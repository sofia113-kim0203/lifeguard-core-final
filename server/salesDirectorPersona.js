/**
 * P7-PERSONA — Trusted insurance advisor conversation philosophy.
 * Question → intent → situation → judgment → explanation → reassurance
 */

export const CONVERSATION_BRAIN_TOPICS = {
  CANCER_COVERAGE: "cancer_coverage",
  PREMIUM_BURDEN: "premium_burden",
  ADEQUACY: "adequacy",
};

export const SALES_DIRECTOR_PERSONA_ID = "p7_trusted_advisor";

export const TRUSTED_ADVISOR_CONVERSATION_STEPS = [
  "intent",
  "situation",
  "judgment",
  "explanation",
  "reassurance",
];

export const SALES_DIRECTOR_TRUSTED_ADVISOR_PROMPT = [
  "당신은 5천만 명에게 믿음을 주는 보험 고문입니다. 보험 전문가처럼 나설지 말고, 곁에서 함께 생각하는 사람처럼 말하세요.",
  "대화 순서: ①의도 파악 ②상황 정리 ③판단(단정 금지) ④설명 ⑤안심 ⑥부드러운 질문 1개.",
  "Snapshot·Memory·Gap(내부)는 판단 재료일 뿐, 데이터 나열·표 읽기·엔진 용어 금지.",
  "컨텍스트에 없는 보험료·담보·상품명·금액·개인 이력은 지어내지 마세요.",
  "특정 고객의 기억 내용을 그대로 반복하지 마세요. '지난번 ○○'처럼 사실값을 되풀이하지 마세요.",
  "\"가입된 보험은 확인돼요\", \"기억해 둔 상담 내용도 참고할 수 있어요\", \"왜 궁금하세요?\" 단독 금지.",
  "3-5줄. 이모지·엔진명·Gap 보고체 금지. 따뜻하고 담담하게.",
].join(" ");

const TOPIC_INTENT = {
  [CONVERSATION_BRAIN_TOPICS.ADEQUACY]: "한 번에 '괜찮은지' 확인하고 싶으신 것 같아요.",
  [CONVERSATION_BRAIN_TOPICS.CANCER_COVERAGE]: "암보장이 충분한지, 비어 있지 않은지가 걸리시는 것 같아요.",
  [CONVERSATION_BRAIN_TOPICS.PREMIUM_BURDEN]: "매달 나가는 부담이 크게 느껴지시는 것 같아요.",
};

const TOPIC_REASSURANCE = {
  [CONVERSATION_BRAIN_TOPICS.ADEQUACY]:
    "급하게 결론 내릴 필요 없어요. 걱정되는 축부터 천천히 같이 보면 됩니다.",
  [CONVERSATION_BRAIN_TOPICS.CANCER_COVERAGE]:
    "지금 불안하셔도 괜찮아요. 필요한 만큼만 차근차근 확인해 드릴게요.",
  [CONVERSATION_BRAIN_TOPICS.PREMIUM_BURDEN]:
    "부담이 크게 느껴지셔도, 혼자 감당해야 한다고 생각하지 않으셔도 돼요.",
};

export function inferCustomerIntent(topic = null) {
  if (!topic) return "지금 궁금하신 점을 먼저 짚고 싶으신 것 같아요.";
  return TOPIC_INTENT[topic] ?? TOPIC_INTENT[CONVERSATION_BRAIN_TOPICS.ADEQUACY];
}

export function buildTrustReassurance(topic = null) {
  if (!topic) return "천천히 같이 보면 돼요. 제가 곁에서 맞춰 드릴게요.";
  return TOPIC_REASSURANCE[topic] ?? TOPIC_REASSURANCE[CONVERSATION_BRAIN_TOPICS.ADEQUACY];
}

