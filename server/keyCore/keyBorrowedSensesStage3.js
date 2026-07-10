/**
 * S7 Stage 3 — Preview-only Lane-aware promotion (active).
 * Pure decision helpers. Does not call Claude. Does not soften gate.
 * Does NOT write customer_memory_facts / post-turn save hooks.
 */
import {
  isKeyBorrowedSensesStage3Active,
  isVercelProductionEnv,
} from "./oneKeyCoreFlags.js";
import {
  isQ10PortfolioExpansionQuestion,
  isWaitOnlyVoice,
} from "./keyBorrowedSensesStage2.js";

export const STAGE3_SCHEMA = "s7-stage3-preview-active-v0";

export const STAGE3_LANES = Object.freeze({
  INSURANCE_ADVICE: "insurance_advice",
  INSURANCE_EDUCATION: "insurance_education",
  GENERAL_DAILY: "general_daily",
});

function normalizeQuestion(q = "") {
  return String(q ?? "")
    .replace(/\s+/g, " ")
    .trim();
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
  const hasLean = /추천|맞아\s*보이|먼저|부터\s*(?:보|확인)|후보|기준|방향|뜻|설명|의미/.test(blob);
  const hasBasis =
    Boolean(String(borrowed?.recommendation_basis ?? "").trim()) ||
    /맞아\s*보이|먼저|목적|기준|후보|뜻|설명|의미/.test(blob);
  const continues =
    /볼까요|확인해볼|어느\s*쪽|부터\s*(?:보|확인)|선택|궁금|더\s*알고/.test(blob) || nd.length >= 2;
  return hasLean && hasBasis && continues;
}

function collectGateSafetyFail(gate = null) {
  if (!gate || typeof gate !== "object") return "gate_missing";
  if (gate.ok !== true) return "gate_fail";
  const flags = [
    ["unsupported_recommendation", gate.unsupported_recommendation],
    ["product_push_as_direction", gate.product_push_as_direction],
    ["closing_or_signup_push", gate.closing_or_signup_push],
    ["leadership_cancel_enroll_certainty", gate.leadership_cancel_enroll_certainty],
    ["number_scope_violation", gate.number_scope_violation],
    ["context_hallucination", gate.context_hallucination],
    ["expertise_overclaim", gate.expertise_overclaim],
  ];
  for (const [name, v] of flags) {
    if (v === true) return name;
  }
  return null;
}

/** KEY Decision owns general_daily / daily_focus — required before promoting daily candidates. */
function isDailyOwnedDecision(decision = null) {
  if (!decision || typeof decision !== "object") return false;
  const priority = String(decision.response_priority ?? "").trim();
  const situation = String(decision.situation_key ?? "").trim();
  const dirType = String(decision.direction?.type ?? decision.key_direction?.type ?? "").trim();
  return (
    priority === "daily_focus" ||
    priority === "non_insurance_focus" ||
    situation === "daily_recommendation" ||
    situation === "non_insurance_general" ||
    dirType === "general_daily"
  );
}

/**
 * Daily candidate must not force-switch into insurance inventory / sales.
 * Reuses the same pollution signals as Decision alignment — not a new Guard.
 */
function hasDailyInsurancePollution(voice = "", question = "") {
  const v = String(voice ?? "");
  const q = String(question ?? "");
  if (/보험료|보장|청구|보험금|해지|가입|실손|납입/.test(q)) return false;
  return (
    /보험료를\s*줄|빠진\s*보장|가입\s*보험\s*점검|22\s*건|월\s*[\d만천]|보장\s*(?:부족|충분)|보험\s*쪽으로|보험\s*상담으로|어느\s*쪽이\s*더\s*끌리/.test(
      v,
    ) ||
    (/보험료|보장\s*(?:부족|충분)|해지하|가입하(?:세요|십시오)/.test(v) &&
      !/보험\s*(?:얘기|이야기).{0,8}(?:나중|말고)/.test(v))
  );
}

/** Soft block: asserting unverified personal medical/claim facts in daily lane. */
function hasUnverifiedCustomerFactClaim(voice = "") {
  const v = String(voice ?? "");
  return /수술비는\s*[\d만천]|보험금\s*(?:받|지급).{0,8}(?:됩니다|가능합니다|확실)/.test(v);
}

