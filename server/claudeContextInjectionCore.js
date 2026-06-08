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

const DEFAULT_CLAUDE_MODEL = "claude-sonnet-4-6";
const DEFAULT_MEMORY_FACT_LIMIT = 12;
const DEFAULT_MEMORY_SNAPSHOT_MAX_CHARS = 2400;

const IMPORTANCE_PRIORITY = { critical: 0, high: 1, medium: 2, low: 3 };
const FACT_TYPE_PRIORITY = { health: 0, insurance: 1, profile: 2, identity: 2 };

const MEMORY_RELEVANCE_KEYWORDS = {
  health: ["건강", "병력", "복용", "약", "입원", "수술", "흡연", "고지", "치료", "질병"],
  insurance: ["보험", "실손", "보장", "담보", "특약", "계약", "증권", "청구", "보험금", "가입"],
  profile: ["나이", "연령", "성별", "직업", "프로필", "고객", "이름"],
  identity: ["나이", "연령", "성별", "직업", "프로필", "고객", "이름"],
};

function priorityValue(map, key, fallback) {
  const normalized = String(key ?? "").toLowerCase();
  return Object.hasOwn(map, normalized) ? map[normalized] : fallback;
}

function compareMemoryFacts(left, right) {
  const importance = priorityValue(IMPORTANCE_PRIORITY, left.importance, 99) -
    priorityValue(IMPORTANCE_PRIORITY, right.importance, 99);
  if (importance !== 0) return importance;

  const type = priorityValue(FACT_TYPE_PRIORITY, left.fact_type, 99) -
    priorityValue(FACT_TYPE_PRIORITY, right.fact_type, 99);
  if (type !== 0) return type;

  return String(right.updated_at ?? "").localeCompare(String(left.updated_at ?? ""));
}

function normalizeFactType(factType) {
  const value = String(factType ?? "").trim();
  return value === "identity" ? "profile" : value || "unknown";
}

function normalizeImportance(importance) {
  const value = String(importance ?? "").trim();
  return value || "low";
}

function sanitizeFactValue(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, 240);
}

function questionTokens(question) {
  return String(question ?? "")
    .toLowerCase()
    .match(/[\uAC00-\uD7A3]{2,}|[a-z0-9]{2,}/g) ?? [];
}

function memoryFactIsRelevant(question, fact) {
  const haystack = [fact.fact_key, fact.fact_type, fact.fact_value]
    .map((value) => String(value ?? "").toLowerCase())
    .join(" ");
  const tokens = questionTokens(question);
  if (tokens.some((token) => haystack.includes(token))) return true;

  const type = normalizeFactType(fact.fact_type);
  const keywords = MEMORY_RELEVANCE_KEYWORDS[type] ?? [];
  const normalizedQuestion = String(question ?? "");
  return keywords.some((keyword) => normalizedQuestion.includes(keyword));
}

export function selectRelevantMemoryFacts(question, facts) {
  return (facts ?? []).filter((fact) => memoryFactIsRelevant(question, fact));
}

export function formatCustomerMemorySnapshotForPrompt(facts, { maxChars = DEFAULT_MEMORY_SNAPSHOT_MAX_CHARS } = {}) {
  if (!facts?.length) {
    return "(no active customer memory facts retrieved)";
  }

  const lines = [];
  let usedChars = 0;
  for (const [index, fact] of facts.entries()) {
    const line = `[M${index + 1}] type=${normalizeFactType(fact.fact_type)} key=${fact.fact_key} importance=${normalizeImportance(fact.importance)} value=${sanitizeFactValue(fact.fact_value)}`;
    if (usedChars + line.length > maxChars) break;
    lines.push(line);
    usedChars += line.length + 1;
  }

  return lines.length ? lines.join("\n") : "(customer memory facts omitted due to prompt size limit)";
}

export function mapMemoryFactsForResponse(facts) {
  return (facts ?? []).map((fact) => ({
    fact_key: fact.fact_key,
    fact_type: normalizeFactType(fact.fact_type),
    importance: normalizeImportance(fact.importance),
  }));
}

export async function loadCustomerMemorySnapshot(
  supabase,
  customerId,
  { limit = DEFAULT_MEMORY_FACT_LIMIT, maxChars = DEFAULT_MEMORY_SNAPSHOT_MAX_CHARS } = {},
) {
  if (!customerId) {
    throw new Error("customer_id_required");
  }

  const { data, error } = await supabase
    .from("customer_memory_facts")
    .select("id, fact_key, fact_value, fact_type, importance, updated_at, metadata_json")
    .eq("customer_id", customerId)
    .is("superseded_at", null);

  if (error) {
    throw new Error(`memory_snapshot_failed: ${error.message}`);
  }

  const facts = (Array.isArray(data) ? data : [])
    .filter((fact) => !fact?.metadata_json?.revoked_at)
    .sort(compareMemoryFacts)
    .slice(0, limit);

  return {
    facts,
    fact_count: facts.length,
    prompt_block: formatCustomerMemorySnapshotForPrompt(facts, { maxChars }),
  };
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

export function buildClaudeRagPrompt(question, documentContextBlock, customerMemorySnapshotBlock = "(no active customer memory facts retrieved)") {
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
      customer_memory_snapshot_preview: memorySnapshot.prompt_block.slice(0, 1200),
      memory_used: memoryUsed,
      used_memory_facts: usedMemoryFacts,
      memory_fact_count: memorySnapshot.fact_count,
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
      memory_fact_count: memorySnapshot.fact_count,
    };
  }

  const { system, user } = buildClaudeRagPrompt(
    trimmedQuestion,
    documentContextBlock,
    memorySnapshot.prompt_block,
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
      memory_fact_count: memorySnapshot.fact_count,
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
    memory_fact_count: memorySnapshot.fact_count,
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
