/**
 * Underwriting Panel — KEY voice (expression layer only).
 * Factory outputs structured codes; KEY speaks without binding enrollment verdicts.
 */

export const FORBIDDEN_UW_PANEL_PHRASES = [
  "가입 가능합니다",
  "가입이 거절됩니다",
  "가입 거절",
  "할증됩니다",
  "거절됩니다",
  "반드시 가입",
];

export const UW_PANEL_REVIEW_STEP_LABELS = {
  maintain_standard_path: "함께 볼 인수 경로",
  review_with_gap_priority: "보장과 함께 볼 인수 경로",
  prepare_health_documents: "자료 정리 후 볼 인수 경로",
  check_exclusion_riders: "담보 범위부터 볼 인수 경로",
  agent_review_required: "추가 확인이 필요한 인수 경로",
  add_health_memory_context: "자료 보완 후 볼 인수 경로",
};

export function getUnderwritingPanelReviewStepLabel(reviewStepCode) {
  return UW_PANEL_REVIEW_STEP_LABELS[reviewStepCode] ?? "함께 볼 인수 경로";
}

export function buildUnderwritingPanelItemLead(item = {}) {
  const label = String(item.coverage_label ?? "").trim();
  const step = getUnderwritingPanelReviewStepLabel(item.review_step_code);
  if (!label) return step;
  return `${label} — ${step}`;
}

export function buildUnderwritingPanelItemWhy(item = {}) {
  const label = String(item.coverage_label ?? "").trim();
  const reviewStepCode = item.review_step_code;
  const status = item.underwriting_status;

  if (!label) return null;

  if (reviewStepCode === "maintain_standard_path") {
    return `현재 확인되는 자료 기준으로는 ${label} 쪽 인수 경로부터 같이 보면 됩니다.`;
  }
  if (reviewStepCode === "review_with_gap_priority") {
    return `현재 확인되는 자료 기준으로는 ${label} 보장과 인수심사 경로를 함께 확인하는 편이 좋겠습니다.`;
  }
  if (reviewStepCode === "prepare_health_documents") {
    return `현재 확인되는 자료 기준으로는 ${label} 관련 건강 자료를 함께 정리하면서 인수심사를 확인하는 편이 좋겠습니다.`;
  }
  if (reviewStepCode === "check_exclusion_riders") {
    return `현재 확인되는 자료 기준으로는 ${label} 담보 범위부터 같이 확인하는 편이 좋겠습니다.`;
  }
  if (reviewStepCode === "agent_review_required" || status === "likely_decline") {
    return `현재 확인되는 자료 기준으로는 ${label} 쪽 추가 인수심사 확인이 필요해 보입니다.`;
  }
  if (reviewStepCode === "add_health_memory_context" || status === "unknown") {
    return `현재 확인되는 건강 자료가 제한적이어서, ${label} 관련 자료를 함께 보면서 판단하겠습니다.`;
  }
  return `현재 확인되는 자료 기준으로는 ${label} 인수심사를 조금 더 확인하는 편이 좋겠습니다.`;
}

export function buildUnderwritingPanelItemCaveat(item = {}) {
  const status = item.underwriting_status;
  const confidence = item.confidence_level ?? "medium";

  if (
    status === "likely_decline" ||
    status === "likely_surcharge" ||
    status === "likely_exclusion" ||
    status === "likely_additional_review" ||
    status === "unknown" ||
    confidence === "low" ||
    confidence === "medium"
  ) {
    return "다만 현재 자료만으로는 가입 가능 여부를 단정하지 않겠습니다.";
  }
  return null;
}

export const UW_REQUIRED_DOCUMENT_LABELS = {
  health_disclosure: "건강 고지 자료",
  prescription_record: "처방·투약 기록",
  hospitalization_record: "입원 기록",
  diagnosis_record: "진단 기록",
  additional_health_context: "추가 건강 자료",
};

export function formatRequiredDocumentCode(code) {
  return UW_REQUIRED_DOCUMENT_LABELS[code] ?? String(code ?? "");
}

export function formatRequiredDocumentCodes(codes = []) {
  return (codes ?? []).map(formatRequiredDocumentCode).filter(Boolean);
}

export function auditUnderwritingPanelKeyVoice(text = "") {
  const combined = String(text);
  const forbiddenHits = FORBIDDEN_UW_PANEL_PHRASES.filter((phrase) => combined.includes(phrase));
  return {
    forbidden_hits: forbiddenHits,
    pass: forbiddenHits.length === 0,
  };
}
