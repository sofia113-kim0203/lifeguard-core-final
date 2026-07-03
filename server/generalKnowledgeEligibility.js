/**
 * KEY-GI-1 R2 — General knowledge eligibility SSOT (intent-first).
 * Topic keywords support intent; insurance linkage wins when explicit.
 */
const CORE_INSURANCE_SIGNAL =
  /보험|보장|암\s*보험|암보험|실손|담보|특약|가입|청구|보험료|보험금|인수|심사|설계|공백|갭|리밸런싱|포트폴리오|운전자|의료비|해지|변경|보험\s*설계|플랜\s*짜|진단비|들어야|가입해야/;

const GK_HISTORY =
  /역사|조선|고려|삼국|세종|임진|독립|광복|왕조|전쟁|3·1|6·25|한국전|유적|문화재|대왕|의사\s*업적|과거제|청자|휴전/;
const GK_SCIENCE =
  /과학|물리|화학|생물|DNA|양자|블랙홀|광합성|원자력|기후|행성|태양|우주|백신|커피|카페인|지진|광속|jet\s*lag|ChatGPT|GPT|인공지능/;
const GK_ECONOMY =
  /경제|인플레|금리|GDP|환율|주식|채권|비트코인|CPI|경기침체|실업|전세|월세|부동산(?!\s*세)/;
const GK_IT =
  /와이파이|WiFi|Wi-Fi|VPN|클라우드|SSD|HDD|API|피싱|오픈소스|5G|LTE|컴퓨터|프로그래|코딩|프로그래밍|스마트폰|배터리|ChatGPT|GPT/;
const GK_TRAVEL =
  /여행|관광|코스|휴가|캠핑|온천|제주|강원|부산|경주|속초|유럽|일본|해외|비행기|항공|당일치기|혼자\s*여행|jet\s*lag|이태원|강원도|분당/;
const GK_FOOD = /맛집|식당|레스토랑|브런치|파스타|스테이크|김치찌개|와인|요리|음식|비건|pairing|저녁\s*맛/;
const GK_HEALTH =
  /건강|감기|혈압|당뇨|스트레|수면|물\s*마|물\s*얼마|하루\s*물|얼마나\s*마셔|수분|갈증|손\s*씻|디스크|자세|예방|체중|살\s*(?:을\s*)?빼|다이어트|몸\s*무게|몸\s*관리|집에서\s*할|건강상식|jet\s*lag|빼(?:려|면|고)/;
const GK_EDUCATION =
  /공부|학습|교육|시험|숙제|영어|수학|독서|토익|전공|집중력|갈등|아이|자녀|초등|학생|습관|계획|코딩|프로그래밍|배우려면|뭐부터|입문|처음\s*시작|배우(?:려|고)/;
const GK_LIFE =
  /빨래|이사|에어컨|냉장고|분리수거|결로|곰팡이|세탁|전기요금|반려동물|장마|신발|얼룩|필터|보관|통세척/;
const GK_PHILOSOPHY =
  /철학|행복|자유의지|의미|존재|윤리|도덕|삶의\s*의미|인생|가치|정의|진리|양심|운명|선과\s*악|마음\s*철학|인식론|形而上/;

const GK_EXPLAIN_INTENT =
  /뭐야|뭔지|무엇|설명|쉽게|원리|이유|차이|어떻게|방법|법$|몇\s*개|언제|업적|요약|기본|확인\s*방법|알려|만들어|작용|뭐\s*하는|뭐부터|생각해|볼\s*수\s*있|있을까|있을\s*수\s*있|란\s*뭐|이란\s*뭐|뭐라고\s*생각/;
const GK_LIFE_RECOMMEND = /추천(?:해)?(?:줘)?|갈\s*만한|볼\s*만한|어디\s*갈|코스/;

const INSURANCE_CLASSIFICATION_INTENTS = new Set([
  "coverage_gap_check",
  "coverage_review_request",
  "recommendation_request",
  "design_request",
  "design_review_check",
  "design_priority_check",
  "claim_eligibility_check",
  "policy_detail",
  "underwriting_bound_check",
  "recommendation_priority_check",
]);

