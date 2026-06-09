/**
 * Phase 27 Step 1A — Rebalancing Engine E2E.
 */
import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";
import { buildRebalancingInputFromAnalysis } from "../server/rebalancingInputBuilder.js";
import { buildCustomerRebalancingPlan } from "../server/rebalancingEngine.js";
import {
  handleCustomerRebalancingRequest,
  loadRebalancingAnalysisContext,
} from "../server/customerRebalancingCore.js";
import { loadInsuranceDesignAnalysisContext } from "../server/customerInsuranceDesignCore.js";

const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const serviceRoleKey = process.env.SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceRoleKey) throw new Error("SUPABASE_URL and SERVICE_ROLE_KEY are required");

const TEST_CUSTOMER_ID = process.env.PHASE27_TEST_CUSTOMER_ID || "8f8f81e6-a583-44ff-ba6c-a6daed2162ec";
const supabase = createClient(url, serviceRoleKey, { auth: { persistSession: false } });

const context = await loadRebalancingAnalysisContext(supabase, TEST_CUSTOMER_ID);
const designContext = await loadInsuranceDesignAnalysisContext(supabase, TEST_CUSTOMER_ID);

let fullResult = null;
if (process.env.ANTHROPIC_API_KEY) {
  fullResult = await handleCustomerRebalancingRequest({
    testCustomerId: TEST_CUSTOMER_ID,
    adminSupabase: supabase,
    skipClaude: false,
  });
} else {
  fullResult = await handleCustomerRebalancingRequest({
    testCustomerId: TEST_CUSTOMER_ID,
    adminSupabase: supabase,
    skipClaude: true,
  });
}

const rebalancing = context.rebalancingResult;
const visible = rebalancing.customer_visible_rebalancing;
const diabetesInMemory = (context.snapshot.facts ?? []).some((fact) => /당뇨/.test(String(fact.fact_value ?? "")));
const keepKbIndemnity = rebalancing.keep_items.some(
  (item) => /KB|실손|medical_expense/i.test(`${item.insurer_name ?? ""} ${item.product_name ?? ""} ${item.coverage_category ?? ""}`),
);
const addCancerBrain = rebalancing.add_items.some((item) => item.coverage_category === "cancer") &&
  rebalancing.add_items.some((item) => item.coverage_category === "brain");
const diabetesWarning = rebalancing.warning_items.some((item) => /당뇨/.test(`${item.label ?? ""} ${item.message ?? ""}`));

const report = {
  phase: "27-1A",
  test_customer_id: TEST_CUSTOMER_ID,
  memory: {
    fact_count: context.snapshot.fact_count,
    diabetes_in_memory: diabetesInMemory,
    holdings_count: context.input.insurance_holdings?.length ?? 0,
  },
  references: {
    design_id: designContext.designBundle.insurance_design?.design_id ?? null,
    design_title: designContext.designBundle.insurance_design?.design_title ?? null,
    coverage_gap_top_gaps: designContext.coverageGapResult.top_gaps?.length ?? 0,
    recommendation_top2: designContext.recommendationResult.customer_visible_top2?.length ?? 0,
  },
  rebalancing: {
    keep_count: rebalancing.keep_items.length,
    add_count: rebalancing.add_items.length,
    reduce_count: rebalancing.reduce_items.length,
    review_count: rebalancing.review_items.length,
    warning_count: rebalancing.warning_items.length,
    keep_labels: rebalancing.keep_items.map((item) => item.coverage_label ?? item.product_name),
    add_labels: rebalancing.add_items.map((item) => item.coverage_label),
    visible_keep: visible.keep_insurances,
    visible_strengthen: visible.strengthen_coverages,
    design_reference: rebalancing.insurance_design_reference,
  },
  claude: fullResult.claude_explanation
    ? { has_explanation: true, preview: fullResult.claude_explanation.slice(0, 200) }
    : { has_explanation: false, meta: fullResult.claude_meta },
  tests: {
    memoryLoaded: { pass: context.snapshot.fact_count >= 14, fact_count: context.snapshot.fact_count },
    inputBuilt: {
      pass: Boolean(buildRebalancingInputFromAnalysis({
        snapshot: context.snapshot,
        policies: [],
        structuredMemory: context.structuredMemory,
        coverageGapResult: context.coverageGapResult,
        underwritingResult: context.underwritingResult,
        recommendationResult: context.recommendationResult,
        designBundle: context.designBundle,
      }).customer_id),
    },
    designConnected: {
      pass:
        Boolean(rebalancing.insurance_design_reference?.design_title) &&
        rebalancing.insurance_design_reference.design_title === designContext.designBundle.insurance_design?.design_title,
      design_title: rebalancing.insurance_design_reference?.design_title,
    },
    keepKbIndemnity: { pass: keepKbIndemnity },
    addCancerBrain: { pass: addCancerBrain, add_labels: rebalancing.add_items.map((item) => item.coverage_label) },
    diabetesWarning: { pass: diabetesWarning },
    customerVisibleShape: {
      pass:
        Array.isArray(visible.keep_insurances) &&
        Array.isArray(visible.strengthen_coverages) &&
        Array.isArray(visible.next_actions) &&
        visible.next_actions.length >= 1,
    },
    agentDetailsPresent: {
      pass: Boolean(rebalancing.agent_full_details?.policy_comparisons?.length),
      policy_count: rebalancing.agent_full_details?.policy_comparisons?.length ?? 0,
    },
    budgetImpactPresent: {
      pass: Boolean(rebalancing.estimated_budget_impact?.label),
    },
    fullHandlerOk: {
      pass: fullResult.ok === true,
      memory_used: fullResult.memory_used,
      insurance_design_used: fullResult.insurance_design_used,
    },
    claudeExplanation: {
      pass: process.env.ANTHROPIC_API_KEY ? Boolean(fullResult.claude_explanation) : true,
      skipped: !process.env.ANTHROPIC_API_KEY,
    },
  },
};

report.allPass = Object.values(report.tests).every((test) => test.pass === true);
for (const [name, test] of Object.entries(report.tests)) {
  assert.equal(test.pass, true, `${name} should pass`);
}
console.log(JSON.stringify(report, null, 2));
