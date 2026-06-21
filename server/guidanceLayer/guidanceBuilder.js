/**
 * Step 1-B+ — Shared Guidance Builder (One Brain internal assembler).
 * Not a judgment engine: confirmed facts, blocked reason, next step only.
 */
import { computePremiumLookupStats, LOOKUP_CATEGORIES, matchPolicyToCategory } from "../intentGateLayer.js";
import { isRecommendationReasonClassification } from "../advisorBrain/advisorRecommendationReasonResponder.js";

export const GUIDANCE_INTENTS = {
  GAP: "gap",
  DESIGN: "design",
  RECOMMENDATION: "recommendation",
  GENERAL_JUDGMENT: "general_judgment",
};

const GAP_TOPIC_PRIORITY = ["cancer", "brain", "heart", "medical_expense", "driver"];
const GAP_EVALUATION_TOPICS = ["cancer", "brain", "heart"];

const GENERAL_JUDGMENT_SIGNAL =
  /부족|모자라|충분|괜찮|괜찮아|충분해|어디가\s*부족|공백|갭|가입해야|들어야|추천|보완|설계|구성|플랜|포트폴리오|리밸런싱|재구성|줄이|절감/i;

function normalizeQuestion(question = "") {
  return String(question ?? "").replace(/\s+/g, " ").trim();
}

export function buildFactBundleFromCentralBrainBundle(bundle, question = "") {
  const data = bundle?.data ?? {};
  const unified = data.unified ?? {};
  const policies = unified.policies ?? [];

  return buildFactBundle({
    policies,
    policy_count: data.policy_count ?? unified.policy_count ?? policies.length,
    document_count: unified.document_count ?? 0,
    premium_stats: data.premium_stats ?? computePremiumLookupStats(policies),
    memory_fact_count: unified.memory_fact_count ?? data.memory?.fact_count ?? 0,
    question,
    has_stored_coverage_analysis: Boolean(
      data.stored_panels?.coverageGapResult ||
        data.stored_panels?.coverage_gap ||
        data.stored_panels?.coverage_gap_result,
    ),
    has_stored_design_analysis: Boolean(data.stored_panels?.designBundle),
    has_stored_recommendation_analysis: Boolean(
      data.stored_panels?.recommendationResult || data.stored_job?.result_json?.recommendation,
    ),
  });
}

export function buildFactBundleFromLegacyContext({
  sourceContext = null,
  snapshot = null,
  question = "",
  cachePayload = null,
  analysisContext = null,
} = {}) {
  const policies = sourceContext?.policies ?? [];
  return buildFactBundle({
    policies,
    policy_count: policies.length,
    document_count: sourceContext?.has_documents ? (sourceContext?.documents?.length ?? 1) : 0,
    premium_stats: computePremiumLookupStats(policies),
    memory_fact_count: snapshot?.fact_count ?? 0,
    question,
    has_stored_coverage_analysis: Boolean(
      analysisContext?.coverageGapResult || cachePayload?.coverage_gap_result,
    ),
    has_stored_design_analysis: Boolean(analysisContext?.designBundle),
    has_stored_recommendation_analysis: Boolean(analysisContext?.recommendationResult),
    cache_status: cachePayload?.cache_status ?? null,
  });
}

export function buildFactBundleFromUnified(unified, question = "") {
  const policies = unified?.policies ?? [];
  return buildFactBundle({
    policies,
    policy_count: unified?.policy_count ?? policies.length,
    document_count: unified?.document_count ?? 0,
    premium_stats: computePremiumLookupStats(policies),
    memory_fact_count: unified?.memory_fact_count ?? 0,
    question,
    has_stored_coverage_analysis: false,
    has_stored_design_analysis: false,
    has_stored_recommendation_analysis: false,
  });
}

function buildFactBundle({
  policies = [],
  policy_count = 0,
  document_count = 0,
  premium_stats = null,
  memory_fact_count = 0,
  question = "",
  has_stored_coverage_analysis = false,
  has_stored_design_analysis = false,
  has_stored_recommendation_analysis = false,
  cache_status = null,
} = {}) {
  return {
    policy_count: Number(policy_count ?? policies.length ?? 0),
    document_count: Number(document_count ?? 0),
    premium_stats,
    memory_fact_count: Number(memory_fact_count ?? 0),
    policies,
    question: normalizeQuestion(question),
    has_stored_coverage_analysis,
    has_stored_design_analysis,
    has_stored_recommendation_analysis,
    cache_status,
  };
}

