/**
 * Phase 23 Step 2E — Memory review / agent review layer test.
 * No worker deploy: tests pure review helper plus server context-injection path.
 */
import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";
import { handleClaudeContextInjectionRequest } from "../server/claudeContextInjectionCore.js";
import {
  assessAnswerReview,
  assessMemoryReviewCandidate,
} from "../server/memoryReviewLayer.js";

const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const anonKey = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE_KEY;

if (!url || !anonKey || !serviceRoleKey) {
  console.error("Missing Supabase URL, anon key, or service role key");
  process.exit(1);
}

const zeroEmbedding = Array(1536).fill(0);
const report = { phase: "23-2E", env: { hasServiceRole: !!serviceRoleKey }, tests: {} };

function candidate(overrides = {}) {
  return {
    fact_key: "health.medication.summary",
    fact_value: "고객은 혈압약을 복용 중이라고 말했습니다.",
    fact_type: "health",
    importance: "critical",
    metadata_json: {},
    ...overrides,
  };
}

async function setupCustomer(label) {
  const stamp = `${Date.now()}-${Math.floor(Math.random() * 100000)}`;
  const email = `phase23-2e-${label}-${stamp}@example.com`;
  const password = `Step2e!${stamp}`;
  const sb = createClient(url, anonKey, { auth: { persistSession: false } });
  const signUp = await sb.auth.signUp({ email, password });
  if (signUp.error) throw new Error(`${label}_signup:${signUp.error.message}`);
  const signIn = await sb.auth.signInWithPassword({ email, password });
  if (signIn.error) throw new Error(`${label}_signin:${signIn.error.message}`);
  const authUid = (await sb.auth.getUser()).data.user.id;
  const bootstrap = await sb.rpc("lifeguard_bootstrap_customer_signup", {
    p_display_name: `phase23-2e-${label}`,
    p_consent_version: "2026-01-01-ko",
  });
  if (bootstrap.error) throw new Error(`${label}_bootstrap:${bootstrap.error.message}`);
  const profile = await sb.from("customer_profiles").select("id").eq("user_id", authUid).single();
  if (profile.error) throw new Error(`${label}_profile:${profile.error.message}`);
  const session = await sb.auth.getSession();
  return { sb, customerId: profile.data.id, accessToken: session.data.session.access_token };
}

async function grantConsents(admin, customerId) {
  const rows = ["document_storage", "document_analysis", "ai_consultation", "memory_retention"].map((consent_type) => ({
    customer_id: customerId,
    consent_type,
    consent_version: "2026-01-01-ko-step2e",
    granted: true,
    granted_at: new Date().toISOString(),
    source: "phase23_step2e_test",
    purpose: "memory review layer test",
    required: true,
  }));
  const { error } = await admin.from("customer_consents").insert(rows);
  if (error) throw new Error(`consent_seed:${error.message}`);
}

async function seedMemory(admin, customerId) {
  const { error } = await admin.from("customer_memory_facts").insert([
    {
      customer_id: customerId,
      fact_key: "health.medication.summary",
      fact_value: "고객은 혈압약을 복용 중입니다.",
      confidence: 1,
      provenance_type: "profile",
      fact_type: "health",
      importance: "critical",
      source_table: "consultation_messages",
      metadata_json: { consent_type: "ai_consultation", review_status: "pending", requires_agent_review: true },
    },
    {
      customer_id: customerId,
      fact_key: "health.old.superseded",
      fact_value: "사용되면 안 되는 과거 건강 메모리입니다.",
      confidence: 1,
      provenance_type: "profile",
      fact_type: "health",
      importance: "critical",
      source_table: "consultation_messages",
      metadata_json: { consent_type: "ai_consultation" },
      superseded_at: new Date().toISOString(),
    },
  ]);
  if (error) throw new Error(`memory_seed:${error.message}`);
}

async function seedDocument(admin, customerId) {
  const documentId = crypto.randomUUID();
  const doc = await admin.from("customer_documents").insert({
    id: documentId,
    customer_id: customerId,
    storage_path: `${customerId}/${documentId}/step2e.txt`,
    mime_type: "text/plain",
    original_filename: "step2e-terms.txt",
    doc_class: "terms",
    ingest_status: "ready",
  }).select("id").single();
  if (doc.error) throw new Error(`doc_seed:${doc.error.message}`);
  const chunk = await admin.from("customer_document_chunks").insert({
    customer_id: customerId,
    document_id: documentId,
    chunk_index: 0,
    content: "문서 근거: 실손 보장 여부는 약관 표와 청구서류 확인 후 판단합니다.",
    embedding: `[${zeroEmbedding.join(",")}]`,
    embedding_model: "text-embedding-3-small",
    doc_title: "Step2E 약관",
    section: "청구",
    page: 8,
  });
  if (chunk.error) throw new Error(`chunk_seed:${chunk.error.message}`);
}

function fakeFetch(calls) {
  return async (requestUrl, options = {}) => {
    const target = String(requestUrl);
    if (target.includes("api.openai.com/v1/embeddings")) {
      return new Response(JSON.stringify({ data: [{ embedding: zeroEmbedding }] }), { status: 200 });
    }
    if (target.includes("api.anthropic.com/v1/messages")) {
      const body = JSON.parse(options.body ?? "{}");
      calls.prompt = body.messages?.[0]?.content ?? "";
      return new Response(JSON.stringify({ content: [{ type: "text", text: "심사 확인이 필요합니다." }] }), { status: 200 });
    }
    return fetch(requestUrl, options);
  };
}

