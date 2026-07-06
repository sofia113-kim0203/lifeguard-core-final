const ACTION_PRIORITY = ["review", "change", "add", "reduce", "keep"];

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function toNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function currentPremium(currentPortfolio = {}) {
  return toNumber(currentPortfolio.monthly_premium ?? currentPortfolio.total_monthly_premium, 0);
}

function currentCoverageScore(currentPortfolio = {}) {
  return toNumber(currentPortfolio.coverage_score, 0);
}

function duplicateCount(currentPortfolio = {}) {
  return toNumber(currentPortfolio.duplicate_count ?? currentPortfolio.duplicate_warnings?.length, 0);
}

function hasRisk(design = {}, context = {}) {
  return design.requires_agent_review === true ||
    (design.warnings ?? []).length > 0 ||
    context.underwritingRiskResult?.underwriting_risk_level === "high";
}

function bestDesign(designDraft = {}) {
  return designDraft.customer_top2_designs?.[0] ?? designDraft.recommended_designs?.[0] ?? null;
}

function estimateDesignPremium(design) {
  return toNumber(design?.monthly_premium_estimate ?? design?.estimated_monthly_premium, null);
}

function improvementScore(design, coverageGapResult = {}) {
  const focusCount = design?.design_focus?.length ?? 0;
  const gapSeverityBoost = (coverageGapResult.coverage_gaps ?? [])
    .filter((gap) => design?.design_focus?.includes(gap.coverage_type))
    .reduce((sum, gap) => sum + (gap.severity === "high" ? 14 : gap.severity === "medium" ? 8 : 3), 0);
  return focusCount * 6 + gapSeverityBoost;
}

function chooseAction({ premiumDelta, improvement, duplicates, risky, currentScore }) {
  if (risky) return "review";
  if (duplicates >= 2 && improvement < 12) return "reduce";
  if (improvement >= 28 && premiumDelta <= 20000) return "add";
  if (improvement >= 28 && premiumDelta > 20000) return "change";
  if (improvement >= 15 && currentScore < 60) return "add";
  if (duplicates > 0 && premiumDelta <= 0) return "reduce";
  return "keep";
}

function actionReason(action, { improvement, premiumDelta, duplicates }) {
  if (action === "keep") return "현재 보장 구조를 유지하면서 정기 점검하는 편이 우선입니다.";
  if (action === "add") return `월 ${Math.abs(premiumDelta).toLocaleString("ko-KR")}원 수준 변화로 보장 개선 여지가 있습니다.`;
  if (action === "change") return "기존 구성보다 보장 개선 폭이 커서 변경 검토 가치가 있습니다.";
  if (action === "reduce") return `중복/과다 가능성이 ${duplicates}건 있어 감액 또는 정리 검토가 필요합니다.`;
  return "건강 memory 또는 인수위험 요소로 설계사 검토가 먼저 필요합니다.";
}

function summarizeForMonthlyReport(action, score, reasons) {
  return `이번 달 리밸런싱 판단은 ${action}이며 점수는 ${score}점입니다. ${reasons[0] ?? "추가 검토가 필요합니다."}`;
}

function summarizeForKakao(action, requiresReview) {
  if (requiresReview) return "보험 리밸런싱 검토가 필요합니다. 담당 설계사 확인을 권장합니다.";
  if (action === "keep") return "현재 보험 구성은 유지 관점입니다. 다음 점검 때 다시 확인하세요.";
  if (action === "add") return "보장 공백 보완 여지가 있습니다. 추가 검토가 필요합니다.";
  if (action === "change") return "기존 구성 변경 검토 가치가 있습니다. 설계사와 확인하세요.";
  if (action === "reduce") return "중복 보장 정리 가능성이 있습니다. 감액 검토가 필요합니다.";
  return "보험 리밸런싱 결과를 확인하세요.";
}

