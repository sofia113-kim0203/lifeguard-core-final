/**
 * Phase 26 Step 1A — Customer Memory + Policy RAG + Claude personalized Q&A.
 */

import {
  buildPolicyTermsQaPrompt,
  handlePolicyTermsQaRequest,
  resolveClaudeModel,
  resolveSupabaseConfig,
} from "./policyTermsQaCore.js";
import { resolveAnthropicApiKey } from "./claudeGroundedExecutionCore.js";
import {
  loadCustomerMemorySnapshot,
  mapMemoryFactsForResponse,
  selectRelevantMemoryFacts,
} from "./customerMemorySnapshot.js";
import { invokeMemoryBuilderWorker } from "./customerMemoryFoundation.js";
import { createClient } from "@supabase/supabase-js";

const PERSONALIZED_SYSTEM_RULES = [
  "You are a LIFEGUARD customer insurance consultation assistant.",
  "Use customer memory facts when relevant, and reference [M#] labels only for facts in the customer memory block.",
  "Use policy terms context when relevant, and reference [P#] labels only for facts in the policy block.",
  "Do not invent memory facts, health history, insurance holdings, policy terms, coverage amounts, exclusions, or claim eligibility.",
  "If customer memory and policy context conflict, mention uncertainty and explain both sources separately.",
  "Keep these categories separate: A. customer memory, B. policy terms, C. general insurance explanation.",
  "Personalize the answer using customer memory (health, budget, existing coverage, goals) when applicable.",
  "Do not make underwriting approval/decline or product recommendation decisions.",
  "Respond in Korean.",
].join(" ");

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
  const { url, serviceRoleKey } = {
    url: String(env.SUPABASE_URL ?? env.VITE_SUPABASE_URL ?? "").trim(),
    serviceRoleKey: String(env.SERVICE_ROLE_KEY ?? env.SUPABASE_SERVICE_ROLE_KEY ?? "").trim(),
  };
  if (!url || !serviceRoleKey) return null;
  return createClient(url, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
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

export function buildPersonalizedQaPrompt(question, memoryBlock, policyContextBlock) {
  const user = [
    "Answer the customer question using the context blocks below when relevant.",
    "Personalize using customer memory when the question involves eligibility, budget, health, or existing coverage.",
    "",
    `Question: ${question}`,
    "",
    "A. customer_memory:",
    memoryBlock,
    "",
    "B. policy_terms:",
    policyContextBlock,
    "",
    "C. general_insurance_explanation:",
    "Use only for general education after separating memory and policy evidence.",
  ].join("\n");

  return { system: PERSONALIZED_SYSTEM_RULES, user };
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
      max_tokens: 1200,
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

async function extractConversationMemoryAfterAnswer({
  customerId,
  supabaseUrl,
  serviceRoleKey,
}) {
  if (!customerId || !supabaseUrl || !serviceRoleKey) return null;
  return invokeMemoryBuilderWorker({
    supabaseUrl,
    serviceRoleKey,
    customerId,
    scope: "customer_conversation",
    mode: "rebuild",
  });
}

export async function handleCustomerPersonalizedQaRequest({
  question,
  authHeader,
  mode = "execute",
  knowledgeDocumentId = null,
  policyPdfId = null,
  fetchImpl = fetch,
  env = process.env,
  adminSupabase = null,
  testCustomerId = null,
  skipConversationExtract = false,
} = {}) {
  const trimmedQuestion = String(question ?? "").trim();
  if (!trimmedQuestion) {
    return { ok: false, reason: "QUESTION_REQUIRED", error_message: "question is required." };
  }

  let customerId = String(testCustomerId ?? "").trim() || null;
  let userSupabase = null;
  if (!customerId) {
    userSupabase = createUserSupabaseClient(authHeader, env);
    if (!userSupabase) {
      return { ok: false, reason: "SUPABASE_NOT_CONFIGURED", error_message: "Supabase server configuration is missing." };
    }
    const customerResult = await resolveCustomerId(userSupabase);
    if (!customerResult.ok) return customerResult;
    customerId = customerResult.customerId;
  }

  const adminClient = adminSupabase ?? createServiceRoleSupabaseClient(env) ?? userSupabase;
  if (!adminClient) {
    return { ok: false, reason: "SUPABASE_CLIENT_NOT_AVAILABLE", error_message: "Supabase client unavailable." };
  }

  let memorySnapshot;
  try {
    memorySnapshot = await loadCustomerMemorySnapshot(adminClient, customerId);
  } catch (error) {
    return {
      ok: false,
      reason: "MEMORY_SNAPSHOT_FAILED",
      error_message: error instanceof Error ? error.message : "memory_snapshot_failed",
    };
  }

  const relevantMemoryFacts = selectRelevantMemoryFacts(trimmedQuestion, memorySnapshot.facts);
  const usedMemoryFacts = mapMemoryFactsForResponse(relevantMemoryFacts);
  const memoryBlock = relevantMemoryFacts.length
    ? relevantMemoryFacts
        .map(
          (fact, index) =>
            `[M${index + 1}] type=${fact.fact_type} key=${fact.fact_key} value=${fact.fact_value}`,
        )
        .join("\n")
    : "(no active customer memory facts retrieved)";

  const policyResult = await handlePolicyTermsQaRequest({
    question: trimmedQuestion,
    authHeader,
    mode: "rag_only",
    knowledgeDocumentId,
    policyPdfId,
    fetchImpl,
    env,
    adminSupabase: adminClient,
    testCustomerId: customerId,
  });

  if (!policyResult.ok && !policyResult.blocked) {
    return {
      ...policyResult,
      memory_version: memorySnapshot.memory_version,
      memory_fact_count: memorySnapshot.fact_count,
      used_memory_facts: usedMemoryFacts,
      memory_used: usedMemoryFacts.length > 0,
    };
  }

  const policyContextBlock =
    policyResult.document_context_preview ??
    (policyResult.used_sources?.length
      ? policyResult.used_sources
          .map((source, index) => `[P${index + 1}] ${source.chunk_text_preview ?? ""}`)
          .join("\n")
      : "(no policy terms context retrieved)");

  if (mode === "rag_only") {
    return {
      ok: true,
      mode: "rag_only",
      customer_id: customerId,
      question: trimmedQuestion,
      answer: null,
      memory_version: memorySnapshot.memory_version,
      memory_fact_count: memorySnapshot.fact_count,
      used_memory_facts: usedMemoryFacts,
      memory_used: usedMemoryFacts.length > 0,
      used_sources: policyResult.used_sources ?? [],
      policy_result: policyResult,
      customer_memory_preview: memoryBlock.slice(0, 1200),
      policy_context_preview: String(policyContextBlock).slice(0, 1200),
    };
  }

  if (policyResult.blocked) {
    return {
      ...policyResult,
      memory_version: memorySnapshot.memory_version,
      memory_fact_count: memorySnapshot.fact_count,
      used_memory_facts: usedMemoryFacts,
      memory_used: usedMemoryFacts.length > 0,
      personalized: true,
    };
  }

  const anthropicApiKey = resolveAnthropicApiKey(env);
  if (!anthropicApiKey) {
    return {
      ok: false,
      reason: "ANTHROPIC_NOT_CONFIGURED",
      error_message: "ANTHROPIC_API_KEY is not configured on the server.",
      memory_version: memorySnapshot.memory_version,
      used_memory_facts: usedMemoryFacts,
      used_sources: policyResult.used_sources ?? [],
    };
  }

  const { system, user } = buildPersonalizedQaPrompt(trimmedQuestion, memoryBlock, policyContextBlock);
  const claudeResult = await callAnthropic({
    apiKey: anthropicApiKey,
    modelName: resolveClaudeModel(env),
    system,
    user,
    fetchImpl,
  });

  if (!claudeResult.ok) {
    return {
      ok: false,
      reason: claudeResult.reason,
      error_message: claudeResult.errorMessage,
      memory_version: memorySnapshot.memory_version,
      used_memory_facts: usedMemoryFacts,
      used_sources: policyResult.used_sources ?? [],
    };
  }

  let conversationExtract = null;
  if (!skipConversationExtract) {
    const { url, serviceRoleKey } = {
      url: String(env.SUPABASE_URL ?? env.VITE_SUPABASE_URL ?? "").trim(),
      serviceRoleKey: String(env.SERVICE_ROLE_KEY ?? env.SUPABASE_SERVICE_ROLE_KEY ?? "").trim(),
    };
    if (url && serviceRoleKey) {
      conversationExtract = await extractConversationMemoryAfterAnswer({
        customerId,
        supabaseUrl: url,
        serviceRoleKey,
      });
    }
  }

  return {
    ok: true,
    mode: "execute",
    personalized: true,
    customer_id: customerId,
    question: trimmedQuestion,
    answer: claudeResult.answer,
    memory_version: memorySnapshot.memory_version,
    memory_fact_count: memorySnapshot.fact_count,
    used_memory_facts: usedMemoryFacts,
    memory_used: usedMemoryFacts.length > 0,
    used_sources: policyResult.used_sources ?? [],
    context_used: (policyResult.context_used ?? false) || usedMemoryFacts.length > 0,
    insufficient_context: policyResult.insufficient_context ?? false,
    rag_row_count: policyResult.rag_row_count ?? 0,
    policy_pdf_id: policyResult.policy_pdf_id ?? null,
    knowledge_document_id: policyResult.knowledge_document_id ?? null,
    ingest_status: policyResult.ingest_status ?? null,
    model_name: claudeResult.model,
    provider: claudeResult.provider,
    conversation_memory_extract: conversationExtract?.body ?? null,
  };
}

export function parseCustomerPersonalizedQaBody(body) {
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
