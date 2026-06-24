/**
 * P9-1 — Sales Director 100: interpretive response formatter.
 * Transforms raw answers into constitution-aligned structure at the final output boundary.
 * 정보 → 해석 → 우선순위 → 다음 행동
 *
 * P9-2: basisTagged facts remain as thinking material; final speech via Human Understanding Loop.
 */
import { finalizeHumanSalesDirectorResponse, shouldApplyHumanUnderstandingLoop } from "./humanUnderstandingLoop.js";
import { LOOKUP_CATEGORIES, matchPolicyToCategory } from "./intentGateLayer.js";

export const SALES_DIRECTOR_JUDGMENT_INTENTS = {
  COVERAGE_JUDGMENT: "coverage_judgment",
  INSURANCE_CHECKUP: "insurance_checkup",
  PREMIUM_INTERPRETATION: "premium_interpretation",
  CLAIM_OPPORTUNITY: "claim_opportunity",
  ACCIDENT_CLAIM: "accident_claim",
  RECOMMENDATION_REASON: "recommendation_reason",
  DESIGN_QUESTION: "design_question",
  POLICY_REVIEW: "policy_review",
  GENERAL_INSURANCE_JUDGMENT: "general_insurance_judgment",
};

export const STATEMENT_BASIS = {
  EVIDENCE: "evidence",
  INSIGHT: "insight",
};

const APPLICABLE_CLASSIFICATION_INTENTS = new Set([
  "coverage_gap_check",
  "general_consultation",
  "claim_eligibility_check",
  "coverage_review_request",
  "recommendation_request",
  "design_request",
]);

const EXCLUDED_CLASSIFICATION_INTENTS = new Set([
  "casual_chat",
  "factual_lookup",
  "policy_detail",
]);

const CASUAL_GREETING_RE =
  /^(?:하이|안녕(?:하세요|하십니까)?|헬로|hello|hi|ㅎㅇ|반가워요?|반갑습니다)(?:[!.?\s~♡♥]*)?$/i;
const APP_HELP_RE = /(?:로그인|비밀번호|앱\s*오류|버그|장애|접속\s*안|회원가입|설정\s*어디)/i;

const GENERAL_JUDGMENT_SIGNAL =
  /부족|모자라|충분|괜찮|공백|갭|가입해야|들어야|추천|보완|설계|구성|플랜|포트폴리오|리밸런싱|재구성|줄이|절감|해지|중복|유지|고쳐|놓친|비싸|부담/i;

const COVERAGE_PRESENCE_JUDGMENT_RE =
  /(?:암보장|실손\s*보장|운전자\s*보장)|(?:암|실손|운전자|뇌|심)[^\n]{0,12}(?:보장|담보)?[^\n]{0,10}(?:있(?:어|나|음|습)?|가입|들어|보유|돼|되어)/;

const JUDGMENT_GAP_INTENTS = new Set([
  SALES_DIRECTOR_JUDGMENT_INTENTS.COVERAGE_JUDGMENT,
  SALES_DIRECTOR_JUDGMENT_INTENTS.INSURANCE_CHECKUP,
  SALES_DIRECTOR_JUDGMENT_INTENTS.GENERAL_INSURANCE_JUDGMENT,
]);

export const FACTUAL_LOOKUP_JUDGMENT_INTENTS = new Set([
  SALES_DIRECTOR_JUDGMENT_INTENTS.PREMIUM_INTERPRETATION,
  ...JUDGMENT_GAP_INTENTS,
]);

const QUESTION_INTENT_RULES = [
  { pattern: /내\s*보험\s*괜찮|보험\s*괜찮|내\s*보장\s*괜찮/, intent: SALES_DIRECTOR_JUDGMENT_INTENTS.COVERAGE_JUDGMENT },
  { pattern: /암\s*보험\s*부족|암보험\s*부족|암\s*부족/, intent: SALES_DIRECTOR_JUDGMENT_INTENTS.COVERAGE_JUDGMENT },
  { pattern: /보험료\s*(?:너무\s*)?(?:비싸|부담|많)/, intent: SALES_DIRECTOR_JUDGMENT_INTENTS.PREMIUM_INTERPRETATION },
  { pattern: /사고(?:났|났는데|났어).{0,12}(?:받을|청구|보험금)/, intent: SALES_DIRECTOR_JUDGMENT_INTENTS.ACCIDENT_CLAIM },
  { pattern: /운전자\s*보험.{0,16}(?:받을|청구|보험금|나올)/, intent: SALES_DIRECTOR_JUDGMENT_INTENTS.CLAIM_OPPORTUNITY },
  { pattern: /실손\s*유지/, intent: SALES_DIRECTOR_JUDGMENT_INTENTS.POLICY_REVIEW },
  { pattern: /중복\s*보험/, intent: SALES_DIRECTOR_JUDGMENT_INTENTS.INSURANCE_CHECKUP },
  { pattern: /(?:지금\s*)?보험\s*해지/, intent: SALES_DIRECTOR_JUDGMENT_INTENTS.POLICY_REVIEW },
  { pattern: /뭐(?:부터|를\s*먼저)\s*고치|어디(?:부터|를\s*먼저)\s*(?:고치|손)/, intent: SALES_DIRECTOR_JUDGMENT_INTENTS.RECOMMENDATION_REASON },
  { pattern: /놓친\s*보험금|못\s*받은\s*보험금/, intent: SALES_DIRECTOR_JUDGMENT_INTENTS.CLAIM_OPPORTUNITY },
  { pattern: /보장\s*(?:분석|점검|검토)|보험\s*(?:점검|진단|검토)/, intent: SALES_DIRECTOR_JUDGMENT_INTENTS.INSURANCE_CHECKUP },
];

