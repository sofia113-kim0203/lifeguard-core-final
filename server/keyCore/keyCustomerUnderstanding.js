/**
 * Slice 4 — Customer Understanding SSOT (buildCustomerUnderstanding single Goal source).
 */
import {
  buildDu1InputBundle,
  resolveDu1InputGates,
} from "../keyBrain/du1DocumentUploadFirstSpeak.js";
import { PREMIUM_BURDEN_COMPANION_CLUSTER_ID } from "../intentGateLayer.js";
import {
  buildKeyThinkingFlow,
  detectConversationPhase,
  detectEmotionSignal,
  detectThinkingDomain,
} from "./keyThinkingFlow.js";

/** Experiment constants — not constitution values (Tom 2026-07-08). */
export const EXPERIMENT_ASSERT_THRESHOLD = 0.75;
export const EXPERIMENT_CONFIRM_THRESHOLD = 0.45;
export const EXPERIMENT_GOAL_TIE_EPSILON = 0.08;

export const KEY_CUSTOMER_UNDERSTANDING_SCHEMA = "key-customer-understanding-v1";

const INSURANCE_TOPIC_RE =
  /보험|보험료|보장|암|실손|담보|청구|보험금|해지|중복|유지|가입|설계|부족|괜찮|납입|계약/;
const EMOTION_SIGNAL_RE =
  /힘들|지쳤|불안|걱정|부담|무서|망설|답답|우울|속상|덥|춥|추워|더워|피곤|지침/;

