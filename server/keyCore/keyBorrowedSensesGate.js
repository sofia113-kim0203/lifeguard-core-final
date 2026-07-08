/**
 * S7-a — Borrowed Senses shadow gate (trace/audit only · does not block S6 final_answer).
 */
import { deriveKeyVoiceQuestionFocus } from "./keyVoiceDirective.js";

export const S7_BORROWED_SENSES_SCHEMA = "key-borrowed-senses-s7a-v0";
export const S7_BORROWED_SENSES_SCHEMA_B = "key-borrowed-senses-s7b-v0";

export const S7B_EXPERTISE_TAXONOMY = [
  "실손",
  "진단비",
  "수술비",
  "사망보장",
  "운전자",
  "간병",
  "갱신",
  "중복",
  "납입부담",
  "보장구성",
  "계약정리",
  "환급/해지손실",
  "미확인",
];

const AXIS_TERM_RE = /보장축|우선순위\s*축|암\s*보장축|필수축|축별|축으로|축을|축부터|축\s*설정/;
const PASSIVE_LEADERSHIP_RE =
  /^(?:편하|말씀|언제든|천천히|궁금).{0,40}(?:말씀해|말해)\s*주세요\.?$/;
const LEADERSHIP_CANCEL_CERTAINTY_RE =
  /(?:해지(?:하|해)\s*(?:세요|시길|해도\s*됩)|(?:꼭|반드시)\s*가입)/;
const ENROLLMENT_RE = /(?:지금\s*)?가입(?:하|을)\s*(?:시|는|세요)|(?:꼭\s*)?가입하시(?:길|기)/;
const PRODUCT_PUSH_RE = /(?:이\s*상품|이\s*보험|(?:바로|지금)\s*).{0,12}(?:추천|가입)/;
const CANCELLATION_RE = /(?:지금\s*)?해지(?:하|할)\s*(?:시|는|세요)|(?:바로\s*)?해지(?:하|해)\s*(?:보|는)/;
const TERMINATION_CLOSE_RE = /(?:최종\s*)?(?:체결|가입\s*확정|설계\s*완료|지금\s*결정)/;
const DEFINITIVE_VERDICT_RE =
  /(?:충분합니다|부족합니다|문제\s*없(?:어|습니다)|완벽(?:해|합니다|해요)|틀림없|확실히\s*(?:부족|충분|괜찮)|꼭\s*필요(?:합니다|해요|한\s*거(?:야|예)?))/;
const PREMIUM_SCOPE_BLUR_RE = /22건,\s*월|기준으로\s*전체\s*보험료|전체\s*보험료\s*=\s*월/;
const CALCULATED_NUMBER_RE = /나머지\s*\d+|절반|대부분|\d+\s*건\s*중\s*\d+/;
const HYPOTHESIS_AS_FACT_RE = /(?:분명|확실|틀림없|당연히).{0,20}(?:원하|필요|걱정|불안)/;
const PRIOR_MEMORY_CLAIM_RE = /(?:지난번|저번|앞서\s*말(?:씀|한)|전에\s*(?:말|이야기))/;
const NEGATION_MUST_NOT_RE =
  /(?:하지\s*(?:않|말)|단정하지|가정하지|추정하지|없음|없다고|암시하지|언급하지)/;

const KNOWN_INSURERS = ["메리츠", "현대해상", "KB손보", "한화", "DB손보", "삼성생명", "교보", "NH"];

