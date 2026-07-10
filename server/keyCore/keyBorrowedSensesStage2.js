/**
 * S7 Stage 2 — Preview-only / allowlist-only / gate-pass-only promotion.
 * Pure decision helpers. Does not call Claude. Does not soften gate.
 */
import { isKeyBorrowedSensesStage2Partial, isVercelProductionEnv } from "./oneKeyCoreFlags.js";

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

/** Q10-style whole-portfolio expansion — never promote. */
export function isQ10PortfolioExpansionQuestion(question = "") {
  const q = normalizeQuestion(question);
  return /내\s*보험\s*(?:전체\s*)?괜찮아|전체\s*보험\s*괜찮아|포트폴리오/.test(q);
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