const INFO_LISTING_PATTERNS = [
  /^보험(?:은|이)\s*\d+\s*건/,
  /^현재\s*\d+\s*건의\s*보험/,
  /^월\s*보험료(?:는|가)\s*[\d,]+원/,
  /^확인(?:된| 가능한)\s*월\s*보험료/,
  /^\d+\s*건(?:\s*확인|\s*가입)/,
];

const REDIRECT_PATTERNS = [/AI\s*상담실/i, /다른\s*메뉴/i, /이동(?:해|하)/i];
const STANDALONE_UPLOAD_PATTERNS = [/^보장내역(?:서)?(?:를|을)\s*올려\s*주세요[.!]?$/i];

const INTERPRETATION_MARKERS =
  /전체\s*그림|돈이\s*새|겹치|비어\s*있|먼저\s*볼|의미|해석|중요한\s*건|가능성|여지|관점|관심\s*축|우선/i;
const SHOCK_MARKERS =
  /맞는데|어\?|잠깐|어떻게\s*알|겹치는\s*곳|돈이\s*새|전체\s*그림|개수가\s*아니라|놓친\s*항목|있는데도\s*불안/i;
const NEXT_ACTION_MARKERS = /먼저\s*짚|다음\s*으로|말씀해\s*주|확인해\s*드리|같이\s*볼|보면\s*됩니다|짚어\s*드리/i;

const CUSTOMER_SPECIFIC_RISK_PATTERNS = [
  /(?:암|실손|운전자|뇌|심)[^\n]{0,8}(?:이|은|가)\s*(?:부족|없(?:습니다|어요|음))/,
  /(?:암|실손|운전|보장|담보|보험).{0,12}(?:부족합니다|없습니다|없어요|충분합니다|괜찮습니다)/,
  /중복\s*(?:담보|보험)?(?:이|가)\s*(?:있(?:습니다|어요|음)|확인)/,
  /(?:자부상|자상)\s*(?:이|가)?\s*없/,
  /겹치(?:는|는\s*곳)[^\n]{0,12}(?:두껍|많)/,
  /비(?:는|어\s*있는)\s*곳[^\n]{0,12}(?:비어|공백)/,
];

const FALSE_ASSERTION_PATTERNS = [
  { pattern: /(?:반드시|확실히)\s*부족/, requires: "gap_shortage" },
  { pattern: /(?:암|실손|운전|보장|담보|보험).{0,12}(?:충분합니다|괜찮습니다)/, requires: "gap_maintained" },
  { pattern: /(?:암|실손|운전자)[^\n]{0,6}(?:이|은)\s*부족/, requires: "gap_shortage_labeled" },
  { pattern: /중복\s*(?:담보|보험)?(?:이|가)\s*있(?:습니다|어요)/, requires: "gap_duplicate" },
  { pattern: /받을\s*수\s*있(?:습니다|어요)(?![^\n]{0,12}(?:가능성|여지|볼|확인))/, requires: "claim_evidence" },
];

function normalizeQuestion(question = "") {
  return String(question ?? "").replace(/\s+/g, " ").trim();
}

function normalizeText(text = "") {
  return String(text ?? "").replace(/\s+/g, " ").trim();
}

function statement(text = "", basis = STATEMENT_BASIS.INSIGHT, evidenceKey = null) {
  return {
    text: normalizeText(text),
    basis,
    evidence_key: evidenceKey,
  };
}

function hasPolicyEvidence(factBundle = {}) {
  return (factBundle.policy_count ?? 0) > 0 || (factBundle.policies?.length ?? 0) > 0;
}

function hasPremiumEvidence(factBundle = {}) {
  return Boolean(factBundle?.premium_stats?.premiumKnownCount > 0);
}

function hasCoverageAnalysis(factBundle = {}) {
  return Boolean(factBundle.has_stored_coverage_analysis || factBundle.coverage_gap_used);
}

function parseGapSignals(factBundle = {}) {
  const raw = factBundle.coverage_gap_signals ?? [];
  return raw
    .map((signal) => {
      const [label, status] = String(signal).split(":");
      return { label: (label ?? "").trim(), status: (status ?? "").trim() };
    })
    .filter((item) => item.label);
}

