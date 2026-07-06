/**
 * FACTORY-SPEAK-03-S1 — Underwriting structured-only factory output + KEY panel voice.
 */
import assert from "node:assert/strict";
import { analyzeUnderwritingRisk } from "../server/underwritingRiskAnalysisEngine.js";
import { analyzeCoverageGaps } from "../server/coverageGapAnalysisEngine.js";
import { transformCoverageGapResults } from "../server/customerCoverageGapCore.js";
import { transformUnderwritingRiskResults } from "../server/customerUnderwritingRiskCore.js";
import { buildUnderwritingRiskInputFromMemory } from "../server/underwritingRiskInputBuilder.js";
import {
  auditUnderwritingPanelKeyVoice,
  buildUnderwritingPanelItemCaveat,
  buildUnderwritingPanelItemWhy,
} from "../src/lib/underwritingPanelKeyVoice.js";

const FORBIDDEN_FACTORY_FIELDS = ["reason", "recommended_next_step"];
const REQUIRED_STRUCTURED_FIELDS = [
  "coverage_label",
  "coverage_category",
  "underwriting_status",
  "risk_level",
  "uw_reason_codes",
  "review_step_code",
  "evidence_codes",
  "confidence_level",
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

const input = buildUnderwritingRiskInputFromMemory({
  snapshot: { facts: memory, fact_count: memory.length, memory_version: 1 },
  policies: [],
  health: null,
  coverageGapResult,
});

const transformed = transformUnderwritingRiskResults({
  healthAnalysis,
  input,
  coverageGapResult,
});

let passed = 0;

function test(name, fn) {
  fn();
  passed += 1;
  console.log(`  ok ${name}`);
}

console.log("factory-speak-03-s1-underwriting-unit-test");

test("engine health risks expose health_risk_reason_codes not Korean reason", () => {
  const diabetes = healthAnalysis.health_risk_items.find((item) => item.risk_type === "diabetes");
  assert.ok(Array.isArray(diabetes.health_risk_reason_codes));
  assert.equal(Object.hasOwn(diabetes, "reason"), false);
});

test("transformed items keep structured fields only", () => {
  const cancer = transformed.items.find((item) => item.coverage_category === "cancer");
  assert.ok(cancer, "cancer item expected");
  for (const field of REQUIRED_STRUCTURED_FIELDS) {
    assert.ok(field in cancer, `missing ${field}`);
  }
  for (const field of FORBIDDEN_FACTORY_FIELDS) {
    assert.equal(Object.hasOwn(cancer, field), false, `forbidden field leaked: ${field}`);
  }
});

test("diabetes signal produces structured uw_reason_codes and review step", () => {
  const diabetesAffected = transformed.items.find((item) =>
    item.uw_reason_codes?.includes("diabetes_signal"),
  );
  assert.ok(diabetesAffected, "expected diabetes-affected coverage item");
  assert.ok(diabetesAffected.review_step_code);
  assert.ok(Array.isArray(diabetesAffected.required_document_codes));
});

test("serialized output has no factory binding enrollment sentences", () => {
  const json = JSON.stringify(transformed);
  assert.doesNotMatch(json, /가입 가능성이 높습니다/);
  assert.doesNotMatch(json, /가입 거절 위험이 높습니다/);
  assert.doesNotMatch(json, /할증 가능성이 있습니다/);
  assert.doesNotMatch(json, /recommended_next_step/);
});

test("panel why uses KEY voice without binding verdicts", () => {
  const target =
    transformed.items.find((item) => item.uw_reason_codes?.includes("diabetes_signal")) ??
    transformed.likely_surcharge[0] ??
    transformed.items[0];
  const why = buildUnderwritingPanelItemWhy(target);
  assert.match(why, /현재 확인되는 자료 기준/);
  const audit = auditUnderwritingPanelKeyVoice(why);
  assert.equal(audit.pass, true, `forbidden hits: ${audit.forbidden_hits.join(", ")}`);
});

test("panel caveat hedges enrollment verdict", () => {
  const target =
    transformed.items.find((item) => item.uw_reason_codes?.includes("diabetes_signal")) ??
    transformed.likely_surcharge[0] ??
    transformed.items[0];
  const caveat = buildUnderwritingPanelItemCaveat(target);
  assert.match(caveat, /단정하지 않겠습니다/);
});

test("aggregate required_document_codes collected", () => {
  assert.ok(Array.isArray(transformed.required_document_codes));
  assert.ok(transformed.required_document_codes.includes("health_disclosure"));
});

console.log(`\n${passed}/${passed} passed`);
