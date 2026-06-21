/**
 * Step 1-B — Shared Guidance Builder (CB + legacy import surface).
 * Not a judgment engine: confirmed facts, blocked reason, next step only.
 */
import { LOOKUP_CATEGORIES, matchPolicyToCategory } from "../intentGateLayer.js";

export const GUIDANCE_INTENTS = {
  GAP: "gap",
  DESIGN: "design",
  RECOMMENDATION: "recommendation",
  GENERAL_JUDGMENT: "general_judgment",
};

const INTERIM_PARTIAL_GUIDANCE =
  "현재 확인된 근거만으로는 정확히 단정하기 어렵습니다. 보험증권/보장내역서를 추가로 확인하면 해당 보장을 정확히 분석해 드릴게요.";

const GAP_EVALUATION_TOPICS = ["cancer", "brain", "heart"];

function normalizeQuestion(question = "") {
  return String(question ?? "").replace(/\s+/g, " ").trim();
}

export function buildFactBundleFromCentralBrainBundle(bundle, question = "") {
  const data = bundle?.data ?? {};
  const unified = data.unified ?? {};
  const policies = unified.policies ?? [];

  return {
    policy_count: Number(data.policy_count ?? unified.policy_count ?? policies.length ?? 0),
    document_count: Number(unified.document_count ?? 0),
    premium_stats: data.premium_stats ?? null,
    memory_fact_count: Number(unified.memory_fact_count ?? data.memory?.fact_count ?? 0),
    policies,
    question: normalizeQuestion(question),
    has_stored_coverage_analysis: Boolean(
      data.stored_panels?.coverageGapResult ||
        data.stored_panels?.coverage_gap ||
        data.stored_panels?.coverage_gap_result,
    ),
  };
}

function detectGapTopicCategory(question = "") {
  const text = normalizeQuestion(question).toLowerCase();
  for (const [category, config] of Object.entries(LOOKUP_CATEGORIES)) {
    if (config.keywords.some((keyword) => text.includes(String(keyword).toLowerCase()))) {
      return { category, label: config.label };
    }
  }
  return { category: null, label: "해당 보장" };
}

function buildGapConfirmedFactsSlot(factBundle) {
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

  const topic = detectGapTopicCategory(factBundle.question);
  if (topic.category && factBundle.policies?.length) {
    const match = matchPolicyToCategory(factBundle.policies, topic.category);
    if (match.found && match.confidence === "high") {
      lines.push(`등록된 보험 목록에서 ${topic.label} 관련 계약이 확인됩니다.`);
    }
  }

  if ((factBundle.document_count ?? 0) > 0) {
    lines.push(`등록된 서류 ${factBundle.document_count}건이 확인됩니다.`);
  }

  if ((factBundle.memory_fact_count ?? 0) > 0) {
    lines.push(`고객 memory ${factBundle.memory_fact_count}건이 확인됩니다.`);
  }

  if (lines.length === 0) {
    lines.push("현재 등록된 보험·서류 정보가 아직 확인되지 않았습니다.");
  }

  return lines.join(" ");
}

function buildGapJudgmentBlockedReasonSlot(factBundle, topic) {
  const label = topic.label ?? "해당 보장";
  if (topic.category) {
    return `다만 ${label} 보장금액은 아직 확인되지 않았습니다.`;
  }
  return "다만 질문하신 보장의 금액과 구조는 아직 확인되지 않았습니다.";
}

function buildGapNextStepSlot(question, topic) {
  const text = normalizeQuestion(question);
  const label = topic.label ?? "보장";
  const evaluationLabels = GAP_EVALUATION_TOPICS.map(
    (key) => LOOKUP_CATEGORIES[key]?.label ?? key,
  ).join("·");

  if (/부족|모자라|없/.test(text) && topic.category) {
    return `${label}보험이 부족한지는 보장금액을 확인해야 판단할 수 있습니다. 보장내역서를 분석하면 ${evaluationLabels} 보장을 바로 평가해 드릴게요.`;
  }

  return `${label} 보장 상태를 단정하려면 보장금액을 확인해야 판단할 수 있습니다. 보장내역서를 분석하면 ${evaluationLabels} 보장을 바로 평가해 드릴게요.`;
}

export function buildGapGuidance(factBundle) {
  const topic = detectGapTopicCategory(factBundle.question);
  const confirmedFacts = buildGapConfirmedFactsSlot(factBundle);
  const blockedReason = buildGapJudgmentBlockedReasonSlot(factBundle, topic);
  const nextStep = buildGapNextStepSlot(factBundle.question, topic);

  return {
    confirmedFacts,
    blockedReason,
    nextStep,
    message: [confirmedFacts, blockedReason, nextStep].join(" "),
  };
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
    case GUIDANCE_INTENTS.RECOMMENDATION:
    case GUIDANCE_INTENTS.GENERAL_JUDGMENT:
    case "design":
    case "recommendation":
    case "general_judgment":
      throw new Error(`guidance_intent_not_implemented_in_b1:${intent}`);
    default:
      throw new Error(`unknown_guidance_intent:${intent}`);
  }
}

/** Non-gap partial modes until B-1-L / later steps. */
export function buildInterimPartialGuidanceMessage(bundle) {
  const lines = [];
  const stats = bundle?.data?.premium_stats;
  if (stats?.premiumKnownCount > 0 && stats?.premiumTotal > 0) {
    lines.push(
      `현재 확인 가능한 월 보험료는 ${stats.premiumTotal.toLocaleString("ko-KR")}원입니다.`,
    );
  }
  lines.push(INTERIM_PARTIAL_GUIDANCE);
  return lines.join("\n");
}