function gapConcerns(factBundle = {}) {
  const concerns = factBundle.coverage_gap_top_concerns ?? [];
  if (concerns.length) return concerns;
  return parseGapSignals(factBundle)
    .filter((item) => ["부족", "공백", "점검", "미확인"].includes(item.status))
    .map((item) => item.label);
}

function gapDuplicates(factBundle = {}) {
  return parseGapSignals(factBundle)
    .filter((item) => item.status === "중복")
    .map((item) => item.label);
}

function gapMaintained(factBundle = {}) {
  const maintained = factBundle.coverage_gap_maintained ?? [];
  if (maintained.length) return maintained;
  return parseGapSignals(factBundle)
    .filter((item) => item.status === "유지")
    .map((item) => item.label);
}

function gapShortages(factBundle = {}) {
  return parseGapSignals(factBundle)
    .filter((item) => ["부족", "공백"].includes(item.status))
    .map((item) => ({ label: item.label, status: item.status }));
}

function detectQuestionCategory(question = "") {
  const text = normalizeQuestion(question).toLowerCase();
  for (const [category, config] of Object.entries(LOOKUP_CATEGORIES)) {
    if (config.keywords.some((keyword) => text.includes(String(keyword).toLowerCase()))) {
      return { category, label: config.label };
    }
  }
  return { category: null, label: null };
}

export function extractFactBundleEvidence(factBundle = {}) {
  const evidence = {
    gap_shortages: gapShortages(factBundle),
    gap_duplicates: gapDuplicates(factBundle),
    gap_maintained: gapMaintained(factBundle),
    gap_concerns: gapConcerns(factBundle),
    has_coverage_analysis: hasCoverageAnalysis(factBundle),
    has_policies: hasPolicyEvidence(factBundle),
    has_premium: hasPremiumEvidence(factBundle),
    policy_absent_categories: [],
    policy_present_categories: [],
  };

  const topic = detectQuestionCategory(factBundle.question ?? "");
  if (topic.category && hasPolicyEvidence(factBundle)) {
    const match = matchPolicyToCategory(factBundle.policies ?? [], topic.category);
    if (match.found && match.confidence === "high") {
      evidence.policy_present_categories.push(topic.label);
    } else if (!match.found) {
      evidence.policy_absent_categories.push(topic.label);
    }
  }

  return evidence;
}

export function resolveSalesDirectorJudgmentIntent(classificationIntent = "", question = "") {
  const q = normalizeQuestion(question);
  if (!q) return null;

  for (const rule of QUESTION_INTENT_RULES) {
    if (rule.pattern.test(q)) return rule.intent;
  }

  if (
    classificationIntent === "factual_lookup" &&
    COVERAGE_PRESENCE_JUDGMENT_RE.test(q)
  ) {
    return SALES_DIRECTOR_JUDGMENT_INTENTS.COVERAGE_JUDGMENT;
  }

  switch (classificationIntent) {
    case "coverage_gap_check":
      return SALES_DIRECTOR_JUDGMENT_INTENTS.COVERAGE_JUDGMENT;
    case "claim_eligibility_check":
      return SALES_DIRECTOR_JUDGMENT_INTENTS.CLAIM_OPPORTUNITY;
    case "coverage_review_request":
      return SALES_DIRECTOR_JUDGMENT_INTENTS.INSURANCE_CHECKUP;
    case "recommendation_request":
      return SALES_DIRECTOR_JUDGMENT_INTENTS.RECOMMENDATION_REASON;
    case "design_request":
      return SALES_DIRECTOR_JUDGMENT_INTENTS.DESIGN_QUESTION;
    case "general_consultation":
      return GENERAL_JUDGMENT_SIGNAL.test(q)
        ? SALES_DIRECTOR_JUDGMENT_INTENTS.GENERAL_INSURANCE_JUDGMENT
        : null;
    default:
      return null;
  }
}

export function shouldApplySalesDirectorFormatter(
  classificationIntent = "",
  question = "",
  opts = {},
) {
  return shouldApplyHumanUnderstandingLoop(classificationIntent, question, opts);
}

function insightRiskForTopic(topicLabel = null) {
  if (topicLabel === "암") {
    return "보험은 충분해 보여도 암보장은 의외로 부족한 경우가 많습니다. 암 영역은 반드시 먼저 확인해야 합니다.";
  }
  if (topicLabel) {
    return `${topicLabel} 영역은 반드시 먼저 확인해야 합니다. 겉으로는 괜찮아 보여도 구조를 열어봐야 합니다.`;
  }
  return "보험이 없어서 불안한 게 아니라, 보험이 있는데도 불안한 경우가 많습니다.";
}

