/**
 * Phase 28 Step 1C — Panel Claude vascular wiring test.
 */
import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";
import { buildUnderwritingExplanationPrompt } from "../server/customerUnderwritingRiskCore.js";
import { buildRecommendationExplanationPrompt } from "../server/customerRecommendationCore.js";
import { buildInsuranceDesignExplanationPrompt } from "../server/customerInsuranceDesignCore.js";
import {
  formatPoliciesForClaudePrompt,
  buildPoliciesPromptBlock,
} from "../server/panelClaudePoliciesContext.js";
import {
  buildClaudeExplanationEntry,
  generatePanelClaudeExplanations,
} from "../server/panelClaudeExplanationHydration.js";
import {
  normalizeClaudeExplanationEntry,
  hasClaudeExplanation,
} from "../src/lib/panelClaudeExplanation.js";
import { loadUnifiedCustomerState } from "../server/unifiedCustomerState.js";
import { runAnalysisJobToCompletion } from "../server/backgroundAnalysisJobRunner.js";
import { handleConversationalQuestionRequest } from "../server/conversationalBackgroundAnalysisCore.js";
import { resolveAuditCustomerId } from "./lib/sandboxAuthGuard.js";

const TEST_CUSTOMER_ID = resolveAuditCustomerId(process.env.PHASE28_TEST_CUSTOMER_ID);
const EXPECTED_POLICY_COUNT = Number(process.env.PHASE28_EXPECTED_POLICY_COUNT || "8");

const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const serviceRoleKey = process.env.SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

function makeMockPolicies(count = 8) {
  return Array.from({ length: count }, (_, index) => ({
    id: `policy-${index + 1}`,
    insurer_name: `Insurer ${index + 1}`,
    product_name: `Product ${index + 1}`,
    policy_type: "health",
    monthly_premium: 10000 + index,
    coverage_summary: `Coverage ${index + 1}`,
    is_active: true,
    policy_status: "active",
  }));
}

const mockPolicies = makeMockPolicies(EXPECTED_POLICY_COUNT);
const mockMemory = { profile: { name: "김진우" }, memory_version: 2 };
const mockCoverageGap = { overall_risk: "high", gap_score: 72, top_gaps: [] };
const mockUnderwriting = {
  overall_underwriting_risk: "medium",
  risk_score: 55,
  likely_standard: [],
  likely_surcharge: [],
  coverage_gap_reference: { overall_risk: "high" },
};
const mockRecommendation = {
  customer_visible_top2: [{ coverage_label: "암" }],
  keep_existing: [],
  recommendations: [{ coverage_label: "암" }],
};
const mockDesignBundle = {
  insurance_design: { design_title: "설계안" },
  customer_visible_design: { design_title: "설계안" },
};

assert.equal(formatPoliciesForClaudePrompt(mockPolicies).length, EXPECTED_POLICY_COUNT);
assert.match(buildPoliciesPromptBlock(mockPolicies), /"policy_count": 8/);

for (const [name, promptBuilder, args] of [
  [
    "underwriting",
    buildUnderwritingExplanationPrompt,
    [mockMemory, mockCoverageGap, mockUnderwriting, mockPolicies],
  ],
  [
    "recommendation",
    buildRecommendationExplanationPrompt,
    [mockMemory, mockRecommendation, mockCoverageGap, mockUnderwriting, mockPolicies],
  ],
  [
    "insurance_design",
    buildInsuranceDesignExplanationPrompt,
    [
      mockMemory,
      mockDesignBundle,
      {
        coverageGapResult: mockCoverageGap,
        underwritingResult: mockUnderwriting,
        recommendationResult: mockRecommendation,
      },
      mockPolicies,
    ],
  ],
]) {
  const prompt = promptBuilder(...args);
  assert.match(prompt.user, /customer_insurance_policies/, `${name} prompt must include full policies block`);
  assert.match(prompt.user, /"policy_count": 8/, `${name} prompt must include policy_count=8`);
  for (let index = 1; index <= EXPECTED_POLICY_COUNT; index += 1) {
    assert.match(prompt.user, new RegExp(`Insurer ${index}`), `${name} prompt must include policy ${index}`);
  }
}

