/**
 * Signup onboarding V1 — all-insurer identity section data (READ ONLY sources).
 * No fake logos. logoStatus: OFFICIAL_LOGO_PENDING until official assets land in repo.
 *
 * Sources (verified 2026-07-26, read-only):
 * - FSS press summary ’26 Q1: 생명보험 22 · 손해보험 30 (보험회사 영업 기준)
 * - KLIA 회원사안내 https://www.klia.or.kr/klia/company/member/list.do
 * - KNIA 수시경영공시/소비자포털 회사별 공시
 *   https://kpub.knia.or.kr/managementDisc/spot/spotDisclosure.do
 *   https://consumer.knia.or.kr/disclosure.do
 *
 * Scope note for Jinwoo:
 * - Display = customer-facing domestic life/non-life insurers from association lists.
 * - Reinsurance / foreign branches / GA·금융서비스 준회원은 FSS 30·협회 준회원에
 *   섞여 있으나, 고객 “가입 보험사” 메시지와 업권이 달라 아래 excluded로 별도 보고.
 * - 예별손해보험 = 舊 MG손해보험 (사명 변경; MG 중복 표기 금지).
 */

export const INSURER_LIST_META = {
  asOf: "2026-07-26",
  fssOperatingCount: { life: 22, nonLife: 30, total: 52 },
  sources: [
    {
      id: "fss-2026q1",
      title: "금융감독원 2026년 1분기 보험회사 경영실적(잠정)",
      note: "생보 22 · 손보 30 영업 중 집계",
    },
    {
      id: "klia-members",
      title: "생명보험협회 회원사안내",
      url: "https://www.klia.or.kr/klia/company/member/list.do",
    },
    {
      id: "knia-spot",
      title: "손해보험협회 수시경영공시 회원사",
      url: "https://kpub.knia.or.kr/managementDisc/spot/spotDisclosure.do",
    },
    {
      id: "knia-consumer",
      title: "손해보험협회 소비자포털 회사별 공시",
      url: "https://consumer.knia.or.kr/disclosure.do",
    },
  ],
  renames: [{ from: "MG손해보험", to: "예별손해보험", note: "舊 MG → 예별" }],
  ambiguity: [
    "FSS 손보 30에는 재보험·외국지점 등이 포함된다. 고객 가입 보험사 시현에는 국내 원수 손해보험사(협회 소비자 공시 대상)를 우선 표시한다.",
    "재보험·외국지점·GA·금융서비스는 excludedPendingApproval로 분리. 진우 승인 전 동등 타일 강제 포함하지 않음.",
  ],
};

/** KLIA 정회원 20 + 영업 보험회사 준회원 2 (IBK연금·교보라이프플래닛) = 22 */
export const LIFE_INSURERS = [
  { id: "abl", name: "ABL생명", logoStatus: "OFFICIAL_LOGO_PENDING" },
  { id: "aia", name: "AIA생명", logoStatus: "OFFICIAL_LOGO_PENDING" },
  { id: "bnp", name: "BNP파리바카디프생명", logoStatus: "OFFICIAL_LOGO_PENDING" },
  { id: "db-life", name: "DB생명", logoStatus: "OFFICIAL_LOGO_PENDING" },
  { id: "ibk", name: "IBK연금보험", logoStatus: "OFFICIAL_LOGO_PENDING" },
  { id: "im", name: "iM라이프생명", logoStatus: "OFFICIAL_LOGO_PENDING" },
  { id: "kb-life", name: "KB라이프생명", logoStatus: "OFFICIAL_LOGO_PENDING" },
  { id: "kdb", name: "KDB생명", logoStatus: "OFFICIAL_LOGO_PENDING" },
  { id: "nh-life", name: "NH농협생명", logoStatus: "OFFICIAL_LOGO_PENDING" },
  { id: "kyobo", name: "교보생명", logoStatus: "OFFICIAL_LOGO_PENDING" },
  { id: "kyobo-planet", name: "교보라이프플래닛", logoStatus: "OFFICIAL_LOGO_PENDING" },
  { id: "dongyang", name: "동양생명", logoStatus: "OFFICIAL_LOGO_PENDING" },
  { id: "lina-life", name: "라이나생명", logoStatus: "OFFICIAL_LOGO_PENDING" },
  { id: "metlife", name: "메트라이프생명", logoStatus: "OFFICIAL_LOGO_PENDING" },
  { id: "mirae", name: "미래에셋생명", logoStatus: "OFFICIAL_LOGO_PENDING" },
  { id: "samsung-life", name: "삼성생명", logoStatus: "OFFICIAL_LOGO_PENDING" },
  { id: "shinhan-life", name: "신한라이프생명", logoStatus: "OFFICIAL_LOGO_PENDING" },
  { id: "chubb-life", name: "처브라이프생명", logoStatus: "OFFICIAL_LOGO_PENDING" },
  { id: "fubon", name: "푸본현대생명", logoStatus: "OFFICIAL_LOGO_PENDING" },
  { id: "hana-life", name: "하나생명", logoStatus: "OFFICIAL_LOGO_PENDING" },
  { id: "hanwha-life", name: "한화생명", logoStatus: "OFFICIAL_LOGO_PENDING" },
  { id: "heungkuk-life", name: "흥국생명", logoStatus: "OFFICIAL_LOGO_PENDING" },
].sort((a, b) => a.name.localeCompare(b.name, "ko"));

