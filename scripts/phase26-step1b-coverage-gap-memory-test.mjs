/**
 * Phase 26 Step 1B — Customer Memory + Coverage Gap Engine E2E.
 */
import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";
import { buildCoverageGapInputFromMemory } from "../server/coverageGapInputBuilder.js";
import { analyzeCoverageGaps } from "../server/coverageGapAnalysisEngine.js";
import {
  handleCustomerCoverageGapRequest,
  transformCoverageGapResults,
} from "../server/customerCoverageGapCore.js";
import {
  buildStructuredMemoryProfile,
  loadCustomerMemorySnapshot,
} from "../server/customerMemorySnapshot.js";

const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const serviceRoleKey = process.env.SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceRoleKey) throw new Error("SUPABASE_URL and SERVICE_ROLE_KEY are required");

const TEST_CUSTOMER_ID = process.env.PHASE26_TEST_CUSTOMER_ID || "8f8f81e6-a583-44ff-ba6c-a6daed2162ec";
const supabase = createClient(url, serviceRoleKey, { auth: { persistSession: false } });

const snapshot = await loadCustomerMemorySnapshot(supabase, TEST_CUSTOMER_ID);
const structured = buildStructuredMemoryProfile(snapshot);

const { data: policies } = await supabase
  .from("profile_insurance_policies")
  .select(
    "id, insurer_name, product_name, policy_type, monthly_premium, premium_amount, coverage_summary, effective_from, contract_date, is_active, policy_status",
  )
  .eq("customer_id", TEST_CUSTOMER_ID)
  .is("deleted_at", null);

const { data: health } = await supabase
  .from("profile_health")
  .select("customer_id, source, details_json")
  .eq("customer_id", TEST_CUSTOMER_ID)
  .maybeSingle();

const input = buildCoverageGapInputFromMemory({ snapshot, policies: policies ?? [], health });
const analysis = analyzeCoverageGaps({ customer_id: TEST_CUSTOMER_ID, memory: input.memory_facts });
const coverageGapResult = transformCoverageGapResults(analysis, input, snapshot.facts);

let fullResult = null;
if (process.env.ANTHROPIC_API_KEY) {
  fullResult = await handleCustomerCoverageGapRequest({
    testCustomerId: TEST_CUSTOMER_ID,
    adminSupabase: supabase,
    skipClaude: false,
  });
} else {
  fullResult = await handleCustomerCoverageGapRequest({
    testCustomerId: TEST_CUSTOMER_ID,
    adminSupabase: supabase,
    skipClaude: true,
  });
}

const hasInsuranceMemory = structured.insurance_memory.length > 0;
const hasHealthMemory = structured.health_memory.length > 0;
const hasMedicalExpenseHeld = coverageGapResult.items.some(
  (item) => item.coverage_category === "medical_expense" && item.gap_level === "sufficient",
);
const hasCriticalOrHighGap = coverageGapResult.top_gaps.some((item) =>
  ["critical", "high", "medium"].includes(item.gap_level),
);

const report = {
  phase: "26-1B",
  test_customer_id: TEST_CUSTOMER_ID,
  memory: {
    fact_count: snapshot.fact_count,
    memory_version: snapshot.memory_version,
    insurance_memory_count: structured.insurance_memory.length,
    health_memory_count: structured.health_memory.length,
  },
  input_summary: {
    insurance_holdings_count: input.insurance_holdings.length,
    enriched_fact_count: input.memory_facts.length,
    memory_sources_used: input.memory_sources_used,
  },
  coverage_gap_result: {
    overall_risk: coverageGapResult.overall_risk,
    gap_score: coverageGapResult.gap_score,
    item_count: coverageGapResult.items.length,
    top_gaps: coverageGapResult.top_gaps.map((item) => ({
      category: item.coverage_category,
      gap_level: item.gap_level,
    })),
    maintained: coverageGapResult.maintained_coverage.map((item) => item.coverage_category),
  },
  claude: fullResult.claude_explanation
    ? { has_explanation: true, preview: fullResult.claude_explanation.slice(0, 200) }
    : { has_explanation: false, meta: fullResult.claude_meta },
  tests: {
    memoryLoaded: { pass: snapshot.fact_count >= 14, fact_count: snapshot.fact_count },
    insuranceMemory: { pass: hasInsuranceMemory, count: structured.insurance_memory.length },
    healthMemory: { pass: hasHealthMemory, count: structured.health_memory.length },
    coverageGapGenerated: {
      pass: coverageGapResult.items.length >= 10,
      item_count: coverageGapResult.items.length,
    },
    medicalExpenseHeld: { pass: hasMedicalExpenseHeld },
    hasPriorityGaps: { pass: hasCriticalOrHighGap, top_gaps: coverageGapResult.top_gaps.length },
    fullHandlerOk: { pass: fullResult.ok === true, memory_used: fullResult.memory_used },
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
