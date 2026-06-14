/**
 * Advisor Brain P1 Step 2 — coverage_gap_check activation tests (no live DB / no live Claude).
 */
import assert from "node:assert/strict";
import { classifyConsultationIntent } from "../server/intentGateLayer.js";
import {
  buildAdvisorBrainAnswer,
  isAdvisorBrainEnabled,
  sanitizeAdvisorBrainMessage,
  shouldActivateAdvisorBrainForClassification,
} from "../server/advisorBrain/advisorBrainResponder.js";
import { buildToolResult } from "../server/advisorBrain/advisorToolRunner.js";

const mockPolicies = Array.from({ length: 6 }, (_, i) => ({
  id: `p${i + 1}`,
  insurer_name: `Insurer${i + 1}`,
  product_name: `Product${i + 1}`,
  coverage_summary: i % 2 === 0 ? { riders: ["A"] } : {},
  advisor_guarded_ownership_status: i % 2 === 0 ? "held" : "미확인",
}));

const mockGapAllMissing = {
  gap_score: 100,
  items: [
    { coverage_category: "cancer", current_status: "missing", gap_level: "critical" },
    { coverage_category: "medical_expense", current_status: "missing", gap_level: "critical" },
  ],
  top_gaps: [
    { coverage_label: "암", gap_level: "critical" },
    { coverage_label: "실손", gap_level: "critical" },
  ],
};

const mockContext = {
  customerId: "cust-1",
  policies: mockPolicies,
  policyCount: 6,
  snapshot: { customer_id: "cust-1", facts: [], memory_version: 1 },
  structuredMemory: { fact_count: 1, total_fact_count: 1, profile: { name: "테스트" } },
  unified: { policy_ids: mockPolicies.map((p) => p.id) },
  _unifiedLoaded: true,
};

const successfulToolRun = async () => ({
  called_tools: ["get_policies", "get_coverage_gap"],
  tool_results: [
    buildToolResult({
      ok: true,
      tool: "get_policies",
      data: { policies: mockPolicies, policy_count: 6 },
      confidence: "confirmed",
    }),
    buildToolResult({
      ok: true,
      tool: "get_coverage_gap",
      data: mockGapAllMissing,
      confidence: "confirmed",
    }),
  ],
  guardrail_summary: {
    contradiction: { contradicted: true, reason: "policy_count_positive_but_all_gap_items_missing" },
    uncertainty_notice:
      "등록된 보험 건수와 보장 공백 분석 결과가 서로 맞지 않을 수 있어, 단정적 표현을 피하고 추가 확인이 필요합니다.",
  },
  audit_record: { storage_status: "payload_only_no_db_table" },
});

// A — 6 policies + all missing gap: no blanket 미보유, includes 미확인 + contradiction
{
  const classification = classifyConsultationIntent("암보험 부족해?");
  assert.equal(classification.intent, "coverage_gap_check");

  const result = await buildAdvisorBrainAnswer({
    supabase: {},
    customerId: "cust-1",
    question: "암보험 부족해?",
    classification,
    preloadedContext: mockContext,
    toolRun: successfulToolRun,
    claudeCall: async () => ({
      ok: true,
      message:
        "등록된 보험 6건이 있으나 특약 정보가 부족합니다. 미확인 가능성이 있으며 증권 확인이 필요합니다. 보장 공백은 Memory 기준 참고 사항입니다.",
    }),
  });

  assert.equal(result.ok, true);
  assert.match(result.message, /미확인/);
  assert.match(result.message, /증권|특약|확인/);
  assert.doesNotMatch(result.message, /전부\s*미보유|모두\s*미보유|보험이\s*없습니다/);
  assert.equal(result.guardrail_summary.contradiction.contradicted, true);
  assert.equal(result.audit.final_customer_text, result.message);
  console.log("A PASS");
}

// B — unsupported premium / enrollment claims sanitized
{
  const dirty = "월 보험료: 120,000원이며 반드시 가입 가능합니다.";
  const sanitized = sanitizeAdvisorBrainMessage(dirty, {
    hasPremiumEvidence: false,
    hasCoverageEvidence: true,
  });
  assert.doesNotMatch(sanitized, /반드시\s*가입\s*가능/);
  assert.match(sanitized, /미확인|확인 필요/);
  console.log("B PASS");
}

// C — flag OFF keeps existing activation gate disabled
{
  const envOff = { ADVISOR_BRAIN_ENABLED: "false" };
  const envOn = { ADVISOR_BRAIN_ENABLED: "true" };
  const classification = { intent: "coverage_gap_check" };

  assert.equal(isAdvisorBrainEnabled(envOff), false);
  assert.equal(shouldActivateAdvisorBrainForClassification(classification, envOff), false);
  assert.equal(shouldActivateAdvisorBrainForClassification(classification, envOn), true);
  assert.equal(
    shouldActivateAdvisorBrainForClassification({ intent: "factual_lookup" }, envOn),
    false,
  );
  console.log("C PASS");
}

// D — tool failure → ok:false, no fabricated message
{
  const failingToolRun = async () => ({
    called_tools: [],
    tool_results: [
      buildToolResult({
        ok: false,
        tool: "get_policies",
        data: null,
        error: "simulated_failure",
        confidence: "unknown",
      }),
      buildToolResult({
        ok: false,
        tool: "get_coverage_gap",
        data: null,
        error: "simulated_failure",
        confidence: "unknown",
      }),
    ],
    guardrail_summary: { contradiction: { contradicted: false } },
    audit_record: null,
  });

  const result = await buildAdvisorBrainAnswer({
    supabase: {},
    customerId: "cust-1",
    question: "암보험 부족해?",
    classification: { intent: "coverage_gap_check" },
    preloadedContext: mockContext,
    toolRun: failingToolRun,
    claudeCall: async () => ({
      ok: true,
      message: "이 응답은 사용되면 안 됩니다.",
    }),
  });

  assert.equal(result.ok, false);
  assert.equal(result.message, null);
  assert.equal(result.reason, "TOOL_RESULTS_EMPTY");
  console.log("D PASS");
}

console.log("advisor-brain-p1-step2-coverage-gap-test: PASS");
