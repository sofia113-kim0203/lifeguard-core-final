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
import {
  loadCustomerMemorySnapshot,
  mapMemoryFactsForResponse,
  selectRelevantMemoryFacts,
} from "./customerMemorySnapshot.js";
import { assessAnswerReview } from "./memoryReviewLayer.js";

export { mapMemoryFactsForResponse, selectRelevantMemoryFacts } from "./customerMemorySnapshot.js";

const DEFAULT_CLAUDE_MODEL = "claude-sonnet-4-6";

function memorySnapshotResponseFields(memorySnapshot) {
  return {
    memory_version: memorySnapshot.memory_version ?? 0,
    memory_fact_count: memorySnapshot.fact_count ?? 0,
    snapshot_facts_count: memorySnapshot.snapshot_facts_count ?? memorySnapshot.facts?.length ?? 0,
  };
}

const HIGH_RISK_INTENT_PATTERNS = [
  { flag: "underwriting_possible", review: true, pattern: /(가입|인수|심사).{0,16}(가능|될까|거절|할증|부담보|괜찮)/ },
  { flag: "claim_payment_possible", review: true, pattern: /(보험금|청구|지급).{0,16}(가능|받을 수|나올까|될까|거절)/ },
  { flag: "disclosure_duty", review: true, pattern: /(고지|알릴의무).{0,16}(안 해도|위반|해야|괜찮|문제)/ },
  { flag: "health_underwriting", review: true, pattern: /(병력|복용|약|수술|입원|치료).{0,16}(괜찮|가입|심사|고지|부담보|할증|거절)/ },
  { flag: "coverage_terms", review: false, pattern: /(보장|약관|한도|면책|특약|보험료).{0,16}(얼마|가능|내용|기준|알려)/ },
];

export function detectInsuranceRiskIntent(question) {
  const text = String(question ?? "").replace(/\s+/g, " ").trim();
  const matches = HIGH_RISK_INTENT_PATTERNS.filter((entry) => entry.pattern.test(text));
  return {
    risk_flags: Array.from(new Set(matches.map((entry) => entry.flag))),
    requires_agent_review: matches.some((entry) => entry.review),
  };
}

export function determineAnswerBasis({ memoryUsed, contextUsed }) {
  if (memoryUsed && contextUsed) return "memory_and_document";
  if (contextUsed) return "document";
  if (memoryUsed) return "memory_only";
  return "general";
}

export function determineMemoryConfidence(usedMemoryFacts) {
  if (!usedMemoryFacts?.length) return "none";
  if (usedMemoryFacts.some((fact) => ["critical", "high"].includes(fact.importance))) return "high";
  if (usedMemoryFacts.some((fact) => fact.importance === "medium")) return "medium";
  return "low";
}

function buildGuardrailPromptBlock({ answerBasis, memoryConfidence, riskFlags, requiresAgentReview }) {
  return [
    `answer_basis=${answerBasis}`,
    `memory_confidence=${memoryConfidence}`,
    `risk_flags=${riskFlags.length ? riskFlags.join(",") : "none"}`,
    `requires_agent_review=${requiresAgentReview ? "true" : "false"}`,
    "Guardrails:",
    "- Customer memory is prior customer-provided fact/preference/concern only; it is not final underwriting, coverage, or claim evidence.",
    "- Do not conclude sign-up 가능/불가, claim 지급 가능/불가, disclosure violation, exclusions, riders, or coverage amounts from memory alone.",
    "- For underwriting/sign-up questions, say insurer underwriting review is required.",
    "- For claim/payment questions, say policy terms plus diagnosis/receipts/claim documents and insurer review are required.",
    "- For health/disclosure questions, add that an agent or insurer underwriting review is required.",
    "- If memory and uploaded document evidence conflict, state uncertainty and prefer uploaded document evidence.",
  ].join("\n");
}

export function resolveClaudeModel(env = process.env) {
  return String(env.ANTHROPIC_MODEL ?? env.CLAUDE_MODEL ?? DEFAULT_CLAUDE_MODEL).trim();
}

