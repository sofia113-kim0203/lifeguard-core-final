/**
 * FACTORY-SPEAK-05-S1 — Rebalancing structured-only factory output + KEY panel voice.
 */
import assert from "node:assert/strict";
import { analyzeCoverageGaps } from "../server/coverageGapAnalysisEngine.js";
import { analyzeUnderwritingRisk } from "../server/underwritingRiskAnalysisEngine.js";
import { transformCoverageGapResults } from "../server/customerCoverageGapCore.js";
import { transformUnderwritingRiskResults } from "../server/customerUnderwritingRiskCore.js";
import { buildUnderwritingRiskInputFromMemory } from "../server/underwritingRiskInputBuilder.js";
import { buildCoverageCategoryRecommendations } from "../server/recommendationEngine.js";
import { buildInsuranceDesignInputFromAnalysis } from "../server/insuranceDesignInputBuilder.js";
import { buildCustomerInsuranceDesignPlan } from "../server/insuranceDesignGenerator.js";
import { buildRebalancingInputFromAnalysis } from "../server/rebalancingInputBuilder.js";
import { buildCustomerRebalancingPlan } from "../server/rebalancingEngine.js";
import {
  buildRebalancingPanelBudgetLine,
  buildRebalancingPanelLead,
  buildRebalancingPanelNextSteps,
} from "../src/lib/rebalancingPanelKeyVoice.js";

const FORBIDDEN_VISIBLE_FIELDS = [
  "next_actions",
  "keep_insurances",
  "strengthen_coverages",
  "cautions_before_reduction",
];
const REQUIRED_VISIBLE_FIELDS = [
  "keep_coverage_categories",
  "keep_coverage_labels",
  "strengthen_coverage_categories",
  "strengthen_coverage_labels",
  "rebalancing_action_codes",
  "caution_warning_codes",
  "budget_delta_band_code",
];

function fact(overrides) {
  return {
    id: crypto.randomUUID(),
    fact_key: "health.generic",
    fact_value: "",
    fact_type: "health",
    importance: "high",
    source_table: "customer_memory_facts",
    provenance_type: "profile",
    metadata_json: { review_status: "approved", requires_agent_review: false, memory_confidence: "medium" },
    ...overrides,
  };
}

const memory = [
  fact({ fact_key: "health.diabetes.summary", fact_value: "당뇨 진단 및 당뇨약 복용 이력이 있습니다." }),
  fact({ fact_key: "insurance.cancer.missing", fact_value: "암 진단비 보장 없음", fact_type: "insurance" }),
  fact({ fact_key: "insurance.brain.insufficient", fact_value: "뇌혈관 보장이 부족합니다", fact_type: "insurance" }),
  fact({ fact_key: "insurance.indemnity.held", fact_value: "실손의료비 보험 보유", fact_type: "insurance" }),
  fact({ fact_key: "budget.monthly", fact_value: "150000", fact_type: "profile" }),
];

const gapAnalysis = analyzeCoverageGaps({
  customer_id: "cust-test",
  memory,
  generatedAt: "2026-07-06T00:00:00.000Z",
});

const coverageGapResult = transformCoverageGapResults(
  gapAnalysis,
  { customer_profile: {}, insurance_holdings: [], memory_sources_used: [], health_profile: {} },
  memory,
);

const healthAnalysis = analyzeUnderwritingRisk({
  customer_id: "cust-test",
  memory,
  generatedAt: "2026-07-06T00:00:00.000Z",
});

const uwInput = buildUnderwritingRiskInputFromMemory({
  snapshot: { facts: memory, fact_count: memory.length, memory_version: 1, customer_id: "cust-test" },
  policies: [],
  health: null,
  coverageGapResult,
});

const underwritingResult = transformUnderwritingRiskResults({
  healthAnalysis,
  input: uwInput,
  coverageGapResult,
});

const recommendationResult = buildCoverageCategoryRecommendations({
  customer_id: "cust-test",
  coverageGapResult,
  underwritingResult,
  monthly_budget: 150000,
  insurance_goal: "family_protection",
  memory_facts: memory,
});

const designInput = buildInsuranceDesignInputFromAnalysis({
  snapshot: { facts: memory, fact_count: memory.length, memory_version: 1, customer_id: "cust-test" },
  policies: [],
  health: null,
  coverageGapResult,
  underwritingResult,
  recommendationResult,
});

const designBundle = buildCustomerInsuranceDesignPlan(designInput);

const rebalancingInput = buildRebalancingInputFromAnalysis({
  snapshot: { facts: memory, fact_count: memory.length, memory_version: 1, customer_id: "cust-test" },
  policies: [],
  structuredMemory: {},
  coverageGapResult,
  underwritingResult,
  recommendationResult,
  designBundle,
});

const plan = buildCustomerRebalancingPlan({
  customer_id: "cust-test",
  structuredMemory: {},
  insurance_holdings: rebalancingInput.insurance_holdings,
  health_profile: rebalancingInput.health_profile,
  memory_facts: memory,
  monthly_budget: 150000,
  coverageGapResult,
  underwritingResult,
  recommendationResult,
  insurance_design: designBundle.insurance_design,
  customer_visible_design: designBundle.customer_visible_design,
});

const visible = plan.customer_visible_rebalancing;

let passed = 0;

function test(name, fn) {
  fn();
  passed += 1;
  console.log(`  ok ${name}`);
}

console.log("factory-speak-05-s1-rebalancing-unit-test");

test("customer_visible_rebalancing keeps structured fields only", () => {
  for (const field of REQUIRED_VISIBLE_FIELDS) {
    assert.ok(field in visible, `missing ${field}`);
  }
  for (const field of FORBIDDEN_VISIBLE_FIELDS) {
    assert.equal(Object.hasOwn(visible, field), false, `forbidden field leaked: ${field}`);
  }
});

test("priority_actions use action_code not Korean action strings", () => {
  assert.ok(Array.isArray(plan.priority_actions));
  for (const action of plan.priority_actions) {
    assert.ok(action.action_code, "action_code required");
    assert.equal(Object.hasOwn(action, "action"), false);
    assert.doesNotMatch(String(action.action_code), /보장 보강 검토/);
  }
});

test("estimated_budget_impact exposes band code not factory label", () => {
  assert.ok(plan.estimated_budget_impact.budget_delta_band_code);
  assert.equal(Object.hasOwn(plan.estimated_budget_impact, "label"), false);
});

test("serialized output has no factory rebalancing speak fields", () => {
  const json = JSON.stringify(plan);
  assert.doesNotMatch(json, /next_actions/);
  assert.doesNotMatch(json, /keep_insurances/);
  assert.doesNotMatch(json, /strengthen_coverages/);
  assert.doesNotMatch(json, /cautions_before_reduction/);
  assert.doesNotMatch(json, /보장 보강 검토/);
});

test("panel lead and next steps expose structured state only", () => {
  const lead = buildRebalancingPanelLead(visible);
  const steps = buildRebalancingPanelNextSteps(visible);
  assert.match(lead, /확인 코드/);
  assert.match(lead, /KEY 확인 필요/);
  assert.ok(steps.length >= 1);
  for (const step of steps) {
    assert.doesNotMatch(step, /보장 보강 검토$/);
  }
});

test("budget line uses budget_delta_band_code not raw factory sentence dump", () => {
  const line = buildRebalancingPanelBudgetLine(visible);
  assert.match(line, /예산|보험료|Memory|등록된 자료/);
});

console.log(`\n${passed}/${passed} passed`);
