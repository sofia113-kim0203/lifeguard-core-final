/**
 * P9-2 — Human Understanding Loop (Tom Core Loop v1)
 * People first, insurance as tool. Frame + basisTaggedFacts are thinking material, not slot templates.
 */
import { classifyConsultationIntent, computePremiumLookupStats } from "./intentGateLayer.js";
import { detectClaimTopic, findRelevantPolicies } from "./claimBridgeLayer.js";
import { hasCoveragePresenceFactualAnswer, isGenericHulCounselingIntro } from "./coveragePresencePreserveGate.js";
import {
  hasFreeThinkingQualities,
  violatesManualTemplate,
} from "./salesDirectorFreeThinking.js";
import {
  buildKeyJudgmentFromRules,
  KEY_JUDGMENT_RULES,
  resolveKeyJudgmentRule,
  resolveMemoryConfidenceLevel,
  resolveMemoryFactsFromBundle,
} from "./keyJudgmentRules.js";
import {
  buildKeyClosingResponse,
  isKeyClosingTurn,
  isKeySocialTurn,
  resolveKeyClosingConversationPattern,
  resolveKeySocialConversationPattern,
} from "./keyConversationPatterns.js";
import {
  buildKeyCompanionGuidanceResponse,
  KEY_GENERIC_FILLER_JUDGMENT,
  shouldUseKeyCompanionGuidanceCompose,
} from "./keyCompanionGuidance.js";
import {
  buildPersonalTimeContinuityResponse,
  hasTimeContinuityUsedSignal,
  shouldUsePersonalTimeContinuityCompose,
} from "./personalKeyTimeContinuity.js";
import {
  buildContinuityCompanionResponse,
  shouldUseContinuityCompanionCompose,
} from "./conversationContinuityBridge.js";
import {
  FACTUAL_LOOKUP_JUDGMENT_INTENTS,
  SALES_DIRECTOR_JUDGMENT_INTENTS,
  STATEMENT_BASIS,
  detectFalseAssertions,
  extractFactBundleEvidence,
  resolveSalesDirectorJudgmentIntent,
  selectMostImportantOpportunity,
  selectMostImportantRisk,
  selectMostSurprisingInsight,
} from "./salesDirectorFormatter.js";

/** Tool Brain slice ids — mirrored from salesDirectorToolBrain (no import — cycle). */
const TOOL_BRAIN_SLICE_INSURANCE_PRESENCE = "insurance_presence";
const TOOL_BRAIN_SLICE_PREMIUM_BURDEN = "premium_burden";

export const HUMAN_CUSTOMER_STATES = [
  "exploring",
  "confirming",
  "anxious",
  "skeptical",
  "urgent",
  "confused",
  "comparing",
  "pre_decision",
  "trust_check",
  "browsing",
];

export const HUMAN_CUSTOMER_GOALS = [
  "information",
  "confirmation",
  "reassurance",
  "savings",
  "decision",
  "action",
  "compensation",
  "understanding",
  "direction",
  "trust",
];

const TRUST_HUMAN_QUESTION_PATTERNS = [
  /GPT|지피티|챗\s*GPT/i,
  /그냥\s*둘러/i,
  /너무\s*어려/i,
  /뭐부터\s*해야/i,
  /모르겠/,
  /정보\s*줘도\s*안전|내\s*정보/i,
  /PDF|pdf|올려야/i,
  /믿어도|진짜\s*믿/i,
  /그냥\s*확인만/i,
  /설계사.*맞는지|하라는\s*말/i,
  /가입할\s*생각\s*없|지금\s*가입/i,
  /라이프\s*가드|왜\s*써야/i,
  /왜\s*보험을\s*해야/i,
];

const UNBREAKABLE_PROMISE_PATTERNS = [
  /100%\s*안전/,
  /무조건\s*받을\s*수\s*있/,
  /반드시\s*가능/,
  /절대\s*문제\s*없/,
];

export const P9_2_FORBIDDEN_OUTPUT_PATTERNS = [
  { id: "risk_label", pattern: /가장\s*큰\s*위험\s*:/ },
  { id: "opportunity_label", pattern: /가장\s*큰\s*기회\s*:/ },
  { id: "shortage_signal", pattern: /부족\s*신호가\s*있습니다/ },
  { id: "maintain_signal", pattern: /유지\s*신호가\s*있/ },
  { id: "ack_repeat", pattern: /보험을\s*안\s*챙긴\s*분은\s*아닙니다/ },
  { id: "policy_count_open", pattern: /^현재\s*\d+\s*건의\s*보험/ },
  { id: "coverage_detail_repeat", pattern: /보장내역\s*확인이\s*되면/ },
  { id: "confirmed_material", pattern: /확인된\s*자료\s*기준으로\s*~?\s*신호/ },
  { id: "unbreakable_100", pattern: /100%\s*안전합니다/ },
  { id: "unbreakable_must_receive", pattern: /무조건\s*받을\s*수\s*있습니다/ },
  { id: "unbreakable_must_possible", pattern: /반드시\s*가능합니다/ },
  { id: "unbreakable_no_problem", pattern: /절대\s*문제\s*없습니다/ },
  { id: "standalone_upload", pattern: /^보장내역(?:서)?(?:를|을)\s*올려\s*주세요[.!]?$/i },
  { id: "meta_surface_question", pattern: /표면\s*질문\s*뒤(?:에는|에)/ },
];

const INSURANCE_TOPIC =
  /보험|보험료|보장|암|실손|담보|청구|보험금|해지|중복|유지|사고|운전자|부족|괜찮|비싸|부담|놓친/i;

/** Life / emotion turns — KEY listens first (Order 0.5 Scene B/C). */
const KEY_RELATIONAL_LIFE_SIGNAL =
  /피곤|지쳤|힘들(?:어|다)|수면|잠\s*못|우울|스트레스|아버지|어머니|배우자|가족|(?:아이|자녀).{0,8}(?:아프|아퍼|편찮)/;

const KEY_RELATIONAL_INSURANCE_PUSH_RE =
  /보험(?:을|이)?\s*(?:가입|들|추천|설계|정리|볼)|보장(?:을|이)?\s*(?:추천|설계)|가입(?:을|하)/;

/** Scene I — analysis progress / completion status (not analysis requests). */
const KEY_ANALYSIS_STATUS_QUESTION_RE =
  /(?:분석.{0,12}(?:끝|완료|됐|나|되|중|진행|상태|결과|언제|아직)|(?:끝|완료|다\s*됐).{0,12}분석|분석\s*끝)/;

const KEY_ANALYSIS_REQUEST_RE =
  /(?:분석(?:해|해줘|해주|좀|하)|(?:해줘|해주).{0,8}분석|분석\s*(?:해|요청|부탁))/;

/** KEY compose — declarative ending only. */
export const KEY_QUESTION_ENDING_RE =
  /[?？]$|할까요|볼까요|알려주(?:실|시)|말씀해\s*주(?:실|시)|여쭤|궁금하(?:신|세요)/;

/** Limitation-shaped openings — must not lead KEY answers (KEY_JUDGMENT_FIRST). */
const KEY_LIMITATION_OPENING_RE =
  /^(?:월\s*납입|일부\s*보험료|상품명|세부\s*담보|지금\s*알\s*수\s*없는\s*범위)/;

const KEY_DECLARATIVE_NEXT_ACTIONS = {
  premium_burden:
    "가장 무거운 계약부터 순서를 정리해 보면, 줄일지 유지할지가 보입니다.",
  claim_uncertainty: "어떤 사고·치료였는지 정리해 두면, 열려 있는 축부터 같이 볼 수 있습니다.",
  information_gap: "확인해 보고 다시 말씀드리겠습니다.",
  trust_gap: "지금은 확인부터 차근차근 맞춰 보면 됩니다.",
  complexity: "한 번에 다 보기보다, 지금 걸리는 축 하나부터 짚어 보면 됩니다.",
  decision_fatigue: "가볍게 볼 부분과 꼭 볼 부분만 나눠 두면 됩니다.",
  uncertainty: "걱정되는 축부터 차례로 짚어 보면 됩니다.",
  default: "걱정되는 축부터 차례로 짚어 보면 됩니다.",
};

function shouldUseKeyOrchestratorCompose(guardrails = {}, factBundle = {}) {
  return guardrails.generation_mode === "key_orchestrator" || factBundle.key_orchestrator === true;
}

export function resolveKeyFactBundlePolicyCount(factBundle = {}) {
  if (factBundle.active_policy_count != null) {
    return Number(factBundle.active_policy_count);
  }
  if (factBundle.policy_count != null) {
    return Number(factBundle.policy_count);
  }
  return null;
}

export function keyToolBrainSliceHasPolicies(factBundle = {}) {
  if (factBundle.snapshot_tool_used === false) return false;
  const policyCount = resolveKeyFactBundlePolicyCount(factBundle);
  if (typeof policyCount === "number") {
    return policyCount > 0;
  }
  const policies = factBundle.policies;
  if (Array.isArray(policies)) {
    return policies.length > 0;
  }
  return factBundle.snapshot_tool_used === true;
}

function toolBrainSliceHasPolicies(factBundle = {}) {
  return keyToolBrainSliceHasPolicies(factBundle);
}

/**
 * P11-2D — Tool Brain deterministic templates absorbed into KEY slots (this migration only).
 */
