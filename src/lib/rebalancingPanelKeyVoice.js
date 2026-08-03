/**
 * Rebalancing Panel — KEY voice (expression layer only).
 * Factory outputs structured codes; KEY speaks to the customer.
 */

export const REBALANCING_ACTION_LABELS = {
  strengthen_coverage: "함께 보강할 보장",
  review_coverage: "함께 재확인할 보장",
  keep_coverage: "유지하고 볼 보장",
  confirm_health_disclosure: "가입 전 함께 확인할 건강 고지",
  design_step: "함께 볼 설계 단계",
};

export const REBALANCING_CAUTION_LABELS = {
  pre_enrollment_diabetes: "당뇨 관련 자료는 가입 전 함께 확인하겠습니다.",
  pre_enrollment_hypertension: "혈압 관련 자료는 가입 전 함께 확인하겠습니다.",
  pre_enrollment_health: "건강 관련 자료는 가입 전 함께 확인하겠습니다.",
  cancellation_caution: "감액·해지 전에는 기존 보장 범위를 함께 확인하겠습니다.",
  underwriting_caution: "인수심사 관련 신호는 설계 전에 함께 점검하겠습니다.",
  agent_review_caution: "설계사와 함께 확인할 항목이 있어, 순서를 같이 정하겠습니다.",
  review_caution: "변경 전에 함께 확인할 주의사항이 있습니다.",
};

export const REBALANCING_BUDGET_BAND_LABELS = {
  unknown: "보험료·예산 자료가 아직 충분하지 않아, 등록된 자료를 함께 보면서 범위를 정하겠습니다.",
  moderate_increase: "월 보험료가 다소 늘 수 있는 방향이므로, 예산 범위를 함께 확인하겠습니다.",
  over: "월 예산이 Memory 기준을 넘을 수 있어, 우선순위를 함께 정리하겠습니다.",
  within: "현재 확인되는 보험료·예산 범위 안에서 유지·보강 방향을 같이 보면 됩니다.",
  decrease: "월 보험료 절감 여지가 있어, 보장 공백 없이 함께 정리하겠습니다.",
  stable: "현재 보험료 수준과 설계 예산 범위가 비슷해, 유지·보강 방향을 같이 보면 됩니다.",
};

const CATEGORY_LABEL_FALLBACK = {
  cancer: "암 보장",
  brain: "뇌혈관 보장",
  heart: "심혈관 보장",
  medical_expense: "실손·의료비 보장",
  surgery: "수술비 보장",
  hospitalization: "입원비 보장",
};

export function getRebalancingActionLabel(actionCode) {
  if (!actionCode) return REBALANCING_ACTION_LABELS.strengthen_coverage;
  if (REBALANCING_ACTION_LABELS[actionCode]) {
    return REBALANCING_ACTION_LABELS[actionCode];
  }
  const strengthen = String(actionCode).match(/^strengthen_(.+)$/);
  if (strengthen) {
    const label = CATEGORY_LABEL_FALLBACK[strengthen[1]] ?? strengthen[1];
    return `${label}부터 함께 보강`;
  }
  const review = String(actionCode).match(/^review_(.+)$/);
  if (review) {
    const label = CATEGORY_LABEL_FALLBACK[review[1]] ?? review[1];
    return `${label}부터 함께 재확인`;
  }
  const keep = String(actionCode).match(/^keep_(.+)$/);
  if (keep) {
    const label = CATEGORY_LABEL_FALLBACK[keep[1]] ?? keep[1];
    return `${label}은 유지하고 볼 보장`;
  }
  return REBALANCING_ACTION_LABELS.strengthen_coverage;
}

export function getRebalancingCautionLabel(code) {
  return REBALANCING_CAUTION_LABELS[code] ?? REBALANCING_CAUTION_LABELS.review_caution;
}

export function buildRebalancingPanelLead(visible = {}) {
  const count = (visible.rebalancing_action_codes ?? []).filter(Boolean).length;
  return count ? `확인 코드 ${count}건 · KEY 확인 필요` : "KEY 확인 필요";
}

export function buildRebalancingPanelKeepLine(visible = {}) {
  const labels = (visible.keep_coverage_labels ?? []).filter(Boolean);
  if (!labels.length) return "확인 코드 없음";
  return labels.join(", ");
}

export function buildRebalancingPanelStrengthenLine(visible = {}) {
  const labels = (visible.strengthen_coverage_labels ?? []).filter(Boolean);
  if (!labels.length) return "확인 코드 없음";
  return labels.join(", ");
}

export function buildRebalancingPanelBudgetLine(visible = {}) {
  const band = visible.budget_delta_band_code ?? "unknown";
  const delta = visible.budget_delta_monthly;
  const base = REBALANCING_BUDGET_BAND_LABELS[band] ?? REBALANCING_BUDGET_BAND_LABELS.unknown;
  if (delta != null && band === "moderate_increase") {
    return `${base} (약 ${Math.abs(Number(delta)).toLocaleString("ko-KR")}원 수준 변화 가능)`;
  }
  if (delta != null && band === "decrease") {
    return `${base} (약 ${Math.abs(Number(delta)).toLocaleString("ko-KR")}원 수준 절감 여지)`;
  }
  return base;
}

export function buildRebalancingPanelCautionLines(visible = {}) {
  return (visible.caution_warning_codes ?? [])
    .filter(Boolean)
    .map((code) => getRebalancingCautionLabel(code));
}

export function buildRebalancingPanelNextSteps(visible = {}) {
  return (visible.rebalancing_action_codes ?? [])
    .slice(0, 4)
    .map((code) => getRebalancingActionLabel(code));
}

export function buildRebalancingPanelCaveat() {
  return "KEY 확인 필요";
}
