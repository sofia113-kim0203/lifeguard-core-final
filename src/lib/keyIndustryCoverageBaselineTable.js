/**
 * KEY 업계누적 보장 기준선 — versioned industry reference table (product data).
 *
 * Honesty rule: do not invent industry amounts. Until a cited source is
 * authorized and dated, range/limit stay null → UI status "기준 확인 중".
 *
 * Open product-disclosure channels (e.g. 생보협회 공시실 / 보험다모아) are
 * NOT treated as cumulative underwriting limits.
 */

export const KEY_INDUSTRY_COVERAGE_BASELINE_VERSION = "v1.0.0-empty-sources";
export const KEY_INDUSTRY_COVERAGE_BASELINE_AS_OF = "2026-07-18";

/** @typedef {"cancer_diagnosis"|"cerebrovascular_diagnosis"|"ischemic_heart_diagnosis"|"caregiving"|"hospital_daily"|"surgery"|"major_treatment"} BaselineItemId */

/**
 * @type {Array<{
 *   id: BaselineItemId,
 *   label: string,
 *   shortLabel: string,
 *   definition: string,
 *   unit: string,
 *   compareMode: "lump_sum"|"daily_structured"|"surgery_structured"|"treatment_structured",
 *   industry_range_low: number|null,
 *   industry_range_high: number|null,
 *   industry_cumulative_limit: number|null,
 *   apply_conditions: string,
 *   source: string,
 *   source_kind: "none"|"insurer_uw"|"association_disclosure"|"product_summary",
 *   as_of: string,
 *   version: string,
 * }>}
 */
export const KEY_INDUSTRY_COVERAGE_BASELINE_ITEMS = [
  {
    id: "cancer_diagnosis",
    label: "암 진단비",
    shortLabel: "암 진단비",
    definition:
      "일반암 진단 시 지급되는 진단비. 유사암·소액암·경계성종양은 별도 항목으로 다루며 일반암 합산에 넣지 않는다.",
    unit: "원",
    compareMode: "lump_sum",
    industry_range_low: null,
    industry_range_high: null,
    industry_cumulative_limit: null,
    apply_conditions: "일반암 기준. 유사암·소액암 제외.",
    source: "권한 있는 누적 인수기준 미확보 — 공개 상품공시 가입금액을 누적 한도로 사용하지 않음",
    source_kind: "none",
    as_of: KEY_INDUSTRY_COVERAGE_BASELINE_AS_OF,
    version: KEY_INDUSTRY_COVERAGE_BASELINE_VERSION,
  },
  {
    id: "cerebrovascular_diagnosis",
    label: "뇌혈관질환 진단비",
    shortLabel: "뇌혈관질환 진단비",
    definition:
      "뇌혈관질환 범위가 확인된 진단비. 뇌출혈·뇌졸중 등 좁은 담보만 확인된 경우 이 기준선에 합산하지 않는다.",
    unit: "원",
    compareMode: "lump_sum",
    industry_range_low: null,
    industry_range_high: null,
    industry_cumulative_limit: null,
    apply_conditions: "담보명/약관상 뇌혈관질환(광의) 확인 시에만 합산.",
    source: "권한 있는 누적 인수기준 미확보",
    source_kind: "none",
    as_of: KEY_INDUSTRY_COVERAGE_BASELINE_AS_OF,
    version: KEY_INDUSTRY_COVERAGE_BASELINE_VERSION,
  },
  {
    id: "ischemic_heart_diagnosis",
    label: "허혈성심장질환 진단비",
    shortLabel: "허혈성심장질환 진단비",
    definition:
      "허혈성심장질환 범위가 확인된 진단비. 급성심근경색 등 좁은 담보만 확인된 경우 합산하지 않는다.",
    unit: "원",
    compareMode: "lump_sum",
    industry_range_low: null,
    industry_range_high: null,
    industry_cumulative_limit: null,
    apply_conditions: "담보명/약관상 허혈성심장질환(광의) 확인 시에만 합산.",
    source: "권한 있는 누적 인수기준 미확보",
    source_kind: "none",
    as_of: KEY_INDUSTRY_COVERAGE_BASELINE_AS_OF,
    version: KEY_INDUSTRY_COVERAGE_BASELINE_VERSION,
  },
  {
    id: "caregiving",
    label: "간병비",
    shortLabel: "간병비",
    definition:
      "간병·간호 관련 담보. 단순 금액 합계가 아니라 1일 지급액·보장 일수·간병인 사용·간호간병통합·갱신·감액 조건을 함께 본다.",
    unit: "구조화",
    compareMode: "daily_structured",
    industry_range_low: null,
    industry_range_high: null,
    industry_cumulative_limit: null,
    apply_conditions: "일당·일수·조건이 verified된 경우에만 비교. 금액만 있으면 확인 필요.",
    source: "권한 있는 누적 인수기준 미확보",
    source_kind: "none",
    as_of: KEY_INDUSTRY_COVERAGE_BASELINE_AS_OF,
    version: KEY_INDUSTRY_COVERAGE_BASELINE_VERSION,
  },
  {
    id: "hospital_daily",
    label: "입원일당",
    shortLabel: "입원일당",
    definition: "입원 1일당 지급액. 면책일·최대 지급일수·질병/상해 구분을 함께 본다.",
    unit: "구조화",
    compareMode: "daily_structured",
    industry_range_low: null,
    industry_range_high: null,
    industry_cumulative_limit: null,
    apply_conditions: "일당·일수·면책·질병/상해 구분이 불명확하면 확인 필요.",
    source: "권한 있는 누적 인수기준 미확보",
    source_kind: "none",
    as_of: KEY_INDUSTRY_COVERAGE_BASELINE_AS_OF,
    version: KEY_INDUSTRY_COVERAGE_BASELINE_VERSION,
  },
  {
    id: "surgery",
    label: "수술비",
    shortLabel: "수술비",
    definition:
      "질병수술·상해수술·종수술·특정수술 등을 하나의 숫자로 합치지 않고 범위·회당 한도·반복 지급 여부를 구조화해 본다.",
    unit: "구조화",
    compareMode: "surgery_structured",
    industry_range_low: null,
    industry_range_high: null,
    industry_cumulative_limit: null,
    apply_conditions: "수술 종류·회당 한도가 불명확하면 확인 필요. 전 수술 금액 단순합산 금지.",
    source: "권한 있는 누적 인수기준 미확보",
    source_kind: "none",
    as_of: KEY_INDUSTRY_COVERAGE_BASELINE_AS_OF,
    version: KEY_INDUSTRY_COVERAGE_BASELINE_VERSION,
  },
  {
    id: "major_treatment",
    label: "주요치료비",
    shortLabel: "주요치료비",
    definition:
      "항암약물·방사선·표적·면역·로봇수술·심뇌혈관 주요치료 등. 연간 한도·반복 지급·범위를 구분한다.",
    unit: "구조화",
    compareMode: "treatment_structured",
    industry_range_low: null,
    industry_range_high: null,
    industry_cumulative_limit: null,
    apply_conditions: "치료 범위·연한도가 확인되지 않으면 확인 필요.",
    source: "권한 있는 누적 인수기준 미확보",
    source_kind: "none",
    as_of: KEY_INDUSTRY_COVERAGE_BASELINE_AS_OF,
    version: KEY_INDUSTRY_COVERAGE_BASELINE_VERSION,
  },
];

export function getIndustryBaselineItem(id) {
  return KEY_INDUSTRY_COVERAGE_BASELINE_ITEMS.find((row) => row.id === id) || null;
}