function buildKeyToolBrainFixedResponse(slice = null, factBundle = {}, humanFrame = {}) {
  const memoryUsed =
    factBundle.memory_tool_used === true && (factBundle.memory_fact_count ?? 0) > 0;
  const mainBlocker = humanFrame.main_blocker ?? "default";
  let judgment = "";
  let evidence = "";
  let limitation = "";
  let nextAction = "";

  if (slice === TOOL_BRAIN_SLICE_INSURANCE_PRESENCE) {
    if (!toolBrainSliceHasPolicies(factBundle)) {
      judgment = "지금은 등록된 가입 보험 정보를 찾지 못했어요.";
      limitation = "보험 정보를 저장해 주시면 같이 확인해 볼게요.";
      nextAction = buildKeyNextActionBlock("information_gap");
    } else {
      judgment = "가입된 보험이 있는 것은 확인돼요.";
      if (memoryUsed) {
        evidence = "기억해 둔 상담 내용도 있어요.";
      }
      limitation = "담보 구조와 한도까지는 이 정보만으로는 확인 전입니다.";
      nextAction = buildKeyNextActionBlock(memoryUsed ? "default" : "information_gap");
    }
  } else if (slice === TOOL_BRAIN_SLICE_PREMIUM_BURDEN) {
    if (!toolBrainSliceHasPolicies(factBundle)) {
      judgment = "현재 확인되는 가입 보험이 없어요.";
      limitation = "보험 정보를 저장해 주시면 보험료 부담을 같이 보면 됩니다.";
      nextAction = buildKeyNextActionBlock("premium_burden");
    } else {
      const stats = factBundle.premium_stats;
      const premiumKnown = stats?.premiumKnownCount > 0 && stats?.premiumTotal > 0;
      if (premiumKnown) {
        judgment = "보험료 부담이 실제로 큰지는, 총액과 항목별 비중을 나눠 봐야 합니다.";
        evidence = `현재 확인 가능한 월 보험료는 ${stats.premiumTotal.toLocaleString("ko-KR")}원입니다.`;
        limitation = "일부 보험료는 아직 숫자로 확인 전입니다.";
        nextAction = buildKeyNextActionBlock("premium_burden");
      } else {
        judgment = "가입된 보험이 있는 것은 확인돼요.";
        evidence = "다만 총 보험료는 현재 검증이 필요합니다.";
        limitation = "월 납입액이 모든 계약에서 확인되지는 않았습니다.";
        nextAction = buildKeyNextActionBlock("premium_burden");
      }
    }
  }

  const parts = [
    enforceKeyJudgmentFirst(judgment),
    evidence,
    limitation,
    nextAction,
  ].filter(Boolean);
  return enforceKeyDeclarativeEnding(normalizeText(parts.join(" ")), mainBlocker);
}

function buildKeyToolBrainFixedResponseSafe(slice = null, factBundle = {}, humanFrame = {}) {
  const mainBlocker = humanFrame.main_blocker ?? "default";
  const policyCount = resolveKeyFactBundlePolicyCount(factBundle);
  const judgment =
    policyCount === 0
      ? "등록된 가입 보험이 아직 없습니다."
      : "지금 확인된 범위부터 같이 보면 됩니다.";
  const limitation = "지금 알 수 있는 범위와 모르는 범위를 나눠 두는 편이 낫습니다.";
  const nextAction = buildKeyNextActionBlock(mainBlocker);
  return enforceKeyDeclarativeEnding(
    normalizeText([judgment, limitation, nextAction].join(" ")),
    mainBlocker,
  );
}

function resolveToolBrainFixedSlice(factBundle = {}) {
  const slice = factBundle.tool_brain_slice ?? null;
  if (
    slice === TOOL_BRAIN_SLICE_INSURANCE_PRESENCE ||
    slice === TOOL_BRAIN_SLICE_PREMIUM_BURDEN
  ) {
    return slice;
  }
  return null;
}

function shouldUseToolBrainFixedSlots(factBundle = {}) {
  return Boolean(resolveToolBrainFixedSlice(factBundle));
}

function buildKeyNextActionBlock(mainBlocker = "", _resolvedIntent = null) {
  return KEY_DECLARATIVE_NEXT_ACTIONS[mainBlocker] ?? KEY_DECLARATIVE_NEXT_ACTIONS.default;
}

function buildKeyEvidenceBlock(basisTaggedFacts = {}, { evidenceOnly = false } = {}) {
  const lines = [];

  if (basisTaggedFacts.risk?.basis === STATEMENT_BASIS.EVIDENCE) {
    const line = naturalizeBasisItem(basisTaggedFacts.risk);
    if (line) lines.push(line);
  }
  if (basisTaggedFacts.opportunity?.basis === STATEMENT_BASIS.EVIDENCE) {
    const line = naturalizeBasisItem(basisTaggedFacts.opportunity);
    if (line) lines.push(line);
  }
  if (
    !evidenceOnly &&
    lines.length === 0 &&
    basisTaggedFacts.surprising_insight?.basis === STATEMENT_BASIS.EVIDENCE
  ) {
    const line = naturalizeBasisItem(basisTaggedFacts.surprising_insight);
    if (line) lines.push(line);
  }

  return lines.slice(0, 2).join(" ");
}

function buildKeyLimitationBlock(resolvedIntent = null, factBundle = {}, basisTaggedFacts = {}) {
  const evidence = basisTaggedFacts.evidence_summary ?? extractFactBundleEvidence(factBundle);
  const question = factBundle.question ?? "";

  if (resolvedIntent === SALES_DIRECTOR_JUDGMENT_INTENTS.UNDERWRITING_BOUND_JUDGMENT) {
    return "최종 인수 결과는 보험사·상품별 심사에 따라 달라질 수 있습니다.";
  }

  if (resolvedIntent === SALES_DIRECTOR_JUDGMENT_INTENTS.RECOMMENDATION_PRIORITY_JUDGMENT) {
    return "특정 상품 가입을 단정하거나 권유드리기는 어렵습니다.";
  }

  if (
    resolvedIntent === SALES_DIRECTOR_JUDGMENT_INTENTS.PREMIUM_INTERPRETATION &&
    !(factBundle.premium_stats?.premiumKnownCount > 0 && factBundle.premium_stats?.premiumTotal > 0)
  ) {
    return "월 납입액이 모든 계약에서 확인되지는 않았습니다.";
  }

  if (/암|실손|운전자/.test(question)) {
    return "상품명·가입 목록만으로는 세부 담보·한도까지는 확인 전입니다.";
  }

  if (evidence.has_coverage_analysis) {
    return "세부 담보·한도는 이 범위 밖입니다.";
  }

  if (evidence.has_policies) {
    return "담보 구조와 한도까지는 이 정보만으로는 확인 전입니다.";
  }

  return "지금 알 수 있는 범위와 모르는 범위를 나눠 두는 편이 낫습니다.";
}

function isKeyCoveragePresenceOnlyQuestion(question = "", factBundle = {}) {
  const q = normalizeText(question);
  if (/부족|충분|괜찮|모자|공백|갭/.test(q)) return false;

  const classification = classifyConsultationIntent(q);
  if (classification.lookup_sub_intent === "coverage_presence") return true;

  return /(?:암|실손|운전자|뇌|심)[^\n]{0,12}(?:보장|담보|보험)?[^\n]{0,10}(?:있(?:어|나|음|습)?|가입|들어|보유|돼|되어)/.test(
    q,
  );
}

function buildKeyJudgmentBlock(resolvedIntent = null, humanFrame = {}, factBundle = {}) {
  const question = humanFrame.surface_question ?? factBundle.question ?? "";
  const evidence = extractFactBundleEvidence(factBundle);
  const policyCount = resolveKeyFactBundlePolicyCount(factBundle);
  const classificationIntent =
    factBundle.classification_intent ?? classifyConsultationIntent(question).intent ?? "";

  const ruleJudgment = buildKeyJudgmentFromRules({
    question,
    resolvedIntent,
    classificationIntent,
    factBundle,
    humanFrame,
  });
  if (ruleJudgment) {
    return ruleJudgment;
  }

  if (policyCount === 0 && !evidence.has_policies) {
    return "등록된 가입 보험이 아직 없습니다.";
  }

  if (resolvedIntent === SALES_DIRECTOR_JUDGMENT_INTENTS.PREMIUM_INTERPRETATION) {
    return "보험료 부담이 실제로 큰지는, 총액과 항목별 비중을 나눠 봐야 합니다.";
  }

  if (/내\s*보험.*괜찮|보험.*괜찮|내\s*보장.*괜찮/.test(question)) {
    return "전체를 한 번에 괜찮다고 보기보다, 걱정 축부터 짚는 편이 맞습니다.";
  }

  if (/실손/.test(question) && evidence.gap_maintained?.includes("실손")) {
    return "실손 관련 가입은 보이고, 저장된 분석에서도 유지 축으로 보입니다.";
  }

  if (isKeyCoveragePresenceOnlyQuestion(question, factBundle)) {
    if (policyCount === 0 || !evidence.has_policies) {
      return "지금은 등록된 가입 보험 정보를 찾지 못했어요.";
    }
    return "가입된 보험이 있는 것은 확인돼요.";
  }

  if (/암/.test(question) || evidence.policy_absent_categories?.includes("암")) {
    return "지금 자료만으로는 암 담보 충분 여부를 단정하기 어렵습니다.";
  }

  if (resolvedIntent === SALES_DIRECTOR_JUDGMENT_INTENTS.COVERAGE_JUDGMENT) {
    return "지금 자료만으로는 이 축의 보장 충분 여부를 단정하기 어렵습니다.";
  }

  return KEY_GENERIC_FILLER_JUDGMENT;
}

function enforceKeyJudgmentFirst(judgment = "") {
  const trimmed = normalizeText(judgment);
  if (!trimmed || !KEY_LIMITATION_OPENING_RE.test(trimmed)) {
    return trimmed;
  }
  return "지금 확인된 범위부터 같이 보면 됩니다.";
}

export function enforceKeyDeclarativeEnding(text = "", mainBlocker = "") {
  let cleaned = normalizeText(text);
  if (!cleaned || !KEY_QUESTION_ENDING_RE.test(cleaned)) {
    return cleaned;
  }

  const nextAction = buildKeyNextActionBlock(mainBlocker);
  const sentences = cleaned.split(/(?<=[.!?])\s+/).filter(Boolean);
  if (sentences.length <= 1) {
    return nextAction;
  }

  const trimmed = sentences.slice(0, -1).join(" ");
  return normalizeText(`${trimmed} ${nextAction}`);
}

