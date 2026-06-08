/**
 * Phase 25 Step 1J — Customer policy terms Q&A (server-side).
 * Question → ready gate → policy_knowledge_chunks RAG → Claude answer with used_sources.
 */

import { createClient } from "@supabase/supabase-js";
import {
  createQueryEmbedding,
  DEFAULT_RAG_THRESHOLD,
  DEFAULT_RAG_TOP_K,
  evaluateContextSufficiency,
  resolveOpenAiApiKey,
} from "./documentRagContext.js";
import { resolveAnthropicApiKey } from "./claudeGroundedExecutionCore.js";
import {
  DEFAULT_POLICY_PDF_ID,
  formatPolicyKnowledgeContextForPrompt,
  retrievePolicyKnowledgeChunks,
} from "./realPolicyRagContext.js";

const DEFAULT_CLAUDE_MODEL = "claude-sonnet-4-6";
export const DEFAULT_HANWHA_KNOWLEDGE_DOCUMENT_ID = "bd44f29e-9330-4a2b-8d92-24c75859ca19";

export const POLICY_NOT_READY_MESSAGE =
  "업로드하신 약관을 분석 중입니다. 분석이 완료되면 약관 근거 기반 답변을 제공할 수 있습니다.";

export const INSUFFICIENT_CONTEXT_MESSAGE =
  "제공된 약관 내용만으로는 질문에 답하기에 충분한 근거를 찾지 못했습니다. 약관의 해당 조항을 직접 확인해 주시거나, 질문을 더 구체적으로 입력해 주세요.";

const POLICY_RAG_SYSTEM_RULES = [
  "You are a LIFEGUARD customer insurance consultation assistant.",
  "Answer only using the provided policy terms context.",
  "If the context does not contain enough information, explicitly say the policy context is insufficient in Korean.",
  "Do not invent policy terms, coverage amounts, exclusions, waiting periods, or claim eligibility.",
  "Separate policy-based facts from general insurance explanation.",
  "Do not make underwriting approval/decline or product recommendation decisions.",
  "When citing policy facts, reference the [P#] labels from the context block.",
].join(" ");

export function resolveClaudeModel(env = process.env) {
  return String(env.ANTHROPIC_MODEL ?? env.CLAUDE_MODEL ?? DEFAULT_CLAUDE_MODEL).trim();
}

export function resolveSupabaseConfig(env = process.env) {
  const url = String(env.SUPABASE_URL ?? env.VITE_SUPABASE_URL ?? "").trim();
  const anonKey = String(env.SUPABASE_ANON_KEY ?? env.VITE_SUPABASE_ANON_KEY ?? "").trim();
  const serviceRoleKey = String(
    env.SERVICE_ROLE_KEY ?? env.SUPABASE_SERVICE_ROLE_KEY ?? "",
  ).trim();
  return { url, anonKey, serviceRoleKey };
}

function createUserSupabaseClient(authHeader, env = process.env) {
  const { url, anonKey } = resolveSupabaseConfig(env);
  if (!url || !anonKey) return null;

  const token = String(authHeader ?? "").replace(/^Bearer\s+/i, "").trim();
  const headers = token ? { Authorization: `Bearer ${token}` } : {};

  return createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers },
  });
}

function createServiceRoleSupabaseClient(env = process.env) {
  const { url, serviceRoleKey } = resolveSupabaseConfig(env);
  if (!url || !serviceRoleKey) return null;

  return createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function resolveCustomerId(supabase) {
  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError || !authData?.user) {
    return { ok: false, reason: "UNAUTHORIZED", error_message: "Authentication required." };
  }

  const { data: profile, error: profileError } = await supabase
    .from("customer_profiles")
    .select("id")
    .eq("user_id", authData.user.id)
    .maybeSingle();

  if (profileError || !profile?.id) {
    return { ok: false, reason: "CUSTOMER_PROFILE_NOT_FOUND", error_message: "Customer profile not found." };
  }

  return { ok: true, customerId: profile.id };
}

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} adminSupabase
 */
