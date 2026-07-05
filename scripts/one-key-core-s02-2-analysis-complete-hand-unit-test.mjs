/**
 * ONE KEY Core S02-2 — analysis_complete event hand unit tests (local only · no PASS).
 */
import assert from "node:assert/strict";
import { KEY_ANALYSIS_INITIATIVE_PASS_VOICE } from "../server/keyAnalysisInitiativeSpeak.js";
import {
  isOneKeyCoreAnalysisCompleteEnabled,
  ONE_KEY_CORE_RESPONSE_SOURCE,
  resolveOneKeyCoreAnalysisCompleteEnv,
} from "../server/keyCore/oneKeyCoreFlags.js";
import { runOneKeyCoreTurn } from "../server/keyCore/oneKeyCoreTurn.js";
import { ONE_KEY_CORE_ANALYSIS_COMPLETE_STEPS } from "../server/keyCore/oneKeyCoreAnalysisComplete.js";

const CUSTOMER_ID = "cust-one-key-core-ac-s022";

const JOB_NO_RECO = {
  id: "job-s022-no-reco",
  customer_id: CUSTOMER_ID,
  status: "completed",
  completed_at: new Date().toISOString(),
  result_json: { coverage_gap: { ok: true } },
};

const JOB_WITH_RECO = {
  id: "job-s022-reco",
  customer_id: CUSTOMER_ID,
  status: "completed",
  completed_at: new Date().toISOString(),
  result_json: {
    recommendation: {
      customer_visible_top2: [
        { coverage_label: "암진단비", recommendation_type: "add_coverage" },
        { coverage_label: "실손의료비", recommendation_type: "review_existing" },
      ],
    },
  },
};

function buildMockSupabase({ customerId = CUSTOMER_ID } = {}) {
  return {
    from(table) {
      const chain = {
        select() {
          return chain;
        },
        eq() {
          return chain;
        },
        is() {
          return chain;
        },
        order() {
          return chain;
        },
        limit() {
          return chain;
        },
        maybeSingle: async () => ({
          data: table === "customer_profiles" ? { id: customerId, display_name: "S022QA" } : null,
          error: null,
        }),
        then(onFulfilled, onRejected) {
          let payload = { data: [], error: null, count: 0 };
          if (table === "active_profile_insurance_policies") payload = { data: [], error: null };
          if (table === "customer_memory_facts") payload = { data: [], error: null, count: 0 };
          if (table === "analysis_jobs") payload = { data: [], error: null };
          if (table === "customer_consents") payload = { data: [{ id: "consent-1" }], error: null };
          return Promise.resolve(payload).then(onFulfilled, onRejected);
        },
      };
      return chain;
    },
  };
}

function buildEnv() {
  return {
    ...resolveOneKeyCoreAnalysisCompleteEnv(process.env),
    ONE_KEY_CORE_ANALYSIS_COMPLETE: "1",
    KEY_UPLOAD_ENTRY: "active",
    SALES_DIRECTOR_KEY_CUSTOMER_ALLOWLIST: CUSTOMER_ID,
    ANTHROPIC_API_KEY: "mock-key",
  };
}

let passed = 0;
let failed = 0;