export function isKeyAnalysisStatusQuestion(question = "") {
  const q = normalizeQuestion(question);
  if (!q || !/분석/.test(q)) return false;
  if (KEY_ANALYSIS_REQUEST_RE.test(q)) return false;
  return KEY_ANALYSIS_STATUS_QUESTION_RE.test(q);
}

export function buildKeyAnalysisStatusResponse(factBundle = {}, question = "") {
  const evidence = extractFactBundleEvidence(factBundle);
  const hasAnalysis =
    factBundle.has_stored_coverage_analysis === true ||
    factBundle.coverage_gap_used === true ||
    evidence.has_coverage_analysis;

  if (hasAnalysis) {
    return normalizeText(
      pickVariant(question || factBundle.question || "", [
        "저장된 보장 분석 결과는 확인됐어요. 이어서 궁금한 축부터 같이 보면 됩니다.",
        "보장 분석 자료는 저장돼 있어요. 지금 걸리는 부분부터 짚어도 됩니다.",
      ]),
    );
  }

  const policyCount = resolveKeyFactBundlePolicyCount(factBundle);
  if (policyCount === 0 || !evidence.has_policies) {
    return normalizeText(
      `아직 등록된 가입 보험이 없어서, 분석을 시작하기 어렵습니다. ${KEY_DECLARATIVE_NEXT_ACTIONS.information_gap}`,
    );
  }

  return normalizeText(
    `가입 보험은 보이는데, 보장 분석 결과는 아직 같이 볼 단계예요. ${KEY_DECLARATIVE_NEXT_ACTIONS.information_gap}`,
  );
}

export {
  isKeyClosingTurn,
  isKeySocialTurn,
  buildKeyClosingResponse,
  KEY_CONVERSATION_PATTERNS,
  matchKeyConversationPattern,
} from "./keyConversationPatterns.js";

export { KEY_JUDGMENT_RULES, resolveKeyJudgmentRule, buildKeyJudgmentFromRules } from "./keyJudgmentRules.js";

export function shouldUseKeyRelationalCompose({
  question = "",
  classificationIntent = "",
  factBundle = {},
  humanFrame = {},
} = {}) {
  if (resolveToolBrainFixedSlice(factBundle)) return false;

  const q = normalizeQuestion(question || humanFrame.surface_question || factBundle.question || "");
  if (!q) return false;
  if (humanFrame.needs_insurance_tools) return false;
  if (INSURANCE_TOPIC.test(q)) return false;
  if (isKeySocialTurn(q)) return false;

  if (humanFrame.is_trust_human_question) return true;
  if (classificationIntent === "casual_chat") return true;
  if (KEY_RELATIONAL_LIFE_SIGNAL.test(q)) return true;

  return false;
}

export function buildKeyRelationalResponse(humanFrame = {}, question = "") {
  if (humanFrame.is_trust_human_question) {
    return buildTrustResponse(humanFrame);
  }

  const q = normalizeQuestion(question || humanFrame.surface_question || "");

  if (/피곤|지쳤|힘들/.test(q)) {
    return normalizeText(
      pickVariant(q, [
        "요즘 많이 피곤하시겠어요. 무리하고 계신 건 아닌지 먼저 짚어보면 좋겠어요.",
        "많이 지치신 것 같아요. 편하실 때 이어가도 됩니다.",
      ]),
    );
  }

  if (/아버지|어머니|배우자|가족|아이|자녀/.test(q) && /편찮|아프|수술|입원|병원/.test(q)) {
    return normalizeText(
      pickVariant(q, [
        "가족 걱정이 크시겠어요. 지금 상황부터 천천히 같이 정리해도 됩니다.",
        "힘드신 상황이시겠어요. 지금은 상황부터 같이 짚어도 됩니다.",
      ]),
    );
  }

  return normalizeText(
    [
      humanFrame.recommended_first_sentence,
      pickVariant(q, [
        "지금은 판단보다 이야기부터 같이 해도 됩니다.",
        "천천히 맞춰가면 됩니다.",
      ]),
    ]
      .filter(Boolean)
      .join(" "),
  );
}

/**
 * P10-1 KEY compose — judgment → evidence → limitation → next action.
 */