function insightSurpriseForIntent(intent = null) {
  switch (intent) {
    case SALES_DIRECTOR_JUDGMENT_INTENTS.COVERAGE_JUDGMENT:
      return "보험이 없어서 불안한 게 아니라, 보험이 있는데도 불안한 경우가 많습니다.";
    case SALES_DIRECTOR_JUDGMENT_INTENTS.PREMIUM_INTERPRETATION:
      return "보험료가 문제처럼 보여도, 제가 먼저 보는 건 금액이 아니라 돈이 어디에 묶여 있느냐입니다.";
    case SALES_DIRECTOR_JUDGMENT_INTENTS.INSURANCE_CHECKUP:
      return "점검에서 중요한 건 보험 개수가 아니라, 같은 사고에 돈이 두 번 안 나가게 설계됐는지입니다.";
    case SALES_DIRECTOR_JUDGMENT_INTENTS.CLAIM_OPPORTUNITY:
    case SALES_DIRECTOR_JUDGMENT_INTENTS.ACCIDENT_CLAIM:
      return "사고가 났다고 해서 모든 보험이 자동으로 반응하지는 않습니다. 어떤 축이 열려 있는지부터 봐야 합니다.";
    default:
      return "많은 분이 보험 개수로 안심하는데, 실제로는 겹침과 공백이 동시에 있는 경우가 많습니다.";
  }
}

function formatConfirmedPremiumEvidence(stats = null) {
  if (!(stats?.premiumKnownCount > 0 && stats?.premiumTotal > 0)) return null;
  return `현재 확인 가능한 월 보험료는 ${stats.premiumTotal.toLocaleString("ko-KR")}원입니다.`;
}

function formatPremiumUnknownLimitation() {
  return "일부 보험료는 아직 숫자로 확인 전입니다.";
}

function isJudgmentGapIntent(intent = null) {
  return JUDGMENT_GAP_INTENTS.has(intent);
}

function pickGapSignalForQuestion(factBundle = {}) {
  const signals = parseGapSignals(factBundle);
  if (!signals.length) return null;

  const topic = detectQuestionCategory(factBundle.question ?? "");
  if (topic.label) {
    const topicMatch = signals.find((item) => item.label === topic.label);
    if (topicMatch) return topicMatch;
  }

  const concernLabels = factBundle.coverage_gap_top_concerns ?? gapConcerns(factBundle);
  for (const label of concernLabels) {
    const concernMatch = signals.find((item) => item.label === label);
    if (concernMatch) return concernMatch;
  }

  const priorityStatuses = ["부족", "공백", "점검", "미확인", "중복", "유지"];
  for (const status of priorityStatuses) {
    const statusMatch = signals.find((item) => item.status === status);
    if (statusMatch) return statusMatch;
  }

  return signals[0] ?? null;
}

function gapEvidenceFromSignal(signal = null) {
  if (!signal?.label) return null;
  const { label, status } = signal;

  if (status === "유지") {
    return statement(
      `저장된 분석 기준으로 ${label} 쪽은 지금 구조에서 유지하는 축으로 보입니다.`,
      STATEMENT_BASIS.EVIDENCE,
      `gap_maintained:${label}`,
    );
  }

  if (status === "중복") {
    return statement(
      `저장된 분석 기준으로 ${label} 담보가 겹쳐 있을 수 있습니다.`,
      STATEMENT_BASIS.EVIDENCE,
      `gap_duplicate:${label}`,
    );
  }

  if (status === "부족" || status === "공백") {
    return statement(
      `저장된 분석 기준으로 ${label} 쪽은 먼저 볼 여지가 있습니다.`,
      STATEMENT_BASIS.EVIDENCE,
      `gap_shortage:${label}`,
    );
  }

  if (status === "점검" || status === "미확인") {
    return statement(
      `저장된 분석 기준으로 ${label} 쪽은 함께 점검할 여지가 있습니다.`,
      STATEMENT_BASIS.EVIDENCE,
      `gap_concern:${label}`,
    );
  }

  return null;
}

function gapLoadedLimitationStatement() {
  return statement(
    "저장된 보장 분석은 있지만, 이 질문 축에 맞는 항목은 아직 좁히기 어렵습니다.",
    STATEMENT_BASIS.INSIGHT,
    "gap_topic_limitation",
  );
}