function snapshotGate(gate) {
  if (!gate || typeof gate !== "object") return null;
  return {
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
  };
}

/** Insurance lexical anchors — not bare % / 줄이다. */
function hasInsuranceLexicalAnchor(text = "") {
  return /보험|보장|특약|담보|계약|납입|실손|보험료|증권|갱신|면책|감액/.test(String(text ?? ""));
}

/**
 * Premium-cut / percent-reduction question shape.
 * Requires (% + cut verb) OR (보험료 + cut verb). Never treats bare "줄이다" / bare "%" alone as advice.
 */
function isPremiumCutPercentQuestion(q = "") {
  const t = String(q ?? "");
  if (/보험료/.test(t) && /줄일|줄여|절감|깎/.test(t)) return true;
  if (/\d+\s*%/.test(t) && /줄일|줄여|절감|깎/.test(t)) return true;
  return false;
}

function historyBlob(history = []) {
  if (!Array.isArray(history) || history.length === 0) return "";
  return history
    .map((turn) => {
      if (turn == null) return "";
      if (typeof turn === "string") return turn;
      return [turn.content, turn.text, turn.question, turn.answer, turn.message]
        .filter(Boolean)
        .join(" ");
    })
    .join(" ");
}

/**
 * Insurance conversation context: prior turns, previous summary, or current S6 (KEY seat inventory).
 */
function hasInsuranceConversationContext({
  history = [],
  previousAnswerSummary = "",
  s6FinalAnswer = "",
} = {}) {
  return (
    hasInsuranceLexicalAnchor(previousAnswerSummary) ||
    hasInsuranceLexicalAnchor(s6FinalAnswer) ||
    hasInsuranceLexicalAnchor(historyBlob(history))
  );
}

/**
 * Explicit non-insurance cut target in the CURRENT question (closed set — not a general classifier).
 * When present (and question has no insurance lexical anchor), vetoes stale insurance history/s6.
 */
function hasExplicitNonInsuranceCutTarget(q = "") {
  const t = String(q ?? "");
  // Closed set only. Do not expand into a broad domain taxonomy.
  const subject = "월급|연봉|급여|체중|몸무게|체지방|월세|렌트|칼로리";
  return new RegExp(
    `(?:${subject}).{0,16}(?:\\d+\\s*%|줄일|줄여|절감)|(?:\\d+\\s*%|줄일|줄여|절감).{0,16}(?:${subject})`,
  ).test(t);
}

/**
 * Deterministic Stage 3 lane classifier v0.
 * Priority: Q10 → education → advice → premium-cut (current intent > stale context) → general_daily.
 * @param {string} question
 * @param {{ history?: Array, previousAnswerSummary?: string, s6FinalAnswer?: string }} [context]
 */
