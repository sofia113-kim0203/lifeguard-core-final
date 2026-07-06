/**
 * Coverage Gap Panel — KEY voice (expression layer only).
 * Factory outputs structured codes; KEY speaks to the customer.
 */

export const GAP_PANEL_ACTION_LABELS = {
  review_coverage: "함께 확인할 보장",
  check_coverage_level: "함께 점검할 보장",
  maintain_coverage: "유지하고 볼 보장",
  resolve_duplicate: "중복 여부를 같이 정리할 보장",
  add_memory_context: "자료 보완 후 같이 볼 보장",
  skip_corporate_group: "개인 Memory 기준 제외",
};

export function getGapPanelActionLabel(actionCode) {
  return GAP_PANEL_ACTION_LABELS[actionCode] ?? "함께 볼 보장";
}

export function buildGapPanelItemLead(item = {}) {
  const label = String(item.coverage_label ?? "").trim();
  const action = getGapPanelActionLabel(item.action_code);
  if (!label) return action;
  return `${label} — ${action}`;
}

export function buildGapPanelItemWhy(item = {}) {
  const label = String(item.coverage_label ?? "").trim();
  const actionCode = item.action_code;
  const gapLevel = item.gap_level;
  const confidence = item.confidence ?? "medium";

  if (!label) return null;

  if (actionCode === "maintain_coverage") {
    return `${label} 보장은 현재 확인되는 자료 기준으로 유지하면서 같이 보면 됩니다.`;
  }
  if (actionCode === "resolve_duplicate") {
    return `${label} 보장은 중복 가능성이 있어, 등록된 자료를 같이 보면서 정리하는 편이 좋겠습니다.`;
  }
  if (actionCode === "add_memory_context") {
    return `${label} 관련 자료가 아직 충분하지 않아, 등록된 자료를 함께 보면서 판단하겠습니다.`;
  }
  if (actionCode === "skip_corporate_group") {
    return `${label}은(는) 개인 Memory 기준으로는 아직 같이 보기 어렵습니다. 단체 계약 자료가 있으면 함께 확인하겠습니다.`;
  }
  if (actionCode === "check_coverage_level") {
    return `현재 확인되는 자료 기준으로는 ${label} 보장 수준부터 같이 점검하는 것이 좋겠습니다.`;
  }
  if (actionCode === "review_coverage" || gapLevel === "critical" || gapLevel === "high") {
    return `현재 확인되는 자료 기준으로는 ${label} 보장부터 같이 확인하는 것이 좋겠습니다.`;
  }
  return `현재 확인되는 자료 기준으로 ${label} 보장부터 같이 보면 좋겠습니다.`;
}

export function buildGapPanelItemCaveat(item = {}) {
  const confidence = item.confidence ?? "medium";
  const requiresReview = item.requires_agent_review === true;

  if (requiresReview || confidence === "low" || confidence === "medium") {
    return "다만 특약과 가입금액까지는 아직 단정하기 어려우므로, 등록된 자료를 함께 보면서 판단하겠습니다.";
  }
  return null;
}