export function selectMostImportantRisk(factBundle = {}, intent = null) {
  const evidence = extractFactBundleEvidence(factBundle);
  const topic = detectQuestionCategory(factBundle.question ?? "");

  if (intent === SALES_DIRECTOR_JUDGMENT_INTENTS.PREMIUM_INTERPRETATION) {
    const premiumLine = formatConfirmedPremiumEvidence(factBundle.premium_stats);
    if (premiumLine) {
      return statement(premiumLine, STATEMENT_BASIS.EVIDENCE, "premium_stats");
    }
    if (hasPolicyEvidence(factBundle)) {
      return statement(
        formatPremiumUnknownLimitation(),
        STATEMENT_BASIS.INSIGHT,
        "premium_unknown",
      );
    }
  }

  if (isJudgmentGapIntent(intent)) {
    if (evidence.has_coverage_analysis) {
      const gapLine = gapEvidenceFromSignal(pickGapSignalForQuestion(factBundle));
      if (gapLine) return gapLine;
      return gapLoadedLimitationStatement();
    }
    if (evidence.has_policies) {
      return statement(
        "가입은 보이지만 담보 구조가 아직 안 보이면, 겉으론 괜찮아도 속이 비어 있을 수 있습니다.",
        STATEMENT_BASIS.INSIGHT,
        "structure_unknown",
      );
    }
  }

  if (!isJudgmentGapIntent(intent) && evidence.gap_shortages.length) {
    const primary = evidence.gap_shortages[0];
    const statusWord = primary.status === "공백" ? "공백" : "부족";
    return statement(
      `확인된 자료 기준으로 ${primary.label} 보장 쪽은 ${statusWord} 신호가 있습니다.`,
      STATEMENT_BASIS.EVIDENCE,
      `gap_shortage:${primary.label}`,
    );
  }

  if (!isJudgmentGapIntent(intent) && evidence.gap_duplicates.length) {
    return statement(
      `확인된 자료 기준으로 ${evidence.gap_duplicates[0]} 담보 중복 신호가 있습니다.`,
      STATEMENT_BASIS.EVIDENCE,
      `gap_duplicate:${evidence.gap_duplicates[0]}`,
    );
  }

  if (!isJudgmentGapIntent(intent) && evidence.policy_absent_categories.length) {
    const label = evidence.policy_absent_categories[0];
    return statement(
      `등록된 보험 목록에서는 ${label} 관련 계약이 아직 확인되지 않았습니다.`,
      STATEMENT_BASIS.EVIDENCE,
      `policy_absent:${label}`,
    );
  }

  if (!isJudgmentGapIntent(intent) && evidence.policy_present_categories.length) {
    const label = evidence.policy_present_categories[0];
    return statement(
      `${label} 관련 계약은 보이지만, 한도·특약 구조까지는 보장내역 확인이 필요합니다.`,
      STATEMENT_BASIS.EVIDENCE,
      `policy_present:${label}`,
    );
  }

  if (
    (intent === SALES_DIRECTOR_JUDGMENT_INTENTS.CLAIM_OPPORTUNITY ||
      intent === SALES_DIRECTOR_JUDGMENT_INTENTS.ACCIDENT_CLAIM) &&
    !evidence.has_coverage_analysis
  ) {
    return statement(
      "사고·치료 사실만으로는 청구 가능 여부를 단정할 수 없습니다. 보장 구조 확인이 먼저입니다.",
      STATEMENT_BASIS.INSIGHT,
      "claim_structure_unknown",
    );
  }

  if (evidence.has_policies && !evidence.has_coverage_analysis) {
    return statement(
      "가입은 보이지만 담보 구조가 아직 안 보이면, 겉으론 괜찮아도 속이 비어 있을 수 있습니다.",
      STATEMENT_BASIS.INSIGHT,
      "structure_unknown",
    );
  }

  if (isJudgmentGapIntent(intent)) {
    return statement(insightSurpriseForIntent(intent), STATEMENT_BASIS.INSIGHT, "general_surprise");
  }

  return statement(insightRiskForTopic(topic.label), STATEMENT_BASIS.INSIGHT, "general_risk");
}

export function selectMostImportantOpportunity(factBundle = {}, intent = null) {
  const evidence = extractFactBundleEvidence(factBundle);

  if (evidence.gap_maintained.length) {
    return statement(
      `확인된 자료 기준으로 ${evidence.gap_maintained[0]} 쪽은 유지 신호가 있어, 다른 축을 손볼 때 기준점으로 삼을 수 있습니다.`,
      STATEMENT_BASIS.EVIDENCE,
      `gap_maintained:${evidence.gap_maintained[0]}`,
    );
  }

  if (evidence.gap_duplicates.length) {
    return statement(
      `중복으로 확인된 ${evidence.gap_duplicates[0]} 담보를 정리하면, 같은 예산으로 다른 공백을 메울 여지가 있습니다.`,
      STATEMENT_BASIS.EVIDENCE,
      `gap_duplicate_opportunity:${evidence.gap_duplicates[0]}`,
    );
  }

  if (intent === SALES_DIRECTOR_JUDGMENT_INTENTS.PREMIUM_INTERPRETATION) {
    return statement(
      "보험료 부담이 크게 느껴질 때일수록, 중복·약한 담보부터 정리하면 같은 돈으로 방어력을 올릴 여지가 있습니다.",
      STATEMENT_BASIS.INSIGHT,
      "premium_rebalance",
    );
  }

  if (
    intent === SALES_DIRECTOR_JUDGMENT_INTENTS.CLAIM_OPPORTUNITY ||
    intent === SALES_DIRECTOR_JUDGMENT_INTENTS.ACCIDENT_CLAIM
  ) {
    return statement(
      "사고·치료 이력과 보장 구조를 맞춰 보면, 받을 여지가 있는지부터 확인할 기회가 있습니다.",
      STATEMENT_BASIS.INSIGHT,
      "claim_review",
    );
  }

  if (intent === SALES_DIRECTOR_JUDGMENT_INTENTS.RECOMMENDATION_REASON) {
    return statement(
      "무엇을 더 넣기 전에, 지금 돈이 새는 곳부터 줄이면 같은 예산으로 체감 보장을 올릴 수 있습니다.",
      STATEMENT_BASIS.INSIGHT,
      "priority_rebalance",
    );
  }

  if (evidence.has_policies && !evidence.has_coverage_analysis) {
    return statement(
      "보장내역 확인이 되면, 어디를 유지하고 어디를 손볼지 우선순위를 바로 잡을 수 있습니다.",
      STATEMENT_BASIS.INSIGHT,
      "awaiting_coverage_detail",
    );
  }

  return statement(
    "자료가 조금만 더 모이면, 어디를 유지하고 어디를 손볼지 우선순위를 바로 잡을 수 있습니다.",
    STATEMENT_BASIS.INSIGHT,
    "awaiting_materials",
  );
}