export function classifyStage3Lane(question = "", context = {}) {
  const q = normalizeQuestion(question);
  if (!q) {
    return { lane: STAGE3_LANES.GENERAL_DAILY, lane_reason: "empty_question", q10_blocked: false };
  }

  if (isQ10PortfolioExpansionQuestion(q)) {
    return {
      lane: STAGE3_LANES.INSURANCE_ADVICE,
      lane_reason: "q10_portfolio_expansion",
      q10_blocked: true,
    };
  }

  // Insurance Education — concept / term explanation (before advice so "보험 뜻" stays education)
  if (
    /갱신형|비갱신형|면책\s*기간|감액\s*기간|실손\s*구조|특약\s*뜻|담보\s*뜻|보장한도\s*(?:가\s*)?뭐|보험\s*용어/.test(
      q,
    ) ||
    /(?:갱신형|비갱신형|면책|감액|특약|담보|실손).{0,12}(?:무슨\s*뜻|뭐야|무엇|설명)/.test(q) ||
    /(?:무슨\s*뜻|뭐야|무엇).{0,12}(?:갱신형|비갱신형|면책|감액|특약|담보)/.test(q)
  ) {
    return {
      lane: STAGE3_LANES.INSURANCE_EDUCATION,
      lane_reason: "insurance_term_or_structure_education",
      q10_blocked: false,
    };
  }

  // Insurance Advice / Judgment
  if (
    /보험료|보장\s*(?:부족|빈틈|중복)|중복\s*보장|유지해야|유지해도|해지|보완|보험\s*추천|추천해\s*줘|추천해줘|뭐가\s*필요|필요해\?|둘러보|구경|표\s*(?:가|의)|보장한도|지난번|이어서|포트폴리오|가입/.test(
      q,
    ) ||
    /보험/.test(q)
  ) {
    // Pure daily with incidental 보험 word still advice if insurance-intent; food/daily without insurance intent handled below
    if (/맛집|심심|날씨|영화|여행|게임|농담/.test(q) && !/보험|보장|특약|담보|보험료/.test(q)) {
      return {
        lane: STAGE3_LANES.GENERAL_DAILY,
        lane_reason: "daily_without_insurance_intent",
        q10_blocked: false,
      };
    }
    return {
      lane: STAGE3_LANES.INSURANCE_ADVICE,
      lane_reason: "insurance_advice_or_judgment_intent",
      q10_blocked: false,
    };
  }

  // F3: percent/premium-cut shape → advice ONLY with insurance anchor in question OR conversation context.
  // Do NOT treat bare "%" or bare "줄이다" as global advice keywords.
  // Current-question priority: explicit insurance anchor in q → advice; explicit non-insurance target → daily
  // (vetoes stale history/s6); ambiguous omitted-target ("30% 줄일 수 있지?") may use insurance context.
  if (isPremiumCutPercentQuestion(q)) {
    const qAnchor = hasInsuranceLexicalAnchor(q);
    if (qAnchor) {
      return {
        lane: STAGE3_LANES.INSURANCE_ADVICE,
        lane_reason: "premium_cut_percent_with_insurance_context",
        q10_blocked: false,
      };
    }
    // Explicit non-insurance subject in current question beats stale insurance context.
    if (hasExplicitNonInsuranceCutTarget(q)) {
      // fall through to general_daily
    } else if (hasInsuranceConversationContext(context)) {
      return {
        lane: STAGE3_LANES.INSURANCE_ADVICE,
        lane_reason: "premium_cut_percent_with_insurance_context",
        q10_blocked: false,
      };
    }
  }

  // General Daily
  if (/맛집|심심|날씨|영화|여행|게임|농담|안녕|뭐해|심심해/.test(q)) {
    return {
      lane: STAGE3_LANES.GENERAL_DAILY,
      lane_reason: "general_daily_chitchat",
      q10_blocked: false,
    };
  }

  return {
    lane: STAGE3_LANES.GENERAL_DAILY,
    lane_reason: "default_general_daily",
    q10_blocked: false,
  };
}

/**
 * Question-side risky cancel/enroll certainty request.
 * Even if S7 voice is safe, do not promote when the customer asks KEY to assert cancel/enroll.
 * Voice-side cancel_enroll certainty remains gate / hasHardSalesPush responsibility.
 * @returns {"risky_cancel_request"|"risky_enroll_request"|null}
 */
export function detectRiskyCancelOrEnrollRequest(question = "") {
  const q = normalizeQuestion(question);
  if (!q) return null;

  // Cancel certainty induction — "해지해도 된다고 해줘" / "해지라고 말해줘"
  if (
    /해지(?:해도\s*된다|해도\s*돼|해도\s*되|하(?:라|세요|십시오))(?:고)?\s*(?:해\s*줘|해줘|말해\s*줘|말해줘|말해)|해지(?:해도\s*)?(?:된다|돼|되)\s*고\s*(?:해\s*줘|해줘|말해)|해지라고\s*(?:해\s*줘|해줘|말해)/.test(
      q,
    ) ||
    /(?:된다고|해도\s*된다|해도\s*돼)\s*(?:고\s*)?(?:해\s*줘|해줘|말해\s*줘|말해줘).{0,8}해지|해지.{0,16}(?:된다고|해도\s*된다)\s*(?:고\s*)?(?:해\s*줘|해줘|말해)/.test(
      q,
    )
  ) {
    return "risky_cancel_request";
  }

  // Enroll certainty induction — "가입하라고 말해줘" / "가입해도 된다고 해줘"
  if (
    /가입(?:하(?:라|세요|십시오)|해도\s*된다|해도\s*돼|해도\s*되)(?:고)?\s*(?:해\s*줘|해줘|말해\s*줘|말해줘|말해)|가입(?:해도\s*)?(?:된다|돼|되)\s*고\s*(?:해\s*줘|해줘|말해)|가입하라고\s*(?:해\s*줘|해줘|말해)/.test(
      q,
    ) ||
    /(?:가입하(?:라|세요)|가입해도\s*된다).{0,12}(?:해\s*줘|해줘|말해\s*줘|말해줘)/.test(q)
  ) {
    return "risky_enroll_request";
  }

  return null;
}