export function resolveGuidanceIntent(classificationIntent, question = "") {
  const intent = String(classificationIntent ?? "").trim();
  const text = normalizeQuestion(question);
  if (!intent || !text) return null;
  if (intent === "coverage_gap_check") return GUIDANCE_INTENTS.GAP;
  if (intent === "design_request") return GUIDANCE_INTENTS.DESIGN;
  if (intent === "recommendation_request") {
    return isRecommendationReasonClassification({ intent }, text)
      ? null
      : GUIDANCE_INTENTS.RECOMMENDATION;
  }
  if (intent === "general_consultation" && GENERAL_JUDGMENT_SIGNAL.test(text)) {
    return GUIDANCE_INTENTS.GENERAL_JUDGMENT;
  }
  return null;
}

function detectGapTopicCategory(question = "") {
  const text = normalizeQuestion(question).toLowerCase();
  for (const category of GAP_TOPIC_PRIORITY) {
    const config = LOOKUP_CATEGORIES[category];
    if (!config) continue;
    if (config.keywords.some((keyword) => text.includes(String(keyword).toLowerCase()))) {
      return { category, label: config.label };
    }
  }
  return { category: null, label: "해당 보장" };
}

function buildConfirmedFactsSlot(factBundle, topic = null) {
  const lines = [];
  const policyCount = factBundle.policy_count ?? 0;

  if (policyCount > 0) {
    lines.push(`현재 ${policyCount}건의 보험은 확인됩니다.`);
  }

  const stats = factBundle.premium_stats;
  if (stats?.premiumKnownCount > 0 && stats?.premiumTotal > 0) {
    lines.push(
      `현재 확인 가능한 월 보험료는 ${stats.premiumTotal.toLocaleString("ko-KR")}원입니다.`,
    );
  }

  const gapTopic = topic ?? detectGapTopicCategory(factBundle.question);
  if (gapTopic.category && factBundle.policies?.length) {
    const match = matchPolicyToCategory(factBundle.policies, gapTopic.category);
    if (match.found && match.confidence === "high") {
      lines.push(`등록된 보험 목록에서 ${gapTopic.label} 관련 계약이 확인됩니다.`);
    } else if (match.found && match.confidence === "medium") {
      lines.push(
        `등록된 보험 목록에서 ${gapTopic.label} 관련으로 보이는 계약이 있을 수 있습니다.`,
      );
    }
  }

  if ((factBundle.document_count ?? 0) > 0) {
    lines.push(`등록된 서류 ${factBundle.document_count}건이 확인됩니다.`);
  }

  if ((factBundle.memory_fact_count ?? 0) > 0) {
    lines.push(`등록된 고객 정보 ${factBundle.memory_fact_count}건이 확인됩니다.`);
  }

  if (lines.length === 0) {
    lines.push("현재 등록된 보험·서류 정보가 아직 확인되지 않았습니다.");
  }

  return lines.join(" ");
}

function buildGapBlockedReasonSlot(factBundle, topic) {
  const label = topic.label ?? "해당 보장";
  if (!factBundle.has_stored_coverage_analysis) {
    if (topic.category) {
      return `다만 ${label} 보장 구조와 금액은 저장된 분석 결과로 아직 확인되지 않았습니다.`;
    }
    return "다만 질문하신 보장의 구조와 금액은 저장된 분석 결과로 아직 확인되지 않았습니다.";
  }
  if (topic.category) {
    return `다만 ${label} 보장금액과 담보 구조는 아직 확인되지 않았습니다.`;
  }
  return "다만 질문하신 보장의 금액과 구조는 아직 확인되지 않았습니다.";
}

function buildDesignBlockedReasonSlot(factBundle) {
  if (!factBundle.has_stored_design_analysis && !factBundle.has_stored_coverage_analysis) {
    return "다만 보장 구조와 설계에 필요한 분석 결과가 아직 저장되지 않았습니다.";
  }
  if (!factBundle.has_stored_design_analysis) {
    return "다만 설계안에 필요한 보장·인수 분석이 아직 완료되지 않았습니다.";
  }
  return "다만 현재 저장된 설계 근거만으로는 질문하신 설계 방향을 단정할 수 없습니다.";
}

function buildRecommendationBlockedReasonSlot(factBundle) {
  if (!factBundle.has_stored_recommendation_analysis && !factBundle.has_stored_coverage_analysis) {
    return "다만 추천에 필요한 보장 분석 결과가 아직 저장되지 않았습니다.";
  }
  if (!factBundle.has_stored_recommendation_analysis) {
    return "다만 추천 순위와 근거가 저장된 분석 결과로 아직 확인되지 않았습니다.";
  }
  return "다만 현재 저장된 추천 근거만으로는 질문하신 내용을 단정할 수 없습니다.";
}

function buildGeneralBlockedReasonSlot(factBundle) {
  if (!factBundle.has_stored_coverage_analysis) {
    return "다만 보장 구조와 금액이 저장된 분석 결과로 아직 확인되지 않았습니다.";
  }
  return "다만 질문하신 보장 상태를 단정할 수 있는 근거가 아직 충분하지 않습니다.";
}

