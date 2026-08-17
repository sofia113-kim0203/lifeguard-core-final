/**
 * ONE KEY Core S1 — hand unit tests (Tom S1 gate · local only).
 */
import assert from "node:assert/strict";
import { handleHomeBrainFactRequest } from "../server/homeBrainFactCore.js";
import { isOneKeyCoreS1Enabled, ONE_KEY_CORE_S1_BLOCKED_PATHS } from "../server/keyCore/oneKeyCoreFlags.js";
import { runOneKeyCoreTurn } from "../server/keyCore/oneKeyCoreTurn.js";

const CUSTOMER_ID = "cust-one-key-core-s1";

function buildMockSupabase(customerId = CUSTOMER_ID) {
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
          data: { id: customerId, display_name: "S1QA", memory_version: 1 },
          error: null,
        }),
        then(onFulfilled, onRejected) {
          let payload = { data: [], error: null, count: 0 };
          if (table === "active_profile_insurance_policies") {
            payload = { data: [], error: null };
          }
          if (table === "customer_memory_facts") {
            payload = { data: [], error: null, count: 0 };
          }
          if (table === "analysis_jobs") {
            payload = { data: [], error: null };
          }
          return Promise.resolve(payload).then(onFulfilled, onRejected);
        },
      };
      return chain;
    },
  };
}

function buildS1Env() {
  return {
    ...process.env,
    ONE_KEY_CORE_S1: "1",
    SALES_DIRECTOR_KEY_ORCHESTRATOR: "1",
    SALES_DIRECTOR_KEY_LEGACY_FALLBACK: "0",
    SALES_DIRECTOR_KEY_CUSTOMER_ALLOWLIST: CUSTOMER_ID,
    ANTHROPIC_API_KEY: "mock-key",
  };
}

const QUESTIONS = ["내 보험 괜찮아?", "암보험 부족해?", "그냥 추천해줘"];

let passed = 0;
let failed = 0;

async function runCase(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`PASS ${name}`);
    return true;
  } catch (error) {
    failed += 1;
    console.error(`FAIL ${name}`);
    console.error(error);
    return false;
  }
}

await runCase("S1-1 flag gate", () => {
  assert.equal(isOneKeyCoreS1Enabled({ ONE_KEY_CORE_S1: "1" }), true);
  assert.equal(isOneKeyCoreS1Enabled({ ONE_KEY_CORE_S1: "0" }), false);
  assert.ok(ONE_KEY_CORE_S1_BLOCKED_PATHS.length >= 10);
});

await runCase("S1-2 runOneKeyCoreTurn uses Claude-first, not legacy planner", async () => {
  const env = buildS1Env();
  const result = await runOneKeyCoreTurn({
    userSupabase: buildMockSupabase(),
    customerId: CUSTOMER_ID,
    question: QUESTIONS[0],
    history: [],
    env,
    fetchImpl: async () => new Response("", { status: 503 }),
  });
  assert.equal(result.ok, true);
  assert.ok(String(result.customerText ?? "").length > 0);
  const steps = (result.oneKeyCoreTrace?.steps ?? []).map((row) => row.step);
  assert.equal(steps.includes("planner"), false);
  assert.equal(steps.includes("speak"), false);
  assert.notEqual(result.agentTurn?.responseSource, "runSalesDirectorKeyTurn");
});

await runCase("S1-3 handleHomeBrainFactRequest uses Core not legacy", async () => {
  const env = buildS1Env();
  const result = await handleHomeBrainFactRequest({
    userSupabase: buildMockSupabase(),
    customerId: CUSTOMER_ID,
    question: QUESTIONS[0],
    history: [],
    env,
    fetchImpl: async () => new Response("", { status: 503 }),
  });
  assert.equal(result.ok, true);
  assert.equal(result.agent, "one_key_core_s1");
  assert.equal(result.response_source, "one_key_core_s1");
  assert.ok(result.one_key_core_trace);
  assert.equal(result.tom_gap_light_path, undefined);
  assert.equal(result.tom_voice_trace, undefined);
});

for (const question of QUESTIONS) {
  await runCase(`S1-4 question — ${question}`, async () => {
    const env = buildS1Env();
    const result = await handleHomeBrainFactRequest({
      userSupabase: buildMockSupabase(),
      customerId: CUSTOMER_ID,
      question,
      history: [],
      env,
      fetchImpl: async () => new Response("", { status: 503 }),
    });
    assert.equal(result.ok, true);
    assert.equal(result.response_source, "one_key_core_s1");
    assert.ok(String(result.answerText ?? "").length > 0);
    console.log(`  Q: ${question}`);
    console.log(`  A: ${result.answerText}`);
  });
}

console.log(`\nONE KEY Core S1: ${failed > 0 ? "FAILED" : "ALL PASSED"} (${passed}/${passed + failed})`);
process.exit(failed > 0 ? 1 : 0);
