function unique(values) {
  return Array.from(new Set(values.filter(Boolean)));
}

function topGaps(coverageGapResult = {}) {
  return (coverageGapResult.coverage_gaps ?? [])
    .filter((gap) => ["missing", "insufficient", "duplicate"].includes(gap.status))
    .slice(0, 5);
}

function riskWarnings(underwritingRiskResult = {}) {
  return (underwritingRiskResult.health_risk_items ?? [])
    .filter((item) => item.requires_agent_review || ["medium", "high", "unknown"].includes(item.status))
    .map((item) => `${item.risk_type}: ${item.reason}`)
    .slice(0, 5);
}

function budgetSummary(memoryFacts = []) {
  const text = (Array.isArray(memoryFacts) ? memoryFacts : memoryFacts?.facts ?? [])
    .map((fact) => `${fact?.fact_key ?? ""} ${fact?.fact_value ?? ""}`)
    .join(" ");
  const match = text.match(/(\d{1,3})\s*만?원/);
  return match ? `월 ${match[1]}만원 이하 선호` : "예산 선호 정보 부족";
}

function preferenceSummary(memoryFacts = []) {
  const text = (Array.isArray(memoryFacts) ? memoryFacts : memoryFacts?.facts ?? [])
    .map((fact) => `${fact?.fact_key ?? ""} ${fact?.fact_value ?? ""}`)
    .join(" ");
  const preferences = [];
  if (/실손|indemnity|medical/i.test(text)) preferences.push("실손 유지/의료비 보장 선호");
  if (/보험료|budget|월/.test(text)) preferences.push("보험료 예산 고려");
  if (/은퇴|노후/.test(text)) preferences.push("은퇴/노후 우려 고려");
  return preferences.length ? preferences : ["명시 선호 부족" ];
}

function customerSummary({ customer_id, coverageGapResult, underwritingRiskResult, memoryFacts }) {
  return {
    customer_id,
    budget: budgetSummary(memoryFacts),
    preferences: preferenceSummary(memoryFacts),
    coverage_gap_score: coverageGapResult?.gap_score ?? null,
    underwriting_risk_level: underwritingRiskResult?.underwriting_risk_level ?? "unknown",
  };
}

function currentIssues({ coverageGapResult, underwritingRiskResult }) {
  return [
    ...topGaps(coverageGapResult).map((gap) => ({
      type: "coverage_gap",
      key: gap.coverage_type,
      severity: gap.severity,
      summary: gap.reason,
      requires_agent_review: gap.requires_agent_review,
    })),
    ...riskWarnings(underwritingRiskResult).map((warning) => ({
      type: "underwriting_risk",
      key: warning.split(":")[0],
      severity: "high",
      summary: warning,
      requires_agent_review: true,
    })),
  ];
}

function designFocus(recommendation, coverageGapResult) {
  const gaps = topGaps(coverageGapResult).map((gap) => gap.coverage_type);
  const focus = gaps.filter((gap) => recommendation.reasons?.some((reason) => reason.includes("보장 공백")));
  return focus.length ? focus : gaps.slice(0, 3);
}

function buildDesign(recommendation, context, rank) {
  const focus = designFocus(recommendation, context.coverageGapResult);
  const warnings = unique([
    ...(recommendation.warnings ?? []),
    ...(context.underwritingRiskResult?.underwriting_risk_level === "high" ? ["건강 memory 기반 인수심사 검토가 필요합니다."] : []),
  ]);
  return {
    rank,
    carrier_id: recommendation.carrier_id,
    carrier_name: recommendation.carrier_name,
    product_id: recommendation.product_id,
    product_name: recommendation.product_name,
    recommendation_score: recommendation.recommendation_score,
    design_focus: focus,
    rationale: recommendation.reasons ?? [],
    warnings,
    requires_agent_review: recommendation.requires_agent_review || warnings.length > 0,
    disclaimer: "초안 설계안입니다. 가입 여부, 인수 조건, 보험료, 보장 여부는 확정하지 않으며 설계사 검토가 필요합니다.",
  };
}

export function generateInsuranceDesignDraft({
  customer_id = null,
  coverageGapResult = {},
  underwritingRiskResult = {},
  recommendationResult = {},
  memoryFacts = [],
  generatedAt = new Date().toISOString(),
} = {}) {
  const ranking = recommendationResult.full_ranking ?? [];
  const recommended_designs = ranking.map((item, index) => buildDesign(item, { coverageGapResult, underwritingRiskResult }, index + 1));
  const customer_top2_designs = recommended_designs.slice(0, 2).map((design) => ({
    rank: design.rank,
    carrier_id: design.carrier_id,
    carrier_name: design.carrier_name,
    product_id: design.product_id,
    product_name: design.product_name,
    recommendation_score: design.recommendation_score,
    design_focus: design.design_focus,
    rationale: design.rationale,
    warnings: design.warnings,
    requires_agent_review: design.requires_agent_review,
    disclaimer: design.disclaimer,
  }));
  const warnings = unique([
    ...(recommendationResult.warnings ?? []),
    ...recommended_designs.flatMap((design) => design.warnings),
  ]);

  return {
    customer_summary: customerSummary({ customer_id, coverageGapResult, underwritingRiskResult, memoryFacts }),
    current_issues: currentIssues({ coverageGapResult, underwritingRiskResult }),
    recommended_designs,
    customer_top2_designs,
    agent_full_details: {
      full_ranking: ranking,
      coverage_gaps: coverageGapResult.coverage_gaps ?? [],
      health_risk_items: underwritingRiskResult.health_risk_items ?? [],
      agent_review_items: [
        ...(coverageGapResult.agent_review_items ?? []),
        ...(underwritingRiskResult.agent_review_items ?? []),
      ],
    },
    warnings,
    requires_agent_review: recommended_designs.some((design) => design.requires_agent_review) || warnings.length > 0,
    generated_at: generatedAt,
  };
}

export function customerInsuranceDesignView(draft) {
  return {
    customer_summary: draft.customer_summary,
    current_issues: draft.current_issues,
    customer_top2_designs: draft.customer_top2_designs,
    warnings: draft.warnings,
    requires_agent_review: draft.requires_agent_review,
    generated_at: draft.generated_at,
  };
}
