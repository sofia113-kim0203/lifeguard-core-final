/**
 * Phase 26 Step 1E — Build Insurance Design input from Memory + Gap + UW + Recommendation.
 */

import { buildRecommendationInputFromAnalysis } from "./recommendationInputBuilder.js";

export function buildInsuranceDesignInputFromAnalysis({
  snapshot,
  policies = [],
  health = null,
  coverageGapResult = null,
  underwritingResult = null,
  recommendationResult = null,
  structuredMemory = null,
} = {}) {
  const recommendationInput = buildRecommendationInputFromAnalysis({
    snapshot,
    policies,
    health,
    coverageGapResult,
    underwritingResult,
    structuredMemory,
  });

  return {
    customer_id: snapshot?.customer_id ?? null,
    memory_version: snapshot?.memory_version ?? 0,
    structured_memory: structuredMemory,
    customer_profile: recommendationInput.customer_profile,
    insurance_holdings: recommendationInput.insurance_holdings,
    health_profile: recommendationInput.health_profile,
    insurance_goal: recommendationInput.insurance_goal,
    monthly_budget: recommendationInput.monthly_budget,
    memory_facts: recommendationInput.memory_facts,
    memory_sources_used: recommendationInput.memory_sources_used,
    coverage_gap_result: coverageGapResult,
    underwriting_result: underwritingResult,
    recommendation_result: recommendationResult,
  };
}
