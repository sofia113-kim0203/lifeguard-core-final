/**
 * Phase 23 Step 2D — Memory-based insurance consultation guardrail E2E.
 * Uses real Supabase customer/RLS rows and fake OpenAI/Claude fetches.
 */
import { createClient } from "@supabase/supabase-js";
import { handleClaudeContextInjectionRequest } from "../server/claudeContextInjectionCore.js";

const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const anonKey = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE_KEY;

if (!url || !anonKey || !serviceRoleKey) {
  console.error("Missing Supabase URL, anon key, or service role key");
  process.exit(1);
}

const zeroEmbedding = Array(1536).fill(0);
const report = { phase: "23-2D", env: { hasServiceRole: !!serviceRoleKey }, tests: {} };

async function setupCustomer(label) {
  const stamp = `${Date.now()}-${Math.floor(Math.random() * 100000)}`;
  const email = `phase23-2d-${label}-${stamp}@example.com`;
  const password = `Step2d!${stamp}`;
  const sb = createClient(url, anonKey, { auth: { persistSession: false } });
  const signUp = await sb.auth.signUp({ email, password });
  if (signUp.error) throw new Error(`${label}_signup:${signUp.error.message}`);
  const signIn = await sb.auth.signInWithPassword({ email, password });
  if (signIn.error) throw new Error(`${label}_signin:${signIn.error.message}`);
  const authUid = (await sb.auth.getUser()).data.user.id;
  const bootstrap = await sb.rpc("lifeguard_bootstrap_customer_signup", {
    p_display_name: `phase23-2d-${label}`,
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
    consent_version: "2026-01-01-ko-step2d",
    granted: true,
    granted_at: new Date().toISOString(),
    source: "phase23_step2d_test",
    purpose: "memory guardrail test",
    required: true,
  }));
  const { error } = await admin.from("customer_consents").insert(rows);
  if (error) throw new Error(`consent_seed:${error.message}`);
}

async function seedMemory(admin, customerId, rows) {
  const normalized = rows.map((row) => ({
    customer_id: customerId,
    confidence: 1,
    provenance_type: "profile",
    source_table: row.source_table ?? "consultation_messages",
    metadata_json: { consent_type: "ai_consultation", no_raw_transcript: true, ...(row.metadata_json ?? {}) },
    ...row,
  }));
  const { error } = await admin.from("customer_memory_facts").insert(normalized);
  if (error) throw new Error(`memory_seed:${error.message}`);
}

async function seedDocument(admin, customerId, content) {
  const documentId = crypto.randomUUID();
  const doc = await admin.from("customer_documents").insert({
    id: documentId,
    customer_id: customerId,
    storage_path: `${customerId}/${documentId}/step2d.txt`,
    mime_type: "text/plain",
    original_filename: "step2d-terms.txt",
    doc_class: "terms",
    ingest_status: "ready",
  }).select("id").single();
  if (doc.error) throw new Error(`doc_seed:${doc.error.message}`);
  const chunk = await admin.from("customer_document_chunks").insert({
    customer_id: customerId,
    document_id: documentId,
    chunk_index: 0,
    content,
    embedding: `[${zeroEmbedding.join(",")}]`,
    embedding_model: "text-embedding-3-small",
    doc_title: "Step2D 약관",
    section: "보장",
    page: 7,
  });
  if (chunk.error) throw new Error(`chunk_seed:${chunk.error.message}`);
  return documentId;
}