/**
 * KNIA 소비자포털·수시공시 기준 국내 원수 손해보험사 (가나다순).
 * MG는 예별로 통합(사명 변경). 코리안리 등 재보험은 excluded.
 */
export const NON_LIFE_INSURERS = [
  { id: "aig", name: "AIG손해보험", logoStatus: "OFFICIAL_LOGO_PENDING" },
  { id: "axa", name: "AXA손해보험", logoStatus: "OFFICIAL_LOGO_PENDING" },
  { id: "db-pc", name: "DB손해보험", logoStatus: "OFFICIAL_LOGO_PENDING" },
  { id: "kb-pc", name: "KB손해보험", logoStatus: "OFFICIAL_LOGO_PENDING" },
  { id: "nh-pc", name: "농협손해보험", logoStatus: "OFFICIAL_LOGO_PENDING" },
  { id: "lotte", name: "롯데손해보험", logoStatus: "OFFICIAL_LOGO_PENDING" },
  { id: "meritz", name: "메리츠화재", logoStatus: "OFFICIAL_LOGO_PENDING" },
  { id: "samsung-fire", name: "삼성화재", logoStatus: "OFFICIAL_LOGO_PENDING" },
  { id: "seoul-guarantee", name: "서울보증보험", logoStatus: "OFFICIAL_LOGO_PENDING" },
  { id: "shinhan-ez", name: "신한EZ손해보험", logoStatus: "OFFICIAL_LOGO_PENDING" },
  { id: "lina-pc", name: "라이나손해보험", logoStatus: "OFFICIAL_LOGO_PENDING" },
  { id: "yebel", name: "예별손해보험", logoStatus: "OFFICIAL_LOGO_PENDING" },
  { id: "kakao", name: "카카오페이손해보험", logoStatus: "OFFICIAL_LOGO_PENDING" },
  { id: "hana-pc", name: "하나손해보험", logoStatus: "OFFICIAL_LOGO_PENDING" },
  { id: "hanwha-pc", name: "한화손해보험", logoStatus: "OFFICIAL_LOGO_PENDING" },
  { id: "hyundai", name: "현대해상", logoStatus: "OFFICIAL_LOGO_PENDING" },
  { id: "heungkuk-fire", name: "흥국화재", logoStatus: "OFFICIAL_LOGO_PENDING" },
].sort((a, b) => a.name.localeCompare(b.name, "ko"));

/** 진우 승인 전 동등 타일 미포함 — 업권 상이 */
export const EXCLUDED_PENDING_APPROVAL = {
  reinsurance: ["코리안리재보험", "RGA재보험 한국지점", "제네럴재보험", "뮌헨재보험", "스위스리", "SCOR", "하노버재보험"],
  foreignBranchesEtc: ["미쓰이스미토모", "알리안츠글로벌", "스타인터내셔널", "퍼시픽라이프리", "FMIC", "퍼스트", "마이브라운"],
  gaOrServices: [
    "한화생명금융서비스",
    "미래에셋금융서비스",
    "한화라이프랩",
    "KB라이프파트너스",
    "동양생명금융서비스",
    "HK금융파트너스",
    "AIA프리미어파트너스",
    "삼성생명금융서비스",
  ],
  note: "FSS 손보 30 − 표시 원수사 ≈ 재보험·외국지점 등. 완전 일치 명단은 FSS 원장 대조 후 진우 GO로 확장.",
};

export function countPendingLogos(list) {
  return list.filter((x) => x.logoStatus === "OFFICIAL_LOGO_PENDING").length;
}