export function selectMostSurprisingInsight(factBundle = {}, intent = null) {
  const evidence = extractFactBundleEvidence(factBundle);

  if (evidence.gap_shortages.length) {
    const labels = evidence.gap_shortages.slice(0, 2).map((item) => item.label);
    return statement(
      `확인된 자료 기준으로 ${labels.join("·")} 쪽이 먼저 눈에 띕니다. 겉보기와 다를 수 있습니다.`,
      STATEMENT_BASIS.EVIDENCE,
      `gap_shortage_surprise:${labels.join("|")}`,
    );
  }

  if (evidence.gap_duplicates.length) {
    return statement(
      `확인된 자료 기준으로 ${evidence.gap_duplicates[0]} 담보가 겹쳐 있을 수 있습니다. 같은 돈이 두 번 일하는 구조일 수 있습니다.`,
      STATEMENT_BASIS.EVIDENCE,
      `gap_duplicate_surprise:${evidence.gap_duplicates[0]}`,
    );
  }

  if (intent === SALES_DIRECTOR_JUDGMENT_INTENTS.COVERAGE_JUDGMENT && evidence.has_policies && evidence.has_coverage_analysis) {
    return statement(
      "겹치는 곳은 두껍고, 비어 있는 곳은 비어 있을 가능성이 있습니다.",
      STATEMENT_BASIS.EVIDENCE,
      "coverage_analysis_portfolio",
    );
  }

  return statement(insightSurpriseForIntent(intent), STATEMENT_BASIS.INSIGHT, "general_surprise");
}

export function buildInterpretationSentence(factBundle = {}, intent = null) {
  switch (intent) {
    case SALES_DIRECTOR_JUDGMENT_INTENTS.COVERAGE_JUDGMENT:
      return "다만 지금 중요한 건 보험 개수가 아니라 전체 그림입니다.";
    case SALES_DIRECTOR_JUDGMENT_INTENTS.PREMIUM_INTERPRETATION:
      return "보험료가 크게 느껴질 때일수록, 숫자보다 구조를 먼저 봐야 합니다.";
    case SALES_DIRECTOR_JUDGMENT_INTENTS.ACCIDENT_CLAIM:
    case SALES_DIRECTOR_JUDGMENT_INTENTS.CLAIM_OPPORTUNITY:
      return "청구 가능 여부는 사고 사실만으로가 아니라, 어떤 보장 축이 열려 있는지로 갈립니다.";
    case SALES_DIRECTOR_JUDGMENT_INTENTS.POLICY_REVIEW:
      return "유지·해지는 감정이 아니라, 지금 포트폴리오에서 그 보험이 어떤 역할을 하는지로 봐야 합니다.";
    case SALES_DIRECTOR_JUDGMENT_INTENTS.INSURANCE_CHECKUP:
      return "중복은 낭비처럼 보이지만, 진짜 문제는 중복과 공백이 동시에 있는지입니다.";
    case SALES_DIRECTOR_JUDGMENT_INTENTS.RECOMMENDATION_REASON:
      return "뭘 더 넣기 전에, 지금 구조에서 손대야 할 순서가 있습니다.";
    case SALES_DIRECTOR_JUDGMENT_INTENTS.DESIGN_QUESTION:
      return "설계는 상품 고르기가 아니라, 고객 상황에 맞는 우선순위를 정하는 일입니다.";
    default:
      return "지금 필요한 건 정보 더하기보다, 이미 있는 자료를 어떻게 읽을지입니다.";
  }
}