function normalizeText(text = "") {
  return String(text ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

function extractNumbers(text = "") {
  return [...String(text).matchAll(/\d[\d,]*(?:\.\d+)?/g)].map((m) => m[0].replace(/,/g, ""));
}

function collectLeadershipText(borrowed = {}) {
  const parts = [
    borrowed.key_purpose,
    borrowed.leadership_move,
    ...(Array.isArray(borrowed.insurance_expertise_angle) ? borrowed.insurance_expertise_angle : []),
    borrowed.insurance_expertise_rationale,
    borrowed.proposal_direction,
    ...(Array.isArray(borrowed.next_decision_point) ? borrowed.next_decision_point : []),
  ];
  return normalizeText(parts.filter(Boolean).join(" "));
}

function collectLeadershipAuditText(borrowed = {}) {
  return normalizeText(
    [collectLeadershipText(borrowed), borrowed.voice_raw_candidate].filter(Boolean).join(" "),
  );
}

function requiresLeadershipFields(question = "", directive = null) {
  const q = normalizeText(question);
  if (/^(?:안녕|반갑|하이|hello)/i.test(q)) return false;
  if (/그냥\s*둘러/.test(q)) return false;
  if (directive?.answer_mode === "social") return false;
  return true;
}

function hasS7bLeadershipPayload(borrowed = {}) {
  return Boolean(
    String(borrowed.key_purpose ?? "").trim() ||
      String(borrowed.leadership_move ?? "").trim() ||
      (Array.isArray(borrowed.insurance_expertise_angle) && borrowed.insurance_expertise_angle.length) ||
      String(borrowed.proposal_direction ?? "").trim() ||
      (Array.isArray(borrowed.next_decision_point) && borrowed.next_decision_point.length),
  );
}

function checkCustomerFacingAxisTerm(borrowed = {}) {
  return AXIS_TERM_RE.test(collectLeadershipAuditText(borrowed));
}

function checkPassiveLeadership(borrowed = {}, question = "", directive = null) {
  if (!requiresLeadershipFields(question, directive)) return false;
  if (!hasS7bLeadershipPayload(borrowed)) return false;
  const move = normalizeText(borrowed.leadership_move ?? "");
  const choices = borrowed.next_decision_point ?? [];
  const passiveOnly =
    !move ||
    PASSIVE_LEADERSHIP_RE.test(move) ||
    /^편하실\s*때/.test(move) ||
    (/말씀해\s*주세요/.test(move) && move.length < 40);
  return passiveOnly && (!Array.isArray(choices) || choices.length < 2);
}

function checkLeadershipWithoutBasis(borrowed = {}, directive = {}, question = "") {
  if (!requiresLeadershipFields(question, directive)) return false;
  if (!hasS7bLeadershipPayload(borrowed)) return false;
  const blob = collectLeadershipText(borrowed);
  if (!blob) return false;
  const angles = borrowed.insurance_expertise_angle ?? [];
  if (
    angles.some((tag) => tag && !S7B_EXPERTISE_TAXONOMY.includes(String(tag).trim()))
  ) {
    return true;
  }
  const needsFacts = /22|보험료|암|해지|표|납입|실손/.test(blob);
  const used = (borrowed.used_facts ?? []).length;
  if (needsFacts && used === 0 && (directive?.facts_to_speak ?? []).length > 0) {
    return true;
  }
  return false;
}

function isProposalNegation(text = "") {
  const t = normalizeText(text);
  if (!t) return false;
  return /(?:추천\s*(?:불|안)|가입\s*push\s*없|상품\s*추천\s*대신|바로\s*상품|무작위|방향\s*없이\s*추천|줄이기\s*전|확인\s*한\s*뒤|먼저\s*정)/.test(
    t,
  );
}

function checkProductPushAsDirection(borrowed = {}) {
  if (!hasS7bLeadershipPayload(borrowed)) return false;
  const parts = [borrowed.proposal_direction, borrowed.leadership_move, borrowed.key_purpose];
  const blob = normalizeText(parts.filter(Boolean).join(" "));
  if (!blob) return false;
  if (isProposalNegation(blob)) return false;
  return (
    ENROLLMENT_RE.test(blob) ||
    PRODUCT_PUSH_RE.test(blob) ||
    /(?:추가\s*가입|이\s*상품\s*(?:을|를)?\s*(?:추천|가입))/.test(blob)
  );
}

function checkExpertiseOverclaim(borrowed = {}, question = "") {
  if (!hasS7bLeadershipPayload(borrowed)) return false;
  const blob = collectLeadershipText(borrowed);
  if (!blob) return false;
  if (/꼭\s*필요/.test(blob) && /꼭\s*필요/.test(normalizeText(question))) {
    return /(?:꼭\s*필요(?:합니다|해요|한\s*거)|부족합니다|충분합니다)/.test(blob);
  }
  return (
    /(?:부족합니다|충분합니다|문제\s*없(?:어|습니다)|완벽(?:해|합니다))/.test(blob) ||
    /(?:확실히|틀림없).{0,12}(?:부족|충분|필요)/.test(blob)
  );
}

function checkMissingNextDecision(borrowed = {}, question = "", directive = null) {
  if (!requiresLeadershipFields(question, directive)) return false;
  if (!hasS7bLeadershipPayload(borrowed)) return false;
  const choices = borrowed.next_decision_point ?? [];
  return !Array.isArray(choices) || choices.filter((c) => String(c).trim()).length < 2;
}

function checkLeadershipCancelEnrollCertainty(borrowed = {}) {
  if (!hasS7bLeadershipPayload(borrowed)) return false;
  const blob = collectLeadershipText(borrowed);
  if (!blob) return false;
  if (isProposalNegation(blob)) return false;
  return (
    LEADERSHIP_CANCEL_CERTAINTY_RE.test(blob) ||
    CANCELLATION_RE.test(blob) ||
    ENROLLMENT_RE.test(blob)
  );
}

function collectAssertiveBorrowedText(borrowed = {}) {
  const parts = [
    ...(Array.isArray(borrowed.understanding_hypotheses) ? borrowed.understanding_hypotheses : []),
    borrowed.customer_intent,
    borrowed.emotional_signal,
    borrowed.hesitation_signal,
    borrowed.context_carryover,
    borrowed.visual_observation,
    borrowed.answer_purpose,
    borrowed.recommendation_basis,
    borrowed.voice_raw_candidate,
  ];
  return normalizeText(parts.filter(Boolean).join(" "));
}

function collectBorrowedText(borrowed = {}) {
  const parts = [
    collectAssertiveBorrowedText(borrowed),
    ...(Array.isArray(borrowed.must_not_assume) ? borrowed.must_not_assume : []),
  ];
  return normalizeText(parts.filter(Boolean).join(" "));
}

function buildAllowedNumberSet(directive = {}, visualBlocks = []) {
  const allowed = new Set();
  for (const n of directive?.allowed_numbers ?? []) {
    if (n != null) allowed.add(String(n));
  }
  const tokens = directive?.allowed_fact_tokens ?? {};
  for (const v of Object.values(tokens)) {
    if (v == null) continue;
    const text = String(v);
    for (const n of extractNumbers(text)) allowed.add(n);
    if (/만|천|원/.test(text)) {
      for (const n of extractNumbers(text)) allowed.add(n);
    }
  }
  for (const block of visualBlocks ?? []) {
    const chunks = [
      block?.title,
      block?.subtitle,
      ...(Array.isArray(block?.rows) ? block.rows.flatMap((row) => (Array.isArray(row) ? row : [row])) : []),
    ];
    for (const chunk of chunks) {
      const text = String(chunk ?? "");
      for (const n of extractNumbers(text)) allowed.add(n);
    }
  }
  return allowed;
}

function isKoreanNumeralFragment(text = "", num = "") {
  return new RegExp(`${num}(?:\\s*)?(?:만|천|백|억)`).test(String(text));
}

function isScopeClarifierNumber(text = "", num = "") {
  if (num === "1") {
    return /(?:1|한)\s*건|1건\s*기준|대표\s*(?:확인\s*)?계약\s*(?:1|한)\s*건|(?:1|한)\s*건\s*기준/.test(text);
  }
  return new RegExp(`${num}\\s*건(?:\\s*기준)?`).test(text);
}

function checkPremiumScopeBlur(blob = "") {
  if (!PREMIUM_SCOPE_BLUR_RE.test(blob)) return false;
  if (
    /대표\s*(?:확인\s*)?계약|(?:한|1)\s*건\s*기준|전체\s*합계\s*아님|합산\s*아님|정리\s*중|미확인|그\s*계약\s*한\s*건/.test(
      blob,
    )
  ) {
    return false;
  }
  return true;
}

function isUiMetaNumber(text = "", num = "") {
  const uiPatterns = [
    new RegExp(`${num}\\s*개\\s*행`),
    new RegExp(`${num}\\s*행`),
    new RegExp(`${num}\\s*개\\s*열`),
    new RegExp(`${num}\\s*열`),
    new RegExp(`${num}\\s*개\\s*항목`),
    new RegExp(`row_count[^\\d]*${num}`, "i"),
  ];
  return uiPatterns.some((re) => re.test(text));
}

function filterRogueNumbers(blob = "", allowed = new Set()) {
  const nums = extractNumbers(blob);
  return nums.filter((n) => {
    if (!n || n === "0") return false;
    if (allowed.has(n)) return false;
    if (isUiMetaNumber(blob, n)) return false;
    if (isScopeClarifierNumber(blob, n)) return false;
    if (isKoreanNumeralFragment(blob, n)) return false;
    if (/^\d$/.test(n) && /(?:만|천|백|원)/.test(blob)) return false;
    return true;
  });
}

function normalizeFactId(value = "") {
  const t = String(value).trim();
  const idx = t.indexOf(":");
  const id = (idx > 0 ? t.slice(0, idx) : t).trim();
  if (id === "monthly_premium_display" || id === "monthly_premium") {
    return "monthly_premium_representative";
  }
  return id;
}

function claimsPriorMemory(text = "") {
  const t = normalizeText(text);
  if (!t) return false;
  const negationMeta =
    /(?:없음|없습니다|없이|비어\s*있|참조\s*불가|null|없음\s*[—\-,.)]|없음으로|없음$|없음\s*확인|이력\s*없)/.test(t);
  if (negationMeta) return false;
  if (PRIOR_MEMORY_CLAIM_RE.test(t)) return true;
  if (/(?:이전|지난)\s*(?:대화|말씀)/.test(t)) return true;
  return false;
}

function historyBlob(history = []) {
  return normalizeText(
    (history ?? [])
      .map((h) => `${h.role ?? ""}:${h.text ?? h.content ?? ""}`)
      .join(" "),
  );
}

function buildVisualScopeText(visualBlocks = []) {
  const parts = [];
  for (const block of visualBlocks ?? []) {
    parts.push(block?.title, block?.subtitle, block?.type);
    for (const row of block?.rows ?? []) {
      if (Array.isArray(row)) parts.push(...row);
      else parts.push(row);
    }
  }
  return normalizeText(parts.filter(Boolean).join(" "));
}

function checkUnderstandingPollution(borrowed = {}, question = "") {
  const blob = collectAssertiveBorrowedText(borrowed);
  if (DEFINITIVE_VERDICT_RE.test(blob)) return true;
  if (HYPOTHESIS_AS_FACT_RE.test(blob)) return true;
  const q = normalizeText(question);
  const hypotheses = borrowed.understanding_hypotheses ?? [];
  if (
    hypotheses.some((h) => {
      const text = String(h);
      if (q && text.includes(q)) return false;
      if (/꼭\s*필요한지/.test(text) && /꼭\s*필요/.test(q)) return false;
      return /(?:확실|분명|틀림없|당연)/.test(text);
    })
  ) {
    return true;
  }
  return false;
}

function isRecommendationNegationBasis(text = "") {
  const t = normalizeText(text);
  if (!t) return false;
  return /(?:추천\s*(?:불가|보류|없|안(?:\s*함)?|하지\s*않)|방향\s*설정\s*(?:선행|먼저)|무작정\s*추천\s*(?:불|안)|추천\s*대신|추천\s*전\s*방향|방향\s*.*?선행)/.test(
    t,
  );
}

function collectRecommendationPushText(borrowed = {}) {
  const parts = [
    borrowed.answer_purpose,
    borrowed.voice_raw_candidate,
    borrowed.proposal_direction,
    borrowed.leadership_move,
  ];
  const basis = borrowed.recommendation_basis ?? "";
  if (basis && !isRecommendationNegationBasis(basis)) {
    parts.push(basis);
  }
  return normalizeText(parts.filter(Boolean).join(" "));
}

function checkUnsupportedRecommendation(borrowed = {}) {
  const blob = collectRecommendationPushText(borrowed);
  return ENROLLMENT_RE.test(blob) || PRODUCT_PUSH_RE.test(blob);
}

function checkClosingOrSignupPush(blob = "") {
  return (
    ENROLLMENT_RE.test(blob) ||
    CANCELLATION_RE.test(blob) ||
    TERMINATION_CLOSE_RE.test(blob)
  );
}

function checkNumberScopeViolation(blob = "", directive = {}, visualBlocks = []) {
  if (checkPremiumScopeBlur(blob)) return true;
  if (CALCULATED_NUMBER_RE.test(blob)) return true;
  const allowed = buildAllowedNumberSet(directive, visualBlocks);
  if (!allowed.size) return false;
  return filterRogueNumbers(blob, allowed).length > 0;
}

function checkContextHallucination(borrowed = {}, history = [], question = "") {
  const hist = historyBlob(history);
  const asksPrior = /지난번|저번|이어서|앞서/.test(String(question ?? ""));
  const carry = normalizeText(borrowed.context_carryover ?? "");
  const claimsPrior = claimsPriorMemory(carry);

  if (asksPrior && !hist && claimsPrior) return true;

  if (carry && asksPrior && hist) {
    const priorTopicTerms = [
      { re: /암\s*보험|암보험/, histRe: /암/ },
      { re: /실손/, histRe: /실손/ },
      { re: /해지/, histRe: /해지/ },
      { re: /추천/, histRe: /추천/ },
      { re: /부족/, histRe: /부족/ },
    ];
    for (const { re, histRe } of priorTopicTerms) {
      if (re.test(carry) && !histRe.test(hist)) return true;
    }
    if (claimsPriorMemory(carry) && !hist) return true;

    const carryNumbers = extractNumbers(carry);
    for (const n of carryNumbers) {
      if (n.length >= 2 && !hist.includes(n) && !hist.replace(/,/g, "").includes(n)) {
        return true;
      }
    }
  }

  return false;
}

function checkVisualScopeViolation(borrowed = {}, visualBlocks = [], directive = {}) {
  const obs = normalizeText(borrowed.visual_observation ?? "");
  if (!obs || !(visualBlocks ?? []).length) return false;

  const scopeText = buildVisualScopeText(visualBlocks);
  if (!scopeText) return false;

  const allowed = buildAllowedNumberSet(directive, visualBlocks);
  const rogueNums = filterRogueNumbers(obs, allowed);
  if (rogueNums.length > 0) return true;

  for (const name of KNOWN_INSURERS) {
    if (obs.includes(name) && !scopeText.includes(name)) return true;
  }

  return false;
}

function isStructuredFactRef(value = "") {
  const id = normalizeFactId(value);
  return /^(policy_count|insurer|product|monthly_premium)/.test(id);
}

function checkFactsNotInAllowedSet(borrowed = {}, directive = {}) {
  const blob = collectAssertiveBorrowedText(borrowed);
  const allowedNames = [directive?.allowed_fact_tokens?.insurer, directive?.allowed_fact_tokens?.product].filter(
    Boolean,
  );
  const rogueInsurers = KNOWN_INSURERS.filter(
    (name) => blob.includes(name) && !allowedNames.some((a) => String(a).includes(name)),
  );
  if (rogueInsurers.length) return true;

  const usedFacts = (borrowed.used_facts ?? []).map((id) => normalizeFactId(id));
  const structuredFacts = (borrowed.used_facts ?? []).filter((id) => isStructuredFactRef(id));
  const allowedFactIds = new Set(
    (directive?.facts_to_speak ?? []).map((f) => f.fact_id).filter(Boolean),
  );
  for (const key of Object.keys(directive?.allowed_fact_tokens ?? {})) {
    if (key === "monthly_premium_display") {
      allowedFactIds.add("monthly_premium_representative");
      allowedFactIds.add("monthly_premium_display");
    } else {
      allowedFactIds.add(key);
    }
  }
  if (allowedFactIds.size === 0 || structuredFacts.length === 0) return false;
  return structuredFacts.some((raw) => {
    const id = normalizeFactId(raw);
    return id && !allowedFactIds.has(id);
  });
}

/**
 * @param {object} params
 * @param {object} params.borrowed — parsed S7-a output
 * @param {object} [params.directive]
 * @param {Array} [params.history]
 * @param {string} [params.question]
 * @param {Array} [params.visualBlocks]
 */
export function gateBorrowedSensesOutput({
  borrowed = {},
  directive = null,
  history = [],
  question = "",
  visualBlocks = [],
} = {}) {
  const assertiveBlob = collectAssertiveBorrowedText(borrowed);
  const understanding_pollution = checkUnderstandingPollution(borrowed, question);
  const unsupported_recommendation = checkUnsupportedRecommendation(borrowed);
  const closing_or_signup_push = checkClosingOrSignupPush(assertiveBlob);
  const visual_scope_violation = checkVisualScopeViolation(borrowed, visualBlocks, directive);
  const number_scope_violation =
    checkNumberScopeViolation(assertiveBlob, directive, visualBlocks) || visual_scope_violation;
  const context_hallucination = checkContextHallucination(borrowed, history, question);
  const facts_not_in_allowed_set = checkFactsNotInAllowedSet(borrowed, directive);

  const customer_facing_axis_term = checkCustomerFacingAxisTerm(borrowed);
  const passive_leadership = checkPassiveLeadership(borrowed, question, directive);
  const leadership_without_basis = checkLeadershipWithoutBasis(borrowed, directive, question);
  const product_push_as_direction = checkProductPushAsDirection(borrowed);
  const expertise_overclaim = checkExpertiseOverclaim(borrowed, question);
  const missing_next_decision = checkMissingNextDecision(borrowed, question, directive);
  const leadership_cancel_enroll_certainty = checkLeadershipCancelEnrollCertainty(borrowed);

  const gates = {
    understanding_pollution,
    unsupported_recommendation,
    closing_or_signup_push,
    number_scope_violation,
    context_hallucination,
    facts_not_in_allowed_set,
    customer_facing_axis_term,
    passive_leadership,
    leadership_without_basis,
    product_push_as_direction,
    expertise_overclaim,
    missing_next_decision,
    leadership_cancel_enroll_certainty,
  };

  return {
    ok: Object.values(gates).every((v) => v === false),
    ...gates,
    visual_scope_violation,
    gate_blob_preview: collectBorrowedText(borrowed).slice(0, 240),
    leadership_blob_preview: collectLeadershipText(borrowed).slice(0, 240),
  };
}

export function inferRouteLabel(question = "", directive = null) {
  const focus = directive?.question_focus ?? deriveKeyVoiceQuestionFocus(question);
  if (focus === "greeting" || focus === "first_visit" || focus === "browse") {
    return { route: "social_or_browse", fast_path_or_consult_path: "fast_path" };
  }
  if (directive?.answer_mode === "analysis_consulting") {
    return { route: focus ?? "consult", fast_path_or_consult_path: "consult_path" };
  }
  return { route: focus ?? "general", fast_path_or_consult_path: "consult_path" };
}
