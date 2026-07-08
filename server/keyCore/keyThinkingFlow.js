/**
 * KEY Thinking Flow v1.0 — Slice 3 SSOT (interpret/thinking trace).
 * Salience landscape · Fact-first · Conversation Intention (trace only).
 */
import { isGeneralKnowledgeEligible } from "../generalKnowledgeEligibility.js";
import {
  buildDu1InputBundle,
  resolveDu1InputGates,
} from "../keyBrain/du1DocumentUploadFirstSpeak.js";
import { isKeySocialTurn } from "../keyConversationPatterns.js";

export const KEY_THINKING_FLOW_SCHEMA = "key-thinking-flow-v1";

export const CONVERSATION_INTENTION = {
  REASSURE_WITH_TRUTH: "reassure_with_truth",
  CLARIFY: "clarify",
  ACCOMPANY: "accompany",
  ENCOURAGE: "encourage",
  EDUCATE: "educate",
  CELEBRATE: "celebrate",
  COMFORT: "comfort",
  MOTIVATE: "motivate",
};

export const DEFER_ONLY_PATTERNS = [
  /지금\s*걸리는\s*부분부터\s*같이\s*보면/,
  /순서가\s*보입니다/,
  /보장\s*구조부터/,
  /어떤\s*순서로\s*볼지부터\s*맞춰/,
  /맞춰볼게요/,
  /같이\s*보면\s*됩니다/,
  /조금만\s*더\s*알려주시면/,
];

const EMOTION_SIGNAL_RE =
  /힘들|지쳤|불안|걱정|부담|무서|망설|답답|우울|속상|덥|춥|추워|더워|피곤|지침/;
const INSURANCE_TOPIC_RE =
  /보험|보험료|보장|암|실손|담보|청구|보험금|해지|중복|유지|가입|설계|부족|괜찮|납입|계약/;
const CLOSING_SIGNAL_RE =
  /^(?:됐어|됐습니다|고마워|고맙습니다|감사합니다|그만|여기까지|이만)(?:[!.?\s~]*)$/i;

