/**
 * Design Panel — KEY voice (expression layer only).
 * Factory outputs structured codes; KEY speaks to the customer.
 */

export const DESIGN_PLAN_STEP_LABELS = {
  prepare_documents: "함께 준비할 자료",
  confirm_keep_existing: "유지하고 볼 보장",
  agent_consultation: "함께 볼 설계 상담",
};

export const DESIGN_BUDGET_BAND_LABELS = {
  memory_budget_band: "Memory 예산 범위",
  budget_unknown: "예산 자료 보완",
};

const CATEGORY_LABEL_FALLBACK = {
  cancer: "암 보장",
  brain: "뇌혈관 보장",
  heart: "심혈관 보장",
  medical_expense: "실손·의료비 보장",
};

export function resolveCoverageLabel(category, labels = []) {
  const fromList = (labels ?? []).find(Boolean);
  if (fromList) return String(fromList).trim();
  return CATEGORY_LABEL_FALLBACK[category] ?? category ?? "해당 보장";
}

export function getDesignPlanStepLabel(planStepCode, design = {}) {
  if (!planStepCode) return "함께 볼 설계 단계";
  if (DESIGN_PLAN_STEP_LABELS[planStepCode]) {
    return DESIGN_PLAN_STEP_LABELS[planStepCode];
  }
  const match = String(planStepCode).match(/^review_coverage_(.+)$/);
  if (match) {
    const category = match[1];
    const idx = (design.priority_coverage_categories ?? []).indexOf(category);
    const label =
      design.priority_coverages?.[idx] ??
      resolveCoverageLabel(category, design.priority_coverages);
    return `${label}부터 같이 살펴볼 설계`;
  }
  return "함께 볼 설계 단계";
}

export function buildDesignPanelLead(design = {}) {
  const first = (design.priority_coverages ?? [])[0];
  if (first) return `현재 확인된 자료를 기준으로 ${first}부터 같이 살펴보겠습니다.`;
  return "현재 확인된 자료를 기준으로 설계 방향부터 같이 살펴보겠습니다.";
}

export function buildDesignPanelSummary(design = {}) {
  const labels = (design.priority_coverages ?? []).filter(Boolean).slice(0, 2);
  const keep = (design.keep_existing_coverages ?? []).filter(Boolean).slice(0, 2);
  const parts = [];
  if (labels.length >= 2) {
    parts.push(`현재 확인된 자료를 기준으로 ${labels[0]}과 ${labels[1]} 축부터 같이 설계 방향을 보면 됩니다.`);
  } else if (labels.length === 1) {
    parts.push(`현재 확인된 자료를 기준으로 ${labels[0]} 축부터 같이 설계 방향을 보면 됩니다.`);
  } else {
    parts.push("현재 확인된 자료를 기준으로 설계 방향을 함께 정리하면 됩니다.");
  }
  if (keep.length) {
    parts.push(`유지하고 볼 축은 ${keep.join(", ")} 쪽입니다.`);
  }
  return parts.join(" ");
}

export function buildDesignPanelBudgetLine(design = {}) {
  const band = design.budget_band_code ?? "budget_unknown";
  const min = design.budget_min;
  const max = design.budget_max;
  if (band === "memory_budget_band" && min != null && max != null) {
    return `월 ${Number(min).toLocaleString("ko-KR")}원 ~ ${Number(max).toLocaleString("ko-KR")}원 범위를 Memory 예산 기준으로 같이 참고하겠습니다.`;
  }
  return "월 예산은 Memory에 아직 충분히 기록되지 않아, 자료를 함께 보면서 범위를 정하겠습니다.";
}

export function buildDesignPanelCaveat() {
  return "다만 특정 상품 가입이나 보험료·인수 결과는 지금 단정하지 않고, 고객 상황을 보면서 설계 방향을 함께 결정하겠습니다.";
}

export function buildDesignPanelNextSteps(design = {}) {
  return (design.plan_step_codes ?? [])
    .slice(0, 4)
    .map((code) => getDesignPlanStepLabel(code, design));
}

export function buildDesignPanelCautionLine(code) {
  if (code === "likely_surcharge") {
    return "인수심사 관련 자료는 함께 확인하면서 설계 방향을 잡겠습니다.";
  }
  if (code === "likely_decline" || code === "likely_exclusion") {
    return "담보·인수 경로는 자료를 함께 보면서 설계 전에 확인하겠습니다.";
  }
  return "가입 전 확인이 필요한 신호가 있어, 설계 전에 함께 점검하겠습니다.";
}
