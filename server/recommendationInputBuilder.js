/**
 * Phase 26 Step 1D — Build Recommendation Engine input from Memory + Gap + Underwriting.
 */

import { buildUnderwritingRiskInputFromMemory } from "./underwritingRiskInputBuilder.js";

export function buildRecommendationInputFromAnalysis({
  snapshot,
  policies = [],
  health = null,
  coverageGapResult = null,
  underwritingResult = null,
  structuredMemory = null,
} = {}) {
  const underwritingInput = buildUnderwritingRiskInputFromMemory({
    snapshot,
    policies,
    health,
    coverageGapResult,
  });

  return {
    customer_id: snapshot?.customer_id ?? null,
    memory_version: snapshot?.memory_version ?? 0,
    structured_memory: structuredMemory,
    customer_profile: underwritingInput.customer_profile,
    insurance_holdings: underwritingInput.insurance_holdings,
    health_profile: underwritingInput.health_profile,
    insurance_goal: underwritingInput.customer_profile?.insurance_goal ?? null,
    monthly_budget: underwritingInput.customer_profile?.monthly_budget ?? null,
    memory_facts: underwritingInput.memory_facts,
    memory_sources_used: underwritingInput.memory_sources_used,
    coverage_gap_result: coverageGapResult,
    underwriting_result: underwritingResult,
  };
}