export function buildNextAction(intent = null, missingFacts = {}) {
  if (missingFacts.needsCoverageDetail) {
    return "보장내역 확인이 되면 부족·충분 여부와 겹치는 담보를 바로 짚어 드릴게요.";
  }
  if (missingFacts.needsClaimContext) {
    return "사고·치료 시점과 어떤 보험에 가입돼 있는지만 알려주시면, 받을 여지부터 같이 볼게요.";
  }

  switch (intent) {
    case SALES_DIRECTOR_JUDGMENT_INTENTS.COVERAGE_JUDGMENT:
    case SALES_DIRECTOR_JUDGMENT_INTENTS.INSURANCE_CHECKUP:
      return "제가 먼저 볼 건 딱 세 가지입니다. 돈이 새는 곳, 크게 비어 있는 보장, 청구할 수 있는데 놓친 항목입니다. 현재 확인된 자료 기준으로 먼저 짚어드리겠습니다.";
    case SALES_DIRECTOR_JUDGMENT_INTENTS.PREMIUM_INTERPRETATION:
      return "가장 부담되는 보험료가 어디서 나오는지부터 같이 보면, 줄일지 유지할지 순서가 보입니다.";
    case SALES_DIRECTOR_JUDGMENT_INTENTS.ACCIDENT_CLAIM:
    case SALES_DIRECTOR_JUDGMENT_INTENTS.CLAIM_OPPORTUNITY:
      return "어떤 사고·치료였는지와 가입 보험 종류부터 말씀해 주시면, 열려 있는 축부터 확인해 드릴게요.";
    case SALES_DIRECTOR_JUDGMENT_INTENTS.POLICY_REVIEW:
      return "해지·유지 전에, 그 보험이 지금 포트폴리오에서 막아 주는 위험이 무엇인지부터 같이 볼게요.";
    case SALES_DIRECTOR_JUDGMENT_INTENTS.RECOMMENDATION_REASON:
      return "지금 가장 불안한 축 하나만 먼저 말씀해 주시면, 거기부터 손대는 순서를 잡아 드릴게요.";
    default:
      return "걱정되는 축 하나만 먼저 짚고, 확인된 자료 기준으로 같이 보겠습니다.";
  }
}

function buildAcknowledgment(factBundle = {}) {
  if (hasPolicyEvidence(factBundle)) {
    return "보험을 안 챙긴 분은 아닙니다.";
  }
  if ((factBundle.document_count ?? 0) > 0) {
    return "자료를 챙겨 두신 흐름은 보입니다.";
  }
  return "보험을 완전히 방치하신 분은 아닐 수 있습니다.";
}

function buildConfirmedFactsSummary(factBundle = {}) {
  const lines = [];
  const policyCount = factBundle.policy_count ?? factBundle.policies?.length ?? 0;

  if (policyCount > 0) {
    lines.push(`현재 확인된 가입은 ${policyCount}건입니다.`);
  } else {
    lines.push("현재 확인된 가입 정보는 아직 많지 않습니다.");
  }

  const stats = factBundle.premium_stats;
  if (stats?.premiumKnownCount > 0 && stats?.premiumTotal > 0) {
    lines.push("확인 가능한 월 보험료 합계도 함께 보고 있습니다.");
  } else if (hasPolicyEvidence(factBundle)) {
    lines.push("일부 보험료는 아직 숫자로 확인 전입니다.");
  }

  if ((factBundle.document_count ?? 0) > 0) {
    lines.push(`등록된 서류 ${factBundle.document_count}건도 참고 중입니다.`);
  }

  if (!hasCoverageAnalysis(factBundle) && hasPolicyEvidence(factBundle)) {
    lines.push("다만 담보 구조·한도는 아직 전체 그림 단계입니다.");
  }

  return lines.join(" ");
}

function collectMissingFacts(factBundle = {}, intent = null) {
  return {
    needsCoverageDetail: hasPolicyEvidence(factBundle) && !hasCoverageAnalysis(factBundle),
    needsClaimContext:
      (intent === SALES_DIRECTOR_JUDGMENT_INTENTS.CLAIM_OPPORTUNITY ||
        intent === SALES_DIRECTOR_JUDGMENT_INTENTS.ACCIDENT_CLAIM) &&
      !hasCoverageAnalysis(factBundle),
  };
}

function isInfoListingOnly(text = "") {
  const normalized = normalizeText(text);
  if (!normalized) return true;
  if (INFO_LISTING_PATTERNS.some((pattern) => pattern.test(normalized))) return true;
  const sentences = normalized.split(/(?<=[.!?])\s+/).filter(Boolean);
  if (sentences.length <= 2 && /\d+\s*건|[\d,]+원/.test(normalized) && !INTERPRETATION_MARKERS.test(normalized)) {
    return true;
  }
  return false;
}

function stripForbiddenPhrases(text = "") {
  let sanitized = normalizeText(text);
  for (const pattern of REDIRECT_PATTERNS) {
    sanitized = sanitized.replace(pattern, "");
  }
  if (STANDALONE_UPLOAD_PATTERNS.some((pattern) => pattern.test(sanitized))) {
    sanitized = "";
  }
  return sanitized.trim();
}

function formatRiskOpportunityLine(prefix, item) {
  return `${prefix}: ${item.text}`;
}

