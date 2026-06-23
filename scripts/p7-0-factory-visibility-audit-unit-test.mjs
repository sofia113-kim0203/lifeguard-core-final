/**
 * P7-0 — Factory Visibility Audit tests.
 */
import assert from "node:assert/strict";

import { handleHomeBrainFactRequest } from "../server/homeBrainFactCore.js";
import {
  buildSalesDirectorFactoryAudit,
  classifyFactoryHypothesis,
  findPrimaryFactoryDisconnect,
  probeStoredFactoryAvailabilityFromJobs,
} from "../server/salesDirectorFactoryAudit.js";

const mockPolicies = [
  { id: "p1", insurer_name: "삼성", product_name: "실손", policy_type: "health" },
  { id: "p2", insurer_name: "현대", product_name: "암보험", policy_type: "cancer" },
];

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
  await runCase("P1 stored probe — detects engine panels in analysis_jobs", async () => {
    const probe = probeStoredFactoryAvailabilityFromJobs([
      {
        id: "job-1",
        result_json: {
          coverage_gap: { coverage_gaps: [{ item: "cancer" }, { item: "health" }] },
          underwriting_risk: { risk_factors: [{ key: "smoking" }] },
          recommendation: { recommendations: [{ id: "r1" }] },
          insurance_design: { plans: [{ id: "d1" }] },
        },
      },
    ]);
    assert.equal(probe.availability.coverage_gap.available, true);
    assert.equal(probe.availability.coverage_gap.record_count, 2);
    assert.equal(probe.availability.underwriting.available, true);
    assert.equal(probe.availability.recommendation.available, true);
    assert.equal(probe.availability.design.available, true);
  }),
);

await record(
  await runCase("P2 hypothesis A — engines available but not loaded in sales director", async () => {
    const audit = buildSalesDirectorFactoryAudit({
      customerContextBundle: { policies: mockPolicies, memoryFacts: [{ fact_value: "보험료" }] },
      loadedContext: { policies: "present", memory: "present" },
      agentTurn: {
        responseSource: "sales_director_free_thinking",
        factBundle: { policies: mockPolicies, memory_fact_count: 1, customer_context_used: true },
        trace: { conversation_brain: { snapshot_insurance_used: true, memory_used: true } },
      },
      storedProbe: probeStoredFactoryAvailabilityFromJobs([
        { id: "job-1", result_json: { coverage_gap: { coverage_gaps: [{}] } } },
      ]),
    });
    assert.deepEqual(audit.answer_evidence, ["snapshot", "memory"]);
    assert.equal(audit.coverage_gap.available, true);
    assert.equal(audit.coverage_gap.loaded, false);
    assert.equal(audit.coverage_gap.used, false);
    assert.equal(classifyFactoryHypothesis(audit).hypothesis, "A");
    assert.equal(findPrimaryFactoryDisconnect(audit).factory, "coverage_gap");
  }),
);

await record(
  await runCase("P3 hypothesis B — no stored engine panels", async () => {
    const audit = buildSalesDirectorFactoryAudit({
      customerContextBundle: { policies: mockPolicies, memoryFacts: [] },
      loadedContext: { policies: "present", memory: "empty" },
      agentTurn: { responseSource: "sales_director_free_thinking", factBundle: { policies: mockPolicies } },
      storedProbe: probeStoredFactoryAvailabilityFromJobs([]),
    });
    assert.equal(classifyFactoryHypothesis(audit).hypothesis, "B");
  }),
);

await record(
  await runCase("P4 home-brain integration — audit fields on response", async () => {
    const supabase = buildMockSupabase({
      jobs: [{ id: "job-1", result_json: { coverage_gap: { coverage_gaps: [{}] } } }],
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
    assert.ok(result.sales_director_factory_audit);
    assert.ok(Array.isArray(result.answer_evidence));
    assert.ok(result.sales_director_trace?.sales_director_factory_audit);
    assert.ok(result.factory_hypothesis);
    assert.ok(result.sales_director_factory_audit.snapshot.used);
  }),
);

console.log(`\nP7-0: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
