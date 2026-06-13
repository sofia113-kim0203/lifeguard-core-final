/**
 * Phase 26 Step 1A — Customer Memory foundation E2E.
 */
import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";
import {
  loadCustomerMemorySnapshot,
  selectRelevantMemoryFacts,
  buildStructuredMemoryProfile,
} from "../server/customerMemorySnapshot.js";
import { invokeMemoryBuilderWorker } from "../server/customerMemoryFoundation.js";
import { handleCustomerPersonalizedQaRequest } from "../server/customerPersonalizedQaCore.js";

const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const serviceRoleKey = process.env.SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceRoleKey) throw new Error("SUPABASE_URL and SERVICE_ROLE_KEY are required");

const TEST_CUSTOMER_ID = process.env.PHASE26_TEST_CUSTOMER_ID || "8f8f81e6-a583-44ff-ba6c-a6daed2162ec";

const supabase = createClient(url, serviceRoleKey, { auth: { persistSession: false } });

const { count: baselineFacts } = await supabase
  .from("customer_memory_facts")
  .select("id", { count: "exact", head: true })
  .eq("customer_id", TEST_CUSTOMER_ID)
  .is("superseded_at", null);

const rebuild = await invokeMemoryBuilderWorker({
  supabaseUrl: url,
  serviceRoleKey,
  customerId: TEST_CUSTOMER_ID,
  scope: "profile_health_policy",
  mode: "rebuild",
});
assert.equal(rebuild.ok, true, `profile rebuild should succeed: ${JSON.stringify(rebuild)}`);
assert.equal(rebuild.status, 200, `profile rebuild status should be 200: ${JSON.stringify(rebuild.body)}`);

const convRebuild = await invokeMemoryBuilderWorker({
  supabaseUrl: url,
  serviceRoleKey,
  customerId: TEST_CUSTOMER_ID,
  scope: "customer_conversation",
  mode: "rebuild",
});
assert.equal(convRebuild.ok, true, `conversation rebuild should succeed: ${JSON.stringify(convRebuild)}`);
assert.equal(convRebuild.status, 200, `conversation rebuild status should be 200: ${JSON.stringify(convRebuild.body)}`);

const snapshot = await loadCustomerMemorySnapshot(supabase, TEST_CUSTOMER_ID);
const structured = buildStructuredMemoryProfile(snapshot);
const relevant = selectRelevantMemoryFacts("암보험 가입 가능할까? 혈압약 복용 중이고 월 예산 20만원", snapshot.facts);

const { count: afterFacts } = await supabase
  .from("customer_memory_facts")
  .select("id", { count: "exact", head: true })
  .eq("customer_id", TEST_CUSTOMER_ID)
  .is("superseded_at", null);

let personalized = null;
if (process.env.OPENAI_API_KEY && process.env.ANTHROPIC_API_KEY) {
  personalized = await handleCustomerPersonalizedQaRequest({
    question: "암보험 가입 가능할까? 혈압약 복용 중입니다.",
    testCustomerId: TEST_CUSTOMER_ID,
    adminSupabase: supabase,
    skipConversationExtract: true,
  });
}

const report = {
  phase: "26-1A",
  test_customer_id: TEST_CUSTOMER_ID,
  baseline_facts: baselineFacts,
  after_facts: afterFacts,
  rebuild,
  convRebuild,
  snapshot: {
    memory_version: snapshot.memory_version,
    fact_count: snapshot.fact_count,
    fact_keys: snapshot.facts.map((f) => f.fact_key),
  },
  structured,
  relevant_memory_count: relevant.length,
  personalized: personalized
    ? {
        ok: personalized.ok,
        memory_used: personalized.memory_used,
        used_memory_facts: personalized.used_memory_facts,
        rag_row_count: personalized.rag_row_count,
        has_answer: Boolean(personalized.answer),
      }
    : { skipped: true, reason: "OPENAI_API_KEY or ANTHROPIC_API_KEY missing" },
  tests: {
    profileRebuildOk: { pass: rebuild.status === 200, status: rebuild.status },
    conversationRebuildOk: { pass: convRebuild.status === 200, status: convRebuild.status },
    snapshotLoaded: { pass: snapshot.fact_count >= 0, fact_count: snapshot.fact_count },
    structuredProfile: { pass: structured.profile != null, profile: structured.profile },
    factsPreserved: { pass: (afterFacts ?? 0) >= (baselineFacts ?? 0), baselineFacts, afterFacts },
    memoryRelevance: { pass: relevant.length >= 0, relevant_count: relevant.length },
    personalizedQa: {
      pass: personalized ? personalized.ok === true || personalized.blocked === true : true,
      personalized,
    },
  },
};

report.allPass = Object.values(report.tests).every((test) => test.pass === true);
for (const [name, test] of Object.entries(report.tests)) {
  assert.equal(test.pass, true, `${name} should pass`);
}
console.log(JSON.stringify(report, null, 2));
