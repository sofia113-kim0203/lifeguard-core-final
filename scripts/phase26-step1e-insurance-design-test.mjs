/**
 * Phase 26 Step 1E — Insurance Design Generation E2E.
 */
import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";
import { buildInsuranceDesignInputFromAnalysis } from "../server/insuranceDesignInputBuilder.js";
import { buildCustomerInsuranceDesignPlan } from "../server/insuranceDesignGenerator.js";
import {
  handleCustomerInsuranceDesignRequest,
  loadInsuranceDesignAnalysisContext,
} from "../server/customerInsuranceDesignCore.js";
import { loadRecommendationAnalysisContext } from "../server/customerRecommendationCore.js";

const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const serviceRoleKey = process.env.SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceRoleKey) throw new Error("SUPABASE_URL and SERVICE_ROLE_KEY are required");

const TEST_CUSTOMER_ID = process.env.PHASE26_TEST_CUSTOMER_ID || "8f8f81e6-a583-44ff-ba6c-a6daed2162ec";
const supabase = createClient(url, serviceRoleKey, { auth: { persistSession: false } });

const context = await loadInsuranceDesignAnalysisContext(supabase, TEST_CUSTOMER_ID);
const recContext = await loadRecommendationAnalysisContext(supabase, TEST_CUSTOMER_ID);

let fullResult = null;
if (process.env.ANTHROPIC_API_KEY) {
  fullResult = await handleCustomerInsuranceDesignRequest({
    testCustomerId: TEST_CUSTOMER_ID,
    adminSupabase: supabase,
    skipClaude: false,
  });
} else {
  fullResult = await handleCustomerInsuranceDesignRequest({
    testCustomerId: TEST_CUSTOMER_ID,
    adminSupabase: supabase,
    skipClaude: true,
  });
}

const design = context.designBundle.insurance_design;
const visible = context.designBundle.customer_visible_design;
const diabetesInMemory = (context.snapshot.facts ?? []).some((fact) => /당뇨/.test(String(fact.fact_value ?? "")));

const report = {
  phase: "26-1E",
  test_customer_id: TEST_CUSTOMER_ID,
  memory: {
    fact_count: context.snapshot.fact_count,
    diabetes_in_memory: diabetesInMemory,
  },
  references: {
    coverage_gap_top_gaps: recContext.coverageGapResult.top_gaps?.length ?? 0,
    recommendation_top2: recContext.recommendationResult.customer_visible_top2?.length ?? 0,
    full_recommendations: recContext.recommendationResult.recommendations?.length ?? 0,
  },
  insurance_design: {
    design_id: design.design_id,
    design_priority: design.design_priority,
    design_reason_codes: design.design_reason_codes,
    plan_step_codes: design.plan_step_codes,
    budget_band_code: design.budget_band_code,
    keep_existing: design.keep_existing_coverages.map((item) => item.coverage_label),
    recommended_new: design.recommended_new_coverages.map((item) => item.coverage_label),
    step_count: design.step_by_step_plan.length,
    agent_details_present: Boolean(design.agent_full_details?.full_recommendation_ranking?.length),
  },
  customer_visible_design: {
    priority_coverages: visible.priority_coverages,
    keep_existing: visible.keep_existing_coverages,
    plan_step_codes: visible.plan_step_codes,
    design_reason_codes: visible.design_reason_codes,
    budget_band_code: visible.budget_band_code,
  },
  claude: fullResult.claude_explanation
    ? { has_explanation: true, preview: fullResult.claude_explanation.slice(0, 200) }
    : { has_explanation: false, meta: fullResult.claude_meta },
  tests: {
    memoryLoaded: { pass: context.snapshot.fact_count >= 14, fact_count: context.snapshot.fact_count },
    coverageGapReferenced: {
      pass: (recContext.coverageGapResult.top_gaps?.length ?? 0) >= 3,
      top_gaps: recContext.coverageGapResult.top_gaps?.length ?? 0,
    },
    underwritingReferenced: {
      pass: (recContext.underwritingResult.likely_surcharge?.length ?? 0) >= 1,
    },
    recommendationReferenced: {
      pass: (recContext.recommendationResult.customer_visible_top2?.length ?? 0) === 2,
    },
    designGenerated: {
      pass: Boolean(design.design_id) && design.recommended_new_coverages.length >= 2,
      design_id: design.design_id,
    },
    customerVisibleSimplified: {
      pass:
        visible.priority_coverages.length === 2 &&
        (visible.plan_step_codes?.length ?? 0) >= 1 &&
        (visible.design_reason_codes?.length ?? 0) >= 1,
      priority_count: visible.priority_coverages.length,
      plan_step_count: visible.plan_step_codes?.length ?? 0,
    },
    fullDesignPreserved: {
      pass: (design.agent_full_details?.full_recommendation_ranking?.length ?? 0) > 2,
      full_count: design.agent_full_details?.full_recommendation_ranking?.length ?? 0,
    },
    keepMedicalExpense: {
      pass: design.keep_existing_coverages.some((item) => item.coverage_category === "medical_expense"),
    },
    diabetesMemoryPresent: { pass: diabetesInMemory },
    fullHandlerOk: {
      pass: fullResult.ok === true,
      memory_used: fullResult.memory_used,
      coverage_gap_used: fullResult.coverage_gap_used,
      underwriting_used: fullResult.underwriting_used,
      recommendation_used: fullResult.recommendation_used,
    },
    claudeExplanation: {
      pass:
        fullResult.claude_explanation == null &&
        fullResult.claude_meta?.reason === "FACTORY_SPEAK_04_S1",
      skipped: !process.env.ANTHROPIC_API_KEY,
    },
  },
};

report.allPass = Object.values(report.tests).every((test) => test.pass === true);
for (const [name, test] of Object.entries(report.tests)) {
  assert.equal(test.pass, true, `${name} should pass`);
}
console.log(JSON.stringify(report, null, 2));
