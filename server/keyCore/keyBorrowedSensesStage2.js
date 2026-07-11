/**
 * S7 Stage 2 — Preview-only / allowlist-only / gate-pass-only promotion.
 * Pure decision helpers. Does not call Claude. Does not soften gate.
 */
import { isKeyBorrowedSensesStage2Partial, isVercelProductionEnv } from "./oneKeyCoreFlags.js";
import {
  isPlacePublicResearchRequest,
  countGroundedPlaceCandidates,
} from "./keyBorrowedSensesSpeak.js";

export const STAGE2_SCHEMA = "s7-active-stage2-partial-v0";

/** Tier A allowlist — exact question match after normalize. */
export const STAGE2_TIER_A_ALLOWLIST = [
  {
    id: "FULLVOICE_Q7_BROWSE",
    maps_to_s7_id: "S7Q9",
    question: "그냥 둘러보러 왔어",
  },
  {
    id: "FULLVOICE_Q4_PREMIUM_CUT",
    maps_to_s7_id: "S7Q3",
    question: "보험료 줄이고 싶어",
  },
  {
    id: "FULLVOICE_Q2_WHAT_DO_I_NEED",
    maps_to_s7_id: "S7Q7",
    question: "나한테 뭐가 필요해?",
  },
  {
    id: "FULLVOICE_Q9_RECOMMEND",
    maps_to_s7_id: "S7Q6",
    question: "보험 추천해줘",
  },
  {
    id: "FULLVOICE_Q8_KEEP_POLICY",
    maps_to_s7_id: null,
    question: "이 보험 유지해야 해?",
  },
];