export async function findPolicyKnowledgeDocument(
  adminSupabase,
  { knowledgeDocumentId = null, policyPdfId = DEFAULT_POLICY_PDF_ID } = {},
) {
  if (knowledgeDocumentId) {
    const { data, error } = await adminSupabase
      .from("policy_knowledge_documents")
      .select("id, title, ingest_status, metadata_json, document_type")
      .eq("id", knowledgeDocumentId)
      .is("deleted_at", null)
      .maybeSingle();

    if (error) {
      throw new Error(`knowledge_document_lookup_failed: ${error.message}`);
    }
    return data ?? null;
  }

  const { data, error } = await adminSupabase
    .from("policy_knowledge_documents")
    .select("id, title, ingest_status, metadata_json, document_type")
    .contains("metadata_json", { policy_pdf_id: policyPdfId })
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(10);

  if (error) {
    throw new Error(`knowledge_document_lookup_failed: ${error.message}`);
  }

  const rows = data ?? [];
  const exact = rows.find(
    (row) => String(row.metadata_json?.policy_pdf_id ?? "") === String(policyPdfId),
  );
  return exact ?? rows[0] ?? null;
}

export function isPolicyKnowledgeReady(documentRow) {
  return String(documentRow?.ingest_status ?? "").trim() === "ready";
}

export function mapPolicyChunksForSufficiency(chunks) {
  return (chunks ?? []).map((chunk) => ({
    ...chunk,
    content: chunk.chunk_text ?? "",
  }));
}

export function mapPolicyChunksToUsedSources(chunks) {
  return (chunks ?? []).map((chunk) => ({
    chunk_id: chunk.id,
    document_id: chunk.document_id,
    knowledge_document_id: chunk.knowledge_document_id ?? chunk.document_id,
    document_title: chunk.document_title ?? null,
    document_type: chunk.document_type ?? null,
    policy_pdf_id: chunk.policy_pdf_id ?? null,
    carrier_id: chunk.carrier_id ?? null,
    product_id: chunk.product_id ?? null,
    chunk_order: chunk.chunk_order ?? null,
    similarity: chunk.similarity ?? null,
    chunk_text: chunk.chunk_text ?? "",
    chunk_text_preview: String(chunk.chunk_text ?? "").slice(0, 200),
  }));
}

export function buildPolicyTermsQaPrompt(question, policyContextBlock) {
  const user = [
    "Answer the customer question using only the policy terms context below.",
    "If the context is insufficient, explicitly say so in Korean.",
    "Do not guess policy terms that are not supported by the context.",
    "",
    `Question: ${question}`,
    "",
    "Policy terms context:",
    policyContextBlock,
  ].join("\n");

  return { system: POLICY_RAG_SYSTEM_RULES, user };
}

async function callAnthropic({ apiKey, modelName, system, user, fetchImpl = fetch }) {
  const response = await fetchImpl("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: modelName,
      max_tokens: 1024,
      system,
      messages: [{ role: "user", content: user }],
    }),
  });

  if (!response.ok) {
    return {
      ok: false,
      reason: "CLAUDE_API_ERROR",
      errorMessage: `Claude API error (${response.status})`,
    };
  }

  const data = await response.json();
  const text = Array.isArray(data?.content)
    ? data.content
        .filter((block) => block?.type === "text")
        .map((block) => block.text)
        .join("\n")
        .trim()
    : "";

  if (!text) {
    return { ok: false, reason: "CLAUDE_EMPTY_RESPONSE", errorMessage: "Claude returned an empty response." };
  }

  return { ok: true, answer: text, model: modelName, provider: "anthropic" };
}

/**
 * @param {{
 *   question: string,
 *   authHeader?: string|null,
 *   mode?: 'execute'|'rag_only',
 *   knowledgeDocumentId?: string|null,
 *   policyPdfId?: string|null,
 *   topK?: number,
 *   threshold?: number,
 *   openAiApiKey?: string|null,
 *   anthropicApiKey?: string|null,
 *   modelName?: string,
 *   fetchImpl?: typeof fetch,
 *   env?: NodeJS.ProcessEnv,
 *   adminSupabase?: import('@supabase/supabase-js').SupabaseClient|null,
 *   testCustomerId?: string|null,
 *   queryEmbedding?: string|null,
 * }}
 */
