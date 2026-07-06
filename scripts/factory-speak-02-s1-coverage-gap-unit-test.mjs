/**
 * FACTORY-SPEAK-02-S1 — Coverage Gap structured-only factory output + KEY panel voice.
 */
import assert from "node:assert/strict";
import { analyzeCoverageGaps } from "../server/coverageGapAnalysisEngine.js";
import { transformCoverageGapResults } from "../server/customerCoverageGapCore.js";
import {
  buildGapPanelItemCaveat,
  buildGapPanelItemWhy,
} from "../src/lib/gapPanelKeyVoice.js";

const FORBIDDEN_FACTORY_FIELDS = ["reason", "recommended_action"];
const REQUIRED_STRUCTURED_FIELDS = [
  "coverage_label",
  "coverage_category",
  "current_status",
  "gap_level",
  "priority",
  "gap_reason_codes",
  "action_code",
  "evidence_codes",
  "confidence",
  "requires_agent_review",
];

function fact(overrides) {
  return {
    id: crypto.randomUUID(),
    fact_key: "insurance.generic",
    fact_value: "",
    fact_type: "insurance",
    importance: "medium",
    source_table: "customer_memory_facts",
    provenance_type: "profile",
    metadata_json: { review_status: "approved", requires_agent_review: false },
    ...overrides,
  };
}

const memory = [
  fact({ fact_key: "insurance.cancer.missing", fact_value: "암 진단비 보장 없음", importance: "high" }),
  fact({ fact_key: "insurance.brain.insufficient", fact_value: "뇌혈관 보장이 부족합니다", importance: "high" }),
  fact({ fact_key: "insurance.indemnity.held", fact_value: "실손의료비 보험 보유", importance: "high" }),
  fact({ fact_key: "insurance.driver.duplicate", fact_value: "운전자 특약 2건 중복 가능", importance: "medium" }),
];

const analysis = analyzeCoverageGaps({
  customer_id: "cust-test",
  memory,
  generatedAt: "2026-07-06T00:00:00.000Z",
});

const transformed = transformCoverageGapResults(
  analysis,
  { customer_profile: {}, insurance_holdings: [], memory_sources_used: [], health_profile: {} },
  memory,
);

let passed = 0;

function test(name, fn) {
  fn();
  passed += 1;
  console.log(`  ok ${name}`);
}

console.log("factory-speak-02-s1-coverage-gap-unit-test");

test("engine items expose gap_reason_codes not Korean reason", () => {
  const cancer = analysis.coverage_gaps.find((item) => item.coverage_type === "cancer");
  assert.ok(Array.isArray(cancer.gap_reason_codes));
  assert.ok(cancer.gap_reason_codes.includes("memory_missing"));
  assert.ok(cancer.gap_reason_codes.includes("high_priority_category"));
  assert.equal(Object.hasOwn(cancer, "reason"), false);
});

test("transformed items keep structured fields only", () => {
  const cancer = transformed.items.find((item) => item.coverage_category === "cancer");
  for (const field of REQUIRED_STRUCTURED_FIELDS) {
    assert.ok(field in cancer, `missing ${field}`);
  }
  for (const field of FORBIDDEN_FACTORY_FIELDS) {
    assert.equal(Object.hasOwn(cancer, field), false, `forbidden field leaked: ${field}`);
  }
});

test("critical missing maps to review_coverage action_code", () => {
  const cancer = transformed.items.find((item) => item.coverage_category === "cancer");
  assert.equal(cancer.gap_level, "critical");
  assert.equal(cancer.action_code, "review_coverage");
  assert.equal(cancer.current_status, "missing");
});

test("adequate maps to maintain_coverage", () => {
  const medical = transformed.items.find((item) => item.coverage_category === "medical_expense");
  assert.equal(medical.gap_level, "sufficient");
  assert.equal(medical.action_code, "maintain_coverage");
});

test("serialized output has no factory Korean action sentences", () => {
  const json = JSON.stringify(transformed);
  assert.doesNotMatch(json, /보장 보강을 우선 검토/);
  assert.doesNotMatch(json, /보장이 없거나 부족/);
  assert.doesNotMatch(json, /recommended_action/);
});

test("panel why uses KEY voice from action_code not factory fields", () => {
  const cancer = transformed.top_gaps.find((item) => item.coverage_category === "cancer");
  const why = buildGapPanelItemWhy(cancer);
  assert.match(why, /암 보장부터 같이 확인/);
  assert.doesNotMatch(why, /보강을 우선 검토/);
  assert.doesNotMatch(why, /검토하세요/);
});

test("panel caveat uses confidence not factory sentences", () => {
  const cancer = transformed.top_gaps.find((item) => item.coverage_category === "cancer");
  const caveat = buildGapPanelItemCaveat(cancer);
  assert.match(caveat, /단정하기 어려우/);
});

console.log(`\n${passed}/${passed} passed`);