export function abstractMemoryThemes(memoryFacts = [], topic = null, limit = 2) {
  const themes = [];
  for (const fact of memoryFacts) {
    const combined = `${fact.fact_key ?? ""} ${fact.fact_value ?? fact.value ?? ""}`;
    if (/보험료|부담|premium/i.test(combined)) themes.push("보험료 부담");
    else if (/암|cancer|가족력/i.test(combined)) themes.push("암 관련 걱정");
    else if (/goal|걱정|worry|concern|충분|부족/i.test(combined)) themes.push("보장 걱정");
    else if (combined.trim()) themes.push("상담 맥락");
  }
  const unique = [...new Set(themes)];
  if (topic === CONVERSATION_BRAIN_TOPICS.PREMIUM_BURDEN) {
    unique.sort((a, b) => (a.includes("보험료") ? -1 : 1));
  }
  if (topic === CONVERSATION_BRAIN_TOPICS.CANCER_COVERAGE) {
    unique.sort((a, b) => (a.includes("암") ? -1 : 1));
  }
  return unique.slice(0, limit);
}

export function buildTrustMemoryAcknowledgment(memoryFacts = [], topic = null) {
  if (!memoryFacts.length) return null;
  const themes = abstractMemoryThemes(memoryFacts, topic, 1);
  if (!themes.length) return "지금까지 나눈 이야기도 함께 참고해요.";
  if (topic === CONVERSATION_BRAIN_TOPICS.PREMIUM_BURDEN || themes[0] === "보험료 부담") {
    return "예전에 비슷한 부담을 나눈 적이 있어서, 이번 질문도 그 맥락으로 이해해요.";
  }
  if (topic === CONVERSATION_BRAIN_TOPICS.CANCER_COVERAGE || themes[0] === "암 관련 걱정") {
    return "예전에 비슷한 걱정을 나눈 적이 있어서, 이번 질문도 그 흐름으로 받아들였어요.";
  }
  return "지금까지 나눈 이야기도 함께 참고해요.";
}

export function buildSituationFrame({
  loadedContext = null,
  policySignalText = "",
  gapCtx = null,
  topic = null,
} = {}) {
  const hasPolicies = loadedContext?.policies === "present";
  const parts = [];
  if (hasPolicies) {
    parts.push(
      policySignalText
        ? `가입은 보이는데, ${policySignalText} 쪽 위주로 확인된 상태예요.`
        : "가입은 보이지만, 세부 담보·한도까지는 아직 단정하기 어려워요.",
    );
  } else {
    parts.push("아직 확인된 가입 정보가 많지 않아요.");
  }
  if (gapCtx?.top_concerns?.length) {
    parts.push(`내부적으로는 ${gapCtx.top_concerns.slice(0, 2).join("·")} 쪽을 먼저 볼 여지가 있어요.`);
  } else if (topic === CONVERSATION_BRAIN_TOPICS.PREMIUM_BURDEN) {
    parts.push("총 보험료는 아직 숫자로 확인 전이에요.");
  }
  return parts.join(" ");
}

export function buildJudgmentFrame({ topic = null, gapCtx = null } = {}) {
  if (topic === CONVERSATION_BRAIN_TOPICS.ADEQUACY) {
    return "지금은 전체를 단정하기보다, 걱정 축부터 짚는 게 맞아 보여요.";
  }
  if (topic === CONVERSATION_BRAIN_TOPICS.CANCER_COVERAGE) {
    return gapCtx?.top_concerns?.includes("암")
      ? "가입 여부와 별개로, 암 쪽은 더 함께 봐야 할 여지가 있어 보여요."
      : "상품명만으로는 암 담보 충분 여부를 단정하긴 어려워요.";
  }
  if (topic === CONVERSATION_BRAIN_TOPICS.PREMIUM_BURDEN) {
    return "총액 문제인지, 특정 계약이 무거운 건지부터 나눠보는 게 좋을 것 같아요.";
  }
  return "확인된 범위 안에서만 조심스럽게 말씀드릴게요.";
}

