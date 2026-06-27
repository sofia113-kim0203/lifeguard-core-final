/**
 * P6-2B-1 — Sales Director Tool Brain first slice tests.
 */
import assert from "node:assert/strict";

import { handleHomeBrainFactRequest } from "../server/homeBrainFactCore.js";
import {
  matchToolBrainSliceQuestion,
  planSalesDirectorToolBrain,
  SALES_DIRECTOR_TOOL_BRAIN_SLICES,
  SALES_DIRECTOR_TOOL_FORBIDDEN,
} from "../server/salesDirectorToolBrain.js";
import { SALES_DIRECTOR_MODES } from "../server/salesDirectorLoop.js";

const mockPolicies = [
  {
    id: "p1",
    insurer_name: "삼성화재",
    product_name: "실손",
    monthly_premium: 116568,
    policy_type: "health",
  },
  {
    id: "p2",
    insurer_name: "현대해상",
    product_name: "운전자",
    monthly_premium: 45000,
    policy_type: "auto",
  },
];

function buildJwtPathMockSupabase({
  policies = mockPolicies,
  documents = [],
  memoryFacts = [{ id: "m1", fact_key: "insurance.goal", fact_value: "보험료" }],
} = {}) {
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
          if (table === "profile_health") return { data: null, error: null };
          return { data: null, error: null };
        },
        then(onFulfilled, onRejected) {
          let payload = { data: [], error: null, count: 0 };
          if (table === "active_profile_insurance_policies") {
            payload = { data: policies, error: null };
          }
          if (table === "customer_memory_facts") {
            const facts = memoryFacts.filter((fact) => {
              if (chain._isFilter?.column === "superseded_at") return fact.superseded_at == null;
              return true;
            });
            payload = chain._head
              ? { data: null, error: null, count: facts.length }
              : { data: facts, error: null, count: facts.length };
          }
          if (table === "customer_documents") {
            payload = { data: documents, error: null, count: documents.length };
          }
          if (table === "customer_conversations") payload = { data: [], error: null };
          if (table === "customer_consents") {
            payload = {
              data: [{ id: "c1", consent_type: "terms_of_service", granted: true }],
              error: null,
            };
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
  console.log("p6-2b-1-sales-director-tool-brain-unit-test");
  let passed = 0;
  let failed = 0;
  const record = async (ok) => {
    if (ok) passed += 1;
    else failed += 1;
  };

  await record(
    await runCase("B1 slice matcher — insurance presence + premium burden", () => {
      assert.equal(matchToolBrainSliceQuestion("내 보험 있어?"), SALES_DIRECTOR_TOOL_BRAIN_SLICES.INSURANCE_PRESENCE);
      assert.equal(matchToolBrainSliceQuestion("보험료 부담돼"), SALES_DIRECTOR_TOOL_BRAIN_SLICES.PREMIUM_BURDEN);
    }),
  );

  await record(
    await runCase("B2 plan — forbidden tools skipped", () => {
      const plan = planSalesDirectorToolBrain({
        question: "내 보험 있어?",
        loadedContext: { policies: "present", memory: "present" },
        modeDecision: { mode: SALES_DIRECTOR_MODES.DEFER, pilotKey: null },
      });
      assert.equal(plan.run, true);
      assert.deepEqual(plan.forbidden_skipped, SALES_DIRECTOR_TOOL_FORBIDDEN);
      assert.ok(plan.tools.includes("snapshot"));
      assert.ok(plan.tools.includes("memory"));
    }),
  );

  await record(
    await runCase("B3 insurance presence — factsUsed.totalCount > 0 when policies present", async () => {
      const supabase = buildJwtPathMockSupabase();
      const result = await handleHomeBrainFactRequest({
        question: "내 보험 있어?",
        history: [],
        userSupabase: supabase,
        customerId: "cust-jwt",
        fetchImpl: async () => {
          throw new Error("LLM should not be called");
        },
      });
      assert.equal(result.loaded_context.policies, "present");
      assert.ok(result.factsUsed.totalCount > 0);
      assert.ok(result.sales_director_trace?.tool_brain?.snapshot_insurance_used === true);
      assert.match(result.answerText, /가입된 보험이/);
      assert.doesNotMatch(result.answerText, /318,683|116568|\d{2,}원/);
    }),
  );

  await record(
    await runCase("B4 premium burden — snapshot trace + factsUsed > 0", async () => {
      const supabase = buildJwtPathMockSupabase();
      const result = await handleHomeBrainFactRequest({
        question: "보험료 부담돼",
        history: [],
        userSupabase: supabase,
        customerId: "cust-jwt",
        fetchImpl: async () => {
          throw new Error("LLM should not be called");
        },
      });
      assert.equal(result.loaded_context.policies, "present");
      assert.ok(result.factsUsed.totalCount > 0);
      const trace = result.sales_director_trace?.tool_brain;
      assert.ok(trace?.snapshot_insurance_used === true || trace?.delegated_to === "pilot_handler");
      assert.match(result.answerText, /부담|걱정|신경|기억나|보면/);
      assert.doesNotMatch(result.answerText, /318,683|161568|\d{6,}원/);
    }),
  );

  await record(
    await runCase("B5 no policies — honest absence, no fabrication", async () => {
      const supabase = buildJwtPathMockSupabase({ policies: [] });
      const result = await handleHomeBrainFactRequest({
        question: "내 보험 있어?",
        history: [],
        userSupabase: supabase,
        customerId: "cust-jwt",
        fetchImpl: async () => {
          throw new Error("LLM should not be called");
        },
      });
      assert.equal(result.loaded_context.policies, "empty");
      assert.equal(result.factsUsed.totalCount, 0);
      assert.match(result.answerText, /찾지 못했|없/);
    }),
  );

  console.log(`${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