export function analyzeRebalancing({
  customer_id = null,
  currentPortfolio = {},
  designDraft = {},
  coverageGapResult = {},
  underwritingRiskResult = {},
  generatedAt = new Date().toISOString(),
} = {}) {
  const design = bestDesign(designDraft);
  const current = currentPremium(currentPortfolio);
  const designPremium = estimateDesignPremium(design);
  const premiumDelta = designPremium == null ? 0 : designPremium - current;
  const improvement = improvementScore(design, coverageGapResult);
  const duplicates = duplicateCount(currentPortfolio) + (coverageGapResult.duplicate_warnings?.length ?? 0);
  const risky = hasRisk(design, { underwritingRiskResult });
  const currentScore = currentCoverageScore(currentPortfolio);
  const action = chooseAction({ premiumDelta, improvement, duplicates, risky, currentScore });
  const baseScore = 50 + improvement - Math.max(0, premiumDelta / 5000) - duplicates * 5 - (risky ? 18 : 0);
  const rebalancing_score = clamp(Math.round(baseScore), 0, 100);
  const reasons = [actionReason(action, { improvement, premiumDelta, duplicates })];
  const risk_warnings = [
    ...(design?.warnings ?? []),
    ...(underwritingRiskResult.underwriting_risk_level === "high" ? ["인수심사 위험 검토가 필요합니다."] : []),
  ];
  const requires_agent_review = action === "review" || risk_warnings.length > 0 || design?.requires_agent_review === true;

  return {
    customer_id,
    rebalancing_score,
    action,
    reasons,
    premium_change: {
      current_monthly_premium: current,
      proposed_monthly_premium: designPremium,
      delta: premiumDelta,
    },
    coverage_improvement: {
      score: improvement,
      focus: design?.design_focus ?? [],
    },
    risk_warnings: Array.from(new Set(risk_warnings)),
    monthly_report_summary: summarizeForMonthlyReport(action, rebalancing_score, reasons),
    kakao_notification_summary: summarizeForKakao(action, requires_agent_review),
    requires_agent_review,
    generated_at: generatedAt,
  };
}

const CATEGORY_LABELS = {
  cancer: "암",
  brain: "뇌혈관",
  heart: "심혈관",
  surgery: "수술비",
  hospitalization: "입원비",
  medical_expense: "실손",
  death: "사망",
  disability: "장해",
  driver: "운전자",
  dental: "치아",
  dementia_care: "치매/간병",
  family_protection: "가족 보장",
  corporate_group: "법인/단체",
};

function uniqueStrings(values) {
  return Array.from(new Set((values ?? []).filter(Boolean)));
}

function inferCoverageCategoriesFromPolicy(policy = {}) {
  const text = `${policy.insurer_name ?? ""} ${policy.product_name ?? ""} ${policy.policy_type ?? ""}`.toLowerCase();
  const categories = [];
  if (/실손|indemnity|medical/.test(text)) categories.push("medical_expense");
  if (/암|cancer/.test(text)) categories.push("cancer");
  if (/뇌|brain|cerebro/.test(text)) categories.push("brain");
  if (/심|heart|cardio/.test(text)) categories.push("heart");
  if (/수술|surgery/.test(text)) categories.push("surgery");
  if (/입원|hospital/.test(text)) categories.push("hospitalization");
  if (/운전|driver/.test(text)) categories.push("driver");
  if (/사망|death/.test(text)) categories.push("death");
  if (/치매|간병|dementia/.test(text)) categories.push("dementia_care");
  return categories.length ? categories : ["unknown"];
}

function sumHoldingsPremium(holdings = []) {
  return holdings.reduce((sum, policy) => sum + toNumber(policy.monthly_premium, 0), 0);
}

function collectHealthWarnings(memoryFacts = [], healthProfile = {}) {
  const warnings = [];
  const textParts = [
    ...(memoryFacts ?? []).map((fact) => `${fact.fact_key ?? ""} ${fact.fact_value ?? ""}`),
    healthProfile?.medications ?? "",
    healthProfile?.conditions ?? "",
  ].join(" ");

  if (/당뇨/.test(textParts)) {
    warnings.push({
      warning_type: "pre_enrollment_health",
      label: "당뇨약 복용",
      message: "당뇨약 복용이 Memory에 기록되어 있습니다. 신규 가입 전 인수심사·고지 내용을 설계사와 확인하세요.",
      memory_sources_used: (memoryFacts ?? [])
        .filter((fact) => /당뇨|medication/.test(`${fact.fact_key} ${fact.fact_value}`))
        .map((fact) => fact.fact_key),
      requires_agent_review: true,
    });
  }
  if (/혈압/.test(textParts)) {
    warnings.push({
      warning_type: "pre_enrollment_health",
      label: "혈압약 복용",
      message: "혈압약 복용이 Memory에 기록되어 있습니다. 가입 전 건강 고지·심사 조건을 확인하세요.",
      memory_sources_used: (memoryFacts ?? [])
        .filter((fact) => /혈압|medication/.test(`${fact.fact_key} ${fact.fact_value}`))
        .map((fact) => fact.fact_key),
      requires_agent_review: true,
    });
  }
  return warnings;
}

