/**
 * P6-2B-4 — Sales Director latency audit tests (measurement only).
 */
import assert from "node:assert/strict";

import { handleHomeBrainFactRequest } from "../server/homeBrainFactCore.js";
import {
  createSalesDirectorLatencyBucket,
  finalizeSalesDirectorLatency,
  mergeFreeThinkingLatency,
} from "../server/salesDirectorLatencyAudit.js";

const mockPolicies = [
  { id: "p1", insurer_name: "삼성화재", product_name: "실손", monthly_premium: 116568, policy_type: "health" },
];

function buildJwtPathMockSupabase({ policies = mockPolicies } = {}) {
  return {
    from(table) {
      const chain = {
        _head: false,
        select(_columns, options = {}) {
          chain._head = options.head === true;
          return chain;
        },
        eq() {
          return chain;
        },
        is(column, value) {
          chain._isFilter = { column, value };
          return chain;
        },
        order() {
          return chain;
        },
        limit() {
          return chain;
        },
        maybeSingle: async () => {
          if (table === "customer_profiles") {
            return { data: { id: "cust-jwt", display_name: "QA", memory_version: 1 }, error: null };
          }
          return { data: null, error: null };
        },
        then(onFulfilled, onRejected) {
          let payload = { data: [], error: null, count: 0 };
          if (table === "active_profile_insurance_policies") payload = { data: policies, error: null };
          if (table === "customer_memory_facts") {
            payload = chain._head
              ? { data: null, error: null, count: 0 }
              : { data: [], error: null, count: 0 };
          }
          if (table === "customer_documents") payload = { data: [], error: null, count: 0 };
          if (table === "customer_conversations") payload = { data: [], error: null };
          if (table === "customer_consents") {
            payload = { data: [{ id: "c1", consent_type: "terms_of_service", granted: true }], error: null };
          }
          return Promise.resolve(payload).then(onFulfilled, onRejected);
        },
      };
      return chain;
    },
  };
}

async function runCase(name, fn) {
  try {
    await fn();
    console.log(`PASS ${name}`);
    return true;
  } catch (error) {
    console.log(`FAIL ${name}: ${error instanceof Error ? error.message : String(error)}`);
    return false;
  }
}

async function main() {
  console.log("p6-2b-4-sales-director-latency-audit-unit-test");
  let passed = 0;
  let failed = 0;
  const record = async (ok) => {
    if (ok) passed += 1;
    else failed += 1;
  };

  await record(
    await runCase("L1 latency bucket helpers", () => {
      const bucket = createSalesDirectorLatencyBucket();
      mergeFreeThinkingLatency(bucket, {
        free_thinking_prepare_ms: 3,
        claude_ms: 9000,
        parse_ms: 2,
      });
      assert.equal(bucket.free_thinking_prepare_ms, 3);
      assert.equal(bucket.claude_ms, 9000);
      assert.equal(bucket.parse_ms, 2);
      const startedAt = Date.now() - 50;
      finalizeSalesDirectorLatency(bucket, startedAt);
      assert.ok(bucket.total_ms >= 50);
    }),
  );

  await record(
    await runCase("L2 home-brain — latency fields on trace", async () => {
      const supabase = buildJwtPathMockSupabase();
      const result = await handleHomeBrainFactRequest({
        question: "암보장 있어?",
        history: [],
        userSupabase: supabase,
        customerId: "cust-jwt",
        fetchImpl: async () => {
          throw new Error("LLM should not be called");
        },
      });
      const latency = result.sales_director_trace?.latency;
      assert.ok(latency);
      for (const key of [
        "snapshot_ms",
        "memory_ms",
        "tool_brain_ms",
        "free_thinking_prepare_ms",
        "claude_ms",
        "parse_ms",
        "compose_ms",
        "total_ms",
      ]) {
        assert.equal(typeof latency[key], "number", `${key} missing`);
      }
      assert.equal(typeof latency.handler_ms, "number");
      assert.ok(latency.total_ms >= 0);
      assert.ok(Math.abs(latency.total_ms - result.response_latency_ms) <= 5);
    }),
  );

  await record(
    await runCase("L3 free thinking path — prepare_ms > 0 without Claude", async () => {
      const supabase = buildJwtPathMockSupabase();
      const result = await handleHomeBrainFactRequest({
        question: "내 보험 괜찮아?",
        history: [],
        userSupabase: supabase,
        customerId: "cust-jwt",
        fetchImpl: async () => {
          throw new Error("LLM should not be called");
        },
      });
      const latency = result.sales_director_trace?.latency;
      assert.ok(latency.free_thinking_prepare_ms >= 0);
      assert.equal(latency.claude_ms, 0);
    }),
  );

  console.log(`${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
