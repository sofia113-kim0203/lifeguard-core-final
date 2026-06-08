const DEFAULT_CANDIDATES = [
  {
    carrier_id: "carrier-alpha",
    carrier_name: "Alpha Life",
    product_id: "alpha-health-balance",
    product_name: "Health Balance Plan",
    strengths: ["cancer", "brain", "heart", "medical_expense"],
    weak_spots: ["driver"],
    monthly_premium_estimate: 145000,
    underwriting_appetite: { hypertension: "medium", diabetes: "low", surgery_history: "medium" },
  },
  {
    carrier_id: "carrier-beta",
    carrier_name: "Beta Insurance",
    product_id: "beta-practical-medical",
    product_name: "Practical Medical Plus",
    strengths: ["medical_expense", "hospitalization", "surgery", "driver"],
    weak_spots: ["cancer"],
    monthly_premium_estimate: 95000,
    underwriting_appetite: { hypertension: "high", diabetes: "medium", hospitalization_history: "medium" },
  },
  {
    carrier_id: "carrier-gamma",
    carrier_name: "Gamma Care",
    product_id: "gamma-senior-care",
    product_name: "Senior Care Shield",
    strengths: ["death", "disability", "cancer", "heart"],
    weak_spots: ["medical_expense"],
    monthly_premium_estimate: 180000,
    underwriting_appetite: { hypertension: "medium", diabetes: "medium", cardiovascular: "low" },
  },
  {
    carrier_id: "carrier-delta",
    carrier_name: "Delta Direct",
    product_id: "delta-budget-driver",
    product_name: "Budget Driver Dental",
    strengths: ["driver", "dental", "hospitalization"],
    weak_spots: ["brain", "heart"],
    monthly_premium_estimate: 70000,
    underwriting_appetite: { hypertension: "high", diabetes: "low", surgery_history: "medium" },
  },
];

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function normalize(value) {
  return String(value ?? "").toLowerCase();
}

function factsArray(memoryFacts = []) {
  if (Array.isArray(memoryFacts)) return memoryFacts;
  if (Array.isArray(memoryFacts?.facts)) return memoryFacts.facts;
  if (Array.isArray(memoryFacts?.memory_facts)) return memoryFacts.memory_facts;
  return [];
}

function extractBudget(memoryFacts = []) {
  const facts = factsArray(memoryFacts);
  for (const fact of facts) {
    const text = `${fact?.fact_key ?? ""} ${fact?.fact_value ?? ""}`;
    if (!/budget|보험료|월/.test(text)) continue;
    const match = text.match(/(\d{1,3})\s*만?원/);
    if (match) return Number(match[1]) * 10000;
  }
  return null;
}

function extractPreferenceKeywords(memoryFacts = []) {
  const text = factsArray(memoryFacts).map((fact) => `${fact?.fact_key ?? ""} ${fact?.fact_value ?? ""}`).join(" ");
  const preferences = [];
  if (/실손|indemnity|medical/i.test(text)) preferences.push("medical_expense");
  if (/암|cancer/i.test(text)) preferences.push("cancer");
  if (/운전자|driver/i.test(text)) preferences.push("driver");
  if (/치아|dental/i.test(text)) preferences.push("dental");
  return Array.from(new Set(preferences));
}

function criticalGaps(coverageGapResult = {}) {
  return (coverageGapResult.coverage_gaps ?? [])
    .filter((gap) => ["missing", "insufficient"].includes(gap.status))
    .filter((gap) => ["high", "medium"].includes(gap.severity));
}

function highRiskFlags(underwritingRiskResult = {}) {
  return (underwritingRiskResult.health_risk_items ?? [])
    .filter((item) => ["high", "unknown"].includes(item.status) || item.requires_agent_review)
    .map((item) => item.risk_type);
}

function scoreCoverageFit(candidate, gaps) {
  return gaps.reduce((score, gap) => {
    if (candidate.strengths?.includes(gap.coverage_type)) return score + (gap.severity === "high" ? 18 : 10);
    if (candidate.weak_spots?.includes(gap.coverage_type)) return score - (gap.severity === "high" ? 10 : 5);
    return score;
  }, 0);
}

