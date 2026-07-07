/**
 * ONE KEY Core S02-4 — return_judgment event hand unit tests (local only · no PASS).
 */
import assert from "node:assert/strict";
import { evaluateReturnJudgmentEmitGate } from "../server/keyBrain/returnJudgmentIntakeGate.js";
import {
  isOneKeyCoreReturnJudgmentEnabled,
  ONE_KEY_CORE_RESPONSE_SOURCE,
  resolveOneKeyCoreReturnJudgmentEnv,
} from "../server/keyCore/oneKeyCoreFlags.js";
import { runOneKeyCoreTurn } from "../server/keyCore/oneKeyCoreTurn.js";
import { ONE_KEY_CORE_RETURN_JUDGMENT_STEPS } from "../server/keyCore/oneKeyCoreReturnJudgment.js";

const CUSTOMER_ID = "cust-one-key-core-rj-s024";
const KEY_MASTER_RETURN_JUDGMENT_SENTENCE =
  "다시 연결됐습니다. KEY가 확인되는 범위부터 같이 보겠습니다.";

const ANCHOR_JOB_GAP = {
  id: "job-s024-gap",
  customer_id: CUSTOMER_ID,
  status: "completed",
  completed_at: new Date().toISOString(),
  result_json: {
    coverage_gap: {
      gap_score: 85,
      top_gaps: [{ coverage_type: "cancer", gap_level: "critical", current_status: "insufficient" }],
      customer_visible_top2: [{ coverage_label: "암진단비" }],
    },
    insurance_design: {
      customer_visible_design: {
        priority_coverages: ["암 진단비"],
        next_actions: ["암 진단비 보장 검토"],
      },
    },
  },
};

const ANCHOR_JOB_MINIMAL = {
  id: "job-s024-min",
  customer_id: CUSTOMER_ID,
  status: "completed",
  completed_at: new Date().toISOString(),
  result_json: {
    recommendation: {
      customer_visible_top2: [{ coverage_label: "실손의료비", recommendation_type: "review_existing" }],
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
          data: table === "customer_profiles" ? { id: customerId, display_name: "S024QA" } : null,
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
    ...resolveOneKeyCoreReturnJudgmentEnv(process.env),
    ONE_KEY_CORE_RETURN_JUDGMENT: "1",
    KEY_UPLOAD_ENTRY: "active",
    SALES_DIRECTOR_KEY_CUSTOMER_ALLOWLIST: CUSTOMER_ID,
    ANTHROPIC_API_KEY: "mock-key",
  };
}

const EMIT_GATE = { emit: true, reasons: [] };

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

function assertKeyMasterReturnJudgmentSpeak(result) {
  const speakStep = result.oneKeyCoreTrace?.steps?.find((row) => row.step === "speak");
  assert.equal(speakStep?.payload?.key_speak_master, true);
  assert.equal(speakStep?.payload?.compose_mode, "key_master_return_judgment");
  assert.equal(result.personaMeta?.key_speak_master, true);
  assert.equal(result.personaMeta?.persona_rewrite_blocked, true);
  assert.equal(result.returnJudgmentSentence, KEY_MASTER_RETURN_JUDGMENT_SENTENCE);
}

await runCase("S02-4-1 return_judgment flag gate", () => {
  assert.equal(isOneKeyCoreReturnJudgmentEnabled({ ONE_KEY_CORE_RETURN_JUDGMENT: "1" }), true);
  assert.equal(isOneKeyCoreReturnJudgmentEnabled({ ONE_KEY_CORE_RETURN_JUDGMENT: "0" }), false);
});

await runCase("S02-4-2 gate skip — Core must not run when emit false", () => {
  const gate = evaluateReturnJudgmentEmitGate({
    gapHours: 24,
    hasThreadMessages: true,
    hasBridgeInSession: true,
    hasAnchor: true,
    panelResultsPresent: true,
  });
  assert.equal(gate.emit, false);
  assert.ok(gate.reasons.includes("gap_under_72h"));
});

await runCase("S02-4-3 runOneKeyCoreTurn return_judgment 8-step trace", async () => {
  const env = buildEnv();
  const result = await runOneKeyCoreTurn({
    event: "return_judgment",
    userSupabase: buildMockSupabase(),
    customerId: CUSTOMER_ID,
    sessionId: "sess-s024",
    analysisJob: ANCHOR_JOB_MINIMAL,
    gapHours: 80,
    gate: EMIT_GATE,
    env,
    fetchImpl: async () => new Response("", { status: 503 }),
  });

  assert.equal(result.ok, true);
  assert.equal(result.response_source, ONE_KEY_CORE_RESPONSE_SOURCE.RETURN_JUDGMENT);
  assert.equal(result.event, "return_judgment");
  assert.ok(result.traceComplete);
  const steps = (result.oneKeyCoreTrace?.steps ?? []).map((row) => row.step);
  for (const step of ONE_KEY_CORE_RETURN_JUDGMENT_STEPS) {
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
  assert.ok(String(result.returnJudgmentSentence ?? "").length > 0);
  assert.equal(result.intakeTrace.response_source, ONE_KEY_CORE_RESPONSE_SOURCE.RETURN_JUDGMENT);
});

await runCase("S02-4-4 intake contract fields preserved", async () => {
  const env = buildEnv();
  const result = await runOneKeyCoreTurn({
    event: "return_judgment",
    userSupabase: buildMockSupabase(),
    customerId: CUSTOMER_ID,
    sessionId: "sess-s024",
    analysisJob: ANCHOR_JOB_MINIMAL,
    gapHours: 80,
    gate: EMIT_GATE,
    env,
    fetchImpl: async () => new Response("", { status: 503 }),
  });
  assert.equal(result.ok, true);
  assert.ok(result.intakeTrace.return_judgment_sentence);
  assert.equal(result.intakeTrace.return_judgment_sentence, result.returnJudgmentSentence);
  assert.equal(result.intakeTrace.key_entry, "return_judgment");
  assert.ok(result.intakeTrace.one_key_core_trace?.complete === true);
});

await runCase("S02-4-5 KEY Master speak — gap panel job", async () => {
  const env = buildEnv();
  const result = await runOneKeyCoreTurn({
    event: "return_judgment",
    userSupabase: buildMockSupabase(),
    customerId: CUSTOMER_ID,
    sessionId: "sess-s024-gap",
    analysisJob: ANCHOR_JOB_GAP,
    gapHours: 80,
    gate: EMIT_GATE,
    env,
    fetchImpl: async () => new Response("", { status: 503 }),
  });
  assert.equal(result.ok, true);
  assertKeyMasterReturnJudgmentSpeak(result);
});

console.log(`\nONE KEY Core S02-4: ${failed > 0 ? "FAILED" : "ALL PASSED"} (${passed}/${passed + failed})`);
process.exit(failed > 0 ? 1 : 0);
