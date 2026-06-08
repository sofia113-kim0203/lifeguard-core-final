/**
 * Phase 26 Step 1C — Customer Memory + Coverage Gap + Underwriting Risk E2E.
 */
import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";
import { buildUnderwritingRiskInputFromMemory } from "../server/underwritingRiskInputBuilder.js";
import { analyzeUnderwritingRisk } from "../server/underwritingRiskAnalysisEngine.js";
import {
  handleCustomerUnderwritingRiskRequest,
  transformUnderwritingRiskResults,
} from "../server/customerUnderwritingRiskCore.js";
import { loadCoverageAnalysisContext } from "../server/customerCoverageGapCore.js";
import { buildStructuredMemoryProfile } from "../server/customerMemorySnapshot.js";

const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const serviceRoleKey = process.env.SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceRoleKey) throw new Error("SUPABASE_URL and SERVICE_ROLE_KEY are required");

const TEST_CUSTOMER_ID = process.env.PHASE26_TEST_CUSTOMER_ID || "8f8f81e6-a583-44ff-ba6c-a6daed2162ec";
const supabase = createClient(url, serviceRoleKey, { auth: { persistSession: false } });

const coverageContext = await loadCoverageAnalysisContext(supabase, TEST_CUSTOMER_ID);
const structured = buildStructuredMemoryProfile(coverageContext.snapshot);

const input = buildUnderwritingRiskInputFromMemory({
  snapshot: coverageContext.snapshot,
  policies: coverageContext.policies ?? [],
  health: coverageContext.health ?? null,
  coverageGapResult: coverageContext.coverageGapResult,
});

const healthAnalysis = analyzeUnderwritingRisk({
  customer_id: TEST_CUSTOMER_ID,
  memory: input.health_memory_facts,
});

const underwritingResult = transformUnderwritingRiskResults({
  healthAnalysis,
  input,
  coverageGapResult: coverageContext.coverageGapResult,
});

let fullResult = null;
if (process.env.ANTHROPIC_API_KEY) {
  fullResult = await handleCustomerUnderwritingRiskRequest({
    testCustomerId: TEST_CUSTOMER_ID,
    adminSupabase: supabase,
    skipClaude: false,
  });
} else {
  fullResult = await handleCustomerUnderwritingRiskRequest({
    testCustomerId: TEST_CUSTOMER_ID,
    adminSupabase: supabase,
    skipClaude: true,
  });
}

const diabetesMedicationFact = (coverageContext.snapshot.facts ?? []).find((fact) =>
  /당뇨약/.test(String(fact.fact_value ?? "")),
);
const medicationRisk = healthAnalysis.health_risk_items.find(
  (item) => item.risk_type === "medication_history" && item.status !== "none",
);
const diabetesSurchargeItems = underwritingResult.likely_surcharge.filter((item) =>
  ["cancer", "brain", "heart"].includes(item.coverage_category),
);

const report = {
  phase: "26-1C",
  test_customer_id: TEST_CUSTOMER_ID,
  memory: {
    fact_count: coverageContext.snapshot.fact_count,
    memory_version: coverageContext.snapshot.memory_version,
    health_memory_count: structured.health_memory.length,
    insurance_memory_count: structured.insurance_memory.length,
    diabetes_medication_fact: diabetesMedicationFact?.fact_value ?? null,
  },
  coverage_gap_reference: underwritingResult.coverage_gap_reference,
  underwriting_result: {
    overall_risk: underwritingResult.overall_underwriting_risk,
    risk_score: underwritingResult.risk_score,
    item_count: underwritingResult.items.length,
    likely_surcharge: underwritingResult.likely_surcharge.map((item) => ({
      category: item.coverage_category,
      status: item.underwriting_status,
      risk_level: item.risk_level,
    })),
    likely_standard: underwritingResult.likely_standard.map((item) => item.coverage_category),
    required_documents: underwritingResult.required_documents,
  },
  claude: fullResult.claude_explanation
    ? { has_explanation: true, preview: fullResult.claude_explanation.slice(0, 200) }
    : { has_explanation: false, meta: fullResult.claude_meta },
  tests: {
    memoryLoaded: { pass: coverageContext.snapshot.fact_count >= 14, fact_count: coverageContext.snapshot.fact_count },
    healthMemory: { pass: structured.health_memory.length > 0, count: structured.health_memory.length },
    insuranceMemory: { pass: structured.insurance_memory.length > 0, count: structured.insurance_memory.length },
    coverageGapReferenced: {
      pass: Boolean(underwritingResult.coverage_gap_reference?.top_gaps?.length),
      top_gaps: underwritingResult.coverage_gap_reference?.top_gaps?.length ?? 0,
    },
    underwritingGenerated: {
      pass: underwritingResult.items.length >= 9,
      item_count: underwritingResult.items.length,
    },
    diabetesMedicationInHealthRisk: {
      pass: Boolean(medicationRisk),
      medicationRisk,
    },
    diabetesAffectsUnderwriting: {
      pass: diabetesSurchargeItems.length >= 1,
      surcharge_count: diabetesSurchargeItems.length,
    },
    fullHandlerOk: {
      pass: fullResult.ok === true,
      memory_used: fullResult.memory_used,
      coverage_gap_used: fullResult.coverage_gap_used,
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