function buildGapNextStepSlot(question, topic) {
  const text = normalizeQuestion(question);
  const label = topic.label ?? "보장";
  const evaluationLabels = GAP_EVALUATION_TOPICS.map(
    (key) => LOOKUP_CATEGORIES[key]?.label ?? key,
  ).join("·");

  if (/부족|모자라|없/.test(text) && topic.category) {
    return `${label}보험이 부족한지는 보장금액과 담보 구조를 확인해야 판단할 수 있습니다. 보장내역서를 분석하면 ${evaluationLabels} 보장을 바로 평가해 드릴게요.`;
  }

  return `${label} 보장 상태를 단정하려면 보장금액과 담보 구조를 확인해야 판단할 수 있습니다. 보장내역서를 분석하면 ${evaluationLabels} 보장을 바로 평가해 드릴게요.`;
}

function buildDesignNextStepSlot() {
  return "설계 방향을 정확히 안내하려면 보장내역서와 현재 보유 계약을 함께 분석해야 합니다. 분석이 완료되면 예산과 목표에 맞는 설계 초안을 바로 정리해 드릴게요.";
}

function buildRecommendationNextStepSlot() {
  return "무엇을 우선 검토해야 할지 판단하려면 보장 공백과 추천 근거를 함께 확인해야 합니다. 보장내역서를 분석하면 우선순위를 바로 정리해 드릴게요.";
}

function buildGeneralNextStepSlot() {
  return "질문하신 보장 상태를 정확히 안내하려면 보장내역서와 현재 계약을 함께 확인해야 합니다. 분석이 완료되면 확인된 근거만으로 바로 설명해 드릴게요.";
}

function composeGuidance(confirmedFacts, blockedReason, nextStep) {
  return {
    confirmedFacts,
    blockedReason,
    nextStep,
    message: [confirmedFacts, blockedReason, nextStep].join(" "),
  };
}

export function buildGapGuidance(factBundle) {
  const topic = detectGapTopicCategory(factBundle.question);
  return composeGuidance(
    buildConfirmedFactsSlot(factBundle, topic),
    buildGapBlockedReasonSlot(factBundle, topic),
    buildGapNextStepSlot(factBundle.question, topic),
  );
}

export function buildDesignGuidance(factBundle) {
  return composeGuidance(
    buildConfirmedFactsSlot(factBundle),
    buildDesignBlockedReasonSlot(factBundle),
    buildDesignNextStepSlot(),
  );
}

export function buildRecommendationGuidance(factBundle) {
  return composeGuidance(
    buildConfirmedFactsSlot(factBundle),
    buildRecommendationBlockedReasonSlot(factBundle),
    buildRecommendationNextStepSlot(),
  );
}

export function buildGeneralJudgmentGuidance(factBundle) {
  return composeGuidance(
    buildConfirmedFactsSlot(factBundle),
    buildGeneralBlockedReasonSlot(factBundle),
    buildGeneralNextStepSlot(),
  );
}

export function buildGuidanceResponse(intent, factBundle, { question } = {}) {
  const bundle = {
    ...factBundle,
    question: normalizeQuestion(question ?? factBundle?.question ?? ""),
  };

  switch (intent) {
    case GUIDANCE_INTENTS.GAP:
    case "gap":
      return buildGapGuidance(bundle).message;
    case GUIDANCE_INTENTS.DESIGN:
    case "design":
      return buildDesignGuidance(bundle).message;
    case GUIDANCE_INTENTS.RECOMMENDATION:
    case "recommendation":
      return buildRecommendationGuidance(bundle).message;
    case GUIDANCE_INTENTS.GENERAL_JUDGMENT:
    case "general_judgment":
      return buildGeneralJudgmentGuidance(bundle).message;
    default:
      throw new Error(`unknown_guidance_intent:${intent}`);
  }
}

/** Non-gap partial CB modes until fully migrated. */
export function buildInterimPartialGuidanceMessage(bundle) {
  const factBundle = buildFactBundleFromCentralBrainBundle(bundle, "");
  const stats = factBundle.premium_stats;
  const lines = [];
  if (stats?.premiumKnownCount > 0 && stats?.premiumTotal > 0) {
    lines.push(
      `현재 확인 가능한 월 보험료는 ${stats.premiumTotal.toLocaleString("ko-KR")}원입니다.`,
    );
  }
  lines.push(
    "현재 확인된 근거만으로는 정확히 단정하기 어렵습니다. 보장내역서를 추가로 확인하면 해당 보장을 정확히 분석해 드릴게요.",
  );
  return lines.join("\n");
}