const vagueHealth = assessMemoryReviewCandidate(candidate(), {
  sourceText: "아마 예전에 혈압약을 먹었던 것 같아요.",
});
report.tests.vagueHealthStatementReview = {
  pass:
    vagueHealth.requires_agent_review === true &&
    vagueHealth.review_status === "pending" &&
    vagueHealth.review_priority === "high" &&
    vagueHealth.memory_confidence === "low" &&
    vagueHealth.review_reason.includes("vague_customer_statement") &&
    vagueHealth.review_reason.includes("health_memory_requires_review"),
  result: vagueHealth,
};

const documentBacked = assessMemoryReviewCandidate(candidate({
  fact_key: "insurance.indemnity.held",
  fact_value: "문서에서 실손 보유가 확인되었습니다.",
  fact_type: "insurance",
  importance: "high",
}), { sourceText: "문서 확인", documentBacked: true });
report.tests.documentBackedInsuranceLowerReview = {
  pass:
    documentBacked.requires_agent_review === false &&
    documentBacked.review_status === "approved" &&
    documentBacked.review_priority === "low" &&
    documentBacked.memory_confidence === "high",
  result: documentBacked,
};

const conflict = assessMemoryReviewCandidate(candidate({
  fact_key: "preference.monthly_budget",
  fact_value: "월 보험료 20만원 이하를 선호합니다.",
  fact_type: "preference",
  importance: "high",
}), { sourceText: "보험료는 20만원 이하 원함", conflictsWithExisting: true });
report.tests.conflictingMemoryReview = {
  pass:
    conflict.requires_agent_review === true &&
    conflict.review_reason.includes("memory_conflict") &&
    conflict.review_priority === "high",
  result: conflict,
};

const smallTalk = assessMemoryReviewCandidate(null, { sourceText: "안녕 오늘 날씨 좋네. 점심 뭐 먹을까?" });
report.tests.casualSmallTalkNoReview = {
  pass:
    smallTalk.requires_agent_review === false &&
    smallTalk.review_status === "approved" &&
    smallTalk.review_reason.length === 0,
  result: smallTalk,
};

const answerReview = assessAnswerReview({
  answerBasis: "memory_only",
  riskFlags: ["underwriting_possible", "health_underwriting"],
  usedMemoryFacts: [{ fact_key: "health.medication.summary", fact_type: "health", importance: "critical" }],
  usedSources: [],
});
report.tests.memoryOnlyUnderwritingReview = {
  pass:
    answerReview.requires_agent_review === true &&
    answerReview.review_reason.includes("memory_only_sensitive_insurance_question") &&
    answerReview.review_reason.includes("no_document_backing_for_high_risk_answer") &&
    answerReview.review_priority === "high",
  result: answerReview,
};

const admin = createClient(url, serviceRoleKey, { auth: { persistSession: false } });
const customer = await setupCustomer("memory-only");
await grantConsents(admin, customer.customerId);
await seedMemory(admin, customer.customerId);

const calls = { prompt: "" };
const result = await handleClaudeContextInjectionRequest({
  question: "혈압약 먹는데 보험 가입 가능해?",
  authHeader: `Bearer ${customer.accessToken}`,
  mode: "execute",
  openAiApiKey: "test-openai-key",
  anthropicApiKey: "test-anthropic-key",
  fetchImpl: fakeFetch(calls),
  env: { ...process.env, SUPABASE_URL: url, SUPABASE_ANON_KEY: anonKey },
});
report.tests.contextInjectionReviewFields = {
  pass:
    result.ok === true &&
    result.answer_basis === "memory_only" &&
    result.requires_agent_review === true &&
    result.review_status === "pending" &&
    result.review_priority === "high" &&
    result.review_reason.includes("memory_only_sensitive_insurance_question") &&
    result.memory_confidence === "high" &&
    result.risk_flags.includes("underwriting_possible") &&
    !calls.prompt.includes("사용되면 안 되는 과거"),
  answer_basis: result.answer_basis,
  requires_agent_review: result.requires_agent_review,
  review_reason: result.review_reason,
  review_priority: result.review_priority,
  memory_confidence: result.memory_confidence,
  risk_flags: result.risk_flags,
};

const docCustomer = await setupCustomer("doc-backed");
await grantConsents(admin, docCustomer.customerId);
await seedDocument(admin, docCustomer.customerId);
const docCalls = { prompt: "" };
const docResult = await handleClaudeContextInjectionRequest({
  question: "약관상 실손 청구 기준 알려줘",
  authHeader: `Bearer ${docCustomer.accessToken}`,
  mode: "execute",
  openAiApiKey: "test-openai-key",
  anthropicApiKey: "test-anthropic-key",
  fetchImpl: fakeFetch(docCalls),
  env: { ...process.env, SUPABASE_URL: url, SUPABASE_ANON_KEY: anonKey },
});
report.tests.documentBackedAnswerPreserved = {
  pass:
    docResult.ok === true &&
    docResult.answer_basis === "document" &&
    docResult.used_sources?.length === 1 &&
    docResult.memory_used === false,
  answer_basis: docResult.answer_basis,
  used_sources_count: docResult.used_sources?.length ?? 0,
  memory_used: docResult.memory_used,
};

assert.equal(report.tests.vagueHealthStatementReview.pass, true);
assert.equal(report.tests.documentBackedInsuranceLowerReview.pass, true);
assert.equal(report.tests.memoryOnlyUnderwritingReview.pass, true);
assert.equal(report.tests.conflictingMemoryReview.pass, true);
assert.equal(report.tests.casualSmallTalkNoReview.pass, true);
assert.equal(report.tests.contextInjectionReviewFields.pass, true);
assert.equal(report.tests.documentBackedAnswerPreserved.pass, true);

report.allPass = Object.values(report.tests).every((test) => test.pass === true);
console.log(JSON.stringify(report, null, 2));
process.exit(report.allPass ? 0 : 1);
