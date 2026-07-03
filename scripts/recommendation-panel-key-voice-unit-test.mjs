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
} from "../src/lib/recommendationPanelKeyVoice.js";

const SAMPLE_TOP2 = [
  {
    coverage_category: "cancer",
    coverage_label: "암",
    recommendation_type: "prepare_documents",
    reason: "보장 공백과 인수 정보를 함께 볼 여지가 있습니다.",
    budget_consideration: "신규 보장 추가 시 부담 증가 가능성을 함께 점검하세요.",
    underwriting_consideration: "추가 심사가 필요할 수 있습니다.",
  },
  {
    coverage_category: "brain",
    coverage_label: "뇌혈관",
    recommendation_type: "review_existing",
    reason: "현재 구조를 먼저 점검하는 편이 낫습니다.",
  },
];

let passed = 0;

function test(name, fn) {
  fn();
  passed += 1;
  console.log(`  ok ${name}`);
}

console.log("recommendation-panel-key-voice-unit-test");

test("judgment matches KEY chat phrasing for two labels", () => {
  const text = buildRecommendationPanelJudgment(SAMPLE_TOP2);
  assert.match(text, /저장된 분석 기준으로/);
  assert.match(text, /암과 뇌혈관/);
  assert.match(text, /같이 정하면 됩니다/);
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

test("tom seat heuristic passes for aligned priority chat + panel", () => {
  const chatAnswer =
    "저장된 분석 기준으로, 지금 우선 같이 짚을 여지가 있는 축은 암과 뇌혈관입니다. 어느 쪽부터 볼지는 같이 정하면 됩니다.";
  const panelContinuation = buildRecommendationPanelContinuation(SAMPLE_TOP2);
  const audit = auditTomPanelAlignmentSeat({
    chatAnswer,
    panelContinuation,
    panelLimitation: KEY_RECOMMENDATION_PANEL_LIMITATION,
  });
  assert.equal(audit.checks.panel_continues_chat, true);
  assert.equal(audit.pass_heuristic, true);
});

test("next step uses care-plan style forward voice", () => {
  assert.match(buildRecommendationPanelNextStep(SAMPLE_TOP2), /그럼 앞으로는/);
});

console.log(`\n${passed}/${passed} passed`);