export function buildKeyStructuredResponse(
  humanFrame = {},
  basisTaggedFacts = {},
  factBundle = {},
  { resolvedIntent = null } = {},
  options = {},
) {
  const fixedSlice = resolveToolBrainFixedSlice(factBundle);
  if (fixedSlice) {
    return buildKeyToolBrainFixedResponse(fixedSlice, factBundle, humanFrame);
  }

  const intent = resolvedIntent ?? humanFrame.resolved_intent;
  const question = humanFrame.surface_question ?? factBundle.question ?? "";
  const classificationIntent =
    factBundle.classification_intent ?? classifyConsultationIntent(question).intent ?? "";
  const judgment = enforceKeyJudgmentFirst(
    buildKeyJudgmentBlock(intent, humanFrame, factBundle),
  );
  let evidence = buildKeyEvidenceBlock(basisTaggedFacts, options);
  let limitation = buildKeyLimitationBlock(intent, factBundle, basisTaggedFacts);
  let nextAction = buildKeyNextActionBlock(humanFrame.main_blocker, intent);

  const activeJudgmentRule = resolveKeyJudgmentRule({
    question,
    resolvedIntent: intent,
    classificationIntent,
    factBundle,
    humanFrame,
  });
  if (activeJudgmentRule?.id === "memory_recall_judgment") {
    const facts = resolveMemoryFactsFromBundle(factBundle);
    const confidence = resolveMemoryConfidenceLevel(facts);

    evidence = "";
    if (confidence === "confirmed") {
      limitation = "세부 표현까지는 대화마다 달라질 수 있어요.";
      nextAction = "그 맥락으로 이어가 주시면, 같이 볼게요.";
    } else if (confidence === "theme_only") {
      limitation = "구체적 표현까지는 단정하지 않을게요.";
      nextAction = "지금 걸리는 부분부터 말씀해 주시면, 그 흐름으로 같이 볼게요.";
    } else {
      limitation = "대화는 이어가고 있지만, 저장된 기억은 아직 확인되지 않았어요.";
      nextAction = "지금 걸리는 부분부터 적어 주셔도 돼요. 그 기준으로 같이 정리해 드릴게요.";
    }
  } else if (activeJudgmentRule?.id === "claim_documents_judgment") {
    const policies = factBundle.policies ?? [];
    const count =
      typeof factBundle.policy_count === "number"
        ? factBundle.policy_count
        : policies.length;
    const topic = detectClaimTopic(question);

    if (count === 0 && policies.length === 0) {
      limitation = "보험 정보를 저장해 주시면 같이 확인해 볼게요.";
      nextAction = buildKeyNextActionBlock("information_gap");
    } else {
      evidence = "";
      limitation = "상품별로 추가 서류가 더 필요할 수 있습니다.";
      if (topic.topicKey) {
        nextAction = "서류 준비되시면 알려 주세요. 그걸 기준으로 다음 단계를 같이 볼게요.";
      } else {
        nextAction =
          "어떤 사고·치료인지 먼저 알려 주시면, 필요 서류를 맞춰서 정리해 드릴게요.";
      }
    }
  } else if (activeJudgmentRule?.id === "claim_amount_lookup_judgment") {
    const policies = factBundle.policies ?? [];
    const count =
      typeof factBundle.policy_count === "number"
        ? factBundle.policy_count
        : policies.length;
    const amounts = [];
    for (const policy of policies) {
      for (const item of policy.coverage_summary?.riders ?? []) {
        if (!item || typeof item !== "object") continue;
        const raw = item.amount ?? item.coverage_amount ?? item.coverageAmount;
        if (raw != null && raw !== "") amounts.push(raw);
      }
    }
    const hasConfirmedAmount = amounts.length > 0;

    if (count === 0 && policies.length === 0) {
      limitation = "보험 정보를 저장해 주시면 같이 확인해 볼게요.";
      nextAction = buildKeyNextActionBlock("information_gap");
    } else if (hasConfirmedAmount) {
      evidence = "";
      limitation = "가입금액과 실제 지급액은 다를 수 있습니다.";
      nextAction =
        "서류와 진단 내용을 함께 보면, 지급 범위를 더 정리해 드릴게요.";
    } else {
      evidence = "";
      limitation = "약관·심사 결과에 따라 달라질 수 있습니다.";
      nextAction = buildKeyNextActionBlock("information_gap");
    }
  } else if (activeJudgmentRule?.id === "claim_timing_lookup_judgment") {
    const policies = factBundle.policies ?? [];
    const count =
      typeof factBundle.policy_count === "number"
        ? factBundle.policy_count
        : policies.length;

    if (count === 0 && policies.length === 0) {
      limitation = "보험 정보를 저장해 주시면 같이 확인해 볼게요.";
      nextAction = buildKeyNextActionBlock("information_gap");
    } else {
      evidence = "";
      limitation = "보험사·상품별로 심사 기간이 다를 수 있습니다.";
      nextAction =
        "서류 준비되시면 알려 주세요. 심사 전후 일정을 같이 확인해 볼게요.";
    }
  } else if (activeJudgmentRule?.id === "claim_eligibility_judgment") {
    const policies = factBundle.policies ?? [];
    const count =
      typeof factBundle.policy_count === "number"
        ? factBundle.policy_count
        : policies.length;
    const topic = detectClaimTopic(question);
    const policyMatch = findRelevantPolicies(policies, topic);

    if (count === 0 && policies.length === 0) {
      limitation = "보험 정보를 저장해 주시면 같이 확인해 볼게요.";
      nextAction = buildKeyNextActionBlock("information_gap");
    } else {
      evidence = "";
      limitation = "최종 지급 여부는 약관·서류·보험사 심사에 따라 달라질 수 있습니다.";
      if (topic.topicKey && !policyMatch.found) {
        nextAction = buildKeyNextActionBlock("information_gap");
      } else if (!topic.topicKey) {
        nextAction = buildKeyNextActionBlock("claim_uncertainty");
      } else {
        nextAction = "";
      }
    }
  } else if (activeJudgmentRule?.id === "claim_filing_judgment") {
    const policies = factBundle.policies ?? [];
    const count =
      typeof factBundle.policy_count === "number"
        ? factBundle.policy_count
        : policies.length;
    const topic = detectClaimTopic(question);
    const policyMatch = findRelevantPolicies(policies, topic);

    if (count === 0 && policies.length === 0) {
      limitation = "보험 정보를 저장해 주시면 같이 확인해 볼게요.";
      nextAction = buildKeyNextActionBlock("information_gap");
    } else {
      evidence = "";
      limitation = "최종 접수·지급 여부는 약관·서류·보험사 심사에 따라 달라질 수 있습니다.";
      if (topic.topicKey && !policyMatch.found) {
        nextAction = buildKeyNextActionBlock("information_gap");
      } else if (!topic.topicKey) {
        nextAction = buildKeyNextActionBlock("claim_uncertainty");
      } else {
        nextAction = "";
      }
    }
  } else if (activeJudgmentRule?.id === "underwriting_bound_judgment") {
    evidence = "";
    if (
      factBundle.underwriting_used === true ||
      factBundle.has_stored_underwriting_analysis === true
    ) {
      limitation = "최종 인수 결과는 보험사·상품별 심사에 따라 달라질 수 있습니다.";
      nextAction = "";
    } else {
      limitation = "저장된 인수심사 분석이 아직 없어, 건강 관련 확인부터 필요합니다.";
      nextAction = buildKeyNextActionBlock("information_gap");
    }
  } else if (activeJudgmentRule?.id === "recommendation_priority_judgment") {
    evidence = "";
    if (
      factBundle.recommendation_used === true ||
      factBundle.has_stored_recommendation_analysis === true
    ) {
      limitation = "특정 상품 가입을 단정하거나 권유드리기는 어렵습니다.";
      nextAction = "";
    } else {
      limitation = "저장된 우선순위 분석이 아직 없어, 보장 구조부터 같이 보면 됩니다.";
      nextAction = buildKeyNextActionBlock("information_gap");
    }
  } else if (activeJudgmentRule?.id === "design_priority_judgment") {
    evidence = "";
    if (factBundle.design_used === true || factBundle.has_stored_design_analysis === true) {
      limitation =
        "본 설계안은 초안이며, 특정 상품 가입이나 최종 보험료·인수 결과를 확정하지 않습니다.";
      nextAction = "";
    } else {
      limitation = "저장된 설계 분석이 아직 없어, 보장 구조부터 같이 보면 됩니다.";
      nextAction = buildKeyNextActionBlock("information_gap");
    }
  } else if (activeJudgmentRule?.id === "design_review_judgment") {
    evidence = "";
    if (factBundle.design_used === true || factBundle.has_stored_design_analysis === true) {
      limitation =
        "본 설계안은 초안이며, 담보·한도·인수 결과까지는 같이 확인해야 합니다.";
      nextAction = "";
    } else {
      limitation = "저장된 설계안이 아직 없어, 현재 보유 계약부터 같이 정리하면 됩니다.";
      nextAction = buildKeyNextActionBlock("information_gap");
    }
  } else if (activeJudgmentRule?.id === "premium_lookup_judgment") {
    const stats = factBundle.premium_stats ?? {};
    const premiumKnown = (stats.premiumKnownCount ?? 0) > 0 && (stats.premiumTotal ?? 0) > 0;
    if (premiumKnown) {
      evidence = "";
    } else {
      limitation = "월 납입액이 모든 계약에서 확인되지는 않았습니다.";
      nextAction = buildKeyNextActionBlock("information_gap");
    }
  } else if (activeJudgmentRule?.id === "policy_count_lookup_judgment") {
    const count =
      typeof factBundle.policy_count === "number"
        ? factBundle.policy_count
        : Array.isArray(factBundle.policies)
          ? factBundle.policies.length
          : 0;
    if (count > 0) {
      evidence = "";
      limitation = "세부 담보·한도까지는 이 정보 밖입니다.";
    } else {
      limitation = "보험 정보를 저장해 주시면 같이 확인해 볼게요.";
      nextAction = buildKeyNextActionBlock("information_gap");
    }
  } else if (activeJudgmentRule?.id === "insurer_lookup_judgment") {
    const insurers = Array.from(
      new Set((factBundle.policies ?? []).map((policy) => policy.insurer_name).filter(Boolean)),
    );
    if (insurers.length > 0) {
      evidence = "";
      limitation = "상품별 세부 담보까지는 이 정보 밖입니다.";
    } else {
      limitation = "보험 정보를 저장해 주시면 같이 확인해 볼게요.";
      nextAction = buildKeyNextActionBlock("information_gap");
    }
  } else if (activeJudgmentRule?.id === "product_lookup_judgment") {
    const products = Array.from(
      new Set(
        (factBundle.policies ?? [])
          .map((policy) => policy.product_name ?? policy.product ?? "")
          .filter(Boolean),
      ),
    );
    if (products.length > 0) {
      evidence = "";
      limitation = "세부 담보·한도까지는 이 정보 밖입니다.";
    } else {
      limitation = "보험 정보를 저장해 주시면 같이 확인해 볼게요.";
      nextAction = buildKeyNextActionBlock("information_gap");
    }
  } else if (activeJudgmentRule?.id === "join_date_lookup_judgment") {
    const entries = (factBundle.policies ?? [])
      .map((policy) => {
        const raw = policy.effective_from ?? policy.contract_date ?? policy.start_date ?? null;
        if (raw == null || raw === "") return null;
        return raw;
      })
      .filter(Boolean);
    if (entries.length > 0) {
      evidence = "";
      limitation = "갱신·특약 변경일까지는 이 정보 밖입니다.";
    } else {
      limitation = "보험 정보를 저장해 주시면 같이 확인해 볼게요.";
      nextAction = buildKeyNextActionBlock("information_gap");
    }
  } else if (activeJudgmentRule?.id === "coverage_list_lookup_judgment") {
    const labels = [];
    for (const policy of factBundle.policies ?? []) {
      const riders = policy.coverage_summary?.riders;
      if (Array.isArray(riders)) {
        for (const item of riders) {
          const label =
            typeof item === "string"
              ? item.trim()
              : String(
                  item?.normalized_name ??
                    item?.name ??
                    item?.rider_name ??
                    item?.label ??
                    item?.coverage_line ??
                    "",
                ).trim();
          if (label) labels.push(label);
        }
      }
    }
    const hasCoverageFacts =
      labels.length > 0 ||
      (factBundle.policies ?? []).some((policy) =>
        Boolean(policy.product_name ?? policy.product),
      );
    if (hasCoverageFacts) {
      evidence = "";
      limitation = "한도·면책·세부 특약까지는 이 정보 밖입니다.";
      nextAction = "";
    } else {
      limitation = "보험 정보를 저장해 주시면 같이 확인해 볼게요.";
      nextAction = buildKeyNextActionBlock("information_gap");
    }
  }

  const parts = [judgment, evidence, limitation, nextAction].filter(Boolean);
  const joined = normalizeText(parts.join(" "));
  if (activeJudgmentRule?.id === "memory_recall_judgment") {
    return joined;
  }
  return enforceKeyDeclarativeEnding(joined, humanFrame.main_blocker);
}

function buildKeyStructuredResponseSafe(
  humanFrame,
  basisTaggedFacts,
  factBundle,
  { resolvedIntent = null } = {},
) {
  const fixedSlice = resolveToolBrainFixedSlice(factBundle);
  if (fixedSlice) {
    return buildKeyToolBrainFixedResponseSafe(fixedSlice, factBundle, humanFrame);
  }

  const reducedFacts = {
    ...basisTaggedFacts,
    surprising_insight:
      basisTaggedFacts.surprising_insight?.basis === STATEMENT_BASIS.INSIGHT
        ? null
        : basisTaggedFacts.surprising_insight,
  };
  return buildKeyStructuredResponse(humanFrame, reducedFacts, factBundle, { resolvedIntent }, {
    evidenceOnly: true,
  });
}

function normalizeQuestion(question = "") {
  return String(question ?? "").replace(/\s+/g, " ").trim();
}

function normalizeText(text = "") {
  return String(text ?? "").replace(/\s+/g, " ").trim();
}

function hashSeed(value = "") {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
  }
  return hash;
}

function pickVariant(question, variants = []) {
  if (!variants.length) return "";
  return variants[hashSeed(question) % variants.length];
}

export function isHumanTrustQuestion(question = "") {
  const q = normalizeQuestion(question);
  if (!q) return false;
  return TRUST_HUMAN_QUESTION_PATTERNS.some((pattern) => pattern.test(q));
}