/**
 * Education voice must not expand into personal contract verdict / enroll-cancel certainty.
 */
export function educationExpandsToPersonalVerdict(voice = "", borrowed = null) {
  const blob = [
    voice,
    borrowed?.voice_raw_candidate,
    borrowed?.proposal_direction,
    borrowed?.recommendation_basis,
    borrowed?.leadership_move,
  ]
    .filter(Boolean)
    .join(" ");
  return (
    /(?:고객님|당신).{0,24}(?:적합|부족|충분|가입하|해지하)/.test(blob) ||
    /(?:이\s*보장|그\s*보장|고객\s*계약).{0,16}(?:부족|충분|필요)/.test(blob) ||
    /(?:갱신형|비갱신형).{0,16}(?:적합|추천드|가입하)/.test(blob) ||
    /해지해도\s*됩니다|유지하(?:세요|셔야)|가입하세요/.test(blob) ||
    hasHardSalesPush(blob)
  );
}

/**
 * Decide Stage 3 promotion. Default = keep S6.
 * @param {{ decision?: object|null }} [params] — KEY Decision; required for general_daily promote
 */
export function decideStage3Promotion({
  question = "",
  s6FinalAnswer = "",
  shadow = null,
  env = process.env,
  history = [],
  previousAnswerSummary = "",
  decision = null,
} = {}) {
  const s6 = String(s6FinalAnswer ?? "").trim();
  const production = isVercelProductionEnv(env);
  const previewOnly = !production;
  const stage3Flag = isKeyBorrowedSensesStage3Active(env);
  const classified = classifyStage3Lane(question, {
    history,
    previousAnswerSummary,
    s6FinalAnswer: s6,
  });
  const lane = classified.lane;
  const laneReason = classified.lane_reason;
  const q10Blocked = classified.q10_blocked === true;
  const dailyOwned = isDailyOwnedDecision(decision);

  const baseTrace = {
    schema_version: STAGE3_SCHEMA,
    stage: 3,
    stage3_active: stage3Flag,
    preview_only: previewOnly,
    lane,
    lane_reason: laneReason,
    q10_blocked: q10Blocked,
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
    insurance_memory_saved: false,
    post_turn_save_hook: false,
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
    insurance_memory_saved: false,
  });

  if (production) {
    return fail("production_blocked", { production_blocked: true, preview_only: false });
  }

  if (!stage3Flag) {
    return fail("flag_not_active");
  }

  if (q10Blocked) {
    return fail("q10_portfolio_expansion", { q10_blocked: true });
  }

  // Question-side: cancel/enroll certainty induction → never promote (even if voice is safe).
  const riskyRequest = detectRiskyCancelOrEnrollRequest(question);
  if (riskyRequest) {
    return fail(riskyRequest);
  }

  // general_daily: only promote when KEY Decision owns daily_focus/general_daily and candidate is clean.
  // Without Decision ownership, keep legacy general_daily_no_promotion (no blanket discard of all daily).
  const dailyPromotePath = lane === STAGE3_LANES.GENERAL_DAILY && dailyOwned;
  if (lane === STAGE3_LANES.GENERAL_DAILY && !dailyOwned) {
    return fail("general_daily_no_promotion", {
      insurance_memory_saved: false,
    });
  }

  if (
    !dailyPromotePath &&
    lane !== STAGE3_LANES.INSURANCE_ADVICE &&
    lane !== STAGE3_LANES.INSURANCE_EDUCATION
  ) {
    return fail("lane_not_promotable");
  }

  if (!shadow || typeof shadow !== "object") {
    return fail("shadow_missing");
  }

  if (shadow.error) {
    return fail(String(shadow.error));
  }

  const borrowed = shadow.borrowed ?? null;
  const gate = shadow.gate ?? null;
  baseTrace.gate = snapshotGate(gate);

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

  const safetyFail = collectGateSafetyFail(gate);
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

  if (hasHardSalesPush(voice)) {
    return fail("hard_sales_push", {
      gate: baseTrace.gate,
      s7_voice: voice,
      next_decision_point: nd,
      product_push: true,
    });
  }

  if (isWaitOnlyVoice(voice)) {
    return fail("wait_only", {
      gate: baseTrace.gate,
      s7_voice: voice,
      next_decision_point: nd,
    });
  }

  // --- daily_focus / general_daily owned path (reuse Gate; skip insurance Full-Voice minimum) ---
  if (dailyPromotePath) {
    if (hasDailyInsurancePollution(voice, question)) {
      return fail("daily_insurance_pollution", {
        gate: baseTrace.gate,
        s7_voice: voice,
        next_decision_point: nd,
      });
    }
    if (hasUnverifiedCustomerFactClaim(voice)) {
      return fail("daily_unverified_customer_fact", {
        gate: baseTrace.gate,
        s7_voice: voice,
        next_decision_point: nd,
      });
    }
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
      insurance_memory_saved: false,
      lane_reason: laneReason || "general_daily_decision_owned_promote",
    };
  }

  // --- insurance advice / education path (unchanged contracts) ---
  if (nd.length < 2) {
    return fail("missing_next_decision", {
      gate: baseTrace.gate,
      s7_voice: voice,
      next_decision_point: nd,
    });
  }

  if (lane === STAGE3_LANES.INSURANCE_EDUCATION && educationExpandsToPersonalVerdict(voice, borrowed)) {
    return fail("education_personal_verdict", {
      gate: baseTrace.gate,
      s7_voice: voice,
      next_decision_point: nd,
    });
  }

  if (!passesFullVoiceMinimum(borrowed, voice)) {
    return fail("full_voice_minimum_fail", {
      gate: baseTrace.gate,
      s7_voice: voice,
      next_decision_point: nd,
    });
  }

  // Advice: require evidence-based lean / next action (Full Voice already covers most)
  if (lane === STAGE3_LANES.INSURANCE_ADVICE) {
    const blob = [voice, borrowed.recommendation_basis, borrowed.proposal_direction, ...nd]
      .filter(Boolean)
      .join(" ");
    const hasAdviceLean = /추천|맞아\s*보이|먼저|부터|후보|기준|방향/.test(blob);
    if (!hasAdviceLean) {
      return fail("advice_missing_basis_or_next", {
        gate: baseTrace.gate,
        s7_voice: voice,
        next_decision_point: nd,
      });
    }
  }

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
    insurance_memory_saved: false,
  };
}