function buildKeepItems({ holdings = [], keepExisting = [], maintainedCoverage = [], design = null } = {}) {
  const keepCategories = new Set(
    keepExisting.map((item) => item.coverage_category).concat(maintainedCoverage.map((item) => item.coverage_category)),
  );
  const items = [];

  for (const policy of holdings) {
    const categories = inferCoverageCategoriesFromPolicy(policy);
    const matchedCategory = categories.find((category) => keepCategories.has(category));
    if (!matchedCategory && policy.is_active !== false) {
      const hasMedicalKeep = keepCategories.has("medical_expense") && categories.includes("medical_expense");
      if (!hasMedicalKeep) continue;
    }
    const category = matchedCategory ?? categories[0];
    const keepRef = keepExisting.find((item) => item.coverage_category === category);
    items.push({
      item_type: "keep",
      policy_id: policy.policy_id ?? null,
      insurer_name: policy.insurer_name ?? null,
      product_name: policy.product_name ?? null,
      coverage_category: category,
      coverage_label: CATEGORY_LABELS[category] ?? keepRef?.coverage_label ?? category,
      status: policy.status ?? "유지",
      monthly_premium: policy.monthly_premium ?? null,
      reason: keepRef?.reason_codes?.join(",") ?? `${policy.insurer_name ?? "기존"} ${policy.product_name ?? "보험"}은 현재 보장 구조에서 유지하는 것이 적절합니다.`,
      memory_sources_used: keepRef?.memory_sources_used ?? [],
      linked_design_id: design?.design_id ?? null,
    });
  }

  for (const item of keepExisting) {
    if (items.some((keep) => keep.coverage_category === item.coverage_category)) continue;
    items.push({
      item_type: "keep",
      policy_id: null,
      insurer_name: null,
      product_name: null,
      coverage_category: item.coverage_category,
      coverage_label: item.coverage_label,
      status: "유지",
      monthly_premium: null,
      reason: item.reason_codes?.join(",") ?? `${item.coverage_label} 보장은 유지하는 것이 적절합니다.`,
      memory_sources_used: item.memory_sources_used ?? [],
      linked_design_id: design?.design_id ?? null,
    });
  }

  return items;
}

function buildAddItems({ design = null, recommendationResult = {}, coverageGapResult = {} } = {}) {
  const top2 = recommendationResult.customer_visible_top2 ?? [];
  const newCoverages = design?.recommended_new_coverages ?? [];
  const topGaps = coverageGapResult.top_gaps ?? [];
  const seen = new Set();
  const items = [];

  const pushItem = (source) => {
    const key = source.coverage_category ?? source.coverage_label;
    if (!key || seen.has(key)) return;
    seen.add(key);
    items.push({
      item_type: "add",
      coverage_category: source.coverage_category ?? null,
      coverage_label: source.coverage_label ?? CATEGORY_LABELS[source.coverage_category] ?? key,
      priority: source.priority ?? source.gap_level ?? "high",
      reason:
        (source.reason_codes ?? []).join(",") ||
        source.recommended_action ||
        `${source.coverage_label ?? key} 보장 보강이 필요합니다.`,
      underwriting_status: source.underwriting_status ?? null,
      gap_level: source.gap_level ?? source.coverage_gap_level ?? null,
      memory_sources_used: source.memory_sources_used ?? [],
      linked_design_id: design?.design_id ?? null,
    });
  };

  for (const item of newCoverages) pushItem(item);
  for (const item of top2) pushItem(item);
  for (const gap of topGaps) {
    if (["critical", "high", "medium"].includes(gap.gap_level)) pushItem(gap);
  }

  return items;
}