export async function handlePolicyTermsQaRequest({
  question,
  authHeader,
  mode = "execute",
  knowledgeDocumentId = null,
  policyPdfId = DEFAULT_POLICY_PDF_ID,
  topK = DEFAULT_RAG_TOP_K,
  threshold = DEFAULT_RAG_THRESHOLD,
  openAiApiKey = resolveOpenAiApiKey(),
  anthropicApiKey = resolveAnthropicApiKey(),
  modelName,
  fetchImpl = fetch,
  env = process.env,
  adminSupabase = null,
  testCustomerId = null,
  queryEmbedding: injectedQueryEmbedding = null,
}) {
  const claudeModelName = modelName ?? resolveClaudeModel(env);
  const trimmedQuestion = String(question ?? "").trim();
  if (!trimmedQuestion) {
    return { ok: false, reason: "QUESTION_REQUIRED", error_message: "question is required." };
  }

  let customerId = String(testCustomerId ?? "").trim() || null;
  if (!customerId) {
    const userSupabase = createUserSupabaseClient(authHeader, env);
    if (!userSupabase) {
      return { ok: false, reason: "SUPABASE_NOT_CONFIGURED", error_message: "Supabase server configuration is missing." };
    }

    const customerResult = await resolveCustomerId(userSupabase);
    if (!customerResult.ok) {
      return customerResult;
    }
    customerId = customerId;
  }

  const adminClient = adminSupabase ?? createServiceRoleSupabaseClient(env);
  if (!adminClient) {
    return {
      ok: false,
      reason: "SERVICE_ROLE_NOT_CONFIGURED",
      error_message: "SERVICE_ROLE_KEY is not configured on the server.",
    };
  }

  const resolvedPolicyPdfId = String(policyPdfId ?? DEFAULT_POLICY_PDF_ID).trim() || DEFAULT_POLICY_PDF_ID;
  const resolvedKnowledgeDocumentId = String(knowledgeDocumentId ?? "").trim() || null;

  let knowledgeDocument;
  try {
    knowledgeDocument = await findPolicyKnowledgeDocument(adminClient, {
      knowledgeDocumentId: resolvedKnowledgeDocumentId,
      policyPdfId: resolvedPolicyPdfId,
    });
  } catch (error) {
    return {
      ok: false,
      reason: "KNOWLEDGE_DOCUMENT_LOOKUP_FAILED",
      error_message: error instanceof Error ? error.message : "knowledge_document_lookup_failed",
    };
  }

  if (!knowledgeDocument?.id) {
    return {
      ok: true,
      blocked: true,
      reason: "POLICY_KNOWLEDGE_NOT_FOUND",
      customer_id: customerId,
      question: trimmedQuestion,
      answer: POLICY_NOT_READY_MESSAGE,
      used_sources: [],
      context_used: false,
      insufficient_context: false,
      rag_row_count: 0,
      policy_pdf_id: resolvedPolicyPdfId,
      knowledge_document_id: null,
      ingest_status: null,
    };
  }

  if (!isPolicyKnowledgeReady(knowledgeDocument)) {
    return {
      ok: true,
      blocked: true,
      reason: "POLICY_NOT_READY",
      customer_id: customerId,
      question: trimmedQuestion,
      answer: POLICY_NOT_READY_MESSAGE,
      used_sources: [],
      context_used: false,
      insufficient_context: false,
      rag_row_count: 0,
      policy_pdf_id: resolvedPolicyPdfId,
      knowledge_document_id: knowledgeDocument.id,
      ingest_status: knowledgeDocument.ingest_status ?? null,
    };
  }

  let queryEmbedding = String(injectedQueryEmbedding ?? "").trim() || null;
  if (!queryEmbedding) {
    if (!openAiApiKey) {
      return {
        ok: false,
        reason: "OPENAI_NOT_CONFIGURED",
        error_message: "OPENAI_API_KEY is not configured on the server.",
        knowledge_document_id: knowledgeDocument.id,
        ingest_status: knowledgeDocument.ingest_status,
      };
    }

    try {
      const embedded = await createQueryEmbedding(trimmedQuestion, { apiKey: openAiApiKey, fetchImpl });
      queryEmbedding = embedded.embedding;
    } catch (error) {
      return {
        ok: false,
        reason: "QUERY_EMBEDDING_FAILED",
        error_message: error instanceof Error ? error.message : "query_embedding_failed",
        knowledge_document_id: knowledgeDocument.id,
        ingest_status: knowledgeDocument.ingest_status,
      };
    }
  }

  let chunks;
  try {
    chunks = await retrievePolicyKnowledgeChunks(adminClient, {
      queryEmbedding,
      knowledgeDocumentId: knowledgeDocument.id,
      policyPdfId: resolvedPolicyPdfId,
      topK,
      threshold,
    });
  } catch (error) {
    return {
      ok: false,
      reason: "RAG_RETRIEVAL_FAILED",
      error_message: error instanceof Error ? error.message : "rag_retrieval_failed",
      knowledge_document_id: knowledgeDocument.id,
      ingest_status: knowledgeDocument.ingest_status,
    };
  }

  const usedSources = mapPolicyChunksToUsedSources(chunks);
  const evalChunks = mapPolicyChunksForSufficiency(chunks);
  const { contextUsed, insufficientContext } = evaluateContextSufficiency(evalChunks, {
    threshold,
    question: trimmedQuestion,
  });
  const policyContextBlock = formatPolicyKnowledgeContextForPrompt(chunks);

  if (mode === "rag_only") {
    return {
      ok: true,
      mode: "rag_only",
      customer_id: customerId,
      question: trimmedQuestion,
      answer: null,
      used_sources: usedSources,
      context_used: contextUsed,
      insufficient_context: insufficientContext,
      rag_row_count: chunks.length,
      policy_pdf_id: resolvedPolicyPdfId,
      knowledge_document_id: knowledgeDocument.id,
      ingest_status: knowledgeDocument.ingest_status,
      document_context_preview: policyContextBlock.slice(0, 1200),
    };
  }

  if (insufficientContext) {
    return {
      ok: true,
      mode: "execute",
      customer_id: customerId,
      question: trimmedQuestion,
      answer: INSUFFICIENT_CONTEXT_MESSAGE,
      used_sources: usedSources,
      context_used: false,
      insufficient_context: true,
      rag_row_count: chunks.length,
      policy_pdf_id: resolvedPolicyPdfId,
      knowledge_document_id: knowledgeDocument.id,
      ingest_status: knowledgeDocument.ingest_status,
      claude_skipped: true,
    };
  }

  if (!anthropicApiKey) {
    return {
      ok: false,
      reason: "ANTHROPIC_NOT_CONFIGURED",
      rag_row_count: chunks.length,
      used_sources: usedSources,
      context_used: contextUsed,
      insufficient_context: insufficientContext,
      knowledge_document_id: knowledgeDocument.id,
      ingest_status: knowledgeDocument.ingest_status,
      error_message: "ANTHROPIC_API_KEY is not configured on the server.",
    };
  }

  const { system, user } = buildPolicyTermsQaPrompt(trimmedQuestion, policyContextBlock);
  const claudeResult = await callAnthropic({
    apiKey: anthropicApiKey,
    modelName: claudeModelName,
    system,
    user,
    fetchImpl,
  });

  if (!claudeResult.ok) {
    return {
      ok: false,
      reason: claudeResult.reason,
      rag_row_count: chunks.length,
      used_sources: usedSources,
      context_used: contextUsed,
      insufficient_context: insufficientContext,
      knowledge_document_id: knowledgeDocument.id,
      ingest_status: knowledgeDocument.ingest_status,
      error_message: claudeResult.errorMessage,
    };
  }

  return {
    ok: true,
    mode: "execute",
    customer_id: customerId,
    question: trimmedQuestion,
    answer: claudeResult.answer,
    used_sources: usedSources,
    context_used: contextUsed,
    insufficient_context: insufficientContext,
    rag_row_count: chunks.length,
    policy_pdf_id: resolvedPolicyPdfId,
    knowledge_document_id: knowledgeDocument.id,
    ingest_status: knowledgeDocument.ingest_status,
    model_name: claudeResult.model,
    provider: claudeResult.provider,
    claude_skipped: false,
  };
}

/**
 * @param {unknown} body
 */
export function parsePolicyTermsQaBody(body) {
  if (!body || typeof body !== "object") return null;
  const question = String(body.question ?? body.query ?? "").trim();
  if (!question) return null;

  const modeRaw = String(body.mode ?? "execute").trim().toLowerCase();
  const mode = modeRaw === "rag_only" ? "rag_only" : "execute";

  const knowledgeDocumentId =
    String(body.knowledge_document_id ?? body.knowledgeDocumentId ?? "").trim() || null;
  const policyPdfId = String(body.policy_pdf_id ?? body.policyPdfId ?? "").trim() || null;

  return { question, mode, knowledgeDocumentId, policyPdfId };
}
