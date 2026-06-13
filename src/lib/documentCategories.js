export const DOCUMENT_CATEGORIES = [
  {
    key: "insurance_policy",
    label: "보험증권",
    docClass: "policy_certificate",
    hintType: "insurance_policy",
  },
  {
    key: "coverage_analysis_sheet",
    label: "보장분석표",
    docClass: "coverage_analysis_sheet",
    hintType: "coverage_analysis_sheet",
  },
  {
    key: "terms",
    label: "약관",
    docClass: "terms",
    hintType: "terms",
  },
  {
    key: "claim",
    label: "청구서류",
    docClass: "claim",
    hintType: "claim",
  },
  {
    key: "medical",
    label: "의료서류",
    docClass: "medical",
    hintType: "medical",
  },
  {
    key: "other",
    label: "기타문서",
    docClass: "other",
    hintType: "other",
  },
];

const LEGACY_DOC_CLASS_BY_KEY = {
  insurance_policy: "policy_certificate",
  coverage_analysis_sheet: "other",
  terms: "terms",
  claim: "claim",
  medical: "medical",
  other: "other",
};

export function resolveLegacyDocClass(category) {
  return LEGACY_DOC_CLASS_BY_KEY[category.key] ?? category.docClass;
}
