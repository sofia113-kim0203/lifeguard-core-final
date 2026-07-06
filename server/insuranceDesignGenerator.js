import { randomUUID } from "node:crypto";

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
      summary: (gap.gap_reason_codes ?? []).join(",") || gap.status,
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
  const hasCoverageFit =
    recommendation.reason_codes?.includes("coverage_fit_positive") ||
    recommendation.reasons?.some((reason) => reason.includes("보장 공백"));
  const focus = hasCoverageFit ? gaps : gaps.slice(0, 3);
  return focus.length ? focus : gaps.slice(0, 3);
}

function buildDesign(recommendation, context, rank) {
  const focus = designFocus(recommendation, context.coverageGapResult);
  const warnings = unique([
    ...(recommendation.warning_codes ?? recommendation.warnings ?? []),
    ...(context.underwritingRiskResult?.underwriting_risk_level === "high" ? ["uw_review_needed"] : []),
  ]);
  return {
    rank,
    carrier_id: recommendation.carrier_id,
    carrier_name: recommendation.carrier_name,
    product_id: recommendation.product_id,
    product_name: recommendation.product_name,
    recommendation_score: recommendation.recommendation_score,
    design_focus: focus,
    rationale: recommendation.reason_codes ?? recommendation.reasons ?? [],
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


function uniqueStrings(values) {
  return Array.from(new Set((values ?? []).filter(Boolean)));
}

function formatBudgetRange(monthlyBudget) {
  if (monthlyBudget == null || Number.isNaN(Number(monthlyBudget))) {
    return { label: "Memory에 월 보험 예산이 기록되어 있지 않습니다.", min: null, max: null };
  }
  const budget = Number(monthlyBudget);
  const min = Math.round(budget * 0.85);
  const max = Math.round(budget * 1.15);
  return {
    label: `월 ${min.toLocaleString("ko-KR")}원 ~ ${max.toLocaleString("ko-KR")}원 (Memory 예산 기준)`,
    min,
    max,
  };
}

function aggregateConfidence(items) {
  if (items.some((item) => item.confidence_level === "high")) return "high";
  if (items.some((item) => item.confidence_level === "low")) return "low";
  return "medium";
}

function deriveDesignPriority(top2) {
  if (top2.some((item) => item.priority === "high")) return "high";
  if (top2.some((item) => item.priority === "medium")) return "medium";
  return "low";
}

function deriveBudgetBandCode(monthlyBudget) {
  if (monthlyBudget == null || Number.isNaN(Number(monthlyBudget))) return "budget_unknown";
  return "memory_budget_band";
}

function deriveDesignReasonCodes(top2, keepExisting, monthlyBudget, underwritingWarnings) {
  const codes = [];
  if (top2.some((item) => ["critical", "high"].includes(item.coverage_gap_level))) {
    codes.push("coverage_gap_priority");
  }
  if (keepExisting.length > 0) codes.push("keep_existing_held");
  if (monthlyBudget != null && !Number.isNaN(Number(monthlyBudget))) {
    codes.push("memory_budget_present");
  } else {
    codes.push("memory_budget_unknown");
  }
  if (underwritingWarnings.length > 0) codes.push("underwriting_review_signal");
  if (top2.some((item) => item.recommendation_type === "add_coverage")) {
    codes.push("add_coverage_focus");
  }
  if (top2.length === 0 && keepExisting.length > 0) codes.push("maintain_existing_focus");
  return codes;
}

function buildPlanStepCodes({ requiredDocuments, top2, keepExisting }) {
  const codes = [];
  if (requiredDocuments.length) codes.push("prepare_documents");
  for (const item of top2.slice(0, 2)) {
    if (item.coverage_category) codes.push(`review_coverage_${item.coverage_category}`);
  }
  if (keepExisting.length) codes.push("confirm_keep_existing");
  codes.push("agent_consultation");
  return codes;
}

function buildStructuredStepPlan(planStepCodes) {
  return planStepCodes.map((plan_step_code, index) => ({
    step: index + 1,
    plan_step_code,
  }));
}

export function buildCustomerInsuranceDesignPlan({
  customer_id = null,
  structuredMemory = null,
  coverageGapResult = {},
  underwritingResult = {},
  recommendationResult = {},
  monthly_budget = null,
  insurance_goal = null,
  generatedAt = new Date().toISOString(),
} = {}) {
  const top2 = recommendationResult.customer_visible_top2 ?? [];
  const keepExisting = recommendationResult.keep_existing ?? [];
  const allRecommendations = recommendationResult.recommendations ?? [];
  const monthlyBudgetRange = formatBudgetRange(monthly_budget);
  const customerName = structuredMemory?.profile?.name ?? null;

  const recommended_new_coverages = top2.map((item) => ({
    coverage_category: item.coverage_category,
    coverage_label: item.coverage_label,
    recommendation_type: item.recommendation_type,
    priority: item.priority,
    gap_level: item.coverage_gap_level,
    underwriting_status: item.underwriting_status,
  }));

  const keep_existing_coverages = keepExisting.map((item) => ({
    coverage_category: item.coverage_category,
    coverage_label: item.coverage_label,
    recommendation_type: item.recommendation_type,
  }));

  const underwriting_warnings = uniqueStrings(
    top2.flatMap((item) => item.uw_flags ?? []).concat(
      (underwritingResult.likely_surcharge ?? []).map((item) => item.underwriting_status).filter(Boolean),
    ),
  );

  const required_document_codes = uniqueStrings(
    allRecommendations.flatMap((item) => item.required_document_codes ?? item.required_documents ?? []),
  );

  const memory_sources_used = uniqueStrings(
    allRecommendations.flatMap((item) => item.memory_sources_used ?? []),
  );

  const recommendation_sources_used = top2.map((item) => ({
    recommendation_rank: item.recommendation_rank,
    coverage_category: item.coverage_category,
    recommendation_type: item.recommendation_type,
    recommendation_score: item.recommendation_score,
  }));

  const design_reason_codes = deriveDesignReasonCodes(
    top2,
    keepExisting,
    monthly_budget,
    underwriting_warnings,
  );
  const plan_step_codes = buildPlanStepCodes({
    requiredDocuments: required_document_codes,
    top2,
    keepExisting,
  });
  const budget_band_code = deriveBudgetBandCode(monthly_budget);
  const step_by_step_plan = buildStructuredStepPlan(plan_step_codes);
  const priority_coverage_categories = top2.map((item) => item.coverage_category).filter(Boolean);

  const insurance_design = {
    design_id: randomUUID(),
    design_priority: deriveDesignPriority(top2),
    design_reason_codes,
    plan_step_codes,
    budget_band_code,
    budget_min: monthlyBudgetRange.min,
    budget_max: monthlyBudgetRange.max,
    target_customer_id: customer_id,
    monthly_budget_range: {
      min: monthlyBudgetRange.min,
      max: monthlyBudgetRange.max,
      band_code: budget_band_code,
    },
    insurance_goal: insurance_goal ?? structuredMemory?.profile?.insurance_goal ?? null,
    included_coverages: [
      ...keep_existing_coverages.map((item) => ({ ...item, role: "keep" })),
      ...recommended_new_coverages.map((item) => ({ ...item, role: "new" })),
    ],
    keep_existing_coverages,
    recommended_new_coverages,
    priority_coverage_categories,
    underwriting_warning_codes: underwriting_warnings,
    required_document_codes,
    step_by_step_plan,
    memory_sources_used,
    recommendation_sources_used,
    confidence_level: aggregateConfidence(top2),
    generated_at: generatedAt,
    agent_full_details: {
      full_recommendation_ranking: allRecommendations,
      coverage_gap_result: coverageGapResult,
      underwriting_result: underwritingResult,
      coverage_gap_top_gaps: coverageGapResult.top_gaps ?? [],
      underwriting_surcharge_items: underwritingResult.likely_surcharge ?? [],
    },
  };

  const additional_review_categories = allRecommendations
    .filter(
      (item) =>
        !top2.some((top) => top.coverage_category === item.coverage_category) &&
        ["review_existing", "prepare_documents", "add_coverage"].includes(item.recommendation_type),
    )
    .slice(0, 3)
    .map((item) => item.coverage_category)
    .filter(Boolean);

  const customer_visible_design = {
    design_priority: insurance_design.design_priority,
    design_reason_codes,
    plan_step_codes,
    budget_band_code,
    budget_min: monthlyBudgetRange.min,
    budget_max: monthlyBudgetRange.max,
    priority_coverage_categories,
    priority_coverages: top2.map((item) => item.coverage_label),
    keep_existing_coverages: keepExisting.map((item) => item.coverage_label),
    keep_coverage_categories: keepExisting.map((item) => item.coverage_category).filter(Boolean),
    additional_review_coverage_categories: additional_review_categories,
    pre_enrollment_caution_codes: underwriting_warnings.slice(0, 5),
    required_document_codes,
    confidence_level: insurance_design.confidence_level,
  };

  return {
    insurance_design,
    customer_visible_design,
  };
}