function normalizeQuestion(question = "") {
  return String(question ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

export function detectThinkingDomain(question = "", consultationIntent = null) {
  const q = normalizeQuestion(question);
  if (!q) return "social";
  if (isKeySocialTurn(q) || /심심해서?\s*왔/.test(q)) return "social";
  if (isGeneralKnowledgeEligible(q, consultationIntent) || consultationIntent?.general_knowledge) {
    return "daily";
  }
  if (EMOTION_SIGNAL_RE.test(q) && !INSURANCE_TOPIC_RE.test(q)) return "emotion";
  if (INSURANCE_TOPIC_RE.test(q)) return "insurance";
  return "daily";
}

function deriveInternalNeedFromGoal(customerGoal = null) {
  if (!customerGoal) return "general_inquiry";
  if (customerGoal === "coverage_assessment_whole" || customerGoal === "coverage_assessment_cancer_axis") {
    return "coverage_assessment";
  }
  if (customerGoal === "premium_burden") return "premium_burden";
  if (customerGoal === "premium_lookup") return "factual_lookup";
  return customerGoal;
}

/** @deprecated Slice 3 legacy — use buildCustomerUnderstanding SSOT when S4 active. */
function detectCustomerNeedLegacy(question = "", consultationIntent = null, { policiesPresent = false } = {}) {
  const intent = consultationIntent?.intent ?? null;
  const q = normalizeQuestion(question);

  if (intent === "policy_detail" || (/가입한\s*보험|보험\s*뭐/.test(q) && policiesPresent)) {
    return "enrolled_policy_list";
  }
  if (intent === "factual_lookup" || /얼마|몇\s*건|몇\s*개/.test(q)) {
    return "factual_lookup";
  }
  if (/괜찮|부족|충분|갭|공백/.test(q)) return "coverage_assessment";
  if (/맛집|식당|음식|여행/.test(q)) return "daily_recommendation";
  if (/추천|설계/.test(q)) return "direction_choice";
  if (EMOTION_SIGNAL_RE.test(q)) return "emotional_space";
  if (isKeySocialTurn(q)) return "social_presence";
  return "general_inquiry";
}

export function detectConversationPhase(question = "") {
  const q = normalizeQuestion(question);
  if (
    CLOSING_SIGNAL_RE.test(q) ||
    /^고마워/.test(q) ||
    /됐어[,.\s]*고마워/.test(q) ||
    /됐어[,.\s]*감사/.test(q)
  ) {
    return "closing";
  }
  if (/안녕|처음/.test(q)) return "opening";
  return "exploring";
}

export function detectEmotionSignal(question = "") {
  const q = normalizeQuestion(question);
  if (/힘들|지쳤|피곤|지침/.test(q)) return "fatigue";
  if (/불안|걱정|무서/.test(q)) return "anxiety";
  if (/망설|고민/.test(q)) return "hesitation";
  if (/심심/.test(q)) return "boredom";
  return null;
}

export function resolveConversationIntention({
  question = "",
  consultationIntent = null,
  domain = "daily",
  customerNeed = null,
  policiesPresent = false,
} = {}) {
  const intent = consultationIntent?.intent ?? null;
  const q = normalizeQuestion(question);

  if (domain === "social") return CONVERSATION_INTENTION.ACCOMPANY;
  if (detectConversationPhase(q) === "closing") return CONVERSATION_INTENTION.ACCOMPANY;

  if (customerNeed === "premium_burden") return CONVERSATION_INTENTION.CLARIFY;
  if (customerNeed === "enrolled_policy_list" || intent === "policy_detail") {
    return CONVERSATION_INTENTION.CLARIFY;
  }
  if (customerNeed === "coverage_assessment" || intent === "coverage_gap_check") {
    return policiesPresent
      ? CONVERSATION_INTENTION.REASSURE_WITH_TRUTH
      : CONVERSATION_INTENTION.CLARIFY;
  }
  if (customerNeed === "emotional_space" || EMOTION_SIGNAL_RE.test(q)) {
    return CONVERSATION_INTENTION.COMFORT;
  }
  if (customerNeed === "direction_choice" || intent === "recommendation_request") {
    return CONVERSATION_INTENTION.MOTIVATE;
  }
  if (customerNeed === "daily_recommendation") return CONVERSATION_INTENTION.CLARIFY;
  if (/설명|구조|뭐야|뭔지/.test(q) && domain === "insurance") {
    return CONVERSATION_INTENTION.EDUCATE;
  }
  return CONVERSATION_INTENTION.ACCOMPANY;
}

export function selectConversationElements({
  domain = "daily",
  customerNeed = null,
  conversationIntention = null,
  policiesPresent = false,
} = {}) {
  const elements = [];

  if (conversationIntention === CONVERSATION_INTENTION.COMFORT) {
    elements.push("공감", "참여");
  }
  if (conversationIntention === CONVERSATION_INTENTION.CLARIFY) {
    elements.push("설명", "참여");
  }
  if (conversationIntention === CONVERSATION_INTENTION.EDUCATE) {
    elements.push("설명", "전문성");
  }
  if (conversationIntention === CONVERSATION_INTENTION.REASSURE_WITH_TRUTH) {
    elements.push("판단", "전문성");
  }
  if (conversationIntention === CONVERSATION_INTENTION.MOTIVATE) {
    elements.push("인정", "질문");
  }
  if (policiesPresent && (customerNeed === "enrolled_policy_list" || domain === "insurance")) {
    if (!elements.includes("전문성")) elements.push("전문성");
  }
  if (domain === "daily" && customerNeed === "daily_recommendation") {
    return ["설명", "제안", "질문"];
  }
  if (domain === "social" || customerNeed === "social_presence") {
    return ["인정", "참여", "유머"];
  }
  if (customerNeed === "respect_close") {
    return ["인정", "참여"];
  }
  if (!elements.includes("참여")) elements.push("참여");

  return [...new Set(elements)].slice(0, 4);
}

export function resolveThinkingDensity(question = "", { domain = "daily", customerNeed = null } = {}) {
  const q = normalizeQuestion(question);
  if (/^(?:안녕|고마워|감사)/.test(q)) return "minimal";
  if (domain === "social" || customerNeed === "social_presence") return "light";
  if (customerNeed === "emotional_space" || customerNeed === "coverage_assessment" || customerNeed === "premium_burden") {
    return "deep";
  }
  if (customerNeed === "enrolled_policy_list" || customerNeed === "factual_lookup") return "standard";
  return "standard";
}

export function isDeferOnlyText(text = "") {
  const normalized = String(text ?? "").replace(/\s+/g, " ").trim();
  if (!normalized) return true;
  return DEFER_ONLY_PATTERNS.some((re) => re.test(normalized));
}

export function buildSalienceOrder({
  domain = "daily",
  customerNeed = null,
  policiesPresent = false,
  emotionDetected = null,
} = {}) {
  const order = [];
  if (policiesPresent && (customerNeed === "enrolled_policy_list" || customerNeed === "factual_lookup")) {
    order.push("known_facts", "customer_need", "conversation_intention");
  } else if (emotionDetected) {
    order.push("customer_emotion", "customer_need", "conversation_intention");
  } else if (domain === "daily") {
    order.push("domain", "customer_need", "conversation_intention");
  } else {
    order.push("known_facts", "customer_need", "conversation_intention");
  }
  return order;
}

/**
 * @param {object} params
 */
export function buildKeyThinkingFlow({
  question = "",
  contextSnapshot = null,
  loadedContext = null,
  consultationIntent = null,
  keyInterprets = null,
  customerUnderstanding = null,
} = {}) {
  const bundle = buildDu1InputBundle({
    document: { id: null, event_type: "question" },
    contextSnapshot,
    loadedContext,
    keyFirstJudgment: keyInterprets
      ? {
          judgment_scope: keyInterprets.judgment_scope,
          hold: keyInterprets.hold,
          posture: keyInterprets.orient_speech_planned?.posture ?? "question_provisional",
        }
      : null,
  });

  const inputGates = resolveDu1InputGates(loadedContext, bundle);
  const policies = bundle.policies ?? [];
  const policiesPresent = inputGates.policiesPresent === true;
  const domain = detectThinkingDomain(question, consultationIntent);
  const customerGoal = customerUnderstanding?.customer_goal ?? customerUnderstanding?.selected_goal ?? null;
  const customerNeed = customerGoal
    ? deriveInternalNeedFromGoal(customerGoal)
    : detectCustomerNeedLegacy(question, consultationIntent, { policiesPresent });
  const emotionDetected = detectEmotionSignal(question);
  const conversationPhase = detectConversationPhase(question);
  const conversationIntention = resolveConversationIntention({
    question,
    consultationIntent,
    domain,
    customerNeed,
    policiesPresent,
  });
  const conversationElements = selectConversationElements({
    domain,
    customerNeed,
    conversationIntention,
    policiesPresent,
  });
  const thinkingDensity = resolveThinkingDensity(question, { domain, customerNeed });
  const insuranceBleedGuard = domain === "daily" || domain === "social" || domain === "emotion";

  const unknownDeclared = [];
  if (customerNeed === "enrolled_policy_list" && !policiesPresent) {
    unknownDeclared.push("policies_absent");
  }
  for (const policy of policies) {
    const premium = policy?.monthly_premium ?? policy?.premium_amount;
    if (premium == null) unknownDeclared.push("premium_partial");
    break;
  }

  const factsUsedPlanned = [];
  if (policiesPresent) {
    factsUsedPlanned.push(`policy_count:${policies.length}`);
    const first = policies[0];
    if (first?.insurer_name) factsUsedPlanned.push(`insurer:${first.insurer_name}`);
    if (first?.product_name) factsUsedPlanned.push(`product:${first.product_name}`);
  }

  let thinkingOk = true;
  let thinkingFailureReason = null;

  if (policiesPresent && customerNeed === "enrolled_policy_list" && factsUsedPlanned.length === 0) {
    thinkingOk = false;
    thinkingFailureReason = "facts_available_but_not_planned";
  }
  if (domain === "daily" && !insuranceBleedGuard) {
    thinkingOk = false;
    thinkingFailureReason = "daily_insurance_bleed_risk";
  }
  if (conversationElements.length < 2) {
    thinkingOk = false;
    thinkingFailureReason = "element_count_below_minimum";
  }

  let followUpReason = null;
  if (customerNeed === "enrolled_policy_list" && policiesPresent) followUpReason = "offer_depth";
  if (customerNeed === "daily_recommendation") followUpReason = "clarify_condition";
  if (conversationPhase === "closing") followUpReason = "respect_close";
  if (customerNeed === "coverage_assessment") followUpReason = "offer_depth";
  if (customerNeed === "premium_burden") followUpReason = "clarify_burden_priority";
  if (customerGoal === "direction_choice") followUpReason = "direction_choice_priority";
  if (customerGoal === "emotional_space") followUpReason = "invite_light_share";
  if (customerGoal === "daily_recommendation") followUpReason = "clarify_cuisine_and_party";
  if (customerGoal === "respect_close") followUpReason = "respect_close";

  const understandingOk = customerUnderstanding?.understanding_ok ?? null;

  return {
    schema_version: KEY_THINKING_FLOW_SCHEMA,
    thinking_density: thinkingDensity,
    salience_order: buildSalienceOrder({
      domain,
      customerNeed,
      policiesPresent,
      emotionDetected,
    }),
    customer_intent: consultationIntent?.intent ?? null,
    customer_goal: customerGoal,
    customer_need_detected: customerNeed,
    goal_source: customerGoal ? "derived_from_customer_goal" : "legacy_detect",
    emotion_detected: emotionDetected,
    domain,
    conversation_phase: conversationPhase,
    conversation_intention: conversationIntention,
    known_facts: {
      policies_present: policiesPresent,
      policy_count: policies.length,
      analysis_loaded: contextSnapshot?.flags?.has_stored_coverage_analysis === true,
    },
    unknown_declared: [...new Set(unknownDeclared)],
    facts_considered: policiesPresent
      ? policies.slice(0, 3).map((_, i) => `policy_row_${i}`)
      : [],
    facts_used_planned: factsUsedPlanned,
    facts_withheld_reason: [],
    conversation_elements_selected: conversationElements,
    elements_suppressed: domain === "daily" ? ["전문성(보험)", "판단(보험)"] : [],
    insurance_bleed_guard: insuranceBleedGuard,
    defer_blocked: policiesPresent && customerNeed === "enrolled_policy_list",
    follow_up_reason: followUpReason,
    follow_up_hint: null,
    understanding_ok: understandingOk,
    thinking_ok: customerUnderstanding ? understandingOk === true && thinkingOk : thinkingOk,
    thinking_failure_reason: thinkingFailureReason,
    inputGates,
    four_inputs: {
      document: false,
      policies: policies.length,
      memory: (bundle.memoryFacts ?? []).length,
      conversation: bundle.conversation?.has_recent === true,
    },
    snapshot_loaded: bundle.context_snapshot_loaded === true,
    policies,
  };
}

export function buildQuestionThinkingBundle(params = {}) {
  return buildKeyThinkingFlow(params);
}
