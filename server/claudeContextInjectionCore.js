/**
 * Phase 22D Step 4 — Claude context injection foundation (server-side).
 * Question → embedding → match_customer_document_chunks → Claude prompt context.
 */

import { createClient } from "@supabase/supabase-js";
import {
  createQueryEmbedding,
  DEFAULT_RAG_THRESHOLD,
  DEFAULT_RAG_TOP_K,
  evaluateContextSufficiency,
  formatDocumentContextForPrompt,
  mapChunksToUsedSources,
  resolveOpenAiApiKey,
  retrieveCustomerDocumentChunks,
} from "./documentRagContext.js";
import { resolveAnthropicApiKey } from "./claudeGroundedExecutionCore.js";

const DEFAULT_CLAUDE_MODEL = "claude-sonnet-4-20250514";

const RAG_SYSTEM_RULES = [
  "You are a LIFEGUARD customer insurance consultation assistant.",
  "Use the provided customer document context when relevant.",
  "If the context does not contain the answer, say the document context is insufficient.",
  "Do not invent policy terms, coverage amounts, exclusions, or claim eligibility.",
  "Separate document-based facts from general insurance explanation.",
  "Do not make underwriting approval/decline or product recommendation decisions.",
  "When citing document facts, reference the [D#] labels from the context block.",
].join(" ");

export function resolveSupabaseConfig(env = process.env) {
  const url = String(env.SUPABASE_URL ?? env.VITE_SUPABASE_URL ?? "").trim();
  const anonKey = String(env.SUPABASE_ANON_KEY ?? env.VITE_SUPABASE_ANON_KEY ?? "").trim();
  return { url, anonKey };
}

function createSupabaseClient(authHeader, env = process.env) {
  const { url, anonKey } = resolveSupabaseConfig(env);
  if (!url || !anonKey) return null;

  const token = String(authHeader ?? "").replace(/^Bearer\s+/i, "").trim();
  const headers = token ? { Authorization: `Bearer ${token}` } : {};

  return createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers },
  });
}

export function buildClaudeRagPrompt(question, documentContextBlock) {
  const user = [
    "Answer the customer question using the customer document context below when relevant.",
    "If the context is insufficient, explicitly say so in Korean.",
    "",
    `Question: ${question}`,
    "",
    "Customer document context:",
    documentContextBlock,
  ].join("\n");

  return { system: RAG_SYSTEM_RULES, user };
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
 * @param {{
 *   question: string,
 *   authHeader?: string|null,
 *   mode?: 'execute'|'rag_only',
 *   topK?: number,
 *   threshold?: number,
 *   openAiApiKey?: string|null,
 *   anthropicApiKey?: string|null,
 *   modelName?: string,
 *   fetchImpl?: typeof fetch,
 *   env?: NodeJS.ProcessEnv,
 * }}
 */
export async function handleClaudeContextInjectionRequest({
  question,
  authHeader,
  mode = "execute",
  topK = DEFAULT_RAG_TOP_K,
  threshold = DEFAULT_RAG_THRESHOLD,
  openAiApiKey = resolveOpenAiApiKey(),
  anthropicApiKey = resolveAnthropicApiKey(),
  modelName = DEFAULT_CLAUDE_MODEL,
  fetchImpl = fetch,
  env = process.env,
}) {
  const trimmedQuestion = String(question ?? "").trim();
  if (!trimmedQuestion) {
    return { ok: false, reason: "QUESTION_REQUIRED", error_message: "question is required." };
  }

  const supabase = createSupabaseClient(authHeader, env);
  if (!supabase) {
    return { ok: false, reason: "SUPABASE_NOT_CONFIGURED", error_message: "Supabase server configuration is missing." };
  }

  const customerResult = await resolveCustomerId(supabase);
  if (!customerResult.ok) {
    return customerResult;
  }

  const customerId = customerResult.customerId;

  if (!openAiApiKey) {
    return {
      ok: false,
      reason: "OPENAI_NOT_CONFIGURED",
      error_message: "OPENAI_API_KEY is not configured on the server.",
    };
  }

  let queryEmbedding;
  try {
    const embedded = await createQueryEmbedding(trimmedQuestion, { apiKey: openAiApiKey, fetchImpl });
    queryEmbedding = embedded.embedding;
  } catch (error) {
    return {
      ok: false,
      reason: "QUERY_EMBEDDING_FAILED",
      error_message: error instanceof Error ? error.message : "query_embedding_failed",
    };
  }

  let chunks;
  try {
    chunks = await retrieveCustomerDocumentChunks(supabase, {
      customerId,
      queryEmbedding,
      topK,
      threshold,
    });
  } catch (error) {
    return {
      ok: false,
      reason: "RAG_RETRIEVAL_FAILED",
      error_message: error instanceof Error ? error.message : "rag_retrieval_failed",
    };
  }

  const usedSources = mapChunksToUsedSources(chunks);
  const { contextUsed, insufficientContext } = evaluateContextSufficiency(chunks, {
    threshold,
    question: trimmedQuestion,
  });
  const documentContextBlock = formatDocumentContextForPrompt(chunks);

  if (mode === "rag_only") {
    return {
      ok: true,
      mode: "rag_only",
      customer_id: customerId,
      question: trimmedQuestion,
      rag_row_count: chunks.length,
      answer: null,
      used_sources: usedSources,
      context_used: contextUsed,
      insufficient_context: insufficientContext,
      document_context_preview: documentContextBlock.slice(0, 1200),
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
      error_message: "ANTHROPIC_API_KEY is not configured on the server.",
    };
  }

  const { system, user } = buildClaudeRagPrompt(trimmedQuestion, documentContextBlock);
  const claudeResult = await callAnthropic({
    apiKey: anthropicApiKey,
    modelName,
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
    model_name: claudeResult.model,
    provider: claudeResult.provider,
  };
}

/**
 * @param {unknown} body
 */
export function parseClaudeContextInjectionBody(body) {
  if (!body || typeof body !== "object") return null;
  const question = String(body.question ?? body.query ?? "").trim();
  if (!question) return null;
  const modeRaw = String(body.mode ?? "execute").trim().toLowerCase();
  const mode = modeRaw === "rag_only" ? "rag_only" : "execute";
  return { question, mode };
}
