/**
 * P6-2B-6a — TTFT optimization tests.
 */
import assert from "node:assert/strict";

import { loadSalesDirectorTurnContext } from "../server/customerContextSnapshot.js";
import {
  clearSalesDirectorTurnContextCache,
  readSalesDirectorTurnContextCache,
  writeSalesDirectorTurnContextCache,
} from "../server/salesDirectorTurnContextCache.js";
import {
  buildSalesDirectorThinkingContext,
  FREE_THINKING_MAX_TOKENS,
  resolveSalesDirectorFreeThinkingModel,
} from "../server/salesDirectorFreeThinking.js";
import { CONVERSATION_BRAIN_TOPICS } from "../server/salesDirectorConversationBrain.js";

const mockPolicies = [
  { id: "p1", insurer_name: "삼성", product_name: "실손", policy_type: "health" },
];

function buildCountingSupabase() {
  const counts = { profile: 0, policies: 0, memory: 0, conversations: 0, consents: 0, health: 0, documents: 0 };

  return {
    counts,
    supabase: {
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
            if (table === "profile_health") counts.health += 1;
            if (table === "customer_documents") counts.documents += 1;

            let payload = { data: [], error: null, count: 0 };
            if (table === "active_profile_insurance_policies") payload = { data: mockPolicies, error: null };
            if (table === "customer_memory_facts") {
              const facts = [{ id: "m1", fact_key: "insurance.goal", fact_value: "보험료" }];
              payload = chain._head
                ? { data: null, error: null, count: facts.length }
                : { data: facts, error: null, count: facts.length };
            }
            return Promise.resolve(payload).then(onFulfilled, onRejected);
          },
        };
        return chain;
      },
    },
  };
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

async function record(ok) {
  if (ok) passed += 1;
  else failed += 1;
}

clearSalesDirectorTurnContextCache();

await record(
  await runCase("A1 fast snapshot — skips health/documents/consents/conversations", async () => {
    const { supabase, counts } = buildCountingSupabase();
    await loadSalesDirectorTurnContext(supabase, "c1", {
      requestHistory: [{ role: "user", content: "암보장 있어?" }],
    });
    assert.equal(counts.health, 0);
    assert.equal(counts.documents, 0);
    assert.equal(counts.consents, 0);
    assert.equal(counts.conversations, 0);
    assert.equal(counts.profile, 1);
    assert.equal(counts.policies, 1);
  }),
);

await record(
  await runCase("A2 turn context cache — second load hits cache", async () => {
    clearSalesDirectorTurnContextCache();
    const { supabase } = buildCountingSupabase();
    const first = await loadSalesDirectorTurnContext(supabase, "c1");
    assert.equal(first.from_cache, false);
    const second = await loadSalesDirectorTurnContext(supabase, "c1");
    assert.equal(second.from_cache, true);
    assert.ok(readSalesDirectorTurnContextCache("c1"));
  }),
);

await record(
  await runCase("B1 context diet — compact block under 180 chars", async () => {
    const block = buildSalesDirectorThinkingContext({
      question: "암보장 있어?",
      history: [{ role: "user", content: "안녕" }],
      customerContextBundle: {
        policies: mockPolicies,
        memoryFacts: [{ fact_key: "insurance.goal", fact_value: "보험료" }],
      },
      loadedContext: { policies: "present" },
      topic: CONVERSATION_BRAIN_TOPICS.CANCER_COVERAGE,
    });
    assert.ok(block.length < 180, `block too long: ${block.length}`);
  }),
);

await record(
  await runCase("B2 free thinking model + token budget", async () => {
    assert.equal(resolveSalesDirectorFreeThinkingModel({}), "claude-haiku-4-5");
    assert.ok(FREE_THINKING_MAX_TOKENS <= 280);
  }),
);

console.log(`\nP6-2B-6a: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