function normalizeQuestion(question = "") {
  return String(question ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

function formatPremiumValue(policy) {
  const raw = policy?.monthly_premium ?? policy?.premium_amount;
  if (raw == null) return null;
  const num = Number(raw);
  if (!Number.isFinite(num)) return null;
  if (num >= 10000) {
    const man = Math.floor(num / 10000);
    const cheon = Math.floor((num % 10000) / 1000);
    return cheon > 0 ? `${man}만${cheon}천 원` : `${man}만 원`;
  }
  return `${num.toLocaleString("ko-KR")}원`;
}

function policyFactLines(policies = []) {
  if (!policies.length) return { count: 0, insurer: null, product: null, premium: null };
  const p = policies[0];
  return {
    count: policies.length,
    insurer: p?.insurer_name ?? null,
    product: p?.product_name ?? null,
    premium: formatPremiumValue(p),
    premiumRaw: p?.monthly_premium ?? p?.premium_amount ?? null,
  };
}

export function buildCustomerReality({
  question = "",
  contextSnapshot = null,
  loadedContext = null,
  consultationIntent = null,
} = {}) {
  const bundle = buildDu1InputBundle({
    document: { id: null, event_type: "question" },
    contextSnapshot,
    loadedContext,
  });
  const inputGates = resolveDu1InputGates(loadedContext, bundle);
  const policies = bundle.policies ?? [];
  const q = normalizeQuestion(question);

  return {
    question: q,
    policies,
    policies_present: inputGates.policiesPresent === true,
    policy_count: policies.length,
    companion_signal: consultationIntent?.companion_cluster ?? null,
    emotion_observed: detectEmotionSignal(q),
    domain: detectThinkingDomain(q, consultationIntent),
    phase: detectConversationPhase(q),
    routing_hint: {
      intent: consultationIntent?.intent ?? null,
      lookup_sub_intent: consultationIntent?.lookup_sub_intent ?? null,
      routing_hint_only: true,
    },
    flags: contextSnapshot?.flags ?? {},
    memory_fact_count: (bundle.memoryFacts ?? []).length,
    has_recent_conversation: bundle.conversation?.has_recent === true,
  };
}

function scoreGoalHypotheses(reality, { routingHint = null } = {}) {
  const q = reality.question ?? "";
  const hypotheses = [];
  const add = (goal, score, signals = []) => hypotheses.push({ goal, score, signals_used: signals });

  if (reality.phase === "closing") {
    add("respect_close", 0.95, ["conversation_phase_closing"]);
    return hypotheses;
  }

  if (/맛집|식당|음식/.test(q) && !INSURANCE_TOPIC_RE.test(q)) {
    add("daily_recommendation", 0.92, ["daily_domain", "food_keyword"]);
  }

  if (EMOTION_SIGNAL_RE.test(q) && !INSURANCE_TOPIC_RE.test(q)) {
    add("emotional_space", 0.88, ["emotion_signal", "no_insurance_topic"]);
  }

  if (reality.companion_signal === PREMIUM_BURDEN_COMPANION_CLUSTER_ID || (/보험료/.test(q) && /부담/.test(q))) {
    add("premium_burden", 0.9, ["companion_premium_burden", "premium_burden_keywords"]);
    add("emotional_space", 0.35, ["emotion_signal"]);
  }

  if (/내보험|내\s*보험/.test(q) && /가르쳐|알려|설명/.test(q)) {
    add("enrolled_policy_list", 0.88, ["teach_request", "my_insurance"]);
  } else if (/가입한\s*보험|보험\s*뭐/.test(q)) {
    add("enrolled_policy_list", 0.9, ["policy_list_keyword"]);
  }

  if (/암/.test(q) && /부족/.test(q)) {
    add("coverage_assessment_cancer_axis", 0.9, ["cancer_axis_keyword"]);
    add("coverage_assessment_whole", 0.4, ["coverage_keyword"]);
  } else if (/괜찮/.test(q) && INSURANCE_TOPIC_RE.test(q)) {
    add("coverage_assessment_whole", 0.88, ["whole_assessment_keyword"]);
  }

  if (/추천|설계/.test(q) && (reality.policies_present || INSURANCE_TOPIC_RE.test(q))) {
    add("direction_choice", 0.85, ["recommendation_keyword", reality.policies_present ? "policies_present" : "insurance_topic"]);
  }

  if (/심심해서?\s*왔/.test(q)) {
    add("social_presence", 0.9, ["social_turn"]);
  }

  if (!hypotheses.length) {
    add("general_inquiry", 0.5, ["fallback"]);
  }

  if (routingHint?.intent === "policy_detail") {
    const list = hypotheses.find((h) => h.goal === "enrolled_policy_list");
    if (list) list.score += 0.08;
  }

  hypotheses.sort((a, b) => b.score - a.score);
  return hypotheses;
}

function resolveUnderstandingFromHypotheses(hypotheses) {
  const sorted = [...hypotheses].sort((a, b) => b.score - a.score);
  const top = sorted[0];
  const second = sorted[1] ?? null;
  const tie =
    second && Math.abs(top.score - second.score) < EXPERIMENT_GOAL_TIE_EPSILON;
  const confidence = top?.score ?? 0;

  const rejected_hypotheses = sorted
    .slice(1)
    .filter((h) => h.goal !== top?.goal)
    .map((h) => ({ goal: h.goal, reason: `lower_score:${h.score.toFixed(2)}` }));

  let understanding_ok = confidence >= EXPERIMENT_ASSERT_THRESHOLD && !tie;
  let confirmation_required = false;
  let confirmation_reason = null;

  if (tie) {
    understanding_ok = false;
    confirmation_required = true;
    confirmation_reason = "goal_ambiguous";
  } else if (confidence < EXPERIMENT_ASSERT_THRESHOLD && confidence >= EXPERIMENT_CONFIRM_THRESHOLD) {
    understanding_ok = false;
    confirmation_required = true;
    confirmation_reason = "low_confidence";
  } else if (confidence < EXPERIMENT_CONFIRM_THRESHOLD) {
    understanding_ok = false;
    confirmation_required = true;
    confirmation_reason = "low_confidence";
  }

  return {
    customer_goal: top?.goal ?? "general_inquiry",
    goal_confidence: confidence,
    goal_hypotheses: sorted,
    rejected_hypotheses,
    understanding_ok,
    confirmation_required,
    confirmation_reason,
    selected_goal: top?.goal ?? "general_inquiry",
    confidence,
  };
}

export function buildCustomerUnderstanding(reality, { question = "", routingHint = null } = {}) {
  const hypotheses = scoreGoalHypotheses(reality, { routingHint });
  const resolved = resolveUnderstandingFromHypotheses(hypotheses);

  if (
    resolved.customer_goal === "enrolled_policy_list" &&
    !reality.policies_present
  ) {
    resolved.understanding_ok = false;
    resolved.confirmation_required = true;
    resolved.confirmation_reason = "reality_gap";
  }

  return {
    schema_version: KEY_CUSTOMER_UNDERSTANDING_SCHEMA,
    goal_source: "buildCustomerUnderstanding",
    customer_goal: resolved.customer_goal,
    selected_goal: resolved.selected_goal,
    goal_confidence: resolved.goal_confidence,
    confidence: resolved.confidence,
    goal_hypotheses: resolved.goal_hypotheses,
    rejected_hypotheses: resolved.rejected_hypotheses,
    understanding_ok: resolved.understanding_ok,
    confirmation_required: resolved.confirmation_required,
    confirmation_reason: resolved.confirmation_reason,
    paraphrase: null,
    unknown_boundaries: [],
  };
}

export function selectFactsForSpeech(reality, customerUnderstanding) {
  const goal = customerUnderstanding?.customer_goal ?? customerUnderstanding?.selected_goal;
  const facts = policyFactLines(reality.policies ?? []);
  const spoken = [];
  const withheld = [];

  const pushPolicyFacts = () => {
    if (facts.count > 0) {
      spoken.push({ fact_id: "policy_count", value: String(facts.count), source: "factory" });
      if (facts.insurer) spoken.push({ fact_id: "insurer", value: facts.insurer, source: "factory" });
      if (facts.product) spoken.push({ fact_id: "product", value: facts.product, source: "factory" });
      if (facts.premiumRaw != null) {
        spoken.push({ fact_id: "monthly_premium", value: String(facts.premiumRaw), source: "factory" });
      } else {
        withheld.push({ fact: "monthly_premium", reason: "unknown_declared" });
      }
    } else {
      withheld.push({ fact: "policies", reason: "policies_absent" });
    }
  };

  switch (goal) {
    case "premium_burden":
    case "enrolled_policy_list":
      pushPolicyFacts();
      withheld.push({ fact: "additional_policies", reason: "unknown_declared" });
      withheld.push({ fact: "structure_breakdown", reason: "unknown_declared" });
      break;
    case "coverage_assessment_whole":
    case "coverage_assessment_cancer_axis":
      pushPolicyFacts();
      withheld.push({ fact: "other_coverage_axes", reason: "unknown_declared" });
      withheld.push({ fact: "whole_coverage_verdict", reason: "analysis_pending" });
      break;
    case "direction_choice":
      pushPolicyFacts();
      withheld.push({ fact: "binding_product_name", reason: "hold_binding_recommendation" });
      withheld.push({ fact: "design_bundle", reason: "direction_not_fixed" });
      break;
    case "emotional_space":
      withheld.push({ fact: "insurance_facts", reason: "goal_emotional_space" });
      break;
    case "daily_recommendation":
      withheld.push({ fact: "insurance_facts", reason: "domain_daily" });
      break;
    case "respect_close":
      withheld.push({ fact: "insurance_facts", reason: "respect_close" });
      break;
    default:
      if (facts.count > 0) pushPolicyFacts();
      else withheld.push({ fact: "policies", reason: "policies_absent" });
  }

  return { facts_spoken: spoken, facts_withheld: withheld };
}

export function assertSpeakFactGate({ understanding_ok, factSelection, speak_mode = null } = {}) {
  if (speak_mode === "confirmation_turn") {
    return { ok: true, reason: "confirmation_turn_allowed" };
  }
  if (!understanding_ok) return { ok: false, reason: "understanding_not_ok" };
  const { facts_spoken = [], facts_withheld = [] } = factSelection ?? {};
  const spokenOk = facts_spoken.length > 0;
  const withheldOk = facts_withheld.length > 0 && facts_withheld.every((w) => w.reason);
  if (!spokenOk && !withheldOk) return { ok: false, reason: "fact_third_state_forbidden" };
  if (!spokenOk && facts_withheld.some((w) => !w.reason)) {
    return { ok: false, reason: "withheld_missing_reason" };
  }
  return { ok: true };
}

export function deriveThinkingFromUnderstanding(customerUnderstanding, baseParams = {}) {
  const flow = buildKeyThinkingFlow({
    ...baseParams,
    customerUnderstanding,
  });
  return {
    ...flow,
    customer_understanding: customerUnderstanding,
    understanding_ok: customerUnderstanding?.understanding_ok ?? false,
    goal_source: "derived_from_customer_goal",
  };
}

export function buildUnderstandingTurnBundle({
  question = "",
  contextSnapshot = null,
  loadedContext = null,
  consultationIntent = null,
  keyInterprets = null,
} = {}) {
  const reality = buildCustomerReality({
    question,
    contextSnapshot,
    loadedContext,
    consultationIntent,
  });
  const customerUnderstanding = buildCustomerUnderstanding(reality, {
    question,
    routingHint: reality.routing_hint,
  });
  const factSelection = selectFactsForSpeech(reality, customerUnderstanding);
  const thinkingBundle = deriveThinkingFromUnderstanding(customerUnderstanding, {
    question,
    contextSnapshot,
    loadedContext,
    consultationIntent,
    keyInterprets,
  });
  return {
    reality,
    customerUnderstanding,
    factSelection,
    thinkingBundle,
  };
}
