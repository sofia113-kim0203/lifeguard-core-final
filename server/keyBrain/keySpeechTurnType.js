/**
 * KEY Speech Constitution v1.1 — turn type classification and speak profile.
 * Philosophy layer only: no judgment / factory / memory engine changes.
 */
import { isGeneralKnowledgeEligible } from "../generalKnowledgeEligibility.js";
import { isKeySocialTurn } from "../keyConversationPatterns.js";

export const SPEECH_TURN_TYPE = {
  SOCIAL: "social",
  COMMAND: "command",
  EMOTION: "emotion",
  ASSESSMENT: "assessment",
  CONTINUATION: "continuation",
  REPEAT: "repeat",
};

const INSURANCE_TOPIC_RE =
  /보험|보험료|보장|암|실손|담보|청구|보험금|해지|중복|유지|가입|설계|부족|괜찮|납입|계약/i;

const CASUAL_SOCIAL_RE =
  /^(?:그냥\s*)?(?:심심해서?\s*)?(?:왔어|들렀어|왔습니다|들렀습니다)(?:[!.?\s~♡♥]*)?$/i;

const CONTINUATION_RE =
  /(?:지난(?:번)?|저번|이전|전에(?:\s*한)?)\s*(?:얘기|이야기|상담|말|대화).*(?:이어|계속|봐|보|이어서)|이어서\s*(?:봐|보|말|얘기)/;

const REPEAT_RE =
  /(?:아까|방금|직전(?:에)?(?:\s*한)?)\s*(?:말한|말씀|얘기한|설명한)?\s*(?:거|것|내용)?\s*(?:다시)?\s*(?:알려|말해|설명|정리)|다시\s*(?:알려|말해|설명)/;

const EMOTION_SIGNAL_RE =
  /힘들|지쳤|불안|걱정|부담|무서|막막|혼란|싶어서|망설|답답|우울|속상|덥|춥|추워|더워|피곤|지침/;

const HESITATION_RE = /(?:해야\s*)?(?:하나|할지)\s*(?:싶어|고민|망설)/;

const LOOKUP_RE = /얼마(?:야|예요|인지|정도|쯤)?|몇\s*(?:원|개)|뭐야|뭔지|언제|어디/;

const ASSESSMENT_RE = /괜찮|부족|충분|넉넉|공백|빈\s*곳|갠찮|맞는지|어때/;

const COMMAND_RE = /추천해|알려줘|해줘|봐줘|정리해|찾아|가르쳐|골라/;

export const SPEECH_FORBIDDEN_PATTERNS = {
  F1: { id: "F1", label: "질문 잘 받았습니다", re: /질문\s*잘\s*받았습니다/ },
  F2: { id: "F2", label: "거울 템플릿", re: /걱정되시는군요|걱정되시는\s*마음은\s*이해해요/ },
  F3: { id: "F3", label: "지금 자료로 보면 opener", re: /^지금\s*자료로\s*보면/ },
  F4: { id: "F4", label: "함께 확인해볼게요 closing", re: /함께\s*확인해\s*볼게요\s*$/ },
  F5: { id: "F5", label: "KEY가 자기 지칭", re: /KEY가/ },
  F6: { id: "F6", label: "6단계 조립", kind: "six_step_assembly" },
  F7: { id: "F7", label: "동일 본문", kind: "cross_question_similarity" },
  F8: { id: "F8", label: "closing 반복", re: /확인되는\s*범위부터\s*같이\s*보겠습니다/g },
  F9: { id: "F9", label: "보고서 톤", kind: "segment_stack" },
  F10: { id: "F10", label: "거울 말 오용", kind: "mirror_on_forbidden_type" },
  F11: { id: "F11", label: "연속 공감", kind: "consecutive_empathy" },
  F12: { id: "F12", label: "신규 universal filler", re: /확인된\s*범위\s*안에서만\s*조심스럽게/ },
};