function scoreRiskFit(candidate, risks) {
  return risks.reduce((score, risk) => {
    const appetite = candidate.underwriting_appetite?.[risk] ?? "medium";
    if (appetite === "high") return score + 6;
    if (appetite === "medium") return score + 1;
    return score - 8;
  }, 0);
}

function scoreBudget(candidate, budget) {
  if (!budget) return { score: 0, warning: null };
  if (candidate.monthly_premium_estimate <= budget) return { score: 10, warning: null };
  const overBy = candidate.monthly_premium_estimate - budget;
  return {
    score: overBy > 50000 ? -12 : -6,
    warning: `월 예상 보험료가 선호 예산 ${budget.toLocaleString("ko-KR")}원을 초과할 수 있습니다.`,
  };
}

function scorePreference(candidate, preferences) {
  return preferences.reduce((score, preference) => (
    candidate.strengths?.includes(preference) ? score + 6 : score
  ), 0);
}

function rankCandidate(candidate, context) {
  const reasons = [];
  const warnings = [];
  const gaps = criticalGaps(context.coverageGapResult);
  const risks = highRiskFlags(context.underwritingRiskResult);
  const budget = extractBudget(context.memoryFacts);
  const preferences = extractPreferenceKeywords(context.memoryFacts);

  const coverageScore = scoreCoverageFit(candidate, gaps);
  if (coverageScore > 0) reasons.push("보장 공백 항목과 후보 강점이 일부 일치합니다.");
  if (coverageScore < 0) warnings.push("일부 보장 공백 항목이 후보 약점과 겹칩니다.");

  const riskScore = scoreRiskFit(candidate, risks);
  if (risks.length > 0) warnings.push("건강 memory 기반 인수심사 검토 필요 가능성이 있습니다.");

  const budgetResult = scoreBudget(candidate, budget);
  if (budgetResult.warning) warnings.push(budgetResult.warning);
  if (budgetResult.score > 0) reasons.push("고객 예산 선호와 월 예상 보험료가 맞습니다.");

  const preferenceScore = scorePreference(candidate, preferences);
  if (preferenceScore > 0) reasons.push("고객 선호 memory와 후보 강점이 일치합니다.");

  const reviewPenalty = (context.coverageGapResult?.agent_review_items?.length ?? 0) +
    (context.underwritingRiskResult?.agent_review_items?.length ?? 0);
  const base = 50 + coverageScore + riskScore + budgetResult.score + preferenceScore - Math.min(reviewPenalty, 15);
  const recommendation_score = clamp(Math.round(base), 0, 100);
  const requires_agent_review = warnings.length > 0 || (context.underwritingRiskResult?.underwriting_risk_level === "high");

  return {
    carrier_id: candidate.carrier_id,
    carrier_name: candidate.carrier_name,
    product_id: candidate.product_id,
    product_name: candidate.product_name,
    recommendation_score,
    reasons,
    warnings,
    requires_agent_review,
  };
}

function customerView(item) {
  return {
    carrier_id: item.carrier_id,
    carrier_name: item.carrier_name,
    product_id: item.product_id,
    product_name: item.product_name,
    recommendation_score: item.recommendation_score,
    reasons: item.reasons,
    warnings: item.warnings,
    requires_agent_review: item.requires_agent_review,
  };
}

export function buildRecommendationResult({
  customer_id = null,
  coverageGapResult = {},
  underwritingRiskResult = {},
  memoryFacts = [],
  candidates = DEFAULT_CANDIDATES,
  generatedAt = new Date().toISOString(),
} = {}) {
  const full_ranking = candidates
    .map((candidate) => rankCandidate(candidate, { coverageGapResult, underwritingRiskResult, memoryFacts }))
    .sort((left, right) => right.recommendation_score - left.recommendation_score);

  return {
    customer_id,
    customer_top2: full_ranking.slice(0, 2).map(customerView),
    full_ranking,
    recommendation_score: full_ranking[0]?.recommendation_score ?? 0,
    reasons: full_ranking[0]?.reasons ?? [],
    warnings: Array.from(new Set(full_ranking.flatMap((item) => item.warnings))),
    requires_agent_review: full_ranking.some((item) => item.requires_agent_review),
    generated_at: generatedAt,
  };
}

