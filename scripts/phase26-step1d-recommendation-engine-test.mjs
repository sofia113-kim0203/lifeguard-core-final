/**
 * Phase 26 Step 1D — Customer Memory + Gap + Underwriting + Recommendation E2E.
 */
import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";
import { buildRecommendationInputFromAnalysis } from "../server/recommendationInputBuilder.js";
import { buildCoverageCategoryRecommendations } from "../server/recommendationEngine.js";
import { loadRecommendationAnalysisContext, handleCustomerRecommendationRequest } from "../server/customerRecommendationCore.js";
import { loadUnderwritingAnalysisContext } from "../server/customerUnderwritingRiskCore.js";
import { loadCoverageAnalysisContext } from "../server/customerCoverageGapCore.js";

const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const serviceRoleKey = process.env.SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceRoleKey) throw new Error("SUPABASE_URL and SERVICE_ROLE_KEY are required");

const TEST_CUSTOMER_ID = process.env.PHASE26_TEST_CUSTOMER_ID || "8f8f81e6-a583-44ff-ba6c-a6daed2162ec";
const supabase = createClient(url, serviceRoleKey, { auth: { persistSession: false } });

const context = await loadRecommendationAnalysisContext(supabase, TEST_CUSTOMER_ID);

let fullResult = null;
if (process.env.ANTHROPIC_API_KEY) {
  fullResult = await handleCustomerRecommendationRequest({
    testCustomerId: TEST_CUSTOMER_ID,
    adminSupabase: supabase,
    skipClaude: false,
  });
} else {
  fullResult = await handleCustomerRecommendationRequest({
    testCustomerId: TEST_CUSTOMER_ID,
    adminSupabase: supabase,
    skipClaude: true,
  });
}

const top2 = context.recommendationResult.customer_visible_top2;
const allCount = context.recommendationResult.recommendations.length;
const diabetesInMemory = (context.snapshot.facts ?? []).some((fact) => /당뇨/.test(String(fact.fact_value ?? "")));
const top2HasGapCategory = top2.some((item) => ["cancer", "brain", "heart"].includes(item.coverage_category));
const keepHasMedical = context.recommendationResult.keep_existing.some(
  (item) => item.coverage_category === "medical_expense",
);

const report = {
  phase: "26-1D",
  test_customer_id: TEST_CUSTOMER_ID,
  memory: {
    fact_count: context.snapshot.fact_count,
    memory_version: context.snapshot.memory_version,
    diabetes_in_memory: diabetesInMemory,
  },
  references: {
    coverage_gap_top_gaps: context.coverageGapResult.top_gaps?.length ?? 0,
    underwriting_surcharge_count: context.underwritingResult.likely_surcharge?.length ?? 0,
  },
  recommendations: {
    total_count: allCount,
    customer_visible_top2: top2.map((item) => ({
      rank: item.recommendation_rank,
      category: item.coverage_category,
      type: item.recommendation_type,
      priority: item.priority,
    })),
    keep_existing: context.recommendationResult.keep_existing.map((item) => item.coverage_category),
  },
  claude: fullResult.claude_explanation
    ? { has_explanation: true, preview: fullResult.claude_explanation.slice(0, 200) }
    : { has_explanation: false, meta: fullResult.claude_meta },
  tests: {
    memoryLoaded: { pass: context.snapshot.fact_count >= 14, fact_count: context.snapshot.fact_count },
    coverageGapReferenced: {
      pass: (context.coverageGapResult.top_gaps?.length ?? 0) >= 3,
      top_gaps: context.coverageGapResult.top_gaps?.length ?? 0,
    },
    underwritingReferenced: {
      pass: (context.underwritingResult.likely_surcharge?.length ?? 0) >= 1,
      surcharge_count: context.underwritingResult.likely_surcharge?.length ?? 0,
    },
    recommendationsGenerated: { pass: allCount >= 5, total_count: allCount },
    top2OnlyForCustomer: { pass: top2.length === 2, top2_count: top2.length },
    fullRankingPreserved: { pass: allCount > top2.length, all_count: allCount },
    top2FromGapPriorities: { pass: top2HasGapCategory, top2 },
    keepMedicalExpense: { pass: keepHasMedical },
    diabetesMemoryPresent: { pass: diabetesInMemory },
    fullHandlerOk: {
      pass: fullResult.ok === true,
      memory_used: fullResult.memory_used,
      coverage_gap_used: fullResult.coverage_gap_used,
      underwriting_used: fullResult.underwriting_used,
    },
    claudeExplanation: {
      pass: fullResult.claude_explanation === null && fullResult.claude_meta?.reason === "FACTORY_SPEAK_01_S1",
      meta: fullResult.claude_meta,
    },
  },
};

report.allPass = Object.values(report.tests).every((test) => test.pass === true);
for (const [name, test] of Object.entries(report.tests)) {
  assert.equal(test.pass, true, `${name} should pass`);
}
console.log(JSON.stringify(report, null, 2));