export function shouldApplyHumanUnderstandingLoop(
  classificationIntent = "",
  question = "",
  { surface = null, homeBrainIntent = null, homeRoute = null, homeVerifiedIntents = null } = {},
) {
  const q = normalizeQuestion(question);
  if (!q) return false;

  const CASUAL_GREETING_RE =
    /^(?:하이|안녕(?:하세요|하십니까)?|헬로|hello|hi|ㅎㅇ|반가워요?|반갑습니다)(?:[!.?\s~♡♥]*)?$/i;
  const APP_HELP_RE = /(?:로그인|비밀번호|앱\s*오류|버그|장애|접속\s*안|회원가입|설정\s*어디)/i;

  if (CASUAL_GREETING_RE.test(q) || APP_HELP_RE.test(q)) return false;

  if (isHumanTrustQuestion(q)) return true;

  if (classificationIntent === "casual_chat" && !INSURANCE_TOPIC.test(q)) {
    return isHumanTrustQuestion(q);
  }

  if (classificationIntent === "policy_detail") return false;
  if (classificationIntent === "factual_lookup") {
    const resolved = resolveSalesDirectorJudgmentIntent(classificationIntent, q);
    return FACTUAL_LOOKUP_JUDGMENT_INTENTS.has(resolved);
  }

  if (surface === "home") {
    if (homeRoute === "casual_chat" && !INSURANCE_TOPIC.test(q) && !isHumanTrustQuestion(q)) {
      return false;
    }
    if (homeVerifiedIntents?.has?.(homeBrainIntent)) return false;
  }

  if (resolveSalesDirectorJudgmentIntent(classificationIntent, q)) return true;
  if (INSURANCE_TOPIC.test(q) && classificationIntent !== "casual_chat") return true;

  return false;
}

function inferHiddenQuestions(question = "", intent = null) {
  const q = normalizeQuestion(question);
  const hidden = [];

  if (/괜찮|충분|부족/.test(q)) {
    hidden.push("손해 보는 거 아니야?", "계속 유지해도 돼?", "불안한데 맞는 거야?");
  }
  if (/사고|받을|보험금|놓친/.test(q)) {
    hidden.push("돈 받을 수 있나?", "얼마나 받을까?", "내가 손해 안 볼까?");
  }
  if (/비싸|보험료|부담/.test(q)) {
    hidden.push("줄일 수 있나?", "필요 없는 보험을 들고 있나?");
  }
  if (/해지|유지/.test(q)) {
    hidden.push("지금 끊으면 손해?", "더 낼 필요 없나?");
  }
  if (isHumanTrustQuestion(q)) {
    hidden.push("믿어도 되나?", "시간 낭비 아닌가?", "지금 당장 뭘 해야 하나?");
  }
  if (/GPT|지피티/.test(q)) {
    hidden.push("그냥 GPT로 되는 거 아닌가?", "왜 여기서 해야 하나?");
  }
  if (/둘러|확인만|가입할\s*생각\s*없/.test(q)) {
    hidden.push("부담 없이 볼 수 있나?", "억지로 팔지 않나?");
  }

  if (!hidden.length && intent) {
    hidden.push("지금 뭐가 제일 걸리나?");
  }

  return [...new Set(hidden)].slice(0, 4);
}

function inferCustomerState(question = "", intent = null) {
  const q = normalizeQuestion(question);
  if (/사고|급|지금|당장/.test(q)) return "urgent";
  if (/믿|진짜|안전|정보\s*줘도/.test(q)) return "trust_check";
  if (/설계사|맞는지|의심|사기|속/.test(q)) return "skeptical";
  if (/괜찮|불안|걱정|부족|비싸/.test(q)) return "anxious";
  if (/둘러|확인만|가입할\s*생각\s*없/.test(q)) return "browsing";
  if (/뭐부터|모르겠|어려/.test(q)) return "confused";
  if (/해지|유지|고쳐|뭐부터/.test(q)) return "pre_decision";
  if (/중복|비교|GPT/.test(q)) return "comparing";
  if (/받을|놓친|보험금/.test(q)) return "urgent";
  if (intent) return "confirming";
  return "exploring";
}

function inferCustomerGoal(question = "") {
  const q = normalizeQuestion(question);
  if (/받을|보험금|놓친|사고/.test(q)) return "compensation";
  if (/괜찮|충분|부족|확인만|맞는지/.test(q)) return "confirmation";
  if (/비싸|보험료|절약|줄/.test(q)) return "savings";
  if (/해지|유지|고쳐|뭐부터/.test(q)) return "decision";
  if (/어려|모르겠|뭐부터|이해/.test(q)) return "understanding";
  if (/믿|안전|GPT|왜\s*써/.test(q)) return "trust";
  if (/둘러|가입할\s*생각\s*없/.test(q)) return "direction";
  if (/괜찮|불안/.test(q)) return "reassurance";
  return "information";
}

function inferMainBlocker(question = "", factBundle = {}) {
  const q = normalizeQuestion(question);
  const evidence = extractFactBundleEvidence(factBundle);

  if (/믿|안전|정보\s*줘도/.test(q)) return "trust_gap";
  if (/어려|모르겠|복잡/.test(q)) return "complexity";
  if (/비싸|부담/.test(q)) return "premium_burden";
  if (/사고|받을|놓친/.test(q)) return "claim_uncertainty";
  if (!evidence.has_coverage_analysis && evidence.has_policies && INSURANCE_TOPIC.test(q)) {
    return "information_gap";
  }
  if (/설계사|맞는지/.test(q)) return "trust_gap";
  if (/둘러|가입할\s*생각\s*없/.test(q)) return "decision_fatigue";
  return "uncertainty";
}

function inferNeedsInsuranceTools(question = "", classificationIntent = "", resolvedIntent = null) {
  if (isHumanTrustQuestion(question) && !INSURANCE_TOPIC.test(question)) return false;
  if (/GPT|둘러|믿|안전|PDF|가입할\s*생각\s*없|왜\s*써야|너무\s*어려|뭐부터\s*해야|모르겠/.test(question)) {
    return INSURANCE_TOPIC.test(question);
  }
  return Boolean(resolvedIntent) || INSURANCE_TOPIC.test(question);
}

function buildRecommendedFirstSentence(question = "", customerState = "", hiddenQuestions = []) {
  const q = normalizeQuestion(question);

  if (/괜찮/.test(q)) {
    return pickVariant(q, [
      "괜찮냐고 물으시는 분들은, 보통 안 괜찮아서 묻습니다.",
      "보험보다 먼저, 왜 갑자기 그게 걸리셨는지가 궁금합니다.",
      "괜찮은지 묻기 전에, 뭐가 불안한지부터 짚고 싶어요.",
    ]);
  }
  if (/사고|받을|보험금|놓친/.test(q)) {
    return pickVariant(q, [
      "지금 제일 급한 건 보험 이름이 아니라, 돈이 나올 수 있느냐죠.",
      "사고 얘기가 나오면, 대부분 '받을 수 있나'가 먼저입니다.",
    ]);
  }
  if (/비싸|보험료/.test(q)) {
    return pickVariant(q, [
      "비싸다고 느끼실 때는, 숫자보다 '왜 이만큼 나가지'가 먼저 걸립니다.",
      "보험료 얘기는 거의 항상 '손해 보는 구조인가'로 이어집니다.",
    ]);
  }
  if (/GPT|지피티/.test(q)) {
    return pickVariant(q, [
      "GPT는 뭐든 말해줍니다. 저는 당신 보험만큼은 기억하고 책임지려고 합니다.",
      "차이는 정보 양이 아니라, 당신 상황에 맞춰 말하느냐입니다.",
    ]);
  }
  if (/둘러|확인만/.test(q)) {
    return pickVariant(q, [
      "둘러보셔도 됩니다. 억지로 설명부터 시작하지 않을게요.",
      "가볍게 보셔도 돼요. 지금은 판단보다 감 잡기면 충분합니다.",
    ]);
  }
  if (/믿|안전|정보\s*줘도/.test(q)) {
    return pickVariant(q, [
      "믿을 수 있냐는 질문, 당연합니다.",
      "정보를 주기 전에 불안한 게 뭔지부터 맞춰볼게요.",
    ]);
  }
  if (/어려|모르겠|뭐부터/.test(q)) {
    return pickVariant(q, [
      "어렵게 느껴지는 게 정상이에요. 한 번에 다 보려 해서 그래요.",
      "뭐부터 해야 할지 모르겠다는 말, 제일 많이 듣습니다.",
    ]);
  }

  return pickVariant(q, [
    hiddenQuestions[0] ? `${hiddenQuestions[0].replace(/\?$/, "")} 쪽이 먼저 보입니다.` : "지금 질문 뒤에 다른 걱정이 하나 더 있어 보여요.",
    "보험 얘기 전에, 지금 상태부터 맞춰볼게요.",
  ]);
}

export function buildBasisTaggedFacts(factBundle = {}, intent = null) {
  return {
    risk: selectMostImportantRisk(factBundle, intent),
    opportunity: selectMostImportantOpportunity(factBundle, intent),
    surprising_insight: selectMostSurprisingInsight(factBundle, intent),
    evidence_summary: extractFactBundleEvidence(factBundle),
  };
}

export function buildHumanUnderstandingFrame({
  question = "",
  intent = null,
  surface = null,
  conversationContext = {},
  factBundle = {},
  basisTaggedFacts = {},
} = {}) {
  const q = normalizeQuestion(question);
  const resolvedIntent = intent ?? resolveSalesDirectorJudgmentIntent(conversationContext.classificationIntent ?? "", q);
  const hidden_question_candidates = inferHiddenQuestions(q, resolvedIntent);
  const customer_state = inferCustomerState(q, resolvedIntent);
  const customer_goal = inferCustomerGoal(q);
  const main_blocker = inferMainBlocker(q, factBundle);
  const needs_insurance_tools = inferNeedsInsuranceTools(
    q,
    conversationContext.classificationIntent ?? "",
    resolvedIntent,
  );

  const available_evidence = (basisTaggedFacts.evidence_summary
    ? Object.entries(basisTaggedFacts.evidence_summary)
        .filter(([, value]) => {
          if (Array.isArray(value)) return value.length > 0;
          if (typeof value === "boolean") return value;
          return Boolean(value);
        })
        .map(([key]) => key)
    : []);

  const allowed_insights = [
    basisTaggedFacts.surprising_insight,
    basisTaggedFacts.risk,
    basisTaggedFacts.opportunity,
  ]
    .filter((item) => item?.basis === STATEMENT_BASIS.INSIGHT)
    .map((item) => item.text)
    .filter(Boolean);

  const forbidden_assertions = [
    "근거 없는 암/실손/운전자 부족 단정",
    "100% 안전 / 무조건 수령 / 반드시 가능 / 절대 문제 없음",
    "없는 보장·금액·청구 가능성 단정",
    "자료 올려주세요 단독 응답",
  ];

  return {
    surface_question: q,
    hidden_question_candidates,
    customer_state,
    customer_goal,
    main_blocker,
    needs_insurance_tools,
    available_evidence,
    allowed_insights,
    forbidden_assertions,
    recommended_first_sentence: buildRecommendedFirstSentence(q, customer_state, hidden_question_candidates),
    resolved_intent: resolvedIntent,
    surface,
    is_trust_human_question: isHumanTrustQuestion(q),
    conversation_history: Array.isArray(conversationContext.history)
      ? conversationContext.history
      : [],
    classification_intent: conversationContext.classificationIntent ?? "",
  };
}

