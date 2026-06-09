/**
 * Phase 27 Step 1A — Build Rebalancing input from Memory + Gap + UW + Recommendation + Design.
 */

import { buildInsuranceDesignInputFromAnalysis } from "./insuranceDesignInputBuilder.js";

export function buildRebalancingInputFromAnalysis({
  snapshot,
  policies = [],
  health = null,
  structuredMemory = null,
  coverageGapResult = null,
  underwritingResult = null,
  recommendationResult = null,
  designBundle = null,
} = {}) {
  const designInput = buildInsuranceDesignInputFromAnalysis({
    snapshot,
    policies,
    health,
    coverageGapResult,
    underwritingResult,
    recommendationResult,
    structuredMemory,
  });

  return {
    customer_id: snapshot?.customer_id ?? null,
    memory_version: snapshot?.memory_version ?? 0,
    structured_memory: structuredMemory,
    customer_profile: designInput.customer_profile,
    insurance_holdings: designInput.insurance_holdings,
    health_profile: designInput.health_profile,
    insurance_goal: designInput.insurance_goal,
    monthly_budget: designInput.monthly_budget,
    memory_facts: designInput.memory_facts,
    memory_sources_used: designInput.memory_sources_used,
    coverage_gap_result: coverageGapResult,
    underwriting_result: underwritingResult,
    recommendation_result: recommendationResult,
    insurance_design: designBundle?.insurance_design ?? null,
    customer_visible_design: designBundle?.customer_visible_design ?? null,
  };
}