const RAG_SYSTEM_RULES = [
  "You are a LIFEGUARD customer insurance consultation assistant.",
  "Use customer memory facts when relevant, and reference [M#] labels only for facts present in the customer memory snapshot.",
  "Do not invent memory facts, profile details, health history, insurance holdings, policy terms, coverage amounts, exclusions, or claim eligibility.",
  "Use uploaded document evidence when relevant, and reference [D#] labels only for facts present in the document context.",
  "If customer memory and uploaded document evidence conflict, mention the uncertainty and prefer source-backed uploaded document evidence.",
  "Keep these categories separate in the answer: A. customer memory facts, B. uploaded document evidence, C. general insurance explanation.",
  "If the context does not contain the answer, say the provided context is insufficient in Korean.",
  "Never state sign-up eligibility, claim payment eligibility, disclosure-duty outcome, exclusions, riders, or coverage amounts as certain unless uploaded document evidence explicitly supports it; even then, note insurer/agent review where appropriate.",
  "When the question asks about underwriting, claim payment, disclosure duty, health history, loading/exclusion, or rejection risk, answer cautiously and include review-required wording.",
  "Do not make underwriting approval/decline or product recommendation decisions.",
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

export function buildClaudeRagPrompt(
  question,
  documentContextBlock,
  customerMemorySnapshotBlock = "(no active customer memory facts retrieved)",
  guardrailBlock = buildGuardrailPromptBlock({
    answerBasis: "general",
    memoryConfidence: "none",
    riskFlags: [],
    requiresAgentReview: false,
  }),
) {
  const user = [
    "Answer the customer question using the context blocks below when relevant.",
    "Do not infer or fabricate facts that are not present in customer memory or uploaded document evidence.",
    "",
    `Question: ${question}`,
    "",
    "A. customer_memory_snapshot:",
    customerMemorySnapshotBlock,
    "",
    "B. uploaded_document_evidence:",
    documentContextBlock,
    "",
    "C. general_insurance_explanation:",
    "Use only for general education after separating it from memory and document evidence.",
    "",
    "D. insurance_consultation_guardrails:",
    guardrailBlock,
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
  modelName,
  fetchImpl = fetch,
  env = process.env,
}) {
  const claudeModelName = modelName ?? resolveClaudeModel(env);
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

  let memorySnapshot;
  try {
    memorySnapshot = await loadCustomerMemorySnapshot(supabase, customerId);
  } catch (error) {
    return {
      ok: false,
      reason: "MEMORY_SNAPSHOT_FAILED",
      error_message: error instanceof Error ? error.message : "memory_snapshot_failed",
    };
  }

  const relevantMemoryFacts = selectRelevantMemoryFacts(trimmedQuestion, memorySnapshot.facts);
  const usedMemoryFacts = mapMemoryFactsForResponse(relevantMemoryFacts);
  const memoryUsed = usedMemoryFacts.length > 0;
  const riskIntent = detectInsuranceRiskIntent(trimmedQuestion);

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
  const answerBasis = determineAnswerBasis({ memoryUsed, contextUsed });
  const memoryConfidence = determineMemoryConfidence(usedMemoryFacts);
  const riskFlags = riskIntent.risk_flags;
  const answerReview = assessAnswerReview({
    answerBasis,
    riskFlags,
    usedMemoryFacts,
    usedSources,
  });
  const requiresAgentReview = riskIntent.requires_agent_review || answerReview.requires_agent_review;
  const guardrailBlock = buildGuardrailPromptBlock({
    answerBasis,
    memoryConfidence,
    riskFlags,
    requiresAgentReview,
  });

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
      customer_memory_snapshot_preview: memorySnapshot.prompt_block.slice(0, 1200),
      memory_used: memoryUsed,
      used_memory_facts: usedMemoryFacts,
      ...memorySnapshotResponseFields(memorySnapshot),
      requires_agent_review: requiresAgentReview,
      review_reason: answerReview.review_reason,
      review_status: answerReview.review_status,
      review_priority: answerReview.review_priority,
      risk_flags: riskFlags,
      answer_basis: answerBasis,
      memory_confidence: memoryConfidence,
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
      memory_used: memoryUsed,
      used_memory_facts: usedMemoryFacts,
      ...memorySnapshotResponseFields(memorySnapshot),
      requires_agent_review: requiresAgentReview,
      review_reason: answerReview.review_reason,
      review_status: answerReview.review_status,
      review_priority: answerReview.review_priority,
      risk_flags: riskFlags,
      answer_basis: answerBasis,
      memory_confidence: memoryConfidence,
    };
  }

  const { system, user } = buildClaudeRagPrompt(
    trimmedQuestion,
    documentContextBlock,
    memorySnapshot.prompt_block,
    guardrailBlock,
  );
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
      error_message: claudeResult.errorMessage,
      memory_used: memoryUsed,
      used_memory_facts: usedMemoryFacts,
      ...memorySnapshotResponseFields(memorySnapshot),
      requires_agent_review: requiresAgentReview,
      review_reason: answerReview.review_reason,
      review_status: answerReview.review_status,
      review_priority: answerReview.review_priority,
      risk_flags: riskFlags,
      answer_basis: answerBasis,
      memory_confidence: memoryConfidence,
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
    memory_used: memoryUsed,
    used_memory_facts: usedMemoryFacts,
    ...memorySnapshotResponseFields(memorySnapshot),
    requires_agent_review: requiresAgentReview,
    review_reason: answerReview.review_reason,
    review_status: answerReview.review_status,
    review_priority: answerReview.review_priority,
    risk_flags: riskFlags,
    answer_basis: answerBasis,
    memory_confidence: memoryConfidence,
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