function naturalizeBasisItem(item = {}) {
  if (!item?.text) return null;
  const key = item.evidence_key ?? "";
  let text = item.text;

  if (item.basis === STATEMENT_BASIS.EVIDENCE) {
    if (
      key.startsWith("gap_shortage") ||
      key.startsWith("gap_concern") ||
      key.startsWith("gap_duplicate") ||
      key.startsWith("gap_maintained")
    ) {
      return text;
    }
    if (key.startsWith("policy_present")) {
      const label = key.split(":")[1] ?? "관련";
      return `${label} 계약은 보이는데, 한도와 특약까지는 같이 봐야 합니다.`;
    }
    if (key.startsWith("policy_absent")) {
      const label = key.split(":")[1] ?? "관련";
      return `목록에서는 ${label} 계약이 아직 안 보입니다.`;
    }
    if (key === "premium_stats") {
      return text;
    }
    text = text.replace(/확인된\s*자료\s*기준으로\s*/g, "지금 자료로 보면 ").replace(/신호가\s*있습니다/g, "여지가 있습니다");
  }

  text = text.replace(/보장내역\s*확인이\s*되면[^.!?]*[.!?]?/g, "구조가 더 보이면 우선순위를 바로 잡을 수 있습니다.");
  text = text.replace(/보장내역\s*확인이\s*필요합니다/g, "담보 구조까지는 같이 봐야 합니다");
  return text;
}

function buildTrustResponse(frame = {}) {
  const q = frame.surface_question ?? "";
  const parts = [frame.recommended_first_sentence];

  if (/GPT|지피티/.test(q)) {
    parts.push(
      "GPT는 일반 답변을 잘합니다. 저는 당신이 올린 보험·대화 맥락을 기억하고, 근거 없는 말은 하지 않으려 합니다.",
    );
  } else if (/정보\s*줘도\s*안전|내\s*정보/.test(q)) {
    parts.push(
      "정보는 필요한 만큼만 쓰고, 확인 없이 단정하거나 밖으로 새는 구조는 피하려 합니다.",
    );
  } else if (/PDF|올려야/.test(q)) {
    parts.push(
      "PDF는 더 정확히 볼 때 도움이 됩니다. 다만 지금 궁금한 게 뭔지 먼저 맞추고, 필요할 때만 요청드릴게요.",
    );
  } else if (/믿|진짜/.test(q)) {
    parts.push("믿음은 말로 사는 게 아니라, 틀린 말 안 하는 쪽에서 쌓인다고 봅니다.");
  } else if (/둘러|확인만|가입할\s*생각\s*없/.test(q)) {
    parts.push("지금은 가입 얘기까지 갈 필요 없어요. 궁금한 것만 같이 보면 됩니다.");
  } else if (/어려|모르겠|뭐부터/.test(q)) {
    parts.push("한 번에 다 정리하려 해서 더 어려워집니다. 지금 제일 걸리는 것 하나만 잡아도 됩니다.");
  } else if (/설계사.*맞는지/.test(q)) {
    parts.push("설계사 말이 맞는지보다, 지금 당신 상황에 필요한지가 먼저입니다.");
  } else {
    parts.push("보험 얘기는 그다음이고, 지금은 당신이 뭘 얻고 싶은지부터 맞춰볼게요.");
  }

  parts.push(pickVariant(q, [
    "제가 먼저 확인하고 싶은 게 하나 있습니다. 지금 제일 불편한 게 뭐예요?",
    "한 가지만 여쭤볼게요. 오늘은 확인이 목적인가요, 결정이 목적인가요?",
  ]));

  return normalizeText(parts.filter(Boolean).join(" "));
}

function buildDesignNaturalResponse(frame = {}) {
  const q = frame.surface_question ?? "";
  const parts = [
    pickVariant(q, [
      "설계부터 바로 들어가면, 오히려 더 헷갈릴 수 있어요.",
      "설계해달라는 말 뒤에는, 사실 뭐가 걸리는지가 먼저예요.",
    ]),
    "지금 자료만으로는 설계 방향을 단정하긴 어렵고, 보장 구조를 먼저 확인해야 합니다.",
    pickVariant(q, [
      "어떤 목표로 설계를 원하시는지 — 줄이기, 보완, 새로 정리 — 하나만 알려주시면 같이 보면 됩니다.",
      "예산과 목표를 맞춰 설계 초안을 정리하려면, 현재 보유 계약부터 같이 분석해야 합니다.",
    ]),
  ];
  return normalizeText(parts.filter(Boolean).join(" "));
}

function buildInsuranceNaturalResponse(frame = {}, basisTaggedFacts = {}, factBundle = {}) {
  const q = frame.surface_question ?? "";
  if (frame.resolved_intent === "design_question" || /설계/.test(q)) {
    return buildDesignNaturalResponse(frame);
  }

  const parts = [frame.recommended_first_sentence];

  if (frame.needs_insurance_tools) {
    const evidenceLines = [
      naturalizeBasisItem(basisTaggedFacts.risk),
      naturalizeBasisItem(basisTaggedFacts.opportunity),
    ].filter(Boolean);

    if (basisTaggedFacts.surprising_insight?.basis === STATEMENT_BASIS.EVIDENCE) {
      evidenceLines.unshift(naturalizeBasisItem(basisTaggedFacts.surprising_insight));
    }

    for (const line of evidenceLines.slice(0, 2)) {
      parts.push(line);
    }

    if (basisTaggedFacts.surprising_insight?.basis === STATEMENT_BASIS.INSIGHT) {
      const insight = naturalizeBasisItem(basisTaggedFacts.surprising_insight);
      if (insight) parts.push(insight);
    }
  } else if (!frame.is_trust_human_question) {
    const insight = naturalizeBasisItem(basisTaggedFacts.surprising_insight);
    if (insight && basisTaggedFacts.surprising_insight?.basis === STATEMENT_BASIS.INSIGHT) {
      parts.push(insight);
    }
  }

  const nextActions = {
    premium_burden: "가장 부담되는 보험료가 어디서 나오는지부터 같이 보면, 줄일지 유지할지 순서가 보입니다.",
    claim_uncertainty: "어떤 사고·치료였는지만 알려주시면, 열려 있는 축부터 같이 볼게요.",
    information_gap: "제가 먼저 확인하고 싶은 게 하나 있습니다. 지금 제일 불안한 축이 뭐예요?",
    trust_gap: "한 가지만 여쭤볼게요. 지금은 확인이 목적인가요, 결정이 목적인가요?",
    default: "걱정되는 축 하나만 먼저 짚고, 같이 보면 됩니다.",
  };

  parts.push(nextActions[frame.main_blocker] ?? nextActions.default);

  return normalizeText(parts.filter(Boolean).join(" "));
}

export function detectForbiddenOutputPatterns(text = "") {
  const normalized = normalizeText(text);
  const hits = [];
  for (const rule of P9_2_FORBIDDEN_OUTPUT_PATTERNS) {
    if (rule.pattern.test(normalized)) {
      hits.push(rule.id);
    }
  }
  for (const pattern of UNBREAKABLE_PROMISE_PATTERNS) {
    if (pattern.test(normalized)) {
      hits.push("unbreakable_promise");
      break;
    }
  }
  return {
    pass: hits.length === 0,
    hits,
  };
}

function scrubForbiddenOutput(text = "") {
  let cleaned = normalizeText(text);
  cleaned = cleaned.replace(/가장\s*큰\s*위험\s*:/gi, "");
  cleaned = cleaned.replace(/가장\s*큰\s*기회\s*:/gi, "");
  cleaned = cleaned.replace(/부족\s*신호가\s*있습니다/g, "여유가 부족해 보입니다");
  cleaned = cleaned.replace(/유지\s*신호가\s*있/g, "유지하는 축으로 보");
  cleaned = cleaned.replace(/보험을\s*안\s*챙긴\s*분은\s*아닙니다\.?\s*/g, "");
  cleaned = cleaned.replace(/확인된\s*자료\s*기준으로\s*/g, "지금 자료로 보면 ");
  cleaned = cleaned.replace(/표면\s*질문\s*뒤(?:에는|에)[^.!?]*[.!?]?\s*/g, "");
  cleaned = cleaned.replace(/\s{2,}/g, " ").trim();
  return cleaned;
}

