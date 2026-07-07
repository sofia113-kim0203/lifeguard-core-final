/**
 * ONE KEY Core S02-5 — bridge event hand unit tests (local only · no PASS).
 */
import assert from "node:assert/strict";
import { evaluateBridgeEmitGate } from "../server/keyBrain/bridgeIntakeGate.js";
import {
  isOneKeyCoreBridgeEnabled,
  ONE_KEY_CORE_RESPONSE_SOURCE,
  resolveOneKeyCoreBridgeEnv,
} from "../server/keyCore/oneKeyCoreFlags.js";
import { runOneKeyCoreTurn } from "../server/keyCore/oneKeyCoreTurn.js";
import { ONE_KEY_CORE_BRIDGE_STEPS } from "../server/keyCore/oneKeyCoreBridge.js";

const CUSTOMER_ID = "cust-one-key-core-bridge-s025";
const KEY_MASTER_BRIDGE_SENTENCE =
  "지난번 같이 보던 기준으로, 오늘은 이어서 살펴볼게요.";

const ANCHOR_JOB = {
  id: "job-s025-bridge",
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
          data: table === "customer_profiles" ? { id: customerId, display_name: "S025QA" } : null,
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
    ...resolveOneKeyCoreBridgeEnv(process.env),
    ONE_KEY_CORE_BRIDGE: "1",
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

await runCase("S02-5-1 bridge flag gate", () => {
  assert.equal(isOneKeyCoreBridgeEnabled({ ONE_KEY_CORE_BRIDGE: "1" }), true);
  assert.equal(isOneKeyCoreBridgeEnabled({ ONE_KEY_CORE_BRIDGE: "0" }), false);
});

await runCase("S02-5-2 gate skip — Core must not run when emit false", () => {
  const gate = evaluateBridgeEmitGate({
    gapHours: 24,
    hasThreadMessages: true,
    hasAnchor: true,
  });
  assert.equal(gate.emit, false);
  assert.ok(gate.reasons.includes("gap_under_72h"));
});

await runCase("S02-5-3 runOneKeyCoreTurn bridge 8-step trace", async () => {
  const env = buildEnv();
  const result = await runOneKeyCoreTurn({
    event: "bridge",
    userSupabase: buildMockSupabase(),
    customerId: CUSTOMER_ID,
    sessionId: "sess-s025",
    analysisJob: ANCHOR_JOB,
    gapHours: 80,
    gate: EMIT_GATE,
    env,
    fetchImpl: async () => new Response("", { status: 503 }),
  });

  assert.equal(result.ok, true);
  assert.equal(result.response_source, ONE_KEY_CORE_RESPONSE_SOURCE.BRIDGE);
  assert.equal(result.event, "bridge");
  assert.ok(result.traceComplete);
  const steps = (result.oneKeyCoreTrace?.steps ?? []).map((row) => row.step);
  for (const step of ONE_KEY_CORE_BRIDGE_STEPS) {
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
  const speakStep = result.oneKeyCoreTrace.steps.find((r) => r.step === "speak");
  assert.equal(speakStep?.payload?.key_speak_master, true);
  assert.equal(speakStep?.payload?.compose_mode, "key_master_bridge");
  assert.ok(String(result.bridgeSentence ?? "").length > 0);
  assert.equal(result.intakeTrace.response_source, ONE_KEY_CORE_RESPONSE_SOURCE.BRIDGE);
});

await runCase("S02-5-4 bridge_sentence contract preserved", async () => {
  const env = buildEnv();
  const result = await runOneKeyCoreTurn({
    event: "bridge",
    userSupabase: buildMockSupabase(),
    customerId: CUSTOMER_ID,
    sessionId: "sess-s025",
    analysisJob: ANCHOR_JOB,
    gapHours: 80,
    gate: EMIT_GATE,
    env,
    fetchImpl: async () => new Response("", { status: 503 }),
  });
  assert.equal(result.ok, true);
  assert.ok(result.intakeTrace.bridge_sentence);
  assert.equal(result.intakeTrace.bridge_sentence, result.bridgeSentence);
  assert.equal(result.intakeTrace.key_entry, "bridge");
  assert.ok(result.intakeTrace.one_key_core_trace?.complete === true);
});

await runCase("S02-5-5 KEY Master bridge sentence", async () => {
  const env = buildEnv();
  const result = await runOneKeyCoreTurn({
    event: "bridge",
    userSupabase: buildMockSupabase(),
    customerId: CUSTOMER_ID,
    sessionId: "sess-s025-tpl",
    analysisJob: ANCHOR_JOB,
    gapHours: 80,
    gate: EMIT_GATE,
    env,
    fetchImpl: async () => new Response("", { status: 503 }),
  });
  assert.equal(result.ok, true);
  assert.equal(result.personaMeta?.key_speak_master, true);
  assert.equal(result.personaMeta?.persona_rewrite_blocked, true);
  assert.equal(result.bridgeSentence, KEY_MASTER_BRIDGE_SENTENCE);
});

await runCase("S02-5-6 intake trace one_key_core_event", async () => {
  const env = buildEnv();
  const result = await runOneKeyCoreTurn({
    event: "bridge",
    userSupabase: buildMockSupabase(),
    customerId: CUSTOMER_ID,
    sessionId: "sess-s025-trace",
    analysisJob: ANCHOR_JOB,
    gapHours: 80,
    gate: EMIT_GATE,
    env,
    fetchImpl: async () => new Response("", { status: 503 }),
  });
  assert.equal(result.ok, true);
  assert.equal(result.intakeTrace.one_key_core_event, "bridge");
  assert.equal(result.intakeTrace.one_key_core, true);
});

console.log(`\nONE KEY Core S02-5: ${failed > 0 ? "FAILED" : "ALL PASSED"} (${passed}/${passed + failed})`);
process.exit(failed > 0 ? 1 : 0);