export function customerRecommendationView(result) {
  return {
    customer_id: result.customer_id,
    customer_top2: result.customer_top2,
    recommendation_score: result.recommendation_score,
    reasons: result.reasons,
    warnings: result.warnings,
    requires_agent_review: result.requires_agent_review,
    generated_at: result.generated_at,
  };
}

export { DEFAULT_CANDIDATES };

const GAP_PRIORITY_SCORE = { critical: 100, high: 80, medium: 55, low: 25, sufficient: 5 };
const UW_PRIORITY_SCORE = {
  likely_decline: -30,
  likely_exclusion: -15,
  likely_surcharge: 8,
  likely_additional_review: 12,
  likely_standard: 20,
  unknown: 0,
};
const TYPE_PRIORITY_SCORE = {
  add_coverage: 35,
  prepare_documents: 30,
  review_existing: 12,
  keep_existing: 0,
  avoid_for_now: -10,
};

const CATEGORY_LABELS = {
  cancer: "암보험",
  brain: "뇌혈관 보장",
  heart: "심혈관 보장",
  medical_expense: "실손",
  surgery: "수술비",
  hospitalization: "입원비",
  driver: "운전자보험",
  death: "사망보험",
  dementia_care: "치매/간병",
};

function findGapItem(coverageGapResult, category) {
  return (coverageGapResult?.items ?? []).find((item) => item.coverage_category === category);
}

function findUnderwritingItem(underwritingResult, category) {
  return (underwritingResult?.items ?? []).find((item) => item.coverage_category === category);
}

function deriveRecommendationType(gapItem, uwItem) {
  const gapLevel = gapItem?.gap_level ?? "low";
  const uwStatus = uwItem?.underwriting_status ?? "unknown";

  if (gapLevel === "sufficient" || gapItem?.current_status === "held") {
    return "keep_existing";
  }
  if (uwStatus === "likely_decline") {
    return "avoid_for_now";
  }
  if (["likely_surcharge", "likely_exclusion", "likely_additional_review"].includes(uwStatus)) {
    return ["critical", "high", "medium"].includes(gapLevel) ? "prepare_documents" : "review_existing";
  }
  if (["critical", "high", "medium"].includes(gapLevel)) {
    return "add_coverage";
  }
  return "review_existing";
}

function derivePriority(gapItem, uwItem, recommendationType) {
  const gapLevel = gapItem?.gap_level ?? "low";
  if (recommendationType === "keep_existing") return "low";
  if (recommendationType === "avoid_for_now") return "medium";
  if (gapLevel === "critical") return "high";
  if (gapLevel === "high") return "high";
  if (gapLevel === "medium") return "medium";
  if (uwItem?.risk_level === "high" || uwItem?.risk_level === "critical") return "high";
  return "low";
}

function buildReason(gapItem, uwItem, recommendationType, label) {
  const parts = [];
  if (gapItem?.reason) parts.push(`보장공백: ${gapItem.reason}`);
  if (uwItem?.reason) parts.push(`인수위험: ${uwItem.reason}`);
  if (recommendationType === "keep_existing") {
    return `${label}은(는) 현재 Memory 기준 유지 보장으로 판단됩니다.`;
  }
  if (recommendationType === "add_coverage") {
    return `${label} 보장 보강이 필요하며, 현재 health memory 기준 특별한 인수 제한 신호는 제한적입니다.`;
  }
  if (recommendationType === "prepare_documents") {
    return `${label} 보장 보강이 필요하고, health memory 기준 추가 고지·서류 준비 후 가입 검토가 필요합니다.`;
  }
  if (recommendationType === "avoid_for_now") {
    return `${label}은(는) 현재 Memory 기준 가입 거절 위험이 높아 당장 가입보다 정보 보완·전문 상담이 우선입니다.`;
  }
  return parts.join(" ") || `${label} 관련 추가 검토가 필요합니다.`;
}