function normalizeQuestion(q = "") {
  return String(q ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

export function matchStage2Allowlist(question = "") {
  const q = normalizeQuestion(question);
  if (!q) return null;
  return STAGE2_TIER_A_ALLOWLIST.find((item) => normalizeQuestion(item.question) === q) ?? null;
}

/**
 * F6: explicit no-docs signal + imperative ungrounded full personal judgment.
 * Requires both signals. Does not block methodology, scope-only, or prep questions.
 * Does not block bare "증권이 없어" facts.
 */
function isUngroundedFullJudgmentWithoutDocs(q = "") {
  const docAbsent =
    /(?:증권|자료|서류)\s*없이|(?:증권|자료|서류)\s*없어도/.test(q);
  if (!docAbsent) return false;

  // Method / scope / prep — allow even when docs are absent
  if (
    /어떤\s*기준|어떻게\s*(?:판단|보)|판단할\s*때|판단\s*방법|기준을\s*보|확인할\s*수\s*있는\s*범위|범위만|무엇부터\s*준비|준비하면/.test(
      q,
    )
  ) {
    return false;
  }

  return (
    /(?:내\s*)?(?:보장|보험)\s*전체\s*(?:를\s*)?판단/.test(q) ||
    /전체가\s*충분한지|전체\s*(?:가\s*)?충분한지\s*(?:봐|확정|알려)/.test(q) ||
    /(?:보험|보장)\s*전체가\s*충분한지/.test(q) ||
    /전체\s*공백과\s*중복/.test(q) ||
    /공백과\s*중복을\s*판단/.test(q)
  );
}

/** Q10-style whole-portfolio expansion — never promote. Also F6 no-doc full judgment. */
export function isQ10PortfolioExpansionQuestion(question = "") {
  const q = normalizeQuestion(question);
  if (!q) return false;

  // Classic Q10 whole-portfolio "괜찮아?"
  if (/내\s*보험\s*(?:전체\s*)?괜찮아|전체\s*보험\s*괜찮아/.test(q)) return true;

  // Portfolio expansion — not glossary/education ("무슨 뜻")
  if (/포트폴리오/.test(q) && !/(?:무슨\s*뜻|뭐야|무엇|설명)/.test(q)) return true;

  // F6: 증권/자료/서류 없이 + 실행형 개인 전체 판단
  if (isUngroundedFullJudgmentWithoutDocs(q)) return true;

  return false;
}

export function isWaitOnlyVoice(text = "") {
  const t = String(text ?? "").trim();
  if (!t) return true;
  return (
    /(?:궁금한\s*게\s*생기|필요하면|편하실\s*때).{0,24}말씀해\s*주세요\.?\s*$/.test(t) ||
    (/말씀해\s*주세요/.test(t) && !/추천|볼까요|부터|기준|후보|맞아\s*보이/.test(t))
  );
}

function hasHardSalesPush(text = "") {
  const t = String(text ?? "");
  return (
    /(?:이\s*상품|이\s*보험).{0,20}(?:가입하(?:세요|십시오)|가입을\s*(?:추천|권유)|무조건\s*가입)/.test(t) ||
    /(?:지금|바로)\s*가입(?:하(?:세요|십시오|는\s*게)|을\s*(?:추천|권유))/.test(t) ||
    /가입하세요|해지하(?:세요|셔야)|해지해도\s*됩니다|갈아타세요/.test(t)
  );
}

function passesFullVoiceMinimum(borrowed = {}, voice = "") {
  const nd = Array.isArray(borrowed?.next_decision_point)
    ? borrowed.next_decision_point.map((c) => String(c).trim()).filter(Boolean)
    : [];
  if (nd.length < 2) return false;
  if (isWaitOnlyVoice(voice)) return false;
  const blob = [
    voice,
    borrowed?.recommendation_basis,
    borrowed?.proposal_direction,
    borrowed?.leadership_move,
    ...nd,
  ]
    .filter(Boolean)
    .join(" ");
  const hasLean = /추천|맞아\s*보이|먼저|부터\s*(?:보|확인)|후보|기준|방향/.test(blob);
  const hasBasis =
    Boolean(String(borrowed?.recommendation_basis ?? "").trim()) ||
    /맞아\s*보이|먼저|목적|기준|후보/.test(blob);
  const continues = /볼까요|확인해볼|어느\s*쪽|부터\s*(?:보|확인)|선택/.test(blob) || nd.length >= 2;
  return hasLean && hasBasis && continues;
}

/** Mid-field blob (not customer answer) — trace/warning only for answer-first approval. */
export function collectBorrowedMidFieldText(borrowed = {}) {
  const parts = [
    borrowed?.customer_intent,
    ...(Array.isArray(borrowed?.understanding_hypotheses) ? borrowed.understanding_hypotheses : []),
    borrowed?.proposal_direction,
    borrowed?.leadership_move,
    borrowed?.key_purpose,
    ...(Array.isArray(borrowed?.next_decision_point) ? borrowed.next_decision_point : []),
    ...(Array.isArray(borrowed?.insurance_expertise_angle) ? borrowed.insurance_expertise_angle : []),
  ];
  return parts.map((s) => String(s ?? "").trim()).filter(Boolean).join(" ");
}

export function isDailyOwnedDecisionFocus(decision = null) {
  if (!decision || typeof decision !== "object") return false;
  const priority = String(decision.response_priority ?? "").trim();
  const situation = String(decision.situation_key ?? "").trim();
  const dirType = String(decision.direction?.type ?? decision.key_direction?.type ?? "").trim();
  return (
    priority === "daily_focus" ||
    priority === "non_insurance_focus" ||
    situation === "daily_recommendation" ||
    situation === "non_insurance_general" ||
    situation === "emotional_space" ||
    dirType === "general_daily"
  );
}

/** Insurance pollution in the actual customer answer only. */
export function voiceHasDailyInsurancePollution(voice = "", question = "") {
  const v = String(voice ?? "");
  const q = String(question ?? "");
  if (/보험료|보장|청구|보험금|해지|가입|실손|납입/.test(q)) return false;
  return (
    (/보험료|가입하|해지하|보장\s*부족|보장\s*충분|월\s*[\d만천]|22\s*건|빠진\s*보장|보험\s*쪽으로|보험\s*(?:문의|상담)|보험\s*(?:얘기|이야기).{0,12}(?:하|볼|여|드릴)|궁금하신\s*게\s*생기.{0,24}보험/.test(
      v,
    ) &&
      !/보험\s*(?:얘기|이야기).{0,8}(?:나중|말고)/.test(v)) ||
    (/보험료를\s*줄|빠진\s*보장을\s*채|어느\s*쪽이\s*더\s*끌리/.test(v) && !/보험료|보장/.test(q))
  );
}

/** Unverified public-detail assertions (rating / hours / parking / price / distance) — answer-facing fail. */
export function voiceHasUnsourcedPublicAssertions(voice = "") {
  const v = String(voice ?? "");
  return (
    /평점\s*[\d.]+|별점\s*[\d.]+|[\d.]+\s*점(?:이에요|입니다|예요)/.test(v) ||
    /영업\s*시간(?:은|이)?\s*(?:오전|오후|\d)|오늘\s*(?:도\s*)?영업|까지\s*영업/.test(v) ||
    /주차\s*(?:가능|불가|무료|편하|쉽)/.test(v) ||
    /(?:가격|금액).{0,8}(?:원|만\s*원)/.test(v) ||
    /(?:도보|차량|차로|거리).{0,8}\d+(?:\.\d+)?\s*(?:분|km|킬로|미터|m)|\d+(?:\.\d+)?\s*(?:km|킬로미터)/.test(v)
  );
}

function normalizePlaceKey(s = "") {
  return String(s ?? "")
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[.,·]/g, "");
}

function buildGroundedPlaceBlob(publicResearch = null) {
  const parts = [];
  for (const r of publicResearch?.results ?? []) {
    parts.push(r.title, r.url, r.page_age, r.claim_or_summary);
  }
  for (const c of publicResearch?.citations ?? []) {
    parts.push(c.title, c.cited_text, c.url);
  }
  const summary = publicResearch?.customer_facing_summary;
  if (summary && typeof summary === "object") {
    for (const t of summary.title_previews ?? []) parts.push(t);
  }
  return normalizePlaceKey(parts.filter(Boolean).join(" "));
}

const BROAD_AREA_ONLY =
  /^(분당|정자|정자동|서현|미금|판교|야탑|수내|오리|강남|서울|경기|인근|근처|쪽|한식|일식|중식|양식|분위기|동행)$/;

/** Concrete venue-like mentions (suffix / quoted) — not bare common nouns or broad areas. */
export function extractMentionedPlaceCandidates(voice = "", { question = "" } = {}) {
  const v = String(voice ?? "");
  const qNorm = normalizePlaceKey(question);
  const found = [];
  const suffixRe =
    /(?:^|[\s·,/"“‘'])([가-힣A-Za-z0-9]+(?:\s+[가-힣A-Za-z0-9]+){0,3}(?:한정식|일식|중식|양식|식당|카페|레스토랑|고기집|국밥|스시|베이커리|뷔페|캐주얼|브런치|맛집))/g;
  const quotedRe = /[「『"“‘']([가-힣A-Za-z0-9][가-힣A-Za-z0-9\s]{1,24})[」』"”’']/g;
  const recommendRe =
    /([가-힣A-Za-z0-9][가-힣A-Za-z0-9\s]{1,24}?)\s*(?:을|를)?\s*(?:추천(?:해|한|합|드)|먼저\s*볼\s*수)/g;
  for (const re of [suffixRe, quotedRe, recommendRe]) {
    let m;
    while ((m = re.exec(v)) !== null) {
      const name = String(m[1] ?? "").trim();
      if (name.length < 2) continue;
      const compact = name.replace(/\s+/g, "");
      if (BROAD_AREA_ONLY.test(compact)) continue;
      if (/^(한식|일식|중식|양식|캐주얼|브런치|분위기|동행|선택지)$/.test(compact)) continue;
      const key = normalizePlaceKey(name);
      if (qNorm && key.length <= 4 && qNorm.includes(key) && BROAD_AREA_ONLY.test(key)) continue;
      found.push(name);
    }
  }
  return [...new Set(found)];
}

/** Concrete address / exit / building / floor assertions. */
export function extractConcreteLocationClaims(voice = "") {
  const v = String(voice ?? "");
  const claims = [];
  const patterns = [
    /([가-힣A-Za-z0-9]+(?:로|길)\s*\d+(?:-\d+)?)/g,
    /(\d{1,5}(?:-\d{1,5})?\s*번지)/g,
    /([가-힣A-Za-z0-9]+(?:빌딩|타워|센터|몰|백화점)\s*\d*\s*층?)/g,
    /(\d+\s*층)/g,
    /([가-힣]+역\s*\d*\s*번?\s*출구)/g,
    /([가-힣A-Za-z0-9]+\s*\d+\s*호)/g,
  ];
  for (const re of patterns) {
    let m;
    while ((m = re.exec(v)) !== null) {
      const claim = String(m[1] ?? m[0] ?? "").trim();
      if (claim.length >= 2) claims.push(claim);
    }
  }
  return [...new Set(claims)];
}

function isResearchUnavailable(publicResearch = null) {
  if (!publicResearch || typeof publicResearch !== "object") return true;
  const status = String(publicResearch.status ?? "");
  return (
    publicResearch.research_unavailable === true ||
    status === "empty" ||
    status === "error" ||
    status === "unavailable" ||
    status === "incomplete" ||
    status === "search_not_used" ||
    status === "insufficient" ||
    status === "skipped"
  );
}

/** True when answer asserts concrete address/exit/floor/building not present in evidence. */
export function voiceHasUnsupportedAddressClaims(voice = "", publicResearch = null) {
  const claims = extractConcreteLocationClaims(voice);
  if (!claims.length) return false;
  // Broad area phrasing alone is allowed and not extracted above.
  if (!publicResearch || typeof publicResearch !== "object") return true;
  if (isResearchUnavailable(publicResearch) && !(publicResearch.results ?? []).length) {
    return true;
  }
  const grounded = buildGroundedPlaceBlob(publicResearch);
  if (!grounded) return true;
  return claims.some((claim) => {
    const key = normalizePlaceKey(claim);
    if (key.length < 2) return false;
    return !grounded.includes(key);
  });
}

/**
 * True when daily place answer asserts a place name not grounded in research evidence,
 * or invents places when research has no grounded candidates.
 */
export function voiceHasUnsupportedPlaceClaims(voice = "", publicResearch = null, question = "") {
  if (!publicResearch || typeof publicResearch !== "object") return false;
  if (voiceHasUnsupportedAddressClaims(voice, publicResearch)) return true;
  const status = String(publicResearch.status ?? "");
  const results = Array.isArray(publicResearch.results) ? publicResearch.results : [];
  const mentioned = extractMentionedPlaceCandidates(voice, { question });
  if (!mentioned.length) return false;

  // No grounded candidates at all → any concrete venue mention fails.
  if (!results.length) {
    return (
      publicResearch.research_unavailable === true ||
      status === "empty" ||
      status === "error" ||
      status === "unavailable" ||
      status === "incomplete" ||
      status === "search_not_used" ||
      status === "insufficient" ||
      status === "skipped" ||
      status === "success"
    );
  }

  // success / insufficient with partial results: only ungrounded names fail (confirmed candidates OK).
  const grounded = buildGroundedPlaceBlob(publicResearch);
  if (!grounded) return mentioned.length > 0;
  return mentioned.some((name) => {
    const key = normalizePlaceKey(name);
    if (key.length < 2) return false;
    if (grounded.includes(key)) return false;
    const titleTokens = results
      .map((r) => normalizePlaceKey(r.title ?? ""))
      .filter((t) => t.length >= 2);
    if (titleTokens.some((t) => key.includes(t) || t.includes(key))) return false;
    const citedTokens = (publicResearch.citations ?? [])
      .map((c) => normalizePlaceKey(c.cited_text ?? c.title ?? ""))
      .filter((t) => t.length >= 2);
    if (citedTokens.some((t) => t.includes(key) || key.includes(t))) return false;
    return true;
  });
}

export function voiceHasForbiddenCertainty(voice = "") {
  const v = String(voice ?? "");
  return (
    /보험금(?:은|을|이|가)?\s*(?:받|지급).{0,16}(?:됩니다|가능합니다|확실|있습니다)/.test(v) ||
    /(?:지급|청구).{0,8}가능한\s*경우가\s*많/.test(v) ||
    /충분합니다|부족합니다|해지해도\s*됩니다|가입하세요/.test(v)
  );
}

function isResearchSuccess(publicResearch = null) {
  if (!publicResearch || typeof publicResearch !== "object") return false;
  return (
    String(publicResearch.status ?? "") === "success" &&
    publicResearch.research_unavailable !== true
  );
}

function placeNameGroundedInEvidence(name = "", publicResearch = null) {
  const key = normalizePlaceKey(name);
  if (key.length < 2) return false;
  const grounded = buildGroundedPlaceBlob(publicResearch);
  if (grounded.includes(key)) return true;
  const results = Array.isArray(publicResearch?.results) ? publicResearch.results : [];
  const titleTokens = results
    .map((r) => normalizePlaceKey(r.title ?? ""))
    .filter((t) => t.length >= 2);
  if (titleTokens.some((t) => key.includes(t) || t.includes(key))) return true;
  const citedTokens = (publicResearch?.citations ?? [])
    .map((c) => normalizePlaceKey(c.cited_text ?? c.title ?? ""))
    .filter((t) => t.length >= 2);
  return citedTokens.some((t) => t.includes(key) || key.includes(t));
}

/** Grounded venue names actually present in the customer answer. */
export function countGroundedPlaceMentionsInVoice(voice = "", publicResearch = null, question = "") {
  const raw = String(voice ?? "");
  const compactVoice = normalizePlaceKey(raw);
  const hit = new Set();
  const results = Array.isArray(publicResearch?.results) ? publicResearch.results : [];

  for (const r of results) {
    const title = String(r?.title ?? "").trim();
    if (title.length < 2) continue;
    const key = normalizePlaceKey(title);
    if (key.length >= 2 && compactVoice.includes(key)) {
      hit.add(key);
      continue;
    }
    const parts = title.split(/\s+/).filter(Boolean);
    if (parts.length >= 2) {
      const head = normalizePlaceKey(parts.slice(0, 2).join(" "));
      if (head.length >= 4 && compactVoice.includes(head)) hit.add(key);
    }
  }
  // Prefer evidence-title hits so compound extractions cannot inflate the count.
  if (hit.size > 0) return hit.size;

  for (const c of publicResearch?.citations ?? []) {
    const title = String(c?.title ?? "").trim();
    const key = normalizePlaceKey(title);
    if (key.length >= 2 && compactVoice.includes(key)) hit.add(key);
  }
  if (hit.size > 0) return hit.size;

  for (const name of extractMentionedPlaceCandidates(raw, { question })) {
    if (placeNameGroundedInEvidence(name, publicResearch)) {
      hit.add(normalizePlaceKey(name));
    }
  }
  return hit.size;
}

function isPlaceClarifyingOnlyAnswer(voice = "", question = "", publicResearch = null) {
  const v = String(voice ?? "").trim();
  if (!v) return true;
  if (countGroundedPlaceMentionsInVoice(v, publicResearch, question) > 0) return false;
  if (extractMentionedPlaceCandidates(v, { question }).length > 0) return false;
  return (
    /원하(?:시|세)|있으신가요|어떤\s*(?:분위기|음식|곳|종류)|말씀해\s*주|알려\s*주|좁혀|맞출까요|볼까요/.test(
      v,
    ) || /지도에서\s*직접|네이버|카카오.{0,8}직접\s*찾아/.test(v)
  );
}

function voiceHasPlaceChoiceReasons(voice = "") {
  return /추천|담백|조용|편하|좋|한식|일식|중식|양식|캐주얼|분위기|이동|자리|자극|가족|부모|예약/.test(
    String(voice ?? ""),
  );
}

/**
 * Place-recommend completeness — research success + ≥1 grounded name in answer.
 * "3 candidates" is a prompt quality preference, not a Gate fail reason.
 * search_not_used / insufficient / empty / error may clarify without inventing names.
 */
export function collectPlaceRequestCompletenessFail({
  voice = "",
  question = "",
  publicResearchEvidence = null,
} = {}) {
  if (!isPlacePublicResearchRequest(question)) return null;
  const v = String(voice ?? "").trim();
  const status = String(publicResearchEvidence?.status ?? "");

  // Explicit non-success research: clarifying / honest empty allowed here
  // (unsupported invented names still caught by voiceHasUnsupportedPlaceClaims).
  if (
    publicResearchEvidence &&
    typeof publicResearchEvidence === "object" &&
    !isResearchSuccess(publicResearchEvidence) &&
    (status === "search_not_used" ||
      status === "insufficient" ||
      status === "empty" ||
      status === "error" ||
      status === "incomplete" ||
      status === "skipped" ||
      status === "unavailable")
  ) {
    return null;
  }

  if (!isResearchSuccess(publicResearchEvidence)) {
    // No usable success evidence: clarifying-only is not a complete place answer
    // when the path still claims success-like completeness without evidence.
    if (isPlaceClarifyingOnlyAnswer(v, question, publicResearchEvidence)) {
      return "place_request_unanswered";
    }
    if (extractMentionedPlaceCandidates(v, { question }).length === 0) {
      return "place_candidates_missing";
    }
    return null;
  }

  const groundedMentions = countGroundedPlaceMentionsInVoice(v, publicResearchEvidence, question);

  if (groundedMentions === 0) {
    if (
      isPlaceClarifyingOnlyAnswer(v, question, publicResearchEvidence) ||
      /[?？]|까요|세요|원하|분위기|음식\s*종류/.test(v)
    ) {
      return "place_request_unanswered";
    }
    return "place_candidates_missing";
  }
  // grounded ≥ 1: complete enough — do not fail for candidate count < 3
  return null;
}

export function isClaimPrepRequest({ question = "", decision = null } = {}) {
  const priority = String(decision?.response_priority ?? "").trim();
  const situation = String(decision?.situation_key ?? "").trim();
  if (priority === "claim_prep" || situation === "claim_need_check") return true;
  const q = String(question ?? "");
  return /보험금|청구/.test(q) && /수술|걱정|받을\s*수|지급/.test(q);
}

/**
 * Claim-prep completeness — category coverage, not fixed phrase list.
 * Requires: (진단서|수술확인서) + (영수증|세부내역서) + (담보|계약 확인) signal,
 * and surgery/diagnosis name check (ask or state).
 */
export function collectClaimPrepCompletenessFail({
  voice = "",
  question = "",
  decision = null,
} = {}) {
  if (!isClaimPrepRequest({ question, decision })) return null;
  // T2-style parent meal context without payout worry — skip
  if (
    isPlacePublicResearchRequest(question) ||
    (/부모|모시|식사|맛집|식당/.test(String(question ?? "")) && !/보험금|청구/.test(String(question ?? "")))
  ) {
    return null;
  }
  const v = String(voice ?? "");
  const hasDxOrSurgeryDoc = /진단서|수술확인서/.test(v);
  const hasReceiptOrDetail = /영수증|세부내역서|진료비\s*세부/.test(v);
  const hasCoverageOrContract = /담보|계약/.test(v);
  const hasSurgeryOrDxCheck =
    /수술명|진단명|어떤\s*수술|무슨\s*수술|수술\s*종류|진단\s*종류|수술이셨|어떤\s*진단/.test(v);
  if (hasDxOrSurgeryDoc && hasReceiptOrDetail && hasCoverageOrContract && hasSurgeryOrDxCheck) {
    return null;
  }
  return "claim_prep_incomplete";
}

/**
 * Stage3 hard-promote gate for explicit place requests.
 * Requires research success + ≥1 grounded candidate in evidence and answer.
 * Does not require 3 candidates (quality preference only). Does not force regen alone.
 */
export function placeStage3PromoteBlockReason({
  question = "",
  voice = "",
  publicResearchEvidence = null,
} = {}) {
  if (!isPlacePublicResearchRequest(question)) return null;
  const ev = publicResearchEvidence && typeof publicResearchEvidence === "object" ? publicResearchEvidence : null;
  const status = String(ev?.status ?? "");
  const success = Boolean(ev) && status === "success" && ev.research_unavailable !== true;
  if (!success) {
    return "place_promote_requires_research_success";
  }
  if (countGroundedPlaceCandidates(ev) < 1) {
    return "place_promote_requires_research_success";
  }
  const groundedInAnswer = countGroundedPlaceMentionsInVoice(voice, ev, question);
  if (groundedInAnswer < 1) {
    return "place_promote_requires_grounded_candidates";
  }
  return null;
}

/** Soft promotion fails — never alone force constrained regeneration. */
export const SOFT_PROMOTION_FAIL_REASONS = new Set([
  "wait_only",
  "missing_next_decision",
  "mid_field_leadership_not_adopted",
  "mid_field_insurance_drift",
  "stage3_promotion_blocked",
]);

export function isSoftPromotionFailReason(reason = "") {
  const r = String(reason ?? "").trim();
  if (!r) return false;
  if (SOFT_PROMOTION_FAIL_REASONS.has(r)) return true;
  if (r.startsWith("mid_field_")) return true;
  return false;
}

/**
 * Mid-field insurance drift warnings — never alone veto a safe customer answer.
 */
export function collectMidFieldTraceWarnings(borrowed = null, question = "", decision = null) {
  const warnings = [];
  if (!borrowed || typeof borrowed !== "object") return warnings;
  const voice = String(borrowed.voice_raw_candidate ?? "").trim();
  const mid = collectBorrowedMidFieldText(borrowed);
  if (
    isDailyOwnedDecisionFocus(decision) &&
    !voiceHasDailyInsurancePollution(voice, question) &&
    /보험료|보장|청구|가입|해지|22\s*건|보험\s*쪽/.test(mid)
  ) {
    warnings.push("mid_field_insurance_drift");
  }
  if (
    /보험료를\s*줄|빠진\s*보장|가입\s*보험\s*점검|어느\s*쪽이\s*더\s*끌리/.test(mid) &&
    !/보험료를\s*줄|빠진\s*보장|어느\s*쪽이\s*더\s*끌리/.test(voice)
  ) {
    warnings.push("mid_field_leadership_not_adopted");
  }
  return warnings;
}

/**
 * Answer-first safety — veto only when the customer answer itself is unsafe.
 * Mid-field Gate flags (proposal/leadership/next_decision) alone do not fail.
 * Does not globally soften Gate; demotes mid-field-only veto for approval.
 */
export function collectAnswerFacingSafetyFail({
  gate = null,
  voice = "",
  question = "",
  decision = null,
  publicResearchEvidence = null,
} = {}) {
  if (!gate || typeof gate !== "object") return "gate_missing";
  const v = String(voice ?? "").trim();
  if (!v) return "empty_voice";

  if (hasHardSalesPush(v)) return "hard_sales_push";
  if (voiceHasForbiddenCertainty(v)) return "answer_forbidden_certainty";
  if (isDailyOwnedDecisionFocus(decision) && voiceHasDailyInsurancePollution(v, question)) {
    return "decision_mismatch_insurance_pollution";
  }
  if (isDailyOwnedDecisionFocus(decision) && voiceHasUnsourcedPublicAssertions(v)) {
    return "unsourced_public_assertion";
  }
  if (isDailyOwnedDecisionFocus(decision) && voiceHasUnsupportedAddressClaims(v, publicResearchEvidence)) {
    return "unsupported_public_research_claim";
  }
  if (
    isDailyOwnedDecisionFocus(decision) &&
    voiceHasUnsupportedPlaceClaims(v, publicResearchEvidence, question)
  ) {
    return "unsupported_place_claim";
  }

  const placeCompleteness = collectPlaceRequestCompletenessFail({
    voice: v,
    question,
    publicResearchEvidence,
  });
  if (placeCompleteness) return placeCompleteness;

  const claimCompleteness = collectClaimPrepCompletenessFail({
    voice: v,
    question,
    decision,
  });
  if (claimCompleteness) return claimCompleteness;

  // Hard Gate flags only count when the answer text itself carries the risk.
  const voiceScoped = [
    [
      "unsupported_recommendation",
      gate.unsupported_recommendation,
      /추천드|가입을\s*추천|이\s*상품|추가\s*가입/,
    ],
    [
      "product_push_as_direction",
      gate.product_push_as_direction,
      /가입하(?:세요|십시오)|이\s*상품|추가\s*가입|갈아타/,
    ],
    [
      "closing_or_signup_push",
      gate.closing_or_signup_push,
      /가입하(?:세요|십시오)|해지하|마무리|이만\s*줄이/,
    ],
    [
      "leadership_cancel_enroll_certainty",
      gate.leadership_cancel_enroll_certainty,
      /해지해도\s*됩니다|가입하세요|무조건\s*가입|갈아타세요/,
    ],
    [
      "expertise_overclaim",
      gate.expertise_overclaim,
      /부족합니다|충분합니다|문제\s*없(?:어|습니다)|완벽(?:해|합니다)/,
    ],
  ];
  for (const [name, flagged, re] of voiceScoped) {
    if (flagged === true && re.test(v)) return name;
  }

  // Number / hallucination: only when answer text is implicated (Gate already saw assertive blob).
  if (gate.number_scope_violation === true) {
    if (/\d/.test(v) || /나머지\s*\d|절반|대부분|비율/.test(v)) return "number_scope_violation";
  }
  if (gate.context_hallucination === true) {
    if (/(지난\s*번|이전\s*세션).*(말씀|논의)/.test(v)) return "context_hallucination";
  }

  return null;
}

/** True when constrained one-regeneration should run (answer-facing risk only). */
export function shouldUseConstrainedAnswerRegen({
  failReasons = [],
  voice = "",
  question = "",
  decision = null,
  gate = null,
  publicResearchEvidence = null,
} = {}) {
  const reasons = (Array.isArray(failReasons) ? failReasons : [failReasons])
    .map((r) => String(r ?? "").trim())
    .filter(Boolean);
  const answerFacingKnown = new Set([
    "decision_mismatch_insurance_pollution",
    "daily_insurance_pollution",
    "answer_forbidden_certainty",
    "hard_sales_push",
    "daily_unverified_customer_fact",
    "unsourced_public_assertion",
    "unsupported_place_claim",
    "unsupported_public_research_claim",
    "place_request_unanswered",
    "place_candidates_missing",
    "place_candidates_insufficient",
    "claim_prep_incomplete",
    "unsupported_recommendation",
    "product_push_as_direction",
    "closing_or_signup_push",
    "leadership_cancel_enroll_certainty",
    "expertise_overclaim",
    "number_scope_violation",
    "context_hallucination",
  ]);
  for (const r of reasons) {
    if (isSoftPromotionFailReason(r)) continue;
    if (r.startsWith("key_voice_gate:")) return true;
    if (answerFacingKnown.has(r)) return true;
    if (r.startsWith("decision_mismatch_")) return true;
  }
  const direct = collectAnswerFacingSafetyFail({
    gate: gate && typeof gate === "object" ? gate : { ok: true },
    voice,
    question,
    decision,
    publicResearchEvidence,
  });
  // gate_missing / empty_voice on absent candidate are not regen triggers by themselves
  if (direct && direct !== "gate_missing" && direct !== "empty_voice") return true;
  return false;
}

/** Soft-approve a borrowed voice when Stage3 only soft-failed and the answer itself is safe. */
export function canSoftApproveBorrowedVoice({
  voice = "",
  question = "",
  decision = null,
  gate = null,
  failReason = "",
  midFieldWarnings = [],
  publicResearchEvidence = null,
} = {}) {
  const v = String(voice ?? "").trim();
  if (!v) return false;
  if (isWaitOnlyVoice(v)) return false;
  // Never soft-promote incomplete place / claim-prep answers (Compose may omit evidence arg).
  if (isPlacePublicResearchRequest(question)) {
    const placeBlock = placeStage3PromoteBlockReason({
      question,
      voice: v,
      publicResearchEvidence,
    });
    if (placeBlock) return false;
  }
  if (collectClaimPrepCompletenessFail({ voice: v, question, decision })) return false;
  const soft =
    isSoftPromotionFailReason(failReason) ||
    (Array.isArray(midFieldWarnings) &&
      midFieldWarnings.length > 0 &&
      midFieldWarnings.every((w) => isSoftPromotionFailReason(w)) &&
      (!failReason || isSoftPromotionFailReason(failReason)));
  if (!soft) return false;
  const safety = collectAnswerFacingSafetyFail({
    gate: gate && typeof gate === "object" ? gate : { ok: true },
    voice: v,
    question,
    decision,
    publicResearchEvidence,
  });
  return safety == null || safety === "gate_missing";
}

/**
 * Decide Stage 2 promotion. Default = keep S6.
 * @returns {object} decision + customer-facing fields
 */
export function decideStage2Promotion({
  question = "",
  s6FinalAnswer = "",
  shadow = null,
  env = process.env,
} = {}) {
  const s6 = String(s6FinalAnswer ?? "").trim();
  const production = isVercelProductionEnv(env);
  const previewOnly = !production;
  const stage2Flag = isKeyBorrowedSensesStage2Partial(env);
  const allow = matchStage2Allowlist(question);
  const allowlistHit = Boolean(allow);
  const allowlistId = allow?.id ?? null;

  const baseTrace = {
    schema_version: STAGE2_SCHEMA,
    stage: 2,
    preview_only: previewOnly,
    allowlist_hit: allowlistHit,
    allowlist_id: allowlistId,
    promotion_pass: false,
    fallback_reason: null,
    customer_text_changed: false,
    final_answer_source: "s6",
    s6_final_answer: s6,
    s7_voice: null,
    next_decision_point: [],
    product_push: false,
    invent_or_fake_fact: false,
    cancel_enroll_certainty: false,
    production_touched: false,
    production_blocked: false,
    s7_active_partial: stage2Flag,
    gate: null,
  };

  const fail = (reason, extra = {}) => ({
    ...baseTrace,
    ...extra,
    promotion_pass: false,
    fallback_reason: reason,
    customer_text_changed: false,
    final_answer_source: "s6",
    customer_text: s6,
  });

  if (production) {
    return fail("production_blocked", { production_blocked: true, preview_only: false });
  }

  if (!stage2Flag) {
    return fail("flag_not_active_partial");
  }

  if (isQ10PortfolioExpansionQuestion(question)) {
    return fail("q10_portfolio_expansion");
  }

  if (!allowlistHit) {
    return fail("allowlist_miss");
  }

  if (!shadow || typeof shadow !== "object") {
    return fail("shadow_missing");
  }

  if (shadow.error) {
    return fail(String(shadow.error));
  }

  const borrowed = shadow.borrowed ?? null;
  const gate = shadow.gate ?? null;
  baseTrace.gate = gate
    ? {
        ok: gate.ok ?? null,
        understanding_pollution: gate.understanding_pollution ?? null,
        unsupported_recommendation: gate.unsupported_recommendation ?? null,
        closing_or_signup_push: gate.closing_or_signup_push ?? null,
        number_scope_violation: gate.number_scope_violation ?? null,
        context_hallucination: gate.context_hallucination ?? null,
        facts_not_in_allowed_set: gate.facts_not_in_allowed_set ?? null,
        customer_facing_axis_term: gate.customer_facing_axis_term ?? null,
        passive_leadership: gate.passive_leadership ?? null,
        leadership_without_basis: gate.leadership_without_basis ?? null,
        product_push_as_direction: gate.product_push_as_direction ?? null,
        expertise_overclaim: gate.expertise_overclaim ?? null,
        missing_next_decision: gate.missing_next_decision ?? null,
        missing_proposal_direction: gate.missing_proposal_direction ?? null,
        leadership_cancel_enroll_certainty: gate.leadership_cancel_enroll_certainty ?? null,
        visual_scope_violation: gate.visual_scope_violation ?? null,
      }
    : null;

  if (!borrowed) {
    return fail("borrowed_missing", { gate: baseTrace.gate });
  }

  const voice = String(borrowed.voice_raw_candidate ?? "").trim();
  const nd = Array.isArray(borrowed.next_decision_point)
    ? borrowed.next_decision_point.map((c) => String(c).trim()).filter(Boolean)
    : [];

  baseTrace.s7_voice = voice || null;
  baseTrace.next_decision_point = nd;
  baseTrace.product_push =
    gate?.unsupported_recommendation === true ||
    gate?.product_push_as_direction === true ||
    hasHardSalesPush(voice);
  baseTrace.cancel_enroll_certainty = gate?.leadership_cancel_enroll_certainty === true;
  baseTrace.invent_or_fake_fact =
    gate?.number_scope_violation === true || gate?.context_hallucination === true;

  if (!voice) {
    return fail("empty_voice", { gate: baseTrace.gate, s7_voice: null, next_decision_point: nd });
  }

  const safetyFail = collectAnswerFacingSafetyFail({
    gate,
    voice,
    question,
    decision: null,
  });
  if (safetyFail) {
    return fail(safetyFail, {
      gate: baseTrace.gate,
      s7_voice: voice,
      next_decision_point: nd,
      product_push: baseTrace.product_push,
      invent_or_fake_fact: baseTrace.invent_or_fake_fact,
      cancel_enroll_certainty: baseTrace.cancel_enroll_certainty,
    });
  }

  if (nd.length < 2) {
    return fail("missing_next_decision", {
      gate: baseTrace.gate,
      s7_voice: voice,
      next_decision_point: nd,
    });
  }

  if (isWaitOnlyVoice(voice)) {
    return fail("wait_only", {
      gate: baseTrace.gate,
      s7_voice: voice,
      next_decision_point: nd,
    });
  }

  if (hasHardSalesPush(voice)) {
    return fail("hard_sales_push", {
      gate: baseTrace.gate,
      s7_voice: voice,
      next_decision_point: nd,
      product_push: true,
    });
  }

  if (!passesFullVoiceMinimum(borrowed, voice)) {
    return fail("full_voice_minimum_fail", {
      gate: baseTrace.gate,
      s7_voice: voice,
      next_decision_point: nd,
    });
  }

  // All promotion conditions passed
  return {
    ...baseTrace,
    promotion_pass: true,
    fallback_reason: null,
    customer_text_changed: true,
    final_answer_source: "s7",
    s7_voice: voice,
    customer_text: voice,
    product_push: false,
    invent_or_fake_fact: false,
    cancel_enroll_certainty: false,
  };
}

/**
 * Fast-path candidate vs KEY Decision alignment.
 * Reuses existing Gate safety helpers — does NOT invent a new Guard.
 * On fail: discard candidate (never rewrite) → caller falls back to S6 Speak.
 */
export function evaluateBorrowedFastPathCandidate({
  question = "",
  decision = null,
  directive = null,
  shadow = null,
  env = process.env,
} = {}) {
  const base = {
    ok: false,
    reason: null,
    voice: null,
    final_answer_source: "s6",
    customer_text_changed: false,
    aligned_with_decision: false,
    gate_ok: false,
  };

  if (isVercelProductionEnv(env)) {
    return { ...base, reason: "production_blocked" };
  }

  if (!shadow || typeof shadow !== "object") {
    return { ...base, reason: "shadow_missing" };
  }
  if (shadow.error) {
    return { ...base, reason: String(shadow.error) };
  }

  const borrowed = shadow.borrowed ?? null;
  const gate = shadow.gate ?? null;
  if (!borrowed) {
    return { ...base, reason: "borrowed_missing" };
  }

  const voice = String(borrowed.voice_raw_candidate ?? "").trim();
  if (!voice) {
    return { ...base, reason: "empty_voice" };
  }

  const midFieldWarnings = collectMidFieldTraceWarnings(borrowed, question, decision);
  const safetyFail = collectAnswerFacingSafetyFail({
    gate,
    voice,
    question,
    decision,
    publicResearchEvidence: shadow?.public_research_evidence ?? null,
  });
  if (safetyFail) {
    return {
      ...base,
      reason: safetyFail,
      voice,
      gate_ok: gate?.ok === true,
      mid_field_warnings: midFieldWarnings,
      answer_facing_fail: safetyFail,
    };
  }

  if (hasHardSalesPush(voice)) {
    return {
      ...base,
      reason: "hard_sales_push",
      voice,
      gate_ok: true,
      mid_field_warnings: midFieldWarnings,
    };
  }

  // Decision focus / direction alignment — answer text only (never mid-field alone)
  const priority = String(decision?.response_priority ?? "").trim();
  const situation = String(decision?.situation_key ?? "").trim();
  const focus = String(directive?.question_focus ?? "").trim();
  const move = String(decision?.key_next_move ?? decision?.direction?.move ?? "").trim();
  const q = String(question ?? "").trim();

  if (isDailyOwnedDecisionFocus(decision)) {
    if (voiceHasDailyInsurancePollution(voice, q)) {
      return {
        ...base,
        reason: "decision_mismatch_insurance_pollution",
        voice,
        gate_ok: true,
        mid_field_warnings: midFieldWarnings,
      };
    }
  }

  if (priority === "fact_lookup" || focus === "premium_amount") {
    // Reject pure emotional speculation without fact grounding
    if (
      /불안|힘드|걱정이\s*크/.test(voice) &&
      !/월|원|건|보험료|납입/.test(voice)
    ) {
      return {
        ...base,
        reason: "decision_mismatch_emotional_without_facts",
        voice,
        gate_ok: true,
        mid_field_warnings: midFieldWarnings,
      };
    }
  }

  if (priority === "premium_adequacy_check" || situation === "premium_burden") {
    if (/30\s*%\s*(?:줄|삭|절감)|무조건\s*줄일\s*수/.test(voice)) {
      return {
        ...base,
        reason: "decision_mismatch_unverified_cut_claim",
        voice,
        gate_ok: true,
        mid_field_warnings: midFieldWarnings,
      };
    }
  }

  if (priority === "direction_choice" && /30\s*%/.test(q)) {
    if (/30\s*%\s*(?:줄일\s*수\s*있|가능합니다|됩니다)/.test(voice)) {
      return {
        ...base,
        reason: "decision_mismatch_percent_certainty",
        voice,
        gate_ok: true,
        mid_field_warnings: midFieldWarnings,
      };
    }
  }

  // Focus drift: candidate ignores current question topic when Decision has a clear move
  if (move && focus === "premium_amount" && !/보험료|월|원|납입/.test(voice)) {
    return {
      ...base,
      reason: "decision_mismatch_focus",
      voice,
      gate_ok: true,
      mid_field_warnings: midFieldWarnings,
    };
  }

  // Opposite direction: Decision wants space/non-insurance/daily but candidate pushes product
  if (
    (decision?.direction?.type === "offer_space" ||
      decision?.direction?.type === "offer_recommendation" ||
      decision?.direction?.type === "general_daily") &&
    /이\s*상품|가입하세요|해지해도/.test(voice)
  ) {
    return {
      ...base,
      reason: "decision_mismatch_direction",
      voice,
      gate_ok: true,
      mid_field_warnings: midFieldWarnings,
    };
  }

  return {
    ok: true,
    reason: null,
    voice,
    final_answer_source: "s7",
    customer_text_changed: true,
    aligned_with_decision: true,
    gate_ok: true,
    mid_field_warnings: midFieldWarnings,
    answer_facing_fail: null,
  };
}

/**
 * Apply Stage2 decision onto compose finalText + shadow trace.
 * Never mutates S6 generation — only optionally replaces customer-facing text.
 */
export function applyStage2PromotionToCompose({
  question = "",
  s6FinalAnswer = "",
  shadow = null,
  env = process.env,
} = {}) {
  const decision = decideStage2Promotion({
    question,
    s6FinalAnswer,
    shadow,
    env,
  });

  const stage2Partial = {
    schema_version: decision.schema_version,
    stage: decision.stage,
    preview_only: decision.preview_only,
    allowlist_hit: decision.allowlist_hit,
    allowlist_id: decision.allowlist_id,
    promotion_pass: decision.promotion_pass,
    fallback_reason: decision.fallback_reason,
    customer_text_changed: decision.customer_text_changed,
    final_answer_source: decision.final_answer_source,
    s6_final_answer: decision.s6_final_answer,
    s7_voice: decision.s7_voice,
    next_decision_point: decision.next_decision_point,
    product_push: decision.product_push,
    invent_or_fake_fact: decision.invent_or_fake_fact,
    cancel_enroll_certainty: decision.cancel_enroll_certainty,
    production_touched: false,
    production_blocked: decision.production_blocked,
    s7_active_partial: decision.s7_active_partial,
    gate: decision.gate,
  };

  return {
    finalText: decision.customer_text,
    customer_text_changed: decision.customer_text_changed,
    final_answer_source: decision.final_answer_source,
    stage2_partial: stage2Partial,
    decision,
  };
}
