/**
 * FACTORY-SPEAK-01-S1 — Recommendation structured-only factory output + KEY panel voice.
 */
import assert from "node:assert/strict";
import { buildCoverageCategoryRecommendations } from "../server/recommendationEngine.js";
import {
  buildRecommendationPanelItemCaveat,
  buildRecommendationPanelItemWhy,
} from "../src/lib/recommendationPanelKeyVoice.js";

const FORBIDDEN_FACTORY_FIELDS = ["reason", "budget_consideration", "underwriting_consideration"];
const REQUIRED_STRUCTURED_FIELDS = [
  "coverage_label",
  "recommendation_type",
  "priority",
  "recommendation_score",
  "recommendation_rank",
  "reason_codes",
  "budget_band",
  "gap_signals",
  "uw_flags",
  "evidence_codes",
];

const gapResult = {
  items: [
    {
      coverage_category: "cancer",
      coverage_label: "암",
      gap_level: "critical",
      current_status: "missing",
      confidence: "high",
      memory_sources_used: ["memory.fact.cancer"],
    },
    {
      coverage_category: "medical_expense",
      coverage_label: "실손",
      gap_level: "sufficient",
      current_status: "held",
      confidence: "high",
    },
  ],
};

const uwResult = {
  items: [
    {
      coverage_category: "cancer",
      coverage_label: "암",
      underwriting_status: "likely_standard",
      confidence_level: "high",
      risk_level: "low",
    },
  ],
};

const result = buildCoverageCategoryRecommendations({
  customer_id: "cust-test",
  coverageGapResult: gapResult,
  underwritingResult: uwResult,
  monthly_budget: 150000,
  insurance_goal: "family_protection",
});

let passed = 0;

function test(name, fn) {
  fn();
  passed += 1;
  console.log(`  ok ${name}`);
}

console.log("factory-speak-01-s1-recommendation-unit-test");

test("top2 keeps ranking and structured fields only", () => {
  assert.equal(result.customer_visible_top2.length, 1);
  const item = result.customer_visible_top2[0];
  for (const field of REQUIRED_STRUCTURED_FIELDS) {
    assert.ok(field in item, `missing ${field}`);
  }
  for (const field of FORBIDDEN_FACTORY_FIELDS) {
    assert.equal(Object.hasOwn(item, field), false, `forbidden field leaked: ${field}`);
  }
});

test("reason_codes include critical_gap and uw_friction_low for add_coverage", () => {
  const item = result.customer_visible_top2[0];
  assert.equal(item.recommendation_type, "add_coverage");
  assert.ok(item.reason_codes.includes("critical_gap"));
  assert.ok(item.reason_codes.includes("uw_friction_low"));
  assert.equal(item.budget_band, "review_needed");
});

test("serialized output has no factory Korean recommendation sentences", () => {
  const json = JSON.stringify(result);
  assert.doesNotMatch(json, /보장 보강이 필요하며/);
  assert.doesNotMatch(json, /왜냐하면/);
  assert.doesNotMatch(json, /월 보험 예산이 Memory에/);
});

test("panel why exposes structured status, not invented judgment", () => {
  const item = result.customer_visible_top2[0];
  const why = buildRecommendationPanelItemWhy(item);
  assert.match(why, /암/);
  assert.match(why, /KEY 확인 필요/);
});

test("panel caveat uses uw_flags budget_band not factory sentences", () => {
  const item = result.customer_visible_top2[0];
  const caveat = buildRecommendationPanelItemCaveat(item);
  assert.equal(caveat, "KEY 확인 필요");
});

console.log(`\n${passed}/${passed} passed`);