function fakeFetch(calls, answerMode = "default") {
  return async (requestUrl, options = {}) => {
    const target = String(requestUrl);
    if (target.includes("api.openai.com/v1/embeddings")) {
      return new Response(JSON.stringify({ data: [{ embedding: zeroEmbedding }] }), { status: 200 });
    }
    if (target.includes("api.anthropic.com/v1/messages")) {
      const body = JSON.parse(options.body ?? "{}");
      calls.request = body;
      const prompt = body.messages?.[0]?.content ?? "";
      let text = "일반 설명입니다.";
      if (answerMode === "memory_only") {
        text = prompt.includes("requires_agent_review=true")
          ? "A. 고객 기억 사실: [M1]은 참고 정보입니다. 가입 가능 여부는 단정할 수 없고 보험사 인수심사 및 설계사 확인이 필요합니다."
          : "가입 가능합니다.";
      } else if (answerMode === "document") {
        text = "B. 업로드 문서 근거: [D1] 약관 기준을 우선 확인했습니다. C. 일반 보험 설명: 세부 적용은 문서 조건을 따릅니다.";
      } else if (answerMode === "conflict") {
        text = prompt.includes("prefer uploaded document evidence")
          ? "고객 기억 [M1]과 문서 근거 [D1]가 충돌하므로 불확실성이 있습니다. 문서 근거를 우선하고 설계사 확인이 필요합니다."
          : "기억만 기준으로 확정합니다.";
      }
      return new Response(JSON.stringify({ content: [{ type: "text", text }] }), { status: 200 });
    }
    return fetch(requestUrl, options);
  };
}

async function runQuestion(customer, question, answerMode) {
  const calls = { request: null };
  const result = await handleClaudeContextInjectionRequest({
    question,
    authHeader: `Bearer ${customer.accessToken}`,
    mode: "execute",
    openAiApiKey: "test-openai-key",
    anthropicApiKey: "test-anthropic-key",
    fetchImpl: fakeFetch(calls, answerMode),
    env: { ...process.env, SUPABASE_URL: url, SUPABASE_ANON_KEY: anonKey },
  });
  return { result, prompt: calls.request?.messages?.[0]?.content ?? "", system: calls.request?.system ?? "" };
}

const admin = createClient(url, serviceRoleKey, { auth: { persistSession: false } });
const memoryOnly = await setupCustomer("memory-only");
const docOnly = await setupCustomer("doc-only");
const conflict = await setupCustomer("conflict");
const unrelated = await setupCustomer("unrelated");
const other = await setupCustomer("other");
for (const customer of [memoryOnly, docOnly, conflict, unrelated, other]) {
  await grantConsents(admin, customer.customerId);
}

await seedMemory(admin, memoryOnly.customerId, [
  { fact_key: "health.medication.summary", fact_value: "고객은 혈압약을 복용 중입니다.", fact_type: "health", importance: "critical" },
  { fact_key: "health.old.superseded", fact_value: "사용되면 안 되는 과거 병력입니다.", fact_type: "health", importance: "critical", superseded_at: new Date().toISOString() },
]);
await seedMemory(admin, other.customerId, [
  { fact_key: "health.medication.summary", fact_value: "다른 고객의 비공개 건강 기억입니다.", fact_type: "health", importance: "critical" },
]);

await seedDocument(admin, docOnly.customerId, "약관 문서 근거: 입원 치료비는 자기부담금 공제 후 보장될 수 있으며 세부 한도는 약관 표를 따릅니다.");
await seedMemory(admin, conflict.customerId, [
  { fact_key: "insurance.indemnity.held", fact_value: "고객은 실손 보장이 충분하다고 기억했습니다.", fact_type: "insurance", importance: "high" },
]);
await seedDocument(admin, conflict.customerId, "업로드 문서 근거: 해당 특약은 면책기간 중에는 보장되지 않을 수 있습니다.");
await seedMemory(admin, unrelated.customerId, [
  { fact_key: "preference.monthly_budget", fact_value: "월 보험료 15만원 이하를 선호합니다.", fact_type: "preference", importance: "high" },
]);

