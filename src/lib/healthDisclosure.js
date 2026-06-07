export const INSURANCE_DISCLOSURE_VERSION = "phase17-v1";

export const INSURANCE_DISCLOSURE_STATUS_OPTIONS = [
  { value: "yes", label: "예" },
  { value: "no", label: "아니오" },
  { value: "unknown", label: "모름/해당없음" },
];

/** Simplified insurance disclosure fields only — no disease-specific columns. */
export const HEALTH_DISCLOSURE_FIELD_DEFS = [
  {
    statusKey: "current_medication_status",
    notesKey: "current_medication_notes",
    label: "현재 복용 약물 여부",
    notesLabel: "복용 약물 메모",
    notesPlaceholder: "복용 중인 약이 있으면 간단히 입력해 주세요.",
  },
  {
    statusKey: "recent_3m_hospital_visit",
    notesKey: "recent_3m_hospital_visit_notes",
    label: "최근 3개월 내 병원 방문",
    notesLabel: "병원 방문 메모",
    notesPlaceholder: "방문 사유나 시기를 간단히 입력해 주세요.",
  },
  {
    statusKey: "recent_1y_exam_or_recheck",
    notesKey: "recent_1y_exam_or_recheck_notes",
    label: "최근 1년 내 검사/재검",
    notesLabel: "검사/재검 메모",
    notesPlaceholder: "검사 종류나 결과 요약을 입력해 주세요.",
  },
  {
    statusKey: "recent_5y_hospitalization_or_surgery",
    notesKey: "recent_5y_hospitalization_or_surgery_notes",
    label: "최근 5년 내 입원/수술",
    notesLabel: "입원/수술 메모",
    notesPlaceholder: "입원·수술 이력을 간단히 입력해 주세요.",
  },
  {
    statusKey: "other_medical_history",
    notesKey: "other_medical_history_notes",
    label: "기타 병력/의료 이력",
    notesLabel: "기타 병력 메모",
    notesPlaceholder: "기타 알려야 할 의료 이력을 입력해 주세요.",
  },
];

/** Explicitly excluded from Phase 17 intake (disease-specific). */
export const FORBIDDEN_DISEASE_SPECIFIC_FIELDS = [
  "hypertension_medication",
  "diabetes_medication",
  "hyperlipidemia_medication",
  "cancer_history",
  "heart_disease_history",
  "brain_disease_history",
  "psychiatric_history",
  "liver_disease_history",
];

export const EMPTY_HEALTH_DISCLOSURE = Object.fromEntries(
  HEALTH_DISCLOSURE_FIELD_DEFS.flatMap(({ statusKey, notesKey }) => [
    [statusKey, ""],
    [notesKey, ""],
  ]),
);

export function extractHealthDisclosure(detailsJson) {
  const root = detailsJson && typeof detailsJson === "object" ? detailsJson : {};
  const stored = root.insurance_disclosure;
  const values =
    stored && typeof stored === "object" ? { ...EMPTY_HEALTH_DISCLOSURE, ...stored } : {
      ...EMPTY_HEALTH_DISCLOSURE,
    };

  return {
    version: root.insurance_disclosure_version ?? INSURANCE_DISCLOSURE_VERSION,
    values,
  };
}

export function buildHealthDisclosurePayload(values) {
  const payload = { ...EMPTY_HEALTH_DISCLOSURE };
  for (const { statusKey, notesKey } of HEALTH_DISCLOSURE_FIELD_DEFS) {
    payload[statusKey] = String(values?.[statusKey] ?? "").trim();
    payload[notesKey] = String(values?.[notesKey] ?? "").trim();
  }
  return payload;
}

export function formatDisclosureStatus(value) {
  const option = INSURANCE_DISCLOSURE_STATUS_OPTIONS.find((item) => item.value === value);
  return option?.label ?? (value || "—");
}
