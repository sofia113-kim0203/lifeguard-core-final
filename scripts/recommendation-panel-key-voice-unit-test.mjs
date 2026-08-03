/** Recommendation Panel Alignment — KEY voice unit test (expression layer). */

import assert from "node:assert/strict";

import {
  FORBIDDEN_PANEL_PHRASES,
  KEY_PANEL_ACTION_LABELS,
  KEY_PANEL_CONTINUATION_BRIDGE,
  KEY_PANEL_PAGE_TITLE,
  KEY_PANEL_SECTION_TITLE,
  KEY_RECOMMENDATION_PANEL_LIMITATION,
  auditTomPanelAlignmentSeat,
  buildRecommendationPanelContinuation,
  buildRecommendationPanelJudgment,
  buildRecommendationPanelNextStep,
  buildRecommendationPanelItemLead,
  buildRecommendationPanelItemWhy,
} from "../src/lib/recommendationPanelKeyVoice.js";

const SAMPLE_TOP2 = [
  {
    coverage_category: "cancer",
    coverage_label: "암",
    recommendation_type: "prepare_documents",
    reason_codes: ["critical_gap", "type_prepare_documents"],
    budget_band: "review_needed",
    uw_flags: ["likely_additional_review"],
  },
  {
    coverage_category: "brain",
    coverage_label: "뇌혈관",
    recommendation_type: "review_existing",
    reason_codes: ["high_gap", "type_review_existing"],
    budget_band: "review_needed",
  },
];

let passed = 0;

function test(name, fn) {
  fn();
  passed += 1;
  console.log(`  ok ${name}`);
}

console.log("recommendation-panel-key-voice-unit-test");

test("panel judgment exposes only count and KEY confirmation state", () => {
  const text = buildRecommendationPanelJudgment(SAMPLE_TOP2);
  assert.match(text, /확인 항목 2건/);
  assert.match(text, /KEY 확인 필요/);
  assert.doesNotMatch(text, /암과 뇌혈관|같이 정하면/);
});

test("limitation matches HUL recommendation_priority_judgment", () => {
  assert.match(KEY_RECOMMENDATION_PANEL_LIMITATION, /특정 상품 가입을 단정하거나 권유/);
});

test("forbidden product-sales phrases absent from panel titles", () => {
  const surface = [KEY_PANEL_PAGE_TITLE, KEY_PANEL_SECTION_TITLE, ...Object.values(KEY_PANEL_ACTION_LABELS)].join(
    " ",
  );
  for (const phrase of FORBIDDEN_PANEL_PHRASES) {
    assert.equal(surface.includes(phrase), false, `forbidden phrase leaked: ${phrase}`);
  }
});

test("add_coverage reframed not as 보장 추가", () => {
  const lead = buildRecommendationPanelItemLead({
    coverage_label: "실손",
    recommendation_type: "add_coverage",
  });
  assert.match(lead, /함께 검토할 보장 축/);
  assert.doesNotMatch(lead, /보장 추가/);
});

test("continuation bridges chat — panel does not start fresh", () => {
  const text = buildRecommendationPanelContinuation(SAMPLE_TOP2);
  assert.ok(text.startsWith(KEY_PANEL_CONTINUATION_BRIDGE));
  assert.doesNotMatch(text, /^현재\s*고객\s*자료/);
});

test("panel is explicitly held for KEY confirmation", () => {
  const chatAnswer =
    "저장된 분석 기준으로, 지금 우선 같이 짚을 여지가 있는 축은 암과 뇌혈관입니다. 어느 쪽부터 볼지는 같이 정하면 됩니다.";
  const panelContinuation = buildRecommendationPanelContinuation(SAMPLE_TOP2);
  const audit = auditTomPanelAlignmentSeat({
    chatAnswer,
    panelContinuation,
    panelLimitation: KEY_RECOMMENDATION_PANEL_LIMITATION,
  });
  assert.equal(audit.checks.panel_continues_chat, true);
  assert.equal(audit.checks.panel_continues_chat, true);
});

test("next step does not invent a care-plan", () => {
  assert.equal(buildRecommendationPanelNextStep(SAMPLE_TOP2), "KEY 확인 필요");
});

test("item why exposes structured status only", () => {
  const why = buildRecommendationPanelItemWhy(SAMPLE_TOP2[0]);
  assert.match(why, /암/);
  assert.match(why, /KEY 확인 필요/);
});

console.log(`\n${passed}/${passed} passed`);