async function runCase(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`PASS ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`FAIL ${name}`);
    console.error(error);
  }
}

await runCase("S02-2-1 analysis_complete flag gate", () => {
  assert.equal(isOneKeyCoreAnalysisCompleteEnabled({ ONE_KEY_CORE_ANALYSIS_COMPLETE: "1" }), true);
  assert.equal(isOneKeyCoreAnalysisCompleteEnabled({ ONE_KEY_CORE_ANALYSIS_COMPLETE: "0" }), false);
});

await runCase("S02-2-2 runOneKeyCoreTurn analysis_complete 8-step trace", async () => {
  const env = buildEnv();
  const result = await runOneKeyCoreTurn({
    event: "analysis_complete",
    userSupabase: buildMockSupabase(),
    customerId: CUSTOMER_ID,
    analysisJob: JOB_NO_RECO,
    transitionObservedAt: new Date().toISOString(),
    env,
    fetchImpl: async () => new Response("", { status: 503 }),
  });

  assert.equal(result.ok, true);
  assert.equal(result.response_source, ONE_KEY_CORE_RESPONSE_SOURCE.ANALYSIS_COMPLETE);
  assert.equal(result.event, "analysis_complete");
  assert.ok(result.traceComplete);
  const steps = (result.oneKeyCoreTrace?.steps ?? []).map((row) => row.step);
  for (const step of ONE_KEY_CORE_ANALYSIS_COMPLETE_STEPS) {
    assert.ok(steps.includes(step), `missing step ${step}`);
  }
  assert.equal(result.workOrderId, null);
  const woStep = result.oneKeyCoreTrace.steps.find((r) => r.step === "work_order");
  assert.equal(woStep?.payload?.shadow_only, true);
  assert.equal(woStep?.payload?.work_order_id, null);
  assert.equal(woStep?.payload?.persisted, false);
  assert.equal(
    result.oneKeyCoreTrace.steps.find((r) => r.step === "evidence")?.payload?.factory_explain_invoked,
    false,
  );
  assert.ok(String(result.customerInitiativeSentence ?? "").length > 0);
  assert.equal(result.intakeTrace.response_source, ONE_KEY_CORE_RESPONSE_SOURCE.ANALYSIS_COMPLETE);
});

await runCase("S02-2-3 static fallback regression", async () => {
  const env = buildEnv();
  const result = await runOneKeyCoreTurn({
    event: "analysis_complete",
    userSupabase: buildMockSupabase(),
    customerId: CUSTOMER_ID,
    analysisJob: JOB_NO_RECO,
    env,
    fetchImpl: async () => new Response("", { status: 503 }),
  });
  assert.equal(result.ok, true);
  assert.equal(result.personaMeta?.conn_001_panel_wired, false);
  assert.equal(result.personaMeta?.static_draft, KEY_ANALYSIS_INITIATIVE_PASS_VOICE);
  assert.ok(String(result.customerInitiativeSentence ?? "").length > 0);
});

await runCase("S02-2-4 CONN-001 panel branch regression", async () => {
  const env = buildEnv();
  const result = await runOneKeyCoreTurn({
    event: "analysis_complete",
    userSupabase: buildMockSupabase(),
    customerId: CUSTOMER_ID,
    analysisJob: JOB_WITH_RECO,
    env,
    fetchImpl: async () => new Response("", { status: 503 }),
  });
  assert.equal(result.ok, true);
  assert.equal(result.personaMeta?.conn_001_panel_wired, true);
  assert.ok(result.customerInitiativeSentence.includes("암진단비"));
  assert.ok(result.customerInitiativeSentence.includes("같이"));
});

await runCase("S02-2-5 intake contract fields preserved", async () => {
  const env = buildEnv();
  const result = await runOneKeyCoreTurn({
    event: "analysis_complete",
    userSupabase: buildMockSupabase(),
    customerId: CUSTOMER_ID,
    analysisJob: JOB_NO_RECO,
    env,
    fetchImpl: async () => new Response("", { status: 503 }),
  });
  assert.equal(result.ok, true);
  const trace = result.intakeTrace;
  assert.ok(Array.isArray(trace.trace_steps));
  assert.ok(trace.trace_steps.some((row) => row.step === "key_first_judgment"));
  assert.ok(trace.trace_steps.some((row) => row.step === "key_initiative_speak"));
  assert.equal(trace.customer_initiative_sentence, result.customerInitiativeSentence);
  assert.equal(trace.key_entry, "analysis_complete");
});

console.log(`\nONE KEY Core S02-2: ${failed > 0 ? "FAILED" : "ALL PASSED"} (${passed}/${passed + failed})`);
process.exit(failed > 0 ? 1 : 0);
