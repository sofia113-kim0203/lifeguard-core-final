/**
 * CONN-005 — Rebalancing context pass-through (read-only · rebalancingEngine only).
 */
import { buildCustomerRebalancingPlan } from "./rebalancingEngine.js";
import { buildRebalancingHumanSpeak } from "./keyBrain/returnJudgmentContinuityWeave.js";

function mapPoliciesToHoldings(policies = []) {
  return (policies ?? []).map((policy, index) => ({
    policy_id: policy?.id ?? policy?.policy_id ?? `policy-${index + 1}`,
    insurer_name: policy?.insurer_name ?? policy?.company_name ?? null,
    product_name: policy?.product_name ?? policy?.name ?? null,
    monthly_premium: policy?.monthly_premium ?? policy?.premium ?? null,
    coverage_categories: policy?.coverage_categories ?? policy?.categories ?? [],
  }));
}

function extractDesignBundle(payload = null) {
  if (!payload || typeof payload !== "object") {
    return { insurance_design: null, customer_visible_design: null };
  }
  const nestedDesign = payload.insurance_design ?? null;
  const nestedVisible = payload.customer_visible_design ?? null;
  if (nestedDesign || nestedVisible) {
    return {
      insurance_design: nestedDesign ?? payload,
      customer_visible_design: nestedVisible ?? payload,
    };
  }
  if (
    payload.priority_coverages ||
    payload.plan_step_codes ||
    payload.design_reason_codes ||
    payload.design_id
  ) {
    return {
      insurance_design: payload,
      customer_visible_design: payload,
    };
  }
  return { insurance_design: null, customer_visible_design: null };
}

export function buildRebalancingContextFromAnalysisJob(
  analysisJob = null,
  { policies = [], monthlyBudget = null } = {},
) {
  const result = analysisJob?.result_json ?? analysisJob?.resultJson ?? null;
  if (!result || typeof result !== "object") {
    return buildEmptyRebalancingContext();
  }

  const coverageGapResult = result.coverage_gap ?? {};
  const underwritingResult = result.underwriting_risk ?? {};
  const rawRecommendation = result.recommendation ?? {};
  const recommendationResult =
    (rawRecommendation.customer_visible_top2 ?? []).length > 0
      ? rawRecommendation
      : {
          ...rawRecommendation,
          customer_visible_top2: [{ coverage_category: "general", coverage_label: "담보" }],
        };
  const designBundle = extractDesignBundle(result.insurance_design ?? null);

  const plan = buildCustomerRebalancingPlan({
    customer_id: analysisJob?.customer_id ?? null,
    insurance_holdings: mapPoliciesToHoldings(policies),
    monthly_budget: monthlyBudget,
    coverageGapResult,
    underwritingResult,
    recommendationResult,
    insurance_design: designBundle.insurance_design,
    customer_visible_design: designBundle.customer_visible_design,
  });

  const itemCount =
    (plan.keep_items?.length ?? 0) +
    (plan.add_items?.length ?? 0) +
    (plan.reduce_items?.length ?? 0) +
    (plan.review_items?.length ?? 0);
  const hasDesignReference =
    Boolean(plan.insurance_design_reference) ||
    Boolean(designBundle.insurance_design?.design_id) ||
    (designBundle.insurance_design?.plan_step_codes?.length ?? 0) > 0 ||
    (designBundle.customer_visible_design?.plan_step_codes?.length ?? 0) > 0 ||
    (designBundle.customer_visible_design?.priority_coverages?.length ?? 0) > 0;
  const loaded = itemCount > 0 && hasDesignReference;

  const humanSpeak = buildRebalancingHumanSpeak(plan);

  return {
    available: itemCount > 0,
    loaded,
    used: loaded,
    job_id: analysisJob?.id ?? null,
    keep_items: plan.keep_items ?? [],
    add_items: plan.add_items ?? [],
    reduce_items: plan.reduce_items ?? [],
    review_items: plan.review_items ?? [],
    customer_visible_rebalancing: plan.customer_visible_rebalancing ?? null,
    insurance_design_reference: plan.insurance_design_reference ?? null,
    rebalancing_human_speak: humanSpeak,
    rebalancing_keep_labels: humanSpeak.keep_label ? [humanSpeak.keep_label] : [],
    rebalancing_strengthen_labels: humanSpeak.strengthen_label ? [humanSpeak.strengthen_label] : [],
    rebalancing_review_labels: humanSpeak.review_label ? [humanSpeak.review_label] : [],
    rebalancing_reduce_signal: humanSpeak.reduce_signal === true,
    maintenance_return_eligible: loaded,
  };
}

export function buildEmptyRebalancingContext() {
  return {
    available: false,
    loaded: false,
    used: false,
    job_id: null,
    keep_items: [],
    add_items: [],
    reduce_items: [],
    review_items: [],
    customer_visible_rebalancing: null,
    insurance_design_reference: null,
    rebalancing_human_speak: { clauses: [] },
    rebalancing_keep_labels: [],
    rebalancing_strengthen_labels: [],
    rebalancing_review_labels: [],
    rebalancing_reduce_signal: false,
    maintenance_return_eligible: false,
  };
}
