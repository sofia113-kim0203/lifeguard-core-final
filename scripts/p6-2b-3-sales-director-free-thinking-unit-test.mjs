/**
 * P6-2B-3 — Sales Director Free Thinking tests.
 */
import assert from "node:assert/strict";

import { handleHomeBrainFactRequest } from "../server/homeBrainFactCore.js";
import {
  composeDeterministicFreeThinking,
  FORBIDDEN_MANUAL_PHRASES,
  hasFreeThinkingQualities,
  violatesManualTemplate,
} from "../server/salesDirectorFreeThinking.js";
import { CONVERSATION_BRAIN_TOPICS } from "../server/salesDirectorConversationBrain.js";

const mockPolicies = [
  { id: "p1", insurer_name: "삼성화재", product_name: "실손", monthly_premium: 116568, policy_type: "health" },
  { id: "p2", insurer_name: "현대해상", product_name: "암보험", monthly_premium: 90000, policy_type: "cancer" },
];

function buildJwtPathMockSupabase({
  policies = mockPolicies,
  memoryFacts = [{ id: "m1", fact_key: "insurance.goal", fact_value: "보험료 부담" }],
  memoryVersion = 1,
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
            return {
              data: { id: "cust-jwt", display_name: "QA", memory_version: memoryVersion },
              error: null,
            };
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
  console.log("p6-2b-3-sales-director-free-thinking-unit-test");
  let passed = 0;
  let failed = 0;
  const record = async (ok) => {
    if (ok) passed += 1;
    else failed += 1;
  };

  const bundle = {
    policies: mockPolicies,
    memoryFacts: [{ fact_key: "insurance.goal", fact_value: "보험료 부담" }],
    memoryFactCount: 1,
  };
  const loadedContext = { policies: "present", memory: "present" };

  await record(
    await runCase("F1 forbidden manual phrases rejected", () => {
      assert.equal(violatesManualTemplate("가입된 보험은 확인돼요.\n다만..."), true);
      assert.equal(
        violatesManualTemplate("기억해 둔 상담 내용도 참고할 수 있어요."),
        true,
      );
      FORBIDDEN_MANUAL_PHRASES.forEach((pattern) => {
        assert.ok(pattern.test("가입된 보험은 확인돼요") || pattern.test("기억해 둔 상담 내용도 참고할 수 있어요"));
      });
    }),
  );

  await record(
    await runCase("F2 opening varies by snapshot seed", () => {
      const a = composeDeterministicFreeThinking({
        question: "내 보험 괜찮아?",
        topic: CONVERSATION_BRAIN_TOPICS.ADEQUACY,
        customerContextBundle: bundle,
        loadedContext,
        contextSnapshotId: "seed-a",
      });
      const b = composeDeterministicFreeThinking({
        question: "내 보험 괜찮아?",
        topic: CONVERSATION_BRAIN_TOPICS.ADEQUACY,
        customerContextBundle: bundle,
        loadedContext,
        contextSnapshotId: "seed-b",
      });
      assert.notEqual(a.opening_variant, b.opening_variant);
      assert.equal(violatesManualTemplate(a.text), false);
      assert.equal(hasFreeThinkingQualities(a.text), true);
    }),
  );

  await record(
    await runCase("F3 natural memory — no manual memory line", () => {
      const result = composeDeterministicFreeThinking({
        question: "보험료 부담돼",
        topic: CONVERSATION_BRAIN_TOPICS.PREMIUM_BURDEN,
        customerContextBundle: bundle,
        loadedContext,
        contextSnapshotId: "mem-1",
      });
      assert.match(result.text, /지난번\s*보험료\s*부담\s*얘기/);
      assert.doesNotMatch(result.text, /기억해\s*둔\s*상담\s*내용도\s*참고할\s*수\s*있어요/);
    }),
  );

  const supabase = buildJwtPathMockSupabase();

  for (const item of [
    { q: "내 보험 괜찮아?", id: "F4" },
    { q: "암보장 있어?", id: "F5" },
    { q: "보험료 부담돼", id: "F6" },
  ]) {
    await record(
      await runCase(`${item.id} ${item.q} — free thinking integration`, async () => {
        const result = await handleHomeBrainFactRequest({
          question: item.q,
          history: [],
          userSupabase: supabase,
          customerId: "cust-jwt",
          fetchImpl: async () => {
            throw new Error("LLM should not be called in unit test");
          },
        });
        assert.equal(result.sales_director_loop, true);
        assert.ok(result.factsUsed.totalCount > 0);
        assert.equal(
          result.sales_director_trace?.conversation_brain?.free_thinking?.status,
          "p6_2b_3",
        );
        assert.equal(violatesManualTemplate(result.answerText), false);
        assert.equal(hasFreeThinkingQualities(result.answerText), true);
        assert.doesNotMatch(result.answerText, /숫자로\s*말씀드리기\s*어려/);
      }),
    );
  }

  console.log(`${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