export function generateHumanSalesDirectorResponse({
  humanFrame = {},
  basisTaggedFacts = {},
  rawToolFacts = "",
  guardrails = {},
  question = "",
  intent = null,
  factBundle = {},
  classificationIntent = "",
} = {}) {
  const useKeyOrchestrator = shouldUseKeyOrchestratorCompose(guardrails, factBundle);
  const resolvedIntent = intent ?? humanFrame.resolved_intent;

  let keyComposeTrace = {
    called: false,
    skip_reason: useKeyOrchestrator ? null : "key_orchestrator_compose_not_selected",
    text_preview: "",
    used_safe_fallback: false,
    compose_mode: null,
    absorbed_slice: null,
  };

  const resolvedClassificationIntent =
    classificationIntent || factBundle.classification_intent || "";

  let text;
  if (useKeyOrchestrator) {
    const fixedSlice = resolveToolBrainFixedSlice(factBundle);
    const useContinuityCompanion =
      !fixedSlice &&
      shouldUseContinuityCompanionCompose({
        question,
        factBundle,
        humanFrame,
      });
    const timeContinuityCandidate =
      !fixedSlice &&
      !useContinuityCompanion &&
      shouldUsePersonalTimeContinuityCompose({
        question: question || factBundle.question || "",
        humanFrame,
        classificationIntent: resolvedClassificationIntent,
        factBundle,
      });
    let timeContinuityText = null;
    if (timeContinuityCandidate) {
      const candidate = buildPersonalTimeContinuityResponse({
        question: question || factBundle.question || "",
        humanFrame,
      });
      if (hasTimeContinuityUsedSignal(candidate)) {
        timeContinuityText = candidate;
      }
    }
    const useTimeContinuity = Boolean(timeContinuityText);
    const useAnalysisStatus =
      !fixedSlice &&
      !useContinuityCompanion &&
      !useTimeContinuity &&
      isKeyAnalysisStatusQuestion(question || factBundle.question || "");
    const useSocial =
      !fixedSlice &&
      !useContinuityCompanion &&
      !useTimeContinuity &&
      !useAnalysisStatus &&
      isKeySocialTurn(question || factBundle.question || "");
    const socialPattern = useSocial
      ? resolveKeySocialConversationPattern(question || factBundle.question || "")
      : null;
    const useClosing =
      !fixedSlice &&
      !useContinuityCompanion &&
      !useTimeContinuity &&
      !useAnalysisStatus &&
      !useSocial &&
      isKeyClosingTurn(question || factBundle.question || "");
    const closingPattern = useClosing
      ? resolveKeyClosingConversationPattern(question || factBundle.question || "")
      : null;
    const useRelational =
      !fixedSlice &&
      !useContinuityCompanion &&
      !useTimeContinuity &&
      !useAnalysisStatus &&
      !useSocial &&
      !useClosing &&
      shouldUseKeyRelationalCompose({
        question,
        classificationIntent: resolvedClassificationIntent,
        factBundle,
        humanFrame,
      });
    const useCompanionGuidance =
      !useContinuityCompanion &&
      !useTimeContinuity &&
      !useAnalysisStatus &&
      !useSocial &&
      !useClosing &&
      !useRelational &&
      shouldUseKeyCompanionGuidanceCompose({
        question,
        factBundle,
        humanFrame,
        fixedSlice,
      });
    text = useContinuityCompanion
      ? buildContinuityCompanionResponse({ question, factBundle, humanFrame })
      : useTimeContinuity
      ? timeContinuityText
      : useAnalysisStatus
        ? buildKeyAnalysisStatusResponse(factBundle, question)
        : useSocial
          ? (socialPattern?.text ?? normalizeText("안녕하세요. 편하실 때 이어가도 됩니다."))
          : useClosing
            ? (closingPattern?.text ?? buildKeyClosingResponse(question))
            : useRelational
              ? buildKeyRelationalResponse(humanFrame, question)
              : useCompanionGuidance
                ? buildKeyCompanionGuidanceResponse({ question, factBundle, humanFrame })
                : buildKeyStructuredResponse(humanFrame, basisTaggedFacts, factBundle, { resolvedIntent });
    keyComposeTrace = {
      called: true,
      skip_reason: null,
      text_preview: String(text ?? "").slice(0, 300),
      used_safe_fallback: false,
      compose_mode: useContinuityCompanion
        ? "continuity_companion_bridge"
        : useTimeContinuity
        ? "time_continuity"
        : useAnalysisStatus
          ? "key_analysis_status"
          : useSocial
            ? "key_social"
            : useClosing
              ? "key_closing"
              : useRelational
                ? "key_relational"
                : useCompanionGuidance
                  ? "key_companion_guidance"
                  : fixedSlice
                    ? "tool_brain_fixed_slots"
                    : "key_structured",
      time_continuity_used: useTimeContinuity,
      absorbed_slice: fixedSlice,
      conversation_pattern_id: socialPattern?.pattern_id ?? closingPattern?.pattern_id ?? null,
      conversation_pattern_kind: socialPattern?.kind ?? closingPattern?.kind ?? null,
    };
  } else {
    text =
      humanFrame.is_trust_human_question && !humanFrame.needs_insurance_tools
        ? buildTrustResponse(humanFrame)
        : buildInsuranceNaturalResponse(humanFrame, basisTaggedFacts, factBundle);
  }

  if (
    !useKeyOrchestrator &&
    guardrails.strip_raw_listing !== false &&
    /^현재\s*\d+\s*건/.test(text)
  ) {
    text = buildInsuranceNaturalResponse(humanFrame, basisTaggedFacts, factBundle);
  }

  text = polishHumanOutput(text);

  const assertionBundle =
    humanFrame.is_trust_human_question && !humanFrame.needs_insurance_tools && !useKeyOrchestrator
      ? {
          question: factBundle.question ?? humanFrame.surface_question,
          active_policy_count: factBundle.active_policy_count ?? null,
          active_policy_count_source: factBundle.active_policy_count_source ?? null,
          active_policy_ids: factBundle.active_policy_ids ?? null,
          policy_count: resolveKeyFactBundlePolicyCount(factBundle),
          policies: [],
        }
      : factBundle;

  if (detectFalseAssertions(text, assertionBundle)) {
    if (useKeyOrchestrator) {
      text = polishHumanOutput(
        shouldUseToolBrainFixedSlots(factBundle)
          ? buildKeyToolBrainFixedResponseSafe(
              resolveToolBrainFixedSlice(factBundle),
              factBundle,
              humanFrame,
            )
          : isKeyAnalysisStatusQuestion(question || factBundle.question || "")
            ? buildKeyAnalysisStatusResponse(factBundle, question)
            : isKeySocialTurn(question || factBundle.question || "")
              ? (resolveKeySocialConversationPattern(question || factBundle.question || "")?.text ??
                  normalizeText("안녕하세요. 편하실 때 이어가도 됩니다."))
              : isKeyClosingTurn(question || factBundle.question || "")
                ? buildKeyClosingResponse(question)
                : shouldUseContinuityCompanionCompose({
                      question,
                      factBundle,
                      humanFrame,
                    })
                  ? buildContinuityCompanionResponse({ question, factBundle, humanFrame })
                  : shouldUseKeyRelationalCompose({
                      question,
                      classificationIntent: resolvedClassificationIntent,
                      factBundle,
                      humanFrame,
                    })
                  ? buildKeyRelationalResponse(humanFrame, question)
                  : shouldUseKeyCompanionGuidanceCompose({
                        question,
                        factBundle,
                        humanFrame,
                        fixedSlice: resolveToolBrainFixedSlice(factBundle),
                      })
                    ? buildKeyCompanionGuidanceResponse({ question, factBundle, humanFrame })
                    : buildKeyStructuredResponseSafe(humanFrame, basisTaggedFacts, factBundle, {
                        resolvedIntent,
                      }),
      );
      keyComposeTrace.used_safe_fallback = true;
      keyComposeTrace.text_preview = String(text ?? "").slice(0, 300);
    } else if (humanFrame.is_trust_human_question && !humanFrame.needs_insurance_tools) {
      text = polishHumanOutput(buildTrustResponse(humanFrame));
    } else {
      text = polishHumanOutput(
        buildInsuranceNaturalResponse(humanFrame, basisTaggedFacts, factBundle),
      );
    }
  }

  let generation_mode = "insurance_human";
  if (useKeyOrchestrator) {
    generation_mode = "key_orchestrator";
  } else if (humanFrame.is_trust_human_question && !humanFrame.needs_insurance_tools) {
    generation_mode = "trust_human";
  }

  return {
    text: normalizeText(text),
    forbidden_pattern_scan: detectForbiddenOutputPatterns(text),
    generation_mode,
    intent: resolvedIntent,
    key_compose_trace: keyComposeTrace,
  };
}

function polishHumanOutput(text = "") {
  let cleaned = scrubForbiddenOutput(text);
  cleaned = cleaned.replace(/보장내역\s*확인이\s*되면[^.!?]*[.!?]?/g, "");
  cleaned = cleaned.replace(/\s{2,}/g, " ").trim();
  return cleaned;
}

export function shouldPreserveFactualLookupFreeThinkingAnswer({
  classificationIntent = "",
  question = "",
  rawText = "",
  responseSource = null,
  freeThinking = null,
} = {}) {
  if (classificationIntent !== "factual_lookup") return false;
  if (responseSource !== "sales_director_free_thinking") return false;
  if (freeThinking?.status !== "p6_2b_3" || freeThinking?.source !== "claude") return false;

  const consultation = classifyConsultationIntent(question);
  if (consultation.lookup_sub_intent !== "coverage_presence") return false;

  const text = String(rawText ?? "").trim();
  if (!text) return false;
  if (violatesManualTemplate(text)) return false;
  if (hasFreeThinkingQualities(text)) return true;
  if (hasCoveragePresenceFactualAnswer(text)) return true;

  return false;
}

function resolveCoveragePresencePreservePath(text = "") {
  if (hasFreeThinkingQualities(text)) return "free_thinking_qualities";
  if (hasCoveragePresenceFactualAnswer(text)) return "coverage_presence_factual";
  return null;
}

/**
 * P10-3E READ ONLY runtime trace — preserve gate diagnostics (no answer logic change).
 */