function normalizeQuestion(question = "") {
  return String(question ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

function pickVariant(question, variants = []) {
  if (!variants.length) return "";
  let hash = 0;
  for (const ch of normalizeQuestion(question)) {
    hash = (hash + ch.charCodeAt(0)) % variants.length;
  }
  return variants[hash];
}

const DAILY_DOMAIN_RE = /맛집|식당|음식|여행|날씨|심심|브런치|레스토랑/;

export function isInsuranceSpeechTopic(question = "", { consultationIntent = null } = {}) {
  const q = normalizeQuestion(question);
  const intent = consultationIntent?.intent ?? null;

  if (isGeneralKnowledgeEligible(q, consultationIntent)) return false;
  if (consultationIntent?.general_knowledge === true) return false;
  if (DAILY_DOMAIN_RE.test(q) && !INSURANCE_TOPIC_RE.test(q)) return false;
  if (/추천(?:해|해줘|좀)/.test(q) && DAILY_DOMAIN_RE.test(q) && !INSURANCE_TOPIC_RE.test(q)) {
    return false;
  }

  if (
    intent === "recommendation_request" ||
    intent === "design_request" ||
    intent === "coverage_gap_check" ||
    intent === "coverage_review_request"
  ) {
    if (DAILY_DOMAIN_RE.test(q) && !INSURANCE_TOPIC_RE.test(q)) return false;
    return true;
  }
  return INSURANCE_TOPIC_RE.test(q) || (/추천(?:해|해줘|좀)/.test(q) && INSURANCE_TOPIC_RE.test(q));
}

export function isCasualSocialTurn(question = "") {
  const q = normalizeQuestion(question);
  if (!q) return false;
  if (INSURANCE_TOPIC_RE.test(q)) return false;
  return CASUAL_SOCIAL_RE.test(q) || /심심해서?\s*왔/.test(q);
}

function hadRecentEmpathy(conversation = {}) {
  const excerpt = String(
    conversation.priorAssistantExcerpt ?? conversation.lastAssistantExcerpt ?? "",
  );
  return /이해해요|걱정|힘드|마음|불안|부담/.test(excerpt);
}

/**
 * @param {string} question
 * @param {{ conversation?: object, consultationIntent?: object|null, priorTurnEmpathy?: boolean }} [context]
 */
export function classifySpeechTurnType(question = "", context = {}) {
  const q = normalizeQuestion(question);
  if (!q) return SPEECH_TURN_TYPE.SOCIAL;

  if (isKeySocialTurn(q) || isCasualSocialTurn(q)) {
    return SPEECH_TURN_TYPE.SOCIAL;
  }

  if (CONTINUATION_RE.test(q) && !REPEAT_RE.test(q)) {
    return SPEECH_TURN_TYPE.CONTINUATION;
  }

  if (REPEAT_RE.test(q)) {
    return SPEECH_TURN_TYPE.REPEAT;
  }

  if (LOOKUP_RE.test(q) && !EMOTION_SIGNAL_RE.test(q) && !HESITATION_RE.test(q)) {
    return SPEECH_TURN_TYPE.COMMAND;
  }

  if (
    (EMOTION_SIGNAL_RE.test(q) || HESITATION_RE.test(q)) &&
    !(context.priorTurnEmpathy ?? hadRecentEmpathy(context.conversation ?? {}))
  ) {
    return SPEECH_TURN_TYPE.EMOTION;
  }

  if (isInsuranceSpeechTopic(q) && ASSESSMENT_RE.test(q)) {
    return SPEECH_TURN_TYPE.ASSESSMENT;
  }

  if (COMMAND_RE.test(q) || LOOKUP_RE.test(q)) {
    return SPEECH_TURN_TYPE.COMMAND;
  }

  if (EMOTION_SIGNAL_RE.test(q) || HESITATION_RE.test(q)) {
    return SPEECH_TURN_TYPE.EMOTION;
  }

  if (isInsuranceSpeechTopic(q)) {
    return SPEECH_TURN_TYPE.ASSESSMENT;
  }

  return SPEECH_TURN_TYPE.COMMAND;
}

/**
 * @param {string} turnType
 * @param {{ question?: string, conversation?: object, consultationIntent?: object|null }} [context]
 */
export function resolveSpeechProfile(turnType, context = {}) {
  const question = normalizeQuestion(context.question ?? "");
  const insuranceTopic = isInsuranceSpeechTopic(question, {
    consultationIntent: context.consultationIntent ?? null,
  });
  const conversation = context.conversation ?? {};
  const hasHistory = conversation.hasHistory === true;

  const base = {
    turnType,
    insuranceTopic,
    density: "medium",
    allowMirror: false,
    allowSixStep: false,
    skipFixedOpener: true,
    skipFixedClosing: true,
    skipInsuranceStack: false,
    skipRepeatEmpathy: false,
    skipPolicyAbsentBoilerplate: true,
  };

  switch (turnType) {
    case SPEECH_TURN_TYPE.SOCIAL:
      return {
        ...base,
        density: "minimal",
        skipInsuranceStack: true,
      };

    case SPEECH_TURN_TYPE.COMMAND:
      return {
        ...base,
        density: insuranceTopic ? "medium" : "short",
        skipInsuranceStack: !insuranceTopic,
      };

    case SPEECH_TURN_TYPE.EMOTION:
      return {
        ...base,
        density: insuranceTopic ? "medium" : "short",
        allowMirror: true,
        skipInsuranceStack: !insuranceTopic,
      };

    case SPEECH_TURN_TYPE.ASSESSMENT:
      return {
        ...base,
        density: "medium",
        allowMirror: /괜찮|부족|걱정|불안/.test(question),
      };

    case SPEECH_TURN_TYPE.CONTINUATION:
      return {
        ...base,
        density: "medium",
        allowMirror: hasHistory,
        skipInsuranceStack: !insuranceTopic,
      };

    case SPEECH_TURN_TYPE.REPEAT:
      return {
        ...base,
        density: "minimal",
        skipRepeatEmpathy: true,
        skipInsuranceStack: !insuranceTopic,
      };

    default:
      return base;
  }
}

export function classifyAndResolveSpeechProfile(question = "", context = {}) {
  if (context.customer_goal) {
    const hint = deriveSpeechHintFromGoal(context.customer_goal);
    const profile = resolveSpeechProfile(hint.turnType, {
      ...context,
      question,
      consultationIntent: context.consultationIntent ?? null,
    });
    return { turnType: hint.turnType, profile, speech_hint_from_goal: true };
  }
  const turnType = classifySpeechTurnType(question, context);
  const profile = resolveSpeechProfile(turnType, {
    ...context,
    question,
    consultationIntent: context.consultationIntent ?? null,
  });
  return { turnType, profile };
}

/** Goal → speech turn hint (Slice 4 — Goal SSOT; not independent question classification). */
export function deriveSpeechHintFromGoal(customerGoal = null) {
  switch (customerGoal) {
    case "emotional_space":
      return { turnType: SPEECH_TURN_TYPE.EMOTION, skipInsuranceStack: true };
    case "daily_recommendation":
      return { turnType: SPEECH_TURN_TYPE.COMMAND, skipInsuranceStack: true, insuranceTopic: false };
    case "social_presence":
      return { turnType: SPEECH_TURN_TYPE.SOCIAL, skipInsuranceStack: true };
    case "respect_close":
      return { turnType: SPEECH_TURN_TYPE.SOCIAL, density: "minimal" };
    case "premium_burden":
    case "enrolled_policy_list":
    case "direction_choice":
      return { turnType: SPEECH_TURN_TYPE.COMMAND, insuranceTopic: true };
    case "coverage_assessment_whole":
    case "coverage_assessment_cancer_axis":
      return { turnType: SPEECH_TURN_TYPE.ASSESSMENT, insuranceTopic: true };
    default:
      return { turnType: SPEECH_TURN_TYPE.COMMAND };
  }
}

function buildDailyEmotionLead(question = "") {
  const q = normalizeQuestion(question);
  if (/힘들|지쳤|피곤|지침/.test(q)) {
    return pickVariant(q, [
      "오늘 많이 버티셨네요. 잠깐이라도 숨 고를 틈은 있으세요?",
      "하루가 무겁게 느껴지시는군요. 편하실 때 이어가도 됩니다.",
    ]);
  }
  if (/덥|춥|날씨|더워|추워/.test(q)) {
    return pickVariant(q, [
      "요즘 날씨가 많이 힘드시죠. 밖에 나가기도 부담스러울 때가 있어요.",
      "더위가 오래가면 지치기 쉬워요. 오늘은 무리하지 않으셔도 됩니다.",
    ]);
  }
  return pickVariant(q, [
    "마음이 무거우실 때가 있죠. 천천히 이야기해도 됩니다.",
    "오늘은 편하게 말씀하셔도 돼요.",
  ]);
}

function buildDailyCommandLead(question = "") {
  const q = normalizeQuestion(question);
  if (/맛집|음식|식당/.test(q)) {
    return pickVariant(q, [
      "분당이면 분위기 따라 골라볼 만한 곳이 있어요. 혼자 드실지, 같이 가실지 알려주시면 방향이 보입니다.",
      "어떤 음식이 땡기시는지 알려주시면, 분당 쪽에서 맞춰볼게요.",
    ]);
  }
  return pickVariant(q, [
    "네, 말씀해 주세요. 어떤 부분이 궁금하신가요?",
    "알겠습니다. 조금만 더 알려주시면 같이 볼게요.",
  ]);
}

function buildInsuranceEmotionLead(question = "") {
  const q = normalizeQuestion(question);
  if (/부담|비싸/.test(q)) {
    return pickVariant(q, [
      "보험료가 부담으로 느껴지시는군요.",
      "납입이 버겁게 느껴지실 수 있어요.",
    ]);
  }
  if (/추천|가입/.test(q) && /싶어|망설|고민/.test(q)) {
    return pickVariant(q, [
      "지금 결정을 서두르기보다, 망설이시는 이유부터 같이 보면 됩니다.",
      "망설이시는 마음이 드는 건 자연스러운 일이에요.",
    ]);
  }
  return null;
}

function buildInsuranceCommandLead(question = "", consultationIntent = null) {
  const intent = consultationIntent?.intent ?? "general_consultation";
  const q = normalizeQuestion(question);

  if (intent === "recommendation_request" || /추천/.test(q)) {
    return "지금은 상품부터 꺼내기보다, 보장 구조부터 같이 보면 순서가 보입니다.";
  }
  if (/얼마/.test(q)) {
    return "등록된 계약이 있으면 납입 구조부터 짚어볼 수 있어요.";
  }
  if (intent === "design_request") {
    return "설계 방향은 같이 잡을 수 있어요. 다만 지금 단정할 상품이나 금액은 말씀드리기 어렵고, 보장 구조부터 차례로 보면 됩니다.";
  }
  return pickVariant(q, [
    "지금 걸리는 부분부터 같이 보면 됩니다.",
    "어떤 순서로 볼지부터 맞춰볼게요.",
  ]);
}

function buildAssessmentLead(question = "") {
  const q = normalizeQuestion(question);
  if (/암/.test(q)) {
    return "암 담보 축부터 같이 보면, 겹치는 부분과 비는 부분이 보입니다.";
  }
  if (/괜찮/.test(q)) {
    return "전체적으로 큰 공백 신호가 있는지부터 짚어볼게요.";
  }
  if (/부족/.test(q)) {
    return "부족해 보이는 축이 있는지부터 같이 확인해 볼게요.";
  }
  return "보장 상태를 보려면 등록된 가입 정보를 같이 봐야 합니다.";
}

/**
 * Build judgment-layer segments for question speak (not a fixed 6-step template).
 */
export function buildSpeechProfileJudgmentSegments(
  question = "",
  { consultationIntent = null, profile = null, conversation = null } = {},
) {
  const resolved =
    profile ??
    resolveSpeechProfile(classifySpeechTurnType(question, { conversation, consultationIntent }), {
      question,
      conversation,
      consultationIntent,
    });

  const segments = [];

  if (resolved.turnType === SPEECH_TURN_TYPE.REPEAT) {
    segments.push({
      tier: "inference",
      text: "아까 말씀드린 내용을 짧게 다시 정리해 드릴게요.",
    });
    return segments;
  }

  if (resolved.turnType === SPEECH_TURN_TYPE.CONTINUATION) {
    const hasHistory = conversation?.hasHistory === true;
    segments.push({
      tier: "inference",
      text: hasHistory
        ? "지난번 이야기 흐름에서 이어서 볼게요."
        : "이전에 나눈 이야기가 있으면 그 흐름에서 이어가면 됩니다.",
    });
    if (!resolved.insuranceTopic) return segments;
  }

  if (resolved.turnType === SPEECH_TURN_TYPE.EMOTION) {
    if (resolved.allowMirror && !resolved.skipRepeatEmpathy) {
      const lead = resolved.insuranceTopic
        ? buildInsuranceEmotionLead(question)
        : buildDailyEmotionLead(question);
      if (lead) segments.push({ tier: "inference", text: lead });
    }
    if (resolved.insuranceTopic) {
      if (/보험료|부담|비싸/.test(question)) {
        segments.push({
          tier: "unknown",
          text: "납입 구조부터 같이 보면 부담이 어디서 오는지 짚을 수 있어요.",
        });
      } else if (/추천|가입/.test(question)) {
        segments.push({
          tier: "unknown",
          text: "지금 당장 결정보다, 어떤 부분이 막막한지부터 천천히 보면 됩니다.",
        });
      }
    }
    return segments;
  }

  if (resolved.turnType === SPEECH_TURN_TYPE.COMMAND) {
    const lead = resolved.insuranceTopic
      ? buildInsuranceCommandLead(question, consultationIntent)
      : buildDailyCommandLead(question);
    if (lead) segments.push({ tier: "unknown", text: lead });
    return segments;
  }

  if (resolved.turnType === SPEECH_TURN_TYPE.ASSESSMENT) {
    if (resolved.allowMirror && /괜찮|부족|걱정/.test(question)) {
      segments.push({
        tier: "inference",
        text: pickVariant(question, [
          "보장이 걱정되실 수 있어요.",
          "지금 상태가 궁금하실 때가 있죠.",
        ]),
      });
    }
    segments.push({ tier: "unknown", text: buildAssessmentLead(question) });
    return segments;
  }

  return segments;
}

export function scanSpeechForbiddenPatterns(text = "", { turnType = null } = {}) {
  const normalized = String(text ?? "")
    .replace(/\s+/g, " ")
    .trim();
  const hits = [];

  for (const rule of Object.values(SPEECH_FORBIDDEN_PATTERNS)) {
    if (rule.kind) continue;
    if (rule.re?.test(normalized)) {
      hits.push(rule.id);
    }
  }

  if (turnType === SPEECH_TURN_TYPE.SOCIAL && /이해해요|걱정되/.test(normalized)) {
    hits.push("F10");
  }
  if (
    (turnType === SPEECH_TURN_TYPE.COMMAND || turnType === SPEECH_TURN_TYPE.REPEAT) &&
    /이해해요|걱정되/.test(normalized)
  ) {
    hits.push("F10");
  }

  const closingMatches = normalized.match(SPEECH_FORBIDDEN_PATTERNS.F8.re);
  if (closingMatches && closingMatches.length >= 2) {
    hits.push("F8");
  }

  return [...new Set(hits)];
}

export const SPEECH_TURN_TYPE_TEST_SET = [
  { id: "01", question: "안녕", expected: SPEECH_TURN_TYPE.SOCIAL },
  { id: "02", question: "고마워", expected: SPEECH_TURN_TYPE.SOCIAL },
  { id: "03", question: "보험료 부담돼", expected: SPEECH_TURN_TYPE.EMOTION },
  { id: "04", question: "보험료 얼마야", expected: SPEECH_TURN_TYPE.COMMAND },
  { id: "05", question: "추천해줘", expected: SPEECH_TURN_TYPE.COMMAND },
  { id: "06", question: "추천해줘야 하나 싶어서요", expected: SPEECH_TURN_TYPE.EMOTION },
  { id: "07", question: "내 보험 괜찮아?", expected: SPEECH_TURN_TYPE.ASSESSMENT },
  { id: "08", question: "암보험 부족해?", expected: SPEECH_TURN_TYPE.ASSESSMENT },
  { id: "09", question: "지난번 얘기 이어서 봐줘", expected: SPEECH_TURN_TYPE.CONTINUATION },
  { id: "10", question: "아까 말한 거 다시 알려줘", expected: SPEECH_TURN_TYPE.REPEAT },
  { id: "11", question: "오늘 너무 힘들어", expected: SPEECH_TURN_TYPE.EMOTION },
  { id: "12", question: "분당 맛집 추천해줘", expected: SPEECH_TURN_TYPE.COMMAND },
  { id: "13", question: "요즘 날씨 왜 이렇게 덥지", expected: SPEECH_TURN_TYPE.EMOTION },
  { id: "14", question: "그냥 심심해서 왔어", expected: SPEECH_TURN_TYPE.SOCIAL },
];