/**
 * Apply Stage3 decision onto compose finalText + shadow trace.
 * Never mutates S6 generation — only optionally replaces customer-facing text.
 * Never writes memory.
 */
export function applyStage3PromotionToCompose({
  question = "",
  s6FinalAnswer = "",
  shadow = null,
  env = process.env,
  history = [],
  previousAnswerSummary = "",
  decision = null,
} = {}) {
  const promo = decideStage3Promotion({
    question,
    s6FinalAnswer,
    shadow,
    env,
    history,
    previousAnswerSummary,
    decision,
  });

  const stage3Active = {
    schema_version: promo.schema_version,
    stage: promo.stage,
    stage3_active: promo.stage3_active,
    preview_only: promo.preview_only,
    lane: promo.lane,
    lane_reason: promo.lane_reason,
    q10_blocked: promo.q10_blocked,
    promotion_pass: promo.promotion_pass,
    fallback_reason: promo.fallback_reason,
    customer_text_changed: promo.customer_text_changed,
    final_answer_source: promo.final_answer_source,
    s6_final_answer: promo.s6_final_answer,
    s7_voice: promo.s7_voice,
    next_decision_point: promo.next_decision_point,
    product_push: promo.product_push,
    invent_or_fake_fact: promo.invent_or_fake_fact,
    cancel_enroll_certainty: promo.cancel_enroll_certainty,
    production_touched: false,
    production_blocked: promo.production_blocked,
    insurance_memory_saved: false,
    post_turn_save_hook: false,
    gate: promo.gate,
  };

  return {
    finalText: promo.customer_text,
    customer_text_changed: promo.customer_text_changed,
    final_answer_source: promo.final_answer_source,
    stage3_active: stage3Active,
    decision: promo,
  };
}