function composeStructuredResponse(factBundle = {}, intent = null) {
  const missingFacts = collectMissingFacts(factBundle, intent);
  const risk = selectMostImportantRisk(factBundle, intent);
  const opportunity = selectMostImportantOpportunity(factBundle, intent);
  const surprise = selectMostSurprisingInsight(factBundle, intent);

  const parts = [
    buildAcknowledgment(factBundle),
    surprise.text,
    buildInterpretationSentence(factBundle, intent),
    formatRiskOpportunityLine("가장 큰 위험", risk),
    formatRiskOpportunityLine("가장 큰 기회", opportunity),
    buildNextAction(intent, missingFacts),
    buildConfirmedFactsSummary(factBundle),
  ];
  return {
    text: parts.filter(Boolean).join("\n\n"),
    risk,
    opportunity,
    surprise,
  };
}

function hasEvidenceForAssertion(factBundle = {}, requirement = "") {
  const evidence = extractFactBundleEvidence(factBundle);
  switch (requirement) {
    case "gap_shortage":
    case "gap_shortage_labeled":
      return evidence.gap_shortages.length > 0 || evidence.gap_concerns.length > 0;
    case "gap_maintained":
      return evidence.gap_maintained.length > 0;
    case "gap_duplicate":
      return evidence.gap_duplicates.length > 0;
    case "claim_evidence":
      return evidence.has_coverage_analysis;
    default:
      return false;
  }
}

export function detectFalseAssertions(text = "", factBundle = {}) {
  const normalized = normalizeText(text);
  for (const rule of FALSE_ASSERTION_PATTERNS) {
    if (rule.pattern.test(normalized) && !hasEvidenceForAssertion(factBundle, rule.requires)) {
      return true;
    }
  }
  for (const pattern of CUSTOMER_SPECIFIC_RISK_PATTERNS) {
    if (pattern.test(normalized) && !hasCoverageAnalysis(factBundle) && gapShortages(factBundle).length === 0) {
      return true;
    }
  }
  return false;
}

export function validateStatementBasis(item = {}) {
  if (!item?.text) return { valid: false, reason: "empty" };
  if (![STATEMENT_BASIS.EVIDENCE, STATEMENT_BASIS.INSIGHT].includes(item.basis)) {
    return { valid: false, reason: "missing_basis" };
  }
  if (item.basis === STATEMENT_BASIS.EVIDENCE && !item.evidence_key) {
    return { valid: false, reason: "evidence_missing_key" };
  }
  if (item.basis === STATEMENT_BASIS.INSIGHT && detectFalseAssertions(item.text, {})) {
    return { valid: false, reason: "insight_contains_customer_assertion" };
  }
  return { valid: true, reason: null };
}

export function finalizeSalesDirectorResponse({
  rawText = "",
  intent = null,
  classificationIntent = null,
  surface = null,
  factBundle = {},
  customerState = null,
  homeBrainIntent = null,
  homeRoute = null,
  homeVerifiedIntents = null,
  conversationContext = null,
} = {}) {
  return finalizeHumanSalesDirectorResponse({
    rawText,
    intent,
    classificationIntent,
    surface,
    factBundle,
    customerState,
    homeBrainIntent,
    homeRoute,
    homeVerifiedIntents,
    conversationContext,
  });
}

export function scoreSalesDirectorAnswer(text = "", factBundle = {}) {
  const normalized = normalizeText(text);
  const infoListingForbidden = !INFO_LISTING_PATTERNS.some((pattern) => pattern.test(normalized));

  const interpretationHits = (normalized.match(new RegExp(INTERPRETATION_MARKERS.source, "gi")) ?? []).length;
  const interpretationScore = Math.min(100, interpretationHits * 25 + (INTERPRETATION_MARKERS.test(normalized) ? 40 : 0));

  const hasRisk = /위험|여지|비어|새는|놓치|공백|확인(?:해야|이\s*필요)/.test(normalized);
  const hasOpportunity = /기회|여지|정리|올릴|메우|줄이/.test(normalized);
  const priorityScore = (hasRisk ? 50 : 0) + (hasOpportunity ? 50 : 0);

  const nextActionScore = NEXT_ACTION_MARKERS.test(normalized) ? 100 : /먼저|다음|같이\s*볼|짚/.test(normalized) ? 60 : 0;

  const falseAssertionFree = detectFalseAssertions(normalized, factBundle) ? "FAIL" : "PASS";

  const shockHits = (normalized.match(new RegExp(SHOCK_MARKERS.source, "gi")) ?? []).length;
  const shockScore = Math.min(100, shockHits * 30 + (SHOCK_MARKERS.test(normalized) ? 25 : 0));

  return {
    info_listing_forbidden: infoListingForbidden ? "PASS" : "FAIL",
    interpretation_score: interpretationScore,
    priority_score: priorityScore,
    next_action_score: nextActionScore,
    false_assertion_free: falseAssertionFree,
    shock_score: shockScore,
  };
}
