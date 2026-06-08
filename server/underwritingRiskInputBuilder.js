/**
 * Phase 26 Step 1C — Build Underwriting Risk Engine input from Customer Memory + Coverage Gap.
 */

import { buildCoverageGapInputFromMemory } from "./coverageGapInputBuilder.js";

export const UNDERWRITING_COVERAGE_CATEGORIES = [
  {
    coverage_category: "cancer",
    label: "암보험",
    elevated_risks: ["diabetes", "cancer_history", "recent_diagnosis", "medication_history"],
    critical_risks: ["cancer_history", "recent_diagnosis"],
  },
  {
    coverage_category: "brain",
    label: "뇌혈관 보장",
    elevated_risks: ["cerebrovascular", "hypertension", "diabetes", "medication_history"],
    critical_risks: ["cerebrovascular"],
  },
  {
    coverage_category: "heart",
    label: "심혈관 보장",
    elevated_risks: ["cardiovascular", "hypertension", "diabetes", "medication_history"],
    critical_risks: ["cardiovascular"],
  },
  {
    coverage_category: "medical_expense",
    label: "실손",
    elevated_risks: ["surgery_history", "hospitalization_history", "medication_history", "recent_diagnosis"],
    critical_risks: ["cancer_history", "recent_diagnosis"],
  },
  {
    coverage_category: "surgery",
    label: "수술비",
    elevated_risks: ["surgery_history", "diabetes", "medication_history", "recent_diagnosis"],
    critical_risks: ["cancer_history"],
  },
  {
    coverage_category: "hospitalization",
    label: "입원비",
    elevated_risks: ["hospitalization_history", "diabetes", "medication_history"],
    critical_risks: ["cancer_history", "recent_diagnosis"],
  },
  {
    coverage_category: "driver",
    label: "운전자보험",
    elevated_risks: ["recent_diagnosis", "vague_health"],
    critical_risks: [],
  },
  {
    coverage_category: "death",
    label: "사망보험",
    elevated_risks: ["cardiovascular", "cerebrovascular", "cancer_history", "diabetes"],
    critical_risks: ["cancer_history", "recent_diagnosis"],
  },
  {
    coverage_category: "dementia_care",
    label: "치매/간병",
    elevated_risks: ["cerebrovascular", "hypertension", "diabetes", "medication_history"],
    critical_risks: ["cerebrovascular"],
  },
];

export function buildUnderwritingRiskInputFromMemory({
  snapshot,
  policies = [],
  health = null,
  coverageGapResult = null,
} = {}) {
  const coverageInput = buildCoverageGapInputFromMemory({ snapshot, policies, health });

  return {
    customer_id: snapshot?.customer_id ?? null,
    memory_version: snapshot?.memory_version ?? 0,
    customer_profile: coverageInput.customer_profile,
    health_profile: coverageInput.health_profile,
    insurance_holdings: coverageInput.insurance_holdings,
    insurance_goal: coverageInput.customer_profile?.insurance_goal ?? null,
    monthly_budget: coverageInput.customer_profile?.monthly_budget ?? null,
    memory_facts: coverageInput.memory_facts,
    health_memory_facts: coverageInput.memory_facts.filter(
      (fact) =>
        fact.fact_type === "health" ||
        String(fact.fact_key ?? "").startsWith("health.") ||
        fact.fact_type === "family",
    ),
    coverage_gap_result: coverageGapResult,
    coverage_gap_items: coverageGapResult?.items ?? [],
    memory_sources_used: coverageInput.memory_sources_used,
  };
}
