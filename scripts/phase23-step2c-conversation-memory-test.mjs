/**
 * Phase 23 Step 2C — Conversation memory builder E2E.
 * Requires deployed memory-builder-worker with scope=conversation support.
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

const report = { phase: "23-2C", env: { hasServiceRole: !!serviceRoleKey }, tests: {} };
const zeroEmbedding = Array(1536).fill(0);

async function setupCustomer(label) {
  const stamp = `${Date.now()}-${Math.floor(Math.random() * 100000)}`;
  const email = `phase23-2c-${label}-${stamp}@example.com`;
  const password = `Step2c!${stamp}`;
  const sb = createClient(url, anonKey, { auth: { persistSession: false } });
  const signUp = await sb.auth.signUp({ email, password });
  if (signUp.error) throw new Error(`${label}_signup:${signUp.error.message}`);
  const signIn = await sb.auth.signInWithPassword({ email, password });
  if (signIn.error) throw new Error(`${label}_signin:${signIn.error.message}`);
  const authUid = (await sb.auth.getUser()).data.user.id;
  const boot = await sb.rpc("lifeguard_bootstrap_customer_signup", {
    p_display_name: `phase23-2c-${label}`,
    p_consent_version: "2026-01-01-ko",
  });
  if (boot.error) throw new Error(`${label}_bootstrap:${boot.error.message}`);
  const profile = await sb.from("customer_profiles").select("id, memory_version").eq("user_id", authUid).single();
  if (profile.error) throw new Error(`${label}_profile:${profile.error.message}`);
  const session = await sb.auth.getSession();
  return { sb, customerId: profile.data.id, memoryVersion: profile.data.memory_version ?? 0, accessToken: session.data.session.access_token };
}

async function grantConsents(admin, customerId, consentTypes) {
  const rows = consentTypes.map((consentType) => ({
    customer_id: customerId,
    consent_type: consentType,
    consent_version: "2026-01-01-ko-step2c",
    granted: true,
    granted_at: new Date().toISOString(),
    source: "phase23_step2c_test",
    purpose: "conversation memory builder test",
    required: true,
  }));
  const { error } = await admin.from("customer_consents").insert(rows);
  if (error) throw new Error(`consent_seed:${error.message}`);
}

async function seedConversation(admin, customerId, messages) {
  const consultation = await admin.from("consultations").insert({ customer_id: customerId, title: "Step2C conversation" }).select("id").single();
  if (consultation.error) throw new Error(`consultation_seed:${consultation.error.message}`);
  const rows = messages.map((content) => ({
    consultation_id: consultation.data.id,
    customer_id: customerId,
    role: "user",
    content,
  }));
  const inserted = await admin.from("consultation_messages").insert(rows).select("id");
  if (inserted.error) throw new Error(`messages_seed:${inserted.error.message}`);
  return { consultationId: consultation.data.id, messageIds: inserted.data.map((row) => row.id) };
}

async function invokeWorker(customerId) {
  const response = await fetch(`${url}/functions/v1/memory-builder-worker`, {
    method: "POST",
    headers: { Authorization: `Bearer ${serviceRoleKey}`, apikey: serviceRoleKey, "Content-Type": "application/json" },
    body: JSON.stringify({ customer_id: customerId, mode: "rebuild", scope: "conversation" }),
  });
  const body = await response.json().catch(() => ({}));
  return { status: response.status, body };
}

async function activeFacts(client, customerId) {
  return client
    .from("customer_memory_facts")
    .select("id, fact_key, fact_value, fact_type, importance, metadata_json, superseded_at", { count: "exact" })
    .eq("customer_id", customerId)
    .is("superseded_at", null);
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
      return new Response(JSON.stringify({ content: [{ type: "text", text: "고객 기억 [M1]과 [M2]를 확인했습니다." }] }), { status: 200 });
    }
    return fetch(requestUrl, options);
  };
}

const admin = createClient(url, serviceRoleKey, { auth: { persistSession: false } });
const primary = await setupCustomer("primary");
const other = await setupCustomer("other");
const noConsent = await setupCustomer("no-consent");
await grantConsents(admin, primary.customerId, ["ai_consultation", "memory_retention", "document_storage", "document_analysis"]);
await grantConsents(admin, other.customerId, ["ai_consultation", "memory_retention"]);
await grantConsents(admin, noConsent.customerId, ["ai_consultation"]);

await seedConversation(admin, primary.customerId, [
  "고혈압 약 먹고 있고 보험료는 15만원 이하 원함. 실손은 유지하고 싶다. 은퇴 준비가 걱정된다.",
]);
await seedConversation(admin, other.customerId, ["보험료는 5만원 이하 원함. 다른 고객 메모리입니다."]);
await seedConversation(admin, noConsent.customerId, ["보험료는 12만원 이하 원함."]);

const firstInvoke = await invokeWorker(primary.customerId);
const firstFacts = await activeFacts(primary.sb, primary.customerId);
const firstKeys = new Set((firstFacts.data ?? []).map((row) => row.fact_key));
report.tests.conversationFactCreation = {
  pass:
    firstInvoke.status === 200 &&
    firstInvoke.body.extractors?.conversation?.skipped === false &&
    firstInvoke.body.fact_action_summary?.inserted >= 5 &&
    [
      "preference.monthly_budget",
      "preference.keep_indemnity",
      "concern.retirement",
      "goal.retirement_preparation",
      "health.medication.summary",
      "consultation.latest_summary",
    ].every((key) => firstKeys.has(key)),
  status: firstInvoke.status,
  facts_changed: firstInvoke.body.facts_changed ?? null,
  fact_action_summary: firstInvoke.body.fact_action_summary ?? null,
  active_keys: Array.from(firstKeys).sort(),
};

const secondInvoke = await invokeWorker(primary.customerId);
report.tests.duplicateNoOp = {
  pass:
    secondInvoke.status === 200 &&
    secondInvoke.body.facts_changed === 0 &&
    secondInvoke.body.fact_action_summary?.no_op === firstFacts.count,
  facts_changed: secondInvoke.body.facts_changed ?? null,
  fact_action_summary: secondInvoke.body.fact_action_summary ?? null,
};
report.tests.memoryVersionNoOp = {
  pass: secondInvoke.body.memory_version === firstInvoke.body.memory_version,
  before: firstInvoke.body.memory_version ?? null,
  after: secondInvoke.body.memory_version ?? null,
};

const beforeBudget = (firstFacts.data ?? []).find((row) => row.fact_key === "preference.monthly_budget");
await seedConversation(admin, primary.customerId, ["보험료는 20만원 이하 원함."]);
const thirdInvoke = await invokeWorker(primary.customerId);
const budgetRows = await admin
  .from("customer_memory_facts")
  .select("id, fact_value, superseded_at")
  .eq("customer_id", primary.customerId)
  .eq("fact_key", "preference.monthly_budget")
  .order("created_at", { ascending: false });
const activeBudget = (budgetRows.data ?? []).find((row) => !row.superseded_at);
const supersededBudget = (budgetRows.data ?? []).find((row) => row.superseded_at);
report.tests.changedPreferenceSupersedes = {
  pass:
    thirdInvoke.status === 200 &&
    thirdInvoke.body.fact_action_summary?.superseded_and_inserted >= 1 &&
    !!supersededBudget &&
    activeBudget?.fact_value === "월 보험료 20만원 이하를 선호합니다." &&
    beforeBudget?.fact_value !== activeBudget?.fact_value,
  status: thirdInvoke.status,
  fact_action_summary: thirdInvoke.body.fact_action_summary ?? null,
  old_value: beforeBudget?.fact_value ?? null,
  new_value: activeBudget?.fact_value ?? null,
};

const snapshotCalls = { prompt: "" };
const snapshotResult = await handleClaudeContextInjectionRequest({
  question: "내 보험료 예산과 은퇴 걱정 기억해?",
  authHeader: `Bearer ${primary.accessToken}`,
  mode: "execute",
  openAiApiKey: "test-openai-key",
  anthropicApiKey: "test-anthropic-key",
  fetchImpl: fakeFetch(snapshotCalls),
  env: { ...process.env, SUPABASE_URL: url, SUPABASE_ANON_KEY: anonKey },
});
report.tests.memorySnapshotIncludesConversationFacts = {
  pass:
    snapshotResult.ok === true &&
    snapshotResult.memory_used === true &&
    snapshotResult.used_memory_facts?.some((fact) => fact.fact_key === "preference.monthly_budget") &&
    snapshotResult.used_memory_facts?.some((fact) => fact.fact_key === "concern.retirement") &&
    snapshotCalls.prompt.includes("preference.monthly_budget") &&
    snapshotCalls.prompt.includes("concern.retirement"),
  memory_used: snapshotResult.memory_used ?? null,
  memory_fact_count: snapshotResult.memory_fact_count ?? null,
  used_memory_facts: snapshotResult.used_memory_facts ?? null,
};

const crossFacts = await other.sb
  .from("customer_memory_facts")
  .select("id", { count: "exact" })
  .eq("customer_id", primary.customerId)
  .is("superseded_at", null);
report.tests.crossCustomerBlocked = {
  pass: !crossFacts.error && crossFacts.count === 0,
  cross_customer_count: crossFacts.count,
  error: crossFacts.error?.message ?? null,
};

const directInsert = await primary.sb.from("customer_memory_facts").insert({
  customer_id: primary.customerId,
  fact_key: "preference.customer_insert_should_fail",
  fact_value: "blocked",
  provenance_type: "profile",
});
report.tests.customerDirectInsertDenied = {
  pass: !!directInsert.error,
  code: directInsert.error?.code ?? null,
  message: directInsert.error?.message ?? null,
};

const noConsentInvoke = await invokeWorker(noConsent.customerId);
report.tests.consentGate = {
  pass:
    noConsentInvoke.status === 200 &&
    noConsentInvoke.body.extractors?.conversation?.skipped === true &&
    noConsentInvoke.body.extractors?.conversation?.skip_reason === "consent_missing:memory_retention" &&
    noConsentInvoke.body.facts_changed === 0,
  status: noConsentInvoke.status,
  extractor: noConsentInvoke.body.extractors?.conversation ?? null,
  facts_changed: noConsentInvoke.body.facts_changed ?? null,
};

report.allPass = Object.values(report.tests).every((test) => test.pass === true);
console.log(JSON.stringify(report, null, 2));
process.exit(report.allPass ? 0 : 1);