const memoryOnlyRun = await runQuestion(memoryOnly, "내가 혈압약 먹고 있는데 보험 가입 가능해?", "memory_only");
report.tests.memoryOnlyUnderwritingGuardrail = {
  pass:
    memoryOnlyRun.result.ok &&
    memoryOnlyRun.result.memory_used === true &&
    memoryOnlyRun.result.answer_basis === "memory_only" &&
    memoryOnlyRun.result.memory_confidence === "high" &&
    memoryOnlyRun.result.requires_agent_review === true &&
    memoryOnlyRun.result.risk_flags?.includes("underwriting_possible") &&
    memoryOnlyRun.result.risk_flags?.includes("health_underwriting") &&
    memoryOnlyRun.result.answer.includes("단정할 수 없") &&
    memoryOnlyRun.result.answer.includes("인수심사") &&
    memoryOnlyRun.prompt.includes("requires_agent_review=true") &&
    !memoryOnlyRun.prompt.includes("사용되면 안 되는") &&
    !memoryOnlyRun.prompt.includes("다른 고객의 비공개"),
  answer_basis: memoryOnlyRun.result.answer_basis,
  memory_confidence: memoryOnlyRun.result.memory_confidence,
  requires_agent_review: memoryOnlyRun.result.requires_agent_review,
  risk_flags: memoryOnlyRun.result.risk_flags,
};

const docRun = await runQuestion(docOnly, "약관상 입원 치료비 보장 기준 알려줘", "document");
report.tests.documentBackedCoverageBasis = {
  pass:
    docRun.result.ok &&
    docRun.result.answer_basis === "document" &&
    docRun.result.memory_used === false &&
    docRun.result.used_sources?.length === 1 &&
    docRun.result.context_used === true &&
    docRun.result.risk_flags?.includes("coverage_terms") &&
    docRun.result.requires_agent_review === false &&
    docRun.prompt.includes("[D1] document_id=") &&
    Boolean(docRun.result.answer),
  answer_basis: docRun.result.answer_basis,
  used_sources_count: docRun.result.used_sources?.length ?? 0,
  risk_flags: docRun.result.risk_flags,
  requires_agent_review: docRun.result.requires_agent_review,
};

const conflictRun = await runQuestion(conflict, "내 기억과 약관이 다르면 보장 가능해?", "conflict");
report.tests.memoryDocumentConflictUncertainty = {
  pass:
    conflictRun.result.ok &&
    conflictRun.result.answer_basis === "memory_and_document" &&
    conflictRun.result.memory_used === true &&
    conflictRun.result.used_sources?.length === 1 &&
    conflictRun.prompt.includes("If memory and uploaded document evidence conflict") &&
    conflictRun.result.answer.includes("불확실") &&
    conflictRun.result.answer.includes("문서 근거를 우선"),
  answer_basis: conflictRun.result.answer_basis,
  memory_used: conflictRun.result.memory_used,
  used_sources_count: conflictRun.result.used_sources?.length ?? 0,
};

const unrelatedRun = await runQuestion(unrelated, "미국 주식 투자 추천 종목 알려줘", "default");
report.tests.unrelatedNoFalseMemoryUse = {
  pass:
    unrelatedRun.result.ok &&
    unrelatedRun.result.memory_used === false &&
    unrelatedRun.result.used_memory_facts?.length === 0 &&
    unrelatedRun.result.answer_basis === "general" &&
    unrelatedRun.result.memory_confidence === "none",
  memory_used: unrelatedRun.result.memory_used,
  used_memory_facts: unrelatedRun.result.used_memory_facts,
  answer_basis: unrelatedRun.result.answer_basis,
  memory_confidence: unrelatedRun.result.memory_confidence,
};

report.tests.crossCustomerAndSupersededExcluded = {
  pass:
    memoryOnlyRun.result.ok &&
    !memoryOnlyRun.prompt.includes("사용되면 안 되는") &&
    !memoryOnlyRun.prompt.includes("다른 고객의 비공개"),
  prompt_excludes_superseded: !memoryOnlyRun.prompt.includes("사용되면 안 되는"),
  prompt_excludes_other_customer: !memoryOnlyRun.prompt.includes("다른 고객의 비공개"),
};

report.allPass = Object.values(report.tests).every((test) => test.pass === true);
console.log(JSON.stringify(report, null, 2));
process.exit(report.allPass ? 0 : 1);