function budgetConsideration(monthlyBudget, recommendationType) {
  if (!monthlyBudget) {
    return "월 보험 예산이 Memory에 기록되어 있지 않습니다.";
  }
  if (recommendationType === "keep_existing") {
    return `현재 유지 보험료와 함께 월 예산 ${monthlyBudget.toLocaleString("ko-KR")}원 내 유지 여부를 점검하세요.`;
  }
  return `신규 보장 검토 시 월 예산 ${monthlyBudget.toLocaleString("ko-KR")}원 범위를 고려하세요.`;
}

function confidenceLevel(gapItem, uwItem) {
  if (gapItem?.confidence === "high" && uwItem?.confidence_level === "high") return "high";
  if (gapItem?.confidence === "low" || uwItem?.confidence_level === "low") return "low";
  return "medium";
}

function recommendationScore(gapItem, uwItem, recommendationType) {
  const gapScore = GAP_PRIORITY_SCORE[gapItem?.gap_level] ?? 0;
  const uwScore = UW_PRIORITY_SCORE[uwItem?.underwriting_status] ?? 0;
  const typeScore = TYPE_PRIORITY_SCORE[recommendationType] ?? 0;
  return gapScore + uwScore + typeScore;
}

function collectCategories(coverageGapResult, underwritingResult) {
  const categories = new Set();
  for (const item of coverageGapResult?.items ?? []) categories.add(item.coverage_category);
  for (const item of underwritingResult?.items ?? []) categories.add(item.coverage_category);
  return Array.from(categories);
}

export function buildCoverageCategoryRecommendations({
  customer_id = null,
  coverageGapResult = {},
  underwritingResult = {},
  monthly_budget = null,
  insurance_goal = null,
  generatedAt = new Date().toISOString(),
} = {}) {
  const categories = collectCategories(coverageGapResult, underwritingResult);
  const recommendations = categories.map((category) => {
    const gapItem = findGapItem(coverageGapResult, category);
    const uwItem = findUnderwritingItem(underwritingResult, category);
    const label = gapItem?.coverage_label ?? uwItem?.coverage_label ?? CATEGORY_LABELS[category] ?? category;
    const recommendation_type = deriveRecommendationType(gapItem, uwItem);
    const priority = derivePriority(gapItem, uwItem, recommendation_type);
    const score = recommendationScore(gapItem, uwItem, recommendation_type);

    return {
      coverage_category: category,
      coverage_label: label,
      recommendation_type,
      priority,
      reason: buildReason(gapItem, uwItem, recommendation_type, label),
      underwriting_consideration: uwItem?.reason ?? "인수 위험 분석 결과가 없습니다.",
      budget_consideration: budgetConsideration(monthly_budget, recommendation_type),
      required_documents: uwItem?.required_documents ?? [],
      memory_sources_used: Array.from(
        new Set([
          ...(gapItem?.memory_sources_used ?? []),
          ...(uwItem?.related_memory_sources ?? []),
        ]),
      ),
      confidence_level: confidenceLevel(gapItem, uwItem),
      coverage_gap_level: gapItem?.gap_level ?? null,
      underwriting_status: uwItem?.underwriting_status ?? null,
      insurance_goal_alignment: insurance_goal ? `고객 보험 목표: ${insurance_goal}` : null,
      _score: score,
    };
  });

  recommendations.sort((left, right) => right._score - left._score || left.coverage_category.localeCompare(right.coverage_category));

  const ranked = recommendations.map((item, index) => {
    const { _score, ...rest } = item;
    return {
      recommendation_rank: index + 1,
      recommendation_score: _score,
      ...rest,
    };
  });

  const actionable = ranked.filter((item) => item.recommendation_type !== "keep_existing");
  const customer_visible_top2 = actionable.slice(0, 2);

  return {
    customer_id,
    recommendations: ranked,
    customer_visible_top2,
    keep_existing: ranked.filter((item) => item.recommendation_type === "keep_existing"),
    generated_at: generatedAt,
  };
}