const normalized = normalizeClaudeExplanationEntry({
  explanation: "테스트 설명",
  meta: { skipped: false, policy_count: 8 },
});
assert.equal(normalized.explanation, "테스트 설명");
assert.equal(normalized.meta.policy_count, 8);
assert.equal(hasClaudeExplanation(normalized), true);
assert.equal(hasClaudeExplanation({ explanation: "  ", meta: {} }), false);

const entry = buildClaudeExplanationEntry({
  explanation: "ok",
  meta: { skipped: false },
  policies: mockPolicies,
});
assert.equal(entry.meta.policy_count, EXPECTED_POLICY_COUNT);
assert.equal(entry.meta.policy_ids.length, EXPECTED_POLICY_COUNT);

let integration = { ran: false, policy_count: null, claude_keys: [] };

if (url && serviceRoleKey) {
  const supabase = createClient(url, serviceRoleKey, { auth: { persistSession: false } });

  const unified = await loadUnifiedCustomerState(supabase, TEST_CUSTOMER_ID);
  assert.equal(
    unified.policy_count,
    EXPECTED_POLICY_COUNT,
    `김진우 unified policy_count must be ${EXPECTED_POLICY_COUNT}`,
  );

  const hydration = await generatePanelClaudeExplanations({
    supabase,
    customerId: TEST_CUSTOMER_ID,
    workingContext: {
      structuredMemory: unified.structured_memory,
      coverageGapResult: mockCoverageGap,
      underwritingResult: mockUnderwriting,
      recommendationResult: mockRecommendation,
      designBundle: mockDesignBundle,
    },
    env: { ...process.env, ANTHROPIC_API_KEY: "", CLAUDE_API_KEY: "" },
  });

  assert.equal(hydration.policy_count, EXPECTED_POLICY_COUNT);
  assert.ok(hydration.explanations.underwriting);
  assert.ok(hydration.explanations.recommendation);
  assert.ok(hydration.explanations.insurance_design);
  assert.equal(hydration.explanations.underwriting.meta.policy_count, EXPECTED_POLICY_COUNT);
  assert.equal(hydration.explanations.underwriting.meta.reason, "ANTHROPIC_NOT_CONFIGURED");

  const migrationProbe = await supabase.from("analysis_jobs").select("id").limit(1);
  if (!migrationProbe.error) {
    const started = await handleConversationalQuestionRequest({
      question: "보험 8건 기준으로 인수위험과 추천, 설계를 설명해 주세요.",
      testCustomerId: TEST_CUSTOMER_ID,
      adminSupabase: supabase,
      autoProcess: false,
    });

    assert.ok(started?.analysis_job?.id, "analysis job should be created");
    const completed = await runAnalysisJobToCompletion({
      supabase,
      jobId: started.analysis_job.id,
      env: { ...process.env, ANTHROPIC_API_KEY: "", CLAUDE_API_KEY: "" },
    });

    const resultJson = completed?.job?.result_json ?? {};
    assert.ok(resultJson.claude_explanations, "result_json.claude_explanations must exist after job completion");
    assert.ok(resultJson.claude_explanations.underwriting);
    assert.ok(resultJson.claude_explanations.recommendation);
    assert.ok(resultJson.claude_explanations.insurance_design);
    assert.equal(resultJson.panel_claude_policy_count, EXPECTED_POLICY_COUNT);

    integration = {
      ran: true,
      policy_count: resultJson.panel_claude_policy_count,
      claude_keys: Object.keys(resultJson.claude_explanations),
      underwriting_reason: resultJson.claude_explanations.underwriting?.meta?.reason ?? null,
    };
  }
}

console.log(
  JSON.stringify(
    {
      ok: true,
      phase: "28-step1c-panel-claude-vascular",
      expected_policy_count: EXPECTED_POLICY_COUNT,
      prompt_policy_blocks: ["underwriting", "recommendation", "insurance_design"],
      integration,
    },
    null,
    2,
  ),
);
