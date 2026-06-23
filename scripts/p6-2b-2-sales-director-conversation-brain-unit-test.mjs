/**
 * P6-2B-2 — Sales Director Conversation Brain tests.
 */
import assert from "node:assert/strict";

import { handleHomeBrainFactRequest } from "../server/homeBrainFactCore.js";
import {
  CONVERSATION_BRAIN_TOPICS,
  isDeadEndDeferResponse,
  matchConversationBrainTopic,
  violatesForbiddenOpening,
} from "../server/salesDirectorConversationBrain.js";
import { INSURANCE_DEFER_WITHOUT_TOOL_MESSAGE } from "../server/homeAgentTom.js";

const mockPolicies = [
  { id: "p1", insurer_name: "삼성화재", product_name: "실손", monthly_premium: 116568, policy_type: "health" },
  { id: "p2", insurer_name: "현대해상", product_name: "암보험", monthly_premium: 90000, policy_type: "cancer" },
  { id: "p3", insurer_name: "DB손보", product_name: "운전자", monthly_premium: 45000, policy_type: "auto" },
  { id: "p4", insurer_name: "메리츠", product_name: "종합", monthly_premium: 77000, policy_type: "life" },
];

function buildJwtPathMockSupabase({
  policies = mockPolicies,
  memoryFacts = [{ id: "m1", fact_key: "insurance.goal", fact_value: "암" }],
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
          return { data: null, error: null };
        },
        then(onFulfilled, onRejected) {
          let payload = { data: [], error: null, count: 0 };
          if (table === "active_profile_insurance_policies") payload = { data: policies, error: null };
          if (table === "customer_memory_facts") {
            const facts = memoryFacts.filter((f) => f.superseded_at == null);
            payload = chain._head
              ? { data: null, error: null, count: facts.length }
              : { data: facts, error: null, count: facts.length };
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

async function assertPassQuestion(name, question, supabase) {
  const result = await handleHomeBrainFactRequest({
    question,
    history: [],
    userSupabase: supabase,
    customerId: "cust-jwt",
    fetchImpl: async () => {
      throw new Error("LLM should not be called");
    },
  });
  assert.equal(result.sales_director_loop, true);
  assert.equal(result.loaded_context.policies, "present");
  assert.ok(result.factsUsed.totalCount > 0);
  assert.equal(result.sales_director_trace?.conversation_brain?.status, "p6_2b_2");
  assert.equal(violatesForbiddenOpening(result.answerText), false);
  assert.doesNotMatch(result.answerText, /숫자로\s*말씀드리기\s*어려|보장내역서를\s*주시면\s*같이\s*확인해\s*볼게요\.?\s*$/);
  assert.match(result.answerText, /[?？]/);
  assert.match(result.answerText, /신경|걱정|괜찮|부담|짚어/);
  return result;
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
  console.log("p6-2b-2-sales-director-conversation-brain-unit-test");
  let passed = 0;
  let failed = 0;
  const record = async (ok) => {
    if (ok) passed += 1;
    else failed += 1;
  };

  await record(
    await runCase("C1 topic matcher — PASS questions", () => {
      assert.equal(matchConversationBrainTopic("암보장 있어?"), CONVERSATION_BRAIN_TOPICS.CANCER_COVERAGE);
      assert.equal(matchConversationBrainTopic("보험료 부담돼"), CONVERSATION_BRAIN_TOPICS.PREMIUM_BURDEN);
      assert.equal(matchConversationBrainTopic("내 보험 괜찮아?"), CONVERSATION_BRAIN_TOPICS.ADEQUACY);
      assert.equal(isDeadEndDeferResponse(INSURANCE_DEFER_WITHOUT_TOOL_MESSAGE), true);
    }),
  );

  const supabase = buildJwtPathMockSupabase();

  await record(
    await runCase("C2 암보장 있어? — no dead-end defer", async () => {
      await assertPassQuestion("cancer", "암보장 있어?", supabase);
    }),
  );

  await record(
    await runCase("C3 보험료 부담돼 — empathy + question", async () => {
      const result = await assertPassQuestion("premium", "보험료 부담돼", supabase);
      assert.match(result.answerText, /부담|걱정/);
      assert.match(result.selected_route, /^sales_director_/);
    }),
  );

  await record(
    await runCase("C4 내 보험 괜찮아? — leads next step", async () => {
      const result = await assertPassQuestion("adequacy", "내 보험 괜찮아?", supabase);
      assert.match(result.answerText, /같이\s*보면|같이\s*볼/);
    }),
  );

  await record(
    await runCase("C5 no policies — does not fabricate", async () => {
      const emptySb = buildJwtPathMockSupabase({ policies: [] });
      const result = await handleHomeBrainFactRequest({
        question: "암보장 있어?",
        history: [],
        userSupabase: emptySb,
        customerId: "cust-jwt",
        fetchImpl: async () => ({ ok: false }),
      });
      assert.equal(result.loaded_context.policies, "empty");
      assert.equal(result.factsUsed.totalCount, 0);
    }),
  );

  console.log(`${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
