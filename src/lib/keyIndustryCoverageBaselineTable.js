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
 * Structured-axis screen labels (confirmed plan). Matching is name-heuristic only;
 * never invents amounts. Ambiguous names stay 미확인.
 */
export const BASELINE_STRUCTURED_AXES = Object.freeze({
  caregiving: Object.freeze([
    Object.freeze({ id: "daily_amount", label: "1일 보장액", patterns: [/1일/, /일당/, /하루/] }),
    Object.freeze({ id: "max_days", label: "최대 지급일수", patterns: [/최대.*일/, /지급일수/, /보장일수/] }),
    Object.freeze({ id: "caregiver_direct", label: "간병인 직접 사용", patterns: [/간병인/] }),
    Object.freeze({
      id: "nursing_integrated",
      label: "간호간병통합병동",
      patterns: [/간호간병통합/, /통합병동/],
    }),
    Object.freeze({ id: "renewal", label: "갱신 여부", patterns: [/갱신/] }),
    Object.freeze({ id: "reduction", label: "감액 조건", patterns: [/감액/] }),
  ]),
  hospital_daily: Object.freeze([
    Object.freeze({ id: "disease_daily", label: "질병 일당", patterns: [/질병.*일당/, /질병입원/] }),
    Object.freeze({ id: "injury_daily", label: "상해 일당", patterns: [/상해.*일당/, /상해입원/] }),
    Object.freeze({ id: "waiting_days", label: "면책일", patterns: [/면책/] }),
    Object.freeze({ id: "max_pay_days", label: "최대 지급일", patterns: [/최대.*일/, /지급일수/] }),
    Object.freeze({ id: "hospital_grade", label: "병원급 조건", patterns: [/병원급/, /요양병원/, /상급종합/] }),
  ]),
  surgery: Object.freeze([
    Object.freeze({ id: "disease_surgery", label: "질병수술비", patterns: [/질병수술/] }),
    Object.freeze({ id: "injury_surgery", label: "상해수술비", patterns: [/상해수술/] }),
    Object.freeze({ id: "species_surgery", label: "종수술비", patterns: [/종수술/] }),
    Object.freeze({ id: "specific_n_surgery", label: "특정/N대 수술비", patterns: [/특정수술/, /N대/, /ｎ대/i] }),
    Object.freeze({ id: "per_event", label: "회당 지급", patterns: [/회당/, /1회/] }),
    Object.freeze({ id: "repeat_pay", label: "반복 지급", patterns: [/반복/, /재수술/] }),
  ]),
});

/** major_treatment — two regions; never sum A↔B. */
export const MAJOR_TREATMENT_REGIONS = Object.freeze([
  Object.freeze({
    id: "cancer",
    label: "암 주요치료비",
    axes: Object.freeze([
      Object.freeze({ id: "cancer_surgery", label: "암 수술", patterns: [/암\s*수술/, /암수술/] }),
      Object.freeze({
        id: "chemo_drug",
        label: "항암약물치료",
        patterns: [/항암약물/, /항암제/, /항암(?!방사선)/],
      }),
      Object.freeze({
        id: "chemo_radiation",
        label: "항암방사선치료",
        patterns: [/항암방사선/, /암.*방사선/],
      }),
      Object.freeze({
        id: "targeted_immuno",
        label: "표적·면역항암",
        patterns: [/표적/, /면역항암/],
      }),
      Object.freeze({
        id: "high_cost_radiation",
        label: "고가 방사선치료",
        patterns: [/고가\s*방사선/, /양성자/, /중입자/],
      }),
      Object.freeze({ id: "repeat_pay", label: "반복 지급 구조", patterns: [/반복/, /연간한도/, /회한/] }),
    ]),
  }),
  Object.freeze({
    id: "brain_heart",
    label: "뇌·심 주요치료비",
    axes: Object.freeze([
      Object.freeze({
        id: "cerebro_major",
        label: "뇌혈관 주요치료",
        patterns: [/뇌혈관.*치료/, /뇌혈관.*시술/, /뇌혈관.*수술/],
      }),
      Object.freeze({
        id: "ischemic_major",
        label: "허혈성심장 주요치료",
        patterns: [/허혈성심장.*치료/, /허혈성심장.*시술/, /허혈성심장.*수술/],
      }),
      Object.freeze({
        id: "cardio_procedure",
        label: "수술·시술",
        patterns: [/(뇌혈관|허혈성심장|심뇌).*(수술|시술)/],
      }),
      Object.freeze({
        id: "thrombolysis",
        label: "약물·혈전용해·혈전제거 등 약관상 주요치료",
        patterns: [/혈전용해/, /혈전제거/, /약관상\s*주요치료/],
      }),
      Object.freeze({ id: "icu", label: "중환자 치료", patterns: [/중환자/, /ICU/i] }),
      Object.freeze({ id: "repeat_pay", label: "반복 지급 구조", patterns: [/반복/, /연간한도/, /회한/] }),
    ]),
  }),
]);

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
    label: "일반암 진단비",
    shortLabel: "일반암 진단비",
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
    label: "간병인 사용 입원 보장",
    shortLabel: "간병인 사용 입원 보장",
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
    label: "질병·상해 입원일당",
    shortLabel: "질병·상해 입원일당",
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
    label: "수술 보장 구조",
    shortLabel: "수술 보장 구조",
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
      "암 주요치료비와 뇌·심 주요치료비를 분리해 본다. 영역 간 금액·조건을 합산하지 않는다.",
    unit: "구조화",
    compareMode: "treatment_structured",
    industry_range_low: null,
    industry_range_high: null,
    industry_cumulative_limit: null,
    apply_conditions: "치료 범위·연한도가 확인되지 않으면 확인 필요. A/B 합산 금지.",
    source: "권한 있는 누적 인수기준 미확보",
    source_kind: "none",
    as_of: KEY_INDUSTRY_COVERAGE_BASELINE_AS_OF,
    version: KEY_INDUSTRY_COVERAGE_BASELINE_VERSION,
  },
];

export function getIndustryBaselineItem(id) {
  return KEY_INDUSTRY_COVERAGE_BASELINE_ITEMS.find((row) => row.id === id) || null;
}