function buildReduceItems({ coverageGapResult = {}, holdings = [] } = {}) {
  const items = [];
  for (const warning of coverageGapResult.duplicate_warnings ?? []) {
    items.push({
      item_type: "reduce",
      coverage_category: warning.coverage_type ?? warning.coverage_category ?? null,
      coverage_label: CATEGORY_LABELS[warning.coverage_type] ?? warning.coverage_label ?? "중복 보장",
      reason: warning.reason ?? "중복 가능 보장이 있어 보험료 절감 여지를 검토할 수 있습니다.",
      caution: "해지·감액 전 기존 보장 범위와 면책/대기기간을 반드시 확인하세요.",
      memory_sources_used: warning.memory_sources_used ?? [],
    });
  }

  const duplicateGaps = (coverageGapResult.items ?? []).filter((item) => item.current_status === "duplicate");
  for (const gap of duplicateGaps) {
    if (items.some((item) => item.coverage_category === gap.coverage_category)) continue;
    const relatedPolicies = holdings.filter((policy) =>
      inferCoverageCategoriesFromPolicy(policy).includes(gap.coverage_category),
    );
    items.push({
      item_type: "reduce",
      coverage_category: gap.coverage_category,
      coverage_label: gap.coverage_label,
      reason: gap.reason ?? `${gap.coverage_label} 보장 중복 가능성이 있습니다.`,
      caution: "감액·해지 시 보장 공백이 생기지 않는지 설계사와 확인하세요.",
      related_policies: relatedPolicies.map((policy) => ({
        insurer_name: policy.insurer_name,
        product_name: policy.product_name,
      })),
      memory_sources_used: gap.memory_sources_used ?? [],
    });
  }

  return items;
}

function buildReviewItems({ recommendationResult = {}, underwritingResult = {}, design = null } = {}) {
  const items = [];
  const reviewTypes = new Set(["review_existing", "prepare_documents"]);

  for (const rec of recommendationResult.recommendations ?? []) {
    if (!reviewTypes.has(rec.recommendation_type)) continue;
    items.push({
      item_type: "review",
      coverage_category: rec.coverage_category,
      coverage_label: rec.coverage_label,
      review_type: rec.recommendation_type,
      reason:
        (rec.reason_codes ?? []).join(",") ||
        `${rec.coverage_label} 보장은 전환·재검토가 필요합니다.`,
      uw_flags: rec.uw_flags ?? [],
      memory_sources_used: rec.memory_sources_used ?? [],
      linked_design_id: design?.design_id ?? null,
    });
  }

  for (const item of design?.agent_full_details?.coverage_gap_top_gaps ?? []) {
    if (!["critical", "high"].includes(item.gap_level)) continue;
    if (items.some((review) => review.coverage_category === item.coverage_category)) continue;
    items.push({
      item_type: "review",
      coverage_category: item.coverage_category,
      coverage_label: item.coverage_label,
      review_type: "coverage_gap",
      reason: item.reason ?? `${item.coverage_label} 보장 재검토가 필요합니다.`,
      memory_sources_used: item.memory_sources_used ?? [],
      linked_design_id: design?.design_id ?? null,
    });
  }

  for (const uw of underwritingResult.likely_surcharge ?? []) {
    items.push({
      item_type: "review",
      coverage_category: uw.coverage_category,
      coverage_label: uw.coverage_label,
      review_type: "underwriting",
      reason: uw.reason ?? `${uw.coverage_label} 인수심사 검토가 필요합니다.`,
      memory_sources_used: uw.related_memory_sources ?? [],
      linked_design_id: design?.design_id ?? null,
    });
  }

  return items;
}

