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
  "채팅에서 이어지는 것과 같은 기준으로, KEY가 저장된 자료를 계속 정리합니다.";

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
  const labels = recTop2.map((item) => String(item?.coverage_label ?? "").trim()).filter(Boolean);

  if (labels.length >= 2) {
    return `지금 우선 같이 짚을 여지가 있는 축은 ${labels[0]}과 ${labels[1]}입니다. 어느 쪽부터 볼지는 같이 정하면 됩니다.`;
  }
  if (labels.length === 1) {
    return `지금 우선 같이 짚을 여지가 있는 축은 ${labels[0]} 쪽입니다. 어느 쪽부터 볼지는 같이 정하면 됩니다.`;
  }
  return "지금은 보장 구조부터 같이 보면 됩니다.";
}

/** Chat-aligned judgment (server/keyJudgmentRules.js parity). */
export function buildRecommendationPanelJudgment(recTop2 = []) {
  const core = buildRecommendationJudgmentCore(recTop2);
  if (!recTop2.length) {
    return "저장된 우선순위 분석이 아직 없어, 지금은 보장 구조부터 같이 보면 됩니다.";
  }
  return `저장된 분석 기준으로, ${core}`;
}

/** Panel opens as continuation of chat — not a fresh screen. */
export function buildRecommendationPanelContinuation(recTop2 = []) {
  const core = buildRecommendationJudgmentCore(recTop2);
  if (!recTop2.length) {
    return "앞에서 말씀드린 것과 같은 기준으로, 지금은 보장 구조부터 같이 보면 됩니다.";
  }
  return `${KEY_PANEL_CONTINUATION_BRIDGE} ${core}`;
}

export function buildRecommendationPanelNextStep(recTop2 = []) {
  if (!recTop2.length) {
    return "그럼 앞으로는, 보장 구조부터 함께 확인하면 됩니다.";
  }
  return "그럼 앞으로는, 위 축부터 순서대로 함께 확인하면 됩니다.";
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

  if (type === "add_coverage") {
    return `${label} 보장부터 같이 확인하는 편이 좋겠습니다.`;
  }
  if (type === "prepare_documents") {
    return `${label} 쪽은 필요한 자료를 먼저 정리하고 같이 보는 편이 좋겠습니다.`;
  }
  if (type === "review_existing") {
    return `${label} 구조부터 함께 점검해 보겠습니다.`;
  }
  if (type === "avoid_for_now") {
    return `${label} 쪽은 지금 서두르지 않고 건강 조건을 같이 보겠습니다.`;
  }
  if (type === "keep_existing") {
    return `${label} 보장은 유지하면서 함께 보면 됩니다.`;
  }
  return `${label} 쪽을 같이 짚어보면 좋겠습니다.`;
}

export function buildRecommendationPanelItemCaveat(item = {}) {
  const flags = item.uw_flags ?? [];
  if (flags.includes("likely_decline")) {
    return "다만 상품 가입을 단정하기보다는 현재 건강 조건을 같이 보고 판단하겠습니다.";
  }
  if (
    flags.includes("likely_exclusion") ||
    flags.includes("likely_surcharge") ||
    flags.includes("likely_additional_review")
  ) {
    return "다만 인수 쪽은 추가 확인이 필요할 수 있어, 건강 조건을 같이 보겠습니다.";
  }
  if (item.budget_band === "review_needed" || item.budget_band === "over_budget_risk") {
    return "다만 상품 가입을 단정하기보다는 현재 보장금액과 건강 조건을 같이 보고 판단하겠습니다.";
  }
  return null;
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
