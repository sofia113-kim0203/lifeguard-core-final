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
