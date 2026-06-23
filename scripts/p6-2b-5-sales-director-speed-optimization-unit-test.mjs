/**
 * P6-2B-5 — Sales Director speed optimization tests.
 */
import assert from "node:assert/strict";

import { loadSalesDirectorTurnContext } from "../server/customerContextSnapshot.js";
import { runSalesDirectorLoopTurn } from "../server/salesDirectorLoop.js";
import { clearSalesDirectorTurnContextCache } from "../server/salesDirectorTurnContextCache.js";
import {
  buildSalesDirectorThinkingContext,
  hasFreeThinkingQualities,
  composeDeterministicFreeThinking,
} from "../server/salesDirectorFreeThinking.js";
import { CONVERSATION_BRAIN_TOPICS } from "../server/salesDirectorConversationBrain.js";

const mockPolicies = [
  { id: "p1", insurer_name: "삼성", product_name: "실손", policy_type: "health" },
  { id: "p2", insurer_name: "현대", product_name: "암보험", policy_type: "cancer" },
];

function buildCountingSupabase() {
  const counts = {
    profile: 0,
    policies: 0,
    memory: 0,
    conversations: 0,
    consents: 0,
  };

  const supabase = {
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
        is() {
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
            counts.profile += 1;
            return { data: { id: "c1", display_name: "QA", memory_version: 1 }, error: null };
          }
          return { data: null, error: null };
        },
        then(onFulfilled, onRejected) {
          if (table === "active_profile_insurance_policies") counts.policies += 1;
          if (table === "customer_memory_facts") counts.memory += 1;
          if (table === "customer_conversations") counts.conversations += 1;
          if (table === "customer_consents") counts.consents += 1;

          let payload = { data: [], error: null, count: 0 };
          if (table === "active_profile_insurance_policies") payload = { data: mockPolicies, error: null };
          if (table === "customer_memory_facts") {
            const facts = [{ id: "m1", fact_key: "insurance.goal", fact_value: "보험료 부담" }];
            payload = chain._head
              ? { data: null, error: null, count: facts.length }
              : { data: facts, error: null, count: facts.length };
          }
          if (table === "customer_documents") payload = { data: [], error: null, count: 0 };
          if (table === "customer_conversations") payload = { data: [], error: null };
          if (table === "customer_consents") {
            payload = { data: [{ id: "c1", consent_type: "terms", granted: true }], error: null };
          }
          if (table === "profile_health") payload = { data: null, error: null };
          return Promise.resolve(payload).then(onFulfilled, onRejected);
        },
      };
      return chain;
    },
  };

  return { supabase, counts };
}

async function runCase(name, fn) {
  try {
    await fn();
    console.log(`PASS ${name}`);
    return true;
  } catch (error) {
    console.error(`FAIL ${name}`);
    console.error(error);
    return false;
  }
}

let passed = 0;
let failed = 0;

clearSalesDirectorTurnContextCache();

async function record(ok) {
  if (ok) passed += 1;
  else failed += 1;
}

await record(
  await runCase("S1 dedup — single raw/memory fetch per turn", async () => {
    const { supabase, counts } = buildCountingSupabase();
    await loadSalesDirectorTurnContext(supabase, "c1");
    assert.equal(counts.profile, 1, "profile should load once");
    assert.equal(counts.policies, 1, "policies should load once");
    assert.ok(counts.memory <= 2, "memory count + select at most twice");
  }),
);

await record(
  await runCase("S2 loop — uses deduped turn context", async () => {
    clearSalesDirectorTurnContextCache();
    const { supabase, counts } = buildCountingSupabase();
    await runSalesDirectorLoopTurn({
      userSupabase: supabase,
      customerId: "c1",
      question: "암보장 있어?",
      history: [],
      fetchImpl: async () => {
        throw new Error("no llm");
      },
    });
    assert.equal(counts.profile, 1);
    assert.equal(counts.policies, 1);
  }),
);

await record(
  await runCase("S3 context diet — no duplicate question or [지시]", async () => {
    const block = buildSalesDirectorThinkingContext({
      question: "암보장 있어?",
      history: [{ role: "user", content: "안녕" }],
      customerContextBundle: {
        policies: mockPolicies,
        memoryFacts: [{ fact_key: "insurance.goal", fact_value: "보험료" }],
        recentConversation: { latestUserMessageExcerpt: "이전 질문" },
      },
      loadedContext: { policies: "present" },
      topic: CONVERSATION_BRAIN_TOPICS.CANCER_COVERAGE,
    });
    assert.ok(!block.includes("고객 질문:"));
    assert.ok(!block.includes("[지시]"));
    assert.ok(block.includes("주제:암보장") || block.includes("주제: 암보장"));
    assert.ok(!block.includes("최근 발췌"), "skip excerpt when history present");
    assert.ok(block.length < 400, "context block should stay compact");
  }),
);

await record(
  await runCase("S4 quality — direct answer validation passes", async () => {
    const sample =
      "보험 가입은 확인됩니다.\n다만 현재 정보만으로 암진단비 존재 여부까지는 단정할 수 없습니다.\n혹시 가족력 때문인지, 보장 충분성이 궁금한 건지 알려주실 수 있을까요?";
    assert.equal(hasFreeThinkingQualities(sample), true);
  }),
);

await record(
  await runCase("S5 deterministic cancer — direct answer first", async () => {
    const result = composeDeterministicFreeThinking({
      question: "암보장 있어?",
      topic: CONVERSATION_BRAIN_TOPICS.CANCER_COVERAGE,
      customerContextBundle: { policies: mockPolicies, memoryFacts: [] },
      loadedContext: { policies: "present" },
      contextSnapshotId: "snap-1",
    });
    const firstLine = result.text.split("\n")[0];
    assert.match(firstLine, /보험|가입|암보장/);
    assert.doesNotMatch(firstLine, /왜 궁금|마음에 걸/);
  }),
);

console.log(`\nP6-2B-5: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
