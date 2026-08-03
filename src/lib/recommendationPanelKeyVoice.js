/**
 * Recommendation Panel Alignment — KEY voice (expression layer only).
 * Mirrors server/keyJudgmentRules.js buildRecommendationPriorityJudgment + HUL limitation.
 * Panel must continue chat — not start as an independent screen.
 */

export const KEY_RECOMMENDATION_PANEL_LIMITATION =
  "다만, 특정 상품 가입을 단정하거나 권유드리기는 어렵습니다.";

export const KEY_PANEL_SECTION_TITLE = "이어서 함께 볼 축";

export const KEY_PANEL_PAGE_TITLE = "KEY가 함께 보는 보장 · 인수 · 설계";

export const KEY_PANEL_PAGE_DESC =
  "구조화된 확인 상태를 표시합니다. 최종 판단은 KEY 대화에서 확인합니다.";

export const KEY_PANEL_CONTINUATION_BRIDGE = "같은 저장된 자료를 기준으로 보면,";

export const FORBIDDEN_PANEL_PHRASES = ["AI 보험 추천", "Top 2", "Top2", "보장 추가"];

export const KEY_PANEL_ACTION_LABELS = {
  add_coverage: "함께 검토할 보장 축",
  keep_existing: "유지하고 볼 축",
  review_existing: "함께 점검할 구조",
  avoid_for_now: "지금은 서두르지 않을 축",
  prepare_documents: "먼저 준비할 자료",
};

const ORDER_LABELS = ["먼저 함께 볼 축", "그다음 볼 축"];

function buildRecommendationJudgmentCore(recTop2 = []) {
  const count = recTop2.filter((item) => String(item?.coverage_label ?? "").trim()).length;
  return count ? `확인 항목 ${count}건` : "확인 항목 없음";
}

/** Chat-aligned judgment (server/keyJudgmentRules.js parity). */
export function buildRecommendationPanelJudgment(recTop2 = []) {
  const core = buildRecommendationJudgmentCore(recTop2);
  if (!recTop2.length) {
    return "KEY 확인 필요";
  }
  return `${core} · KEY 확인 필요`;
}

/** Panel opens as continuation of chat — not a fresh screen. */
export function buildRecommendationPanelContinuation(recTop2 = []) {
  const core = buildRecommendationJudgmentCore(recTop2);
  if (!recTop2.length) {
    return "KEY 확인 필요";
  }
  return `${KEY_PANEL_CONTINUATION_BRIDGE} ${core} · KEY 확인 필요`;
}

export function buildRecommendationPanelNextStep(recTop2 = []) {
  return "KEY 확인 필요";
}

export function getRecommendationPanelOrderLabel(index = 0) {
  return ORDER_LABELS[index] ?? `함께 볼 축 ${index + 1}`;
}

export function getRecommendationPanelActionLabel(recommendationType) {
  return KEY_PANEL_ACTION_LABELS[recommendationType] ?? "함께 볼 축";
}

export function buildRecommendationPanelItemLead(item = {}) {
  const label = String(item.coverage_label ?? "").trim();
  const action = getRecommendationPanelActionLabel(item.recommendation_type);
  if (!label) return action;
  return `${label} — ${action}`;
}

export function buildRecommendationPanelItemWhy(item = {}) {
  const label = String(item.coverage_label ?? "").trim();
  const type = item.recommendation_type;
  if (!label) return null;

  return `${label} · ${getRecommendationPanelActionLabel(type)} · KEY 확인 필요`;
}

export function buildRecommendationPanelItemCaveat(item = {}) {
  const flags = item.uw_flags ?? [];
  const hasReviewFlag =
    flags.length > 0 || item.budget_band === "review_needed" || item.budget_band === "over_budget_risk";
  return hasReviewFlag ? "KEY 확인 필요" : null;
}

export function chatPanelContinuitySignals({ chatAnswer = "", panelContinuation = "" } = {}) {
  const chat = String(chatAnswer);
  const panel = String(panelContinuation);
  return {
    chat_has_stored_basis: /저장된|자료|분석\s*기준|보장\s*구조/.test(chat),
    chat_has_together: /같이|함께/.test(chat),
    panel_continuation_bridge: panel.startsWith(KEY_PANEL_CONTINUATION_BRIDGE) || /앞에서\s*말씀/.test(panel),
    panel_not_fresh_screen: !/^현재\s*고객\s*자료/.test(panel) && !FORBIDDEN_PANEL_PHRASES.some((p) => panel.includes(p)),
    shared_basis_vocab: /저장된|자료|분석|보장\s*구조/.test(chat) && /저장된|자료|보장\s*구조/.test(panel),
    shared_together_vocab: /같이|함께/.test(chat) && /같이|함께/.test(panel),
  };
}

export function auditTomPanelAlignmentSeat({
  chatAnswer = "",
  panelContinuation = "",
  panelLimitation = "",
  responseSource = null,
} = {}) {
  const signals = chatPanelContinuitySignals({ chatAnswer, panelContinuation });
  const chatBlocked = responseSource === "sales_director_guarded_hold";
  const same_key_feel =
    !chatBlocked &&
    signals.panel_continuation_bridge &&
    signals.panel_not_fresh_screen &&
    (signals.shared_basis_vocab || signals.shared_together_vocab);
  const not_new_screen =
    signals.panel_continuation_bridge && !FORBIDDEN_PANEL_PHRASES.some((p) => panelContinuation.includes(p));
  const limitation_aligned = panelLimitation.includes("단정") && panelLimitation.includes("권유");

  return {
    tom_question: "채팅에서 패널로 넘어가도, 고객은 계속 KEY와 이야기하고 있다고 느끼는가?",
    signals: { ...signals, chat_blocked_guarded_hold: chatBlocked },
    checks: {
      panel_continues_chat: signals.panel_continuation_bridge,
      not_independent_screen_start: not_new_screen,
      same_key_feel_heuristic: same_key_feel,
      limitation_present: limitation_aligned,
      chat_panel_same_voice: !chatBlocked && signals.shared_basis_vocab,
    },
    pass_heuristic: same_key_feel && not_new_screen && limitation_aligned,
    gap_note: chatBlocked ? "GAP-03 — chat recommendation_request not on KEY path; panel-only slice cannot PASS this flow" : null,
  };
}
