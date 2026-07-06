/**
 * FACTORY-SPEAK-04-S1 — Design structured-only factory output + KEY panel voice.
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
import { KEY_JUDGMENT_RULES } from "../server/keyJudgmentRules.js";
import {
  buildDesignPanelBudgetLine,
  buildDesignPanelLead,
  buildDesignPanelNextSteps,
  buildDesignPanelSummary,
} from "../src/lib/designPanelKeyVoice.js";

const FORBIDDEN_VISIBLE_FIELDS = [
  "design_summary",
  "next_actions",
  "design_title",
  "pre_enrollment_cautions",
];
const REQUIRED_VISIBLE_FIELDS = [
  "design_priority",
  "design_reason_codes",
  "plan_step_codes",
  "budget_band_code",
  "priority_coverages",
  "keep_existing_coverages",
  "pre_enrollment_caution_codes",
  "required_document_codes",
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
const visible = designBundle.customer_visible_design;
const design = designBundle.insurance_design;

let passed = 0;

function test(name, fn) {
  fn();
  passed += 1;
  console.log(`  ok ${name}`);
}

console.log("factory-speak-04-s1-design-unit-test");

test("customer_visible_design keeps structured fields only", () => {
  for (const field of REQUIRED_VISIBLE_FIELDS) {
    assert.ok(field in visible, `missing ${field}`);
  }
  for (const field of FORBIDDEN_VISIBLE_FIELDS) {
    assert.equal(Object.hasOwn(visible, field), false, `forbidden field leaked: ${field}`);
  }
});

test("insurance_design exposes structured codes not customer prose", () => {
  assert.ok(Array.isArray(design.design_reason_codes));
  assert.ok(Array.isArray(design.plan_step_codes));
  assert.ok(design.budget_band_code);
  assert.equal(Object.hasOwn(design, "design_summary"), false);
  assert.equal(Object.hasOwn(design, "next_actions"), false);
});

test("serialized output has no factory design summary sentences", () => {
  const json = JSON.stringify(designBundle);
  assert.doesNotMatch(json, /design_summary/);
  assert.doesNotMatch(json, /next_actions/);
  assert.doesNotMatch(json, /설계안 Claude/);
});

test("panel lead and summary use KEY hedged voice", () => {
  const lead = buildDesignPanelLead(visible);
  const summary = buildDesignPanelSummary(visible);
  assert.match(lead, /현재 확인된 자료/);
  assert.match(summary, /현재 확인된 자료/);
  assert.doesNotMatch(lead, /가입/);
});

test("panel next steps derive from plan_step_codes", () => {
  const steps = buildDesignPanelNextSteps(visible);
  assert.ok(steps.length >= 1);
  assert.ok((visible.plan_step_codes ?? []).length >= 1);
  for (const step of steps) {
    assert.doesNotMatch(step, /검토$/);
  }
});

test("budget line uses budget_band_code not raw factory sentence dump", () => {
  const line = buildDesignPanelBudgetLine(visible);
  assert.match(line, /Memory|예산/);
});

test("design_review_judgment reads structured labels only", () => {
  const rule = KEY_JUDGMENT_RULES.find((entry) => entry.id === "design_review_judgment");
  assert.ok(rule);
  const judgment = rule.buildJudgment({
    factBundle: {
      design_used: true,
      has_stored_design_analysis: true,
      design_priority_coverages: visible.priority_coverages,
      design_keep_coverages: visible.keep_existing_coverages,
    },
  });
  assert.match(judgment, /저장된 설계/);
  assert.doesNotMatch(judgment, /design_summary/);
  if (visible.priority_coverages[0]) {
    assert.ok(judgment.includes(visible.priority_coverages[0]));
  }
});

console.log(`\n${passed}/${passed} passed`);