export function buildPreserveGateRuntimeTrace({
  classificationIntent = "",
  question = "",
  rawText = "",
  responseSource = null,
  freeThinking = null,
  finalText = "",
  hulOverwriteEntered = false,
} = {}) {
  const consultation = classifyConsultationIntent(question);
  const text = String(rawText ?? "").trim();
  const violatesManualTemplateResult = violatesManualTemplate(text);
  const hasFreeThinkingQualitiesResult = hasFreeThinkingQualities(text);
  const hasCoveragePresenceFactualAnswerResult = hasCoveragePresenceFactualAnswer(text);
  const genericHulIntroBlocked = isGenericHulCounselingIntro(text);
  const preservePath = resolveCoveragePresencePreservePath(text);
  const shouldPreserve = shouldPreserveFactualLookupFreeThinkingAnswer({
    classificationIntent,
    question,
    rawText,
    responseSource,
    freeThinking,
  });

  const failedConditions = [];
  if (classificationIntent !== "factual_lookup") {
    failedConditions.push("classificationIntent !== factual_lookup");
  }
  if (responseSource !== "sales_director_free_thinking") {
    failedConditions.push("responseSource !== sales_director_free_thinking");
  }
  if (freeThinking?.status !== "p6_2b_3") {
    failedConditions.push("freeThinking.status !== p6_2b_3");
  }
  if (freeThinking?.source !== "claude") {
    failedConditions.push("freeThinking.source !== claude");
  }
  if (consultation.lookup_sub_intent !== "coverage_presence") {
    failedConditions.push("lookup_sub_intent !== coverage_presence");
  }
  if (!text) {
    failedConditions.push("rawText empty");
  }
  if (violatesManualTemplateResult) {
    failedConditions.push("violatesManualTemplate === true");
  }
  if (genericHulIntroBlocked) {
    failedConditions.push("isGenericHulCounselingIntro === true");
  }
  if (!hasFreeThinkingQualitiesResult && !hasCoveragePresenceFactualAnswerResult) {
    failedConditions.push("hasFreeThinkingQualities === false");
    failedConditions.push("hasCoveragePresenceFactualAnswer === false");
  }

  return {
    audit: "p10_3f_preserve_gate",
    read_only: true,
    classificationIntent,
    lookup_sub_intent: consultation.lookup_sub_intent ?? null,
    lookup_category: consultation.lookup_category ?? null,
    responseSource: responseSource ?? null,
    freeThinking_status: freeThinking?.status ?? null,
    freeThinking_source: freeThinking?.source ?? null,
    freeThinking_rawText_preview: text.slice(0, 300),
    violatesManualTemplate: violatesManualTemplateResult,
    hasFreeThinkingQualities: hasFreeThinkingQualitiesResult,
    hasCoveragePresenceFactualAnswer: hasCoveragePresenceFactualAnswerResult,
    is_generic_hul_intro_blocked: genericHulIntroBlocked,
    preserve_path: preservePath,
    shouldPreserveFactualLookupFreeThinkingAnswer: shouldPreserve,
    failed_conditions: failedConditions,
    hul_overwrite_entered: hulOverwriteEntered,
    final_text_preview: String(finalText ?? "").slice(0, 300),
  };
}

export function finalizeHumanSalesDirectorResponse(input = {}) {
  const question = normalizeQuestion(input.factBundle?.question ?? input.customerState?.question ?? input.question ?? "");
  const classificationIntent = input.classificationIntent ?? "";
  const resolvedIntent =
    input.intent ?? resolveSalesDirectorJudgmentIntent(classificationIntent, question);

  const freeThinking =
    input.conversationContext?.freeThinking ?? input.customerState?.freeThinking ?? null;
  const responseSource =
    input.conversationContext?.responseSource ?? input.responseSource ?? null;
  const rawText = input.rawText ?? "";

  const shouldPreserve = shouldPreserveFactualLookupFreeThinkingAnswer({
    classificationIntent,
    question,
    rawText,
    responseSource,
    freeThinking,
  });

  if (shouldPreserve) {
    const preservedText = normalizeText(rawText);
    return {
      text: preservedText,
      intent: resolvedIntent,
      applied: false,
      humanFrame: null,
      basisTaggedFacts: null,
      forbidden_pattern_scan: null,
      generation_mode: "free_thinking_preserved",
      p9_version: "p9-2",
      key_compose_trace: {
        called: false,
        skip_reason: "free_thinking_preserved_before_hul_compose",
        text_preview: "",
        used_safe_fallback: false,
      },
      preserve_gate_trace: buildPreserveGateRuntimeTrace({
        classificationIntent,
        question,
        rawText,
        responseSource,
        freeThinking,
        finalText: preservedText,
        hulOverwriteEntered: false,
      }),
    };
  }

  const timeGateUsedSnapshot = {
    design_used: input.factBundle?.design_used === true,
    recommendation_used: input.factBundle?.recommendation_used === true,
    underwriting_used: input.factBundle?.underwriting_used === true,
    coverage_gap_used: input.factBundle?.coverage_gap_used === true,
  };

  const bundle = {
    ...input.factBundle,
    question,
    ...(input.customerState?.coverageGapContext
      ? {
          coverage_gap_signals: input.customerState.coverageGapContext.signals ?? [],
          coverage_gap_top_concerns: input.customerState.coverageGapContext.top_concerns ?? [],
          coverage_gap_maintained: input.customerState.coverageGapContext.maintained ?? [],
          coverage_gap_used: input.customerState.coverageGapContext.loaded === true,
          has_stored_coverage_analysis:
            input.factBundle?.has_stored_coverage_analysis === true ||
            input.customerState.coverageGapContext.loaded === true,
        }
      : {}),
    ...(input.customerState?.underwritingRiskContext
      ? {
          underwriting_signals: input.customerState.underwritingRiskContext.signals ?? [],
          underwriting_review_flags: input.customerState.underwritingRiskContext.review_flags ?? [],
          underwriting_health_topics: input.customerState.underwritingRiskContext.health_topics ?? [],
          underwriting_used:
            input.factBundle?.underwriting_used === true ||
            input.customerState.underwritingRiskContext.loaded === true,
          underwriting_loaded:
            input.factBundle?.underwriting_loaded === true ||
            input.customerState.underwritingRiskContext.loaded === true,
          has_stored_underwriting_analysis:
            input.factBundle?.has_stored_underwriting_analysis === true ||
            input.customerState.underwritingRiskContext.loaded === true,
        }
      : {}),
    ...(input.customerState?.recommendationContext
      ? {
          recommendation_priority_labels:
            input.customerState.recommendationContext.priority_labels ?? [],
          recommendation_priority_signals:
            input.customerState.recommendationContext.priority_signals ?? [],
          recommendation_priority_types:
            input.customerState.recommendationContext.priority_types ?? [],
          recommendation_used:
            input.factBundle?.recommendation_used === true ||
            input.customerState.recommendationContext.loaded === true,
          recommendation_loaded:
            input.factBundle?.recommendation_loaded === true ||
            input.customerState.recommendationContext.loaded === true,
          has_stored_recommendation_analysis:
            input.factBundle?.has_stored_recommendation_analysis === true ||
            input.customerState.recommendationContext.loaded === true,
        }
      : {}),
    ...(input.customerState?.designContext
      ? {
          design_priority_coverages:
            input.customerState.designContext.priority_coverages ?? [],
          design_keep_coverages:
            input.customerState.designContext.keep_existing_coverages ?? [],
          design_next_actions: input.customerState.designContext.next_actions ?? [],
          design_title: input.customerState.designContext.design_title ?? null,
          design_summary: input.customerState.designContext.design_summary ?? null,
          design_used:
            input.factBundle?.design_used === true ||
            input.customerState.designContext.loaded === true,
          design_loaded:
            input.factBundle?.design_loaded === true ||
            input.customerState.designContext.loaded === true,
          has_stored_design_analysis:
            input.factBundle?.has_stored_design_analysis === true ||
            input.customerState.designContext.loaded === true,
        }
      : {}),
  };

  const policies = bundle.policies ?? [];
  const enrichedBundle = {
    ...bundle,
    premium_stats: bundle.premium_stats ?? computePremiumLookupStats(policies),
    time_gate_used_snapshot: timeGateUsedSnapshot,
  };

  const basisTaggedFacts = buildBasisTaggedFacts(enrichedBundle, resolvedIntent);
  const humanFrame = buildHumanUnderstandingFrame({
    question,
    intent: resolvedIntent,
    surface: input.surface,
    conversationContext: {
      classificationIntent,
      history: input.conversationContext?.history ?? [],
    },
    factBundle: enrichedBundle,
    basisTaggedFacts,
  });

  const useKeyCompose =
    enrichedBundle.key_orchestrator === true || input.customerState?.keyOrchestrator === true;

  const generated = generateHumanSalesDirectorResponse({
    humanFrame,
    basisTaggedFacts,
    rawToolFacts: input.rawText ?? "",
    guardrails: {
      ...(input.guardrails ?? {}),
      ...(useKeyCompose ? { generation_mode: "key_orchestrator" } : {}),
    },
    question,
    intent: resolvedIntent,
    factBundle: enrichedBundle,
    classificationIntent,
  });

  return {
    text: generated.text,
    intent: resolvedIntent,
    applied: shouldApplyHumanUnderstandingLoop(classificationIntent, question, {
      surface: input.surface,
      homeBrainIntent: input.homeBrainIntent,
      homeRoute: input.homeRoute,
      homeVerifiedIntents: input.homeVerifiedIntents,
    }),
    humanFrame,
    basisTaggedFacts,
    forbidden_pattern_scan: generated.forbidden_pattern_scan,
    generation_mode: generated.generation_mode,
    p9_version: "p9-2",
    key_compose_trace: generated.key_compose_trace ?? null,
    preserve_gate_trace: buildPreserveGateRuntimeTrace({
      classificationIntent,
      question,
      rawText,
      responseSource,
      freeThinking,
      finalText: generated.text,
      hulOverwriteEntered: true,
    }),
  };
}