function normalizeQuestion(question = "") {
  return String(question ?? "").replace(/\s+/g, " ").trim();
}

export function hasInsuranceConsultationIntent(question = "") {
  const text = normalizeQuestion(question);
  if (!text) return false;
  if (CORE_INSURANCE_SIGNAL.test(text)) return true;
  if (/줄이|절감|부담/.test(text) && /보험|보험료|납입/.test(text)) return true;
  if (/추천|가입|들어야|보완|필요/.test(text) && /보험|보장|담보|특약|진단비/.test(text)) return true;
  if (/암|실손|운전자|뇌|심장/.test(text) && /진단비|가입|들|보유|부족|청구|보험금/.test(text)) {
    return true;
  }
  return false;
}

function hasGeneralKnowledgeDomainSignal(text = "") {
  return (
    GK_HISTORY.test(text) ||
    GK_SCIENCE.test(text) ||
    GK_ECONOMY.test(text) ||
    GK_IT.test(text) ||
    GK_TRAVEL.test(text) ||
    GK_FOOD.test(text) ||
    GK_HEALTH.test(text) ||
    GK_EDUCATION.test(text) ||
    GK_LIFE.test(text) ||
    GK_PHILOSOPHY.test(text)
  );
}

/** Intent-first: life/education/health question without insurance linkage. */
export function hasGeneralKnowledgeIntent(question = "") {
  const text = normalizeQuestion(question);
  if (!text || hasInsuranceConsultationIntent(text)) return false;

  if (GK_LIFE_RECOMMEND.test(text) && (GK_TRAVEL.test(text) || GK_FOOD.test(text))) {
    return true;
  }

  if (GK_TRAVEL.test(text) || GK_FOOD.test(text)) return true;

  if (GK_HEALTH.test(text) && /줄이|빼|예방|방법|습관|생활|스트레|jet|물|마시|얼마나|하루|수분/.test(text)) {
    return true;
  }

  if (GK_EDUCATION.test(text) && /줄이|습관|방법|계획|갈등|공부|숙제|코딩|배우|뭐부터|프로그래|입문|처음/.test(text)) {
    return true;
  }

  if (GK_PHILOSOPHY.test(text)) {
    return true;
  }

  if (GK_EXPLAIN_INTENT.test(text) && hasGeneralKnowledgeDomainSignal(text)) {
    return true;
  }

  if (hasGeneralKnowledgeDomainSignal(text)) {
    if (GK_IT.test(text) || GK_SCIENCE.test(text) || GK_HISTORY.test(text) || GK_ECONOMY.test(text) || GK_PHILOSOPHY.test(text)) {
      return true;
    }
    if (GK_LIFE.test(text) || GK_HEALTH.test(text) || GK_EDUCATION.test(text)) {
      return true;
    }
  }

  return false;
}

export function isGeneralKnowledgeEligible(question = "", consultationIntent = null) {
  const text = normalizeQuestion(question);
  if (!text) return false;

  const intent = consultationIntent?.intent ?? null;
  if (intent === "claim_eligibility_check" || intent === "coverage_gap_check") return false;
  if (consultationIntent?.companion_cluster && /^JC-/.test(consultationIntent.companion_cluster)) {
    return false;
  }

  if (hasInsuranceConsultationIntent(text)) return false;

  return hasGeneralKnowledgeIntent(text);
}

export function shouldReclassifyInsuranceIntentAsGeneralKnowledge(question = "", blockedIntent = null) {
  if (!blockedIntent || !INSURANCE_CLASSIFICATION_INTENTS.has(blockedIntent)) return false;
  return isGeneralKnowledgeEligible(question, { intent: blockedIntent });
}

export function buildGeneralKnowledgeConsultationIntent(question = "", blockedIntent = null) {
  return {
    intent: "general_consultation",
    confidence: "high",
    matched_rule: "general_knowledge_eligible",
    blocked_insurance_intent: blockedIntent,
    general_knowledge: true,
    lookup_sub_intent: null,
    lookup_category: null,
    question_focus: normalizeQuestion(question),
  };
}