export function buildExplanationFrame({ topic = null, gapCtx = null } = {}) {
  if (topic === CONVERSATION_BRAIN_TOPICS.ADEQUACY && gapCtx?.maintained?.length) {
    return `${gapCtx.maintained.slice(0, 2).join("·")} 쪽은 유지 신호가 있고, 나머지는 함께 점검하면 좋아요.`;
  }
  if (topic === CONVERSATION_BRAIN_TOPICS.CANCER_COVERAGE) {
    return "암 관련 상품이 보여도, 진단비·치료비까지는 이 정보만으론 확답하기 어려워요.";
  }
  if (topic === CONVERSATION_BRAIN_TOPICS.PREMIUM_BURDEN) {
    return "부담이 최근에 커졌는지, 원래부터 무거웠는지에 따라 보는 방법이 달라져요.";
  }
  return "지금 알 수 있는 범위와 모르는 범위를 나눠서 보면 덜 답답하실 거예요.";
}

export function buildPersonaFollowUpQuestion(topic = null) {
  if (topic === CONVERSATION_BRAIN_TOPICS.ADEQUACY) {
    return "특히 암·실손·운전자 중 어디가 더 신경 쓰이세요?";
  }
  if (topic === CONVERSATION_BRAIN_TOPICS.CANCER_COVERAGE) {
    return "가족력 때문인지, 지금 가입 충분성이 궁금한 건지 알려주실 수 있을까요?";
  }
  if (topic === CONVERSATION_BRAIN_TOPICS.PREMIUM_BURDEN) {
    return "먼저 어떤 보험료가 가장 신경 쓰이는지부터 말씀해 주실까요?";
  }
  return "지금 가장 걸리는 부분부터 말씀해 주실까요?";
}

export function buildPersonaThinkingScaffold({
  topic = null,
  loadedContext = null,
  policySignalText = "",
  memoryFacts = [],
  gapCtx = null,
} = {}) {
  const memoryThemes = abstractMemoryThemes(memoryFacts, topic);
  const lines = [
    `[의도] ${inferCustomerIntent(topic)}`,
    `[상황] ${buildSituationFrame({ loadedContext, policySignalText, gapCtx, topic })}`,
    `[판단힌트] ${buildJudgmentFrame({ topic, gapCtx })}`,
    `[설명힌트] ${buildExplanationFrame({ topic, gapCtx })}`,
    `[안심힌트] ${buildTrustReassurance(topic)}`,
  ];
  if (memoryThemes.length) {
    lines.push(`[Memory테마] ${memoryThemes.join(", ")} (고객에게 사실값 그대로 반복 금지)`);
  }
  return lines.join("\n");
}

export function violatesMemoryValueRepetition(text = "", memoryFacts = []) {
  const body = String(text ?? "");
  for (const fact of memoryFacts) {
    const value = String(fact.fact_value ?? fact.value ?? "").trim();
    if (value.length >= 3 && body.includes(value)) return true;
  }
  return false;
}

export function violatesTrustedAdvisorTemplate(text = "") {
  return violatesMemoryValueRepetition(text, []);
}

export function composeTrustedAdvisorTurn({
  topic = null,
  memoryFacts = [],
  loadedContext = null,
  policySignalText = "",
  gapCtx = null,
  opening = null,
} = {}) {
  const intent = inferCustomerIntent(topic);
  const situation = buildSituationFrame({ loadedContext, policySignalText, gapCtx, topic });
  const judgment = buildJudgmentFrame({ topic, gapCtx });
  const explanation = buildExplanationFrame({ topic, gapCtx });
  const reassurance = buildTrustReassurance(topic);
  const memoryAck = buildTrustMemoryAcknowledgment(memoryFacts, topic);
  const followUp = buildPersonaFollowUpQuestion(topic);

  const parts = [
    opening ?? intent,
    memoryAck,
    situation,
    judgment,
    explanation,
    reassurance,
    followUp,
  ].filter(Boolean);

  return {
    text: parts.join("\n"),
    opening_variant: (opening ?? intent).trim(),
    memory_used: memoryFacts.length > 0,
  };
}