function buildWarningItems({
  memoryFacts = [],
  healthProfile = {},
  underwritingResult = {},
  design = null,
  reduceItems = [],
} = {}) {
  const warnings = [
    ...collectHealthWarnings(memoryFacts, healthProfile),
    ...(design?.underwriting_warnings ?? []).map((message) => ({
      warning_type: "underwriting",
      label: "인수심사 주의",
      message,
      memory_sources_used: design?.memory_sources_used ?? [],
      requires_agent_review: true,
    })),
  ];

  for (const item of reduceItems) {
    warnings.push({
      warning_type: "cancellation_caution",
      label: `${item.coverage_label} 감액/해지 주의`,
      message: item.caution ?? "해지·감액 전 기존 보장과 면책 조건을 확인하세요.",
      memory_sources_used: item.memory_sources_used ?? [],
      requires_agent_review: true,
    });
  }

  for (const uw of underwritingResult.agent_review_items ?? []) {
    warnings.push({
      warning_type: "agent_review",
      label: uw.label ?? "설계사 검토",
      message: uw.message ?? uw.reason ?? "설계사 검토가 필요합니다.",
      memory_sources_used: uw.memory_sources_used ?? [],
      requires_agent_review: true,
    });
  }

  const seen = new Set();
  return warnings.filter((warning) => {
    const key = `${warning.warning_type}::${warning.label}::${warning.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function buildEstimatedBudgetImpact({ holdings = [], monthlyBudget = null, design = null, addItems = [] } = {}) {
  const currentMonthly = sumHoldingsPremium(holdings);
  const budgetRange = design?.monthly_budget_range ?? {};
  const proposedMin = budgetRange.min ?? null;
  const proposedMax = budgetRange.max ?? null;
  const proposedEstimate = proposedMax ?? proposedMin ?? monthlyBudget ?? null;
  const delta =
    proposedEstimate == null || currentMonthly === 0 ? null : Math.round(proposedEstimate - currentMonthly);

  let budgetFit = "unknown";
  if (proposedMax != null && monthlyBudget != null) {
    budgetFit = proposedMax <= monthlyBudget ? "within" : "over";
  } else if (delta != null) {
    budgetFit = delta <= 0 ? "within" : delta <= 50000 ? "moderate_increase" : "over";
  }

  return {
    current_monthly_premium: currentMonthly || null,
    proposed_monthly_premium: proposedEstimate,
    proposed_budget_range: budgetRange.label ?? null,
    delta_monthly: delta,
    budget_fit: budgetFit,
    add_coverage_count: addItems.length,
    label:
      delta == null
        ? "기존 보험료 또는 설계 예산 정보가 부족해 정확한 예산 영향을 계산하지 못했습니다."
        : delta > 0
          ? `월 약 ${delta.toLocaleString("ko-KR")}원 수준 증가 가능성이 있습니다.`
          : delta < 0
            ? `월 약 ${Math.abs(delta).toLocaleString("ko-KR")}원 수준 절감 여지가 있습니다.`
            : "현재 보험료 수준과 설계 예산 범위가 유사합니다.",
  };
}

function buildPriorityActions({ keepItems = [], addItems = [], reviewItems = [], warningItems = [], design = null } = {}) {
  const actions = [];
  for (const item of addItems.slice(0, 2)) {
    actions.push({
      priority: actions.length + 1,
      action: `${item.coverage_label} 보장 보강 검토`,
      detail: item.reason,
    });
  }
  for (const item of reviewItems.slice(0, 2)) {
    actions.push({
      priority: actions.length + 1,
      action: `${item.coverage_label} 전환/재검토`,
      detail: item.reason,
    });
  }
  for (const item of keepItems.slice(0, 2)) {
    actions.push({
      priority: actions.length + 1,
      action: `${item.coverage_label ?? item.product_name ?? "기존 보험"} 유지`,
      detail: item.reason,
    });
  }
  for (const warning of warningItems.filter((item) => item.warning_type === "pre_enrollment_health").slice(0, 1)) {
    actions.push({
      priority: actions.length + 1,
      action: "가입 전 건강 고지 확인",
      detail: warning.message,
    });
  }
  for (const step of design?.step_by_step_plan?.slice(0, 2) ?? []) {
    actions.push({
      priority: actions.length + 1,
      action: step.action,
      detail: step.detail,
    });
  }
  return actions.slice(0, 6);
}

function buildCustomerVisibleRebalancing({ keepItems = [], addItems = [], warningItems = [], priorityActions = [] } = {}) {
  return {
    keep_insurances: uniqueStrings(
      keepItems.map((item) =>
        item.insurer_name && item.product_name ? `${item.insurer_name} ${item.product_name}` : item.coverage_label,
      ),
    ),
    strengthen_coverages: uniqueStrings(addItems.map((item) => item.coverage_label)),
    cautions_before_reduction: uniqueStrings(
      warningItems
        .filter((item) => ["cancellation_caution", "pre_enrollment_health", "underwriting"].includes(item.warning_type))
        .map((item) => item.message),
    ),
    next_actions: priorityActions.map((item) => item.action),
  };
}

function buildAgentFullDetails({
  input = {},
  keepItems = [],
  addItems = [],
  reduceItems = [],
  reviewItems = [],
  warningItems = [],
  estimatedBudgetImpact = {},
  design = null,
  legacySummary = null,
} = {}) {
  return {
    design_reference: design
      ? {
          design_id: design.design_id,
          design_title: design.design_title,
          design_summary: design.design_summary,
        }
      : null,
    policy_comparisons: (input.insurance_holdings ?? []).map((policy) => ({
      policy_id: policy.policy_id,
      insurer_name: policy.insurer_name,
      product_name: policy.product_name,
      monthly_premium: policy.monthly_premium,
      inferred_categories: inferCoverageCategoriesFromPolicy(policy),
      rebalancing_decision: keepItems.find((item) => item.policy_id === policy.policy_id)?.reason ?? "검토 필요",
    })),
    coverage_comparisons: {
      keep: keepItems,
      add: addItems,
      reduce: reduceItems,
      review: reviewItems,
    },
    budget_analysis: estimatedBudgetImpact,
    consultation_points: uniqueStrings([
      ...warningItems.map((item) => item.message),
      ...reviewItems.map((item) => item.reason),
      ...addItems.map((item) => item.reason),
    ]).slice(0, 8),
    legacy_rebalancing_summary: legacySummary,
  };
}

export function buildCustomerRebalancingPlan({
  customer_id = null,
  structuredMemory = null,
  insurance_holdings = [],
  health_profile = {},
  memory_facts = [],
  monthly_budget = null,
  coverageGapResult = {},
  underwritingResult = {},
  recommendationResult = {},
  insurance_design = null,
  customer_visible_design = null,
  generatedAt = new Date().toISOString(),
} = {}) {
  const keepExisting = recommendationResult.keep_existing ?? insurance_design?.keep_existing_coverages ?? [];
  const maintainedCoverage = coverageGapResult.maintained_coverage ?? [];

  const keep_items = buildKeepItems({
    holdings: insurance_holdings,
    keepExisting,
    maintainedCoverage,
    design: insurance_design,
  });
  const add_items = buildAddItems({
    design: insurance_design,
    recommendationResult,
    coverageGapResult,
  });
  const reduce_items = buildReduceItems({ coverageGapResult, holdings: insurance_holdings });
  const review_items = buildReviewItems({ recommendationResult, underwritingResult, design: insurance_design });
  const warning_items = buildWarningItems({
    memoryFacts: memory_facts,
    healthProfile: health_profile,
    underwritingResult,
    design: insurance_design,
    reduceItems: reduce_items,
  });
  const estimated_budget_impact = buildEstimatedBudgetImpact({
    holdings: insurance_holdings,
    monthlyBudget: monthly_budget,
    design: insurance_design,
    addItems: add_items,
  });
  const priority_actions = buildPriorityActions({
    keepItems: keep_items,
    addItems: add_items,
    reviewItems: review_items,
    warningItems: warning_items,
    design: insurance_design,
  });

  const memory_sources_used = uniqueStrings([
    ...(memory_facts ?? []).map((fact) => fact.fact_key),
    ...keep_items.flatMap((item) => item.memory_sources_used ?? []),
    ...add_items.flatMap((item) => item.memory_sources_used ?? []),
    ...review_items.flatMap((item) => item.memory_sources_used ?? []),
    ...(insurance_design?.memory_sources_used ?? []),
  ]);

  const customer_visible_rebalancing = buildCustomerVisibleRebalancing({
    keepItems: keep_items,
    addItems: add_items,
    warningItems: warning_items,
    priorityActions: priority_actions,
  });

  const legacySummary = analyzeRebalancing({
    customer_id,
    currentPortfolio: {
      monthly_premium: estimated_budget_impact.current_monthly_premium ?? 0,
      coverage_score: coverageGapResult.gap_score ?? 0,
      duplicate_count: coverageGapResult.duplicate_warnings?.length ?? 0,
    },
    designDraft: {
      customer_top2_designs: (recommendationResult.customer_visible_top2 ?? []).map((item) => ({
        design_focus: [item.coverage_category],
        monthly_premium_estimate: monthly_budget,
        warnings: warning_items.map((w) => w.message),
        requires_agent_review: warning_items.some((w) => w.requires_agent_review),
      })),
    },
    coverageGapResult,
    underwritingRiskResult: underwritingResult,
    generatedAt,
  });

  const agent_full_details = buildAgentFullDetails({
    input: { insurance_holdings },
    keepItems: keep_items,
    addItems: add_items,
    reduceItems: reduce_items,
    reviewItems: review_items,
    warningItems: warning_items,
    estimatedBudgetImpact: estimated_budget_impact,
    design: insurance_design,
    legacySummary,
  });

  return {
    customer_id,
    keep_items,
    add_items,
    reduce_items,
    review_items,
    warning_items,
    estimated_budget_impact,
    priority_actions,
    memory_sources_used,
    customer_visible_rebalancing,
    agent_full_details,
    insurance_design_reference: insurance_design
      ? { design_id: insurance_design.design_id, design_title: insurance_design.design_title }
      : null,
    customer_visible_design_reference: customer_visible_design
      ? { design_title: customer_visible_design.design_title }
      : null,
    generated_at: generatedAt,
  };
}

export { ACTION_PRIORITY };
