/**
 * P7-1 — Coverage Gap context injection into Sales Director free thinking.
 */
import assert from "node:assert/strict";

import { handleHomeBrainFactRequest } from "../server/homeBrainFactCore.js";
import {
  buildCoverageGapContextFromPayload,
  buildCoverageGapDirectorContextLines,
  normalizeCoverageGapForDirector,
} from "../server/salesDirectorCoverageGapContext.js";
import {
  buildSalesDirectorFactoryAudit,
  buildAnswerEvidence,
} from "../server/salesDirectorFactoryAudit.js";
import {
  buildSalesDirectorThinkingContext,
  coverageGapUsedInThinking,
  composeDeterministicFreeThinking,
} from "../server/salesDirectorFreeThinking.js";
import { CONVERSATION_BRAIN_TOPICS } from "../server/salesDirectorConversationBrain.js";

const mockPolicies = [
  { id: "p1", insurer_name: "삼성", product_name: "실손", policy_type: "health" },
  { id: "p2", insurer_name: "현대", product_name: "암보험", policy_type: "cancer" },
];

const mockGapPayload = {
  coverage_gaps: [
    { coverage_type: "cancer", status: "missing", severity: "high" },
    { coverage_type: "medical_expense", status: "adequate", severity: "low" },
  ],
  gap_score: 12,
  overall_severity: "high",
};

const mockGapContext = buildCoverageGapContextFromPayload(mockGapPayload, { jobId: "job-gap" });

function buildMockSupabase({ jobs = [], memoryFacts = [{ fact_key: "insurance.goal", fact_value: "보험료" }] } = {}) {
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
        is() {
          return chain;
        },
        order() {
          return chain;
        },
        limit() {
          return chain;
        },
        in() {
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
          if (table === "active_profile_insurance_policies") payload = { data: mockPolicies, error: null };
          if (table === "customer_memory_facts") {
            const facts = memoryFacts.filter((f) => f.superseded_at == null);
            payload = chain._head
              ? { data: null, error: null, count: facts.length }
              : { data: facts, error: null, count: facts.length };
          }
          if (table === "customer_documents") payload = { data: [], error: null, count: 0 };
          if (table === "customer_conversations") payload = { data: [], error: null };
          if (table === "customer_consents") payload = { data: [], error: null };
          if (table === "profile_health") payload = { data: null, error: null };
          if (table === "analysis_jobs") payload = { data: jobs, error: null };
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

await record(
  await runCase("P1 normalize — compact gap signals from stored payload", async () => {
    const normalized = normalizeCoverageGapForDirector(mockGapPayload);
    assert.equal(normalized.signals.includes("암:공백"), true);
    assert.equal(normalized.signals.includes("실손:유지"), true);
    assert.deepEqual(normalized.top_concerns, ["암"]);
  }),
);

await record(
  await runCase("P2 thinking context — injects Gap(내부) lines, not readout", async () => {
    const block = buildSalesDirectorThinkingContext({
      customerContextBundle: {
        policies: mockPolicies,
        memoryFacts: [{ fact_value: "보험료 부담" }],
        coverageGapContext: mockGapContext,
      },
      loadedContext: { policies: "present", memory: "present" },
      topic: CONVERSATION_BRAIN_TOPICS.CANCER_COVERAGE,
    });
    assert.match(block, /Gap\(내부\):/);
    assert.match(block, /암:공백/);
    assert.doesNotMatch(block, /부족한\s*보장|우선\s*보강/i);
    assert.equal(coverageGapUsedInThinking({ coverageGapContext: mockGapContext }), true);
  }),
);

await record(
  await runCase("P3 deterministic — uses gap concern in director voice", async () => {
    const result = composeDeterministicFreeThinking({
      question: "암보장 있어?",
      topic: CONVERSATION_BRAIN_TOPICS.CANCER_COVERAGE,
      customerContextBundle: {
        policies: mockPolicies,
        memoryFacts: [],
        coverageGapContext: mockGapContext,
      },
      loadedContext: { policies: "present" },
    });
    assert.equal(result.coverage_gap_used, true);
    assert.match(result.text, /공백 신호/);
    assert.doesNotMatch(result.text, /부족한\s*보장/i);
  }),
);

await record(
  await runCase("P4 factory audit — gap loaded+used in answer_evidence", async () => {
    const audit = buildSalesDirectorFactoryAudit({
      customerContextBundle: {
        policies: mockPolicies,
        memoryFacts: [{ fact_value: "보험료" }],
        coverageGapContext: mockGapContext,
      },
      loadedContext: { policies: "present", memory: "present" },
      agentTurn: {
        responseSource: "sales_director_free_thinking",
        factBundle: {
          policies: mockPolicies,
          memory_fact_count: 1,
          coverage_gap_used: true,
        },
        trace: {
          conversation_brain: {
            snapshot_insurance_used: true,
            memory_used: true,
            coverage_gap_used: true,
          },
        },
      },
      storedProbe: {
        availability: {
          coverage_gap: { available: true, record_count: 2, source: "analysis_jobs" },
        },
      },
    });
    assert.equal(audit.coverage_gap.loaded, true);
    assert.equal(audit.coverage_gap.used, true);
    assert.deepEqual(buildAnswerEvidence(audit), ["snapshot", "memory", "coverage_gap"]);
  }),
);

await record(
  await runCase("P5 home-brain integration — gap context loaded from analysis_jobs", async () => {
    const supabase = buildMockSupabase({
      jobs: [{ id: "job-1", result_json: { coverage_gap: mockGapPayload } }],
    });
    const result = await handleHomeBrainFactRequest({
      question: "암보장 있어?",
      history: [],
      userSupabase: supabase,
      customerId: "cust-jwt",
      fetchImpl: async () => {
        throw new Error("no llm");
      },
    });
    assert.equal(result.sales_director_factory_audit.coverage_gap.loaded, true);
    assert.equal(result.sales_director_factory_audit.coverage_gap.used, true);
    assert.ok(result.answer_evidence.includes("coverage_gap"));
  }),
);

console.log(`\nP7-1: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
