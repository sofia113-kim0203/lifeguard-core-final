/**
 * Advisor Brain P1 — Tool scaffold unit tests (no mock customer, no live DB required).
 */
import assert from "node:assert/strict";
import { classifyConsultationIntent } from "../server/intentGateLayer.js";
import { resolveAllowedTools } from "../server/advisorBrain/advisorToolRegistry.js";
import {
  assertNoUnsupportedFact,
  detectContradictionBetweenPolicyCountAndGap,
  normalizeUnknownVsNotOwned,
} from "../server/advisorBrain/advisorBrainGuardrails.js";
import { buildAdvisorAuditRecord } from "../server/advisorBrain/advisorAuditLog.js";
import {
  MAX_TOOL_CALLS_PER_TURN,
  buildToolResult,
  dedupeAllowedTools,
  isToolCallAllowed,
  runControlledAdvisorTools,
  runSingleAdvisorTool,
} from "../server/advisorBrain/advisorToolRunner.js";

const mockPolicies = Array.from({ length: 6 }, (_, i) => ({
  id: `p${i + 1}`,
  insurer_name: `Insurer${i + 1}`,
  product_name: `Product${i + 1}`,
  coverage_summary: i % 2 === 0 ? { riders: ["A"] } : {},
}));

const mockGapAllMissing = {
  gap_score: 100,
  items: [
    { coverage_category: "cancer", current_status: "missing", gap_level: "critical" },
    { coverage_category: "medical", current_status: "missing", gap_level: "critical" },
  ],
};

const mockContext = {
  customerId: "test-customer",
  policies: mockPolicies,
  policyCount: 6,
  snapshot: { customer_id: "test-customer", facts: [], memory_version: 1 },
  structuredMemory: { fact_count: 2, total_fact_count: 2 },
  unified: { policy_ids: mockPolicies.map((p) => p.id) },
  _unifiedLoaded: true,
};

const mockExecutors = {
  get_policies: async ({ context }) =>
    buildToolResult({
      ok: true,
      tool: "get_policies",
      data: { policies: context.policies, policy_count: context.policyCount },
      confidence: "confirmed",
    }),
  get_coverage_gap: async () =>
    buildToolResult({
      ok: true,
      tool: "get_coverage_gap",
      data: mockGapAllMissing,
      confidence: "confirmed",
    }),
  get_customer_memory: async ({ context }) =>
    buildToolResult({
      ok: true,
      tool: "get_customer_memory",
      data: context.structuredMemory,
      confidence: "confirmed",
    }),
  premium_lookup: async () =>
    buildToolResult({
      ok: true,
      tool: "premium_lookup",
      data: { totalCount: 6, premiumKnownCount: 3, premiumUnknownCount: 3, premiumTotal: 120000 },
      confidence: "confirmed",
    }),
  search_policy_terms: async () =>
    buildToolResult({
      ok: true,
      tool: "search_policy_terms",
      data: { used_sources: [{ chunk_id: "c1" }], rag_row_count: 1, context_used: true },
      confidence: "confirmed",
    }),
  failing_tool: async () => {
    throw new Error("simulated_failure");
  },
};

// A — allowed intent can run get_policies + get_coverage_gap
{
  const classification = classifyConsultationIntent("암보험 부족해?");
  assert.equal(classification.intent, "coverage_gap_check");
  const allowed = resolveAllowedTools(classification);
  assert.deepEqual(allowed, ["get_policies", "get_coverage_gap"]);

  const run = await runControlledAdvisorTools({
    supabase: {},
    customerId: "test-customer",
    classification,
    userMessage: "암보험 부족해?",
    preloadedContext: mockContext,
    executors: mockExecutors,
  });

  assert.deepEqual(run.called_tools, ["get_policies", "get_coverage_gap"]);
  assert.equal(run.tool_results.length, 2);
  assert.equal(run.tool_results.every((r) => r.ok), true);
  assert.equal(run.audit_record.selected_intent, "coverage_gap_check");
  console.log("A PASS");
}

// B — max_tool_calls exceeded
{
  const blocked = [];
  const called = [];
  for (const tool of ["get_policies", "get_coverage_gap", "get_customer_memory", "search_policy_terms"]) {
    const gate = isToolCallAllowed({
      toolName: tool,
      allowedTools: ["get_policies", "get_coverage_gap", "get_customer_memory", "search_policy_terms"],
      calledTools: called,
    });
    if (gate.allowed) called.push(tool);
    else blocked.push({ tool, reason: gate.reason });
  }
  assert.equal(called.length, MAX_TOOL_CALLS_PER_TURN);
  assert.equal(blocked.length, 1);
  assert.equal(blocked[0].reason, "MAX_TOOL_CALLS_EXCEEDED");
  console.log("B PASS");
}

// C — duplicate tool blocked
{
  const deduped = dedupeAllowedTools(["get_policies", "get_policies", "get_coverage_gap"]);
  assert.deepEqual(deduped, ["get_policies", "get_coverage_gap"]);

  const first = isToolCallAllowed({
    toolName: "get_policies",
    allowedTools: deduped,
    calledTools: [],
  });
  const second = isToolCallAllowed({
    toolName: "get_policies",
    allowedTools: deduped,
    calledTools: ["get_policies"],
  });
  assert.equal(first.allowed, true);
  assert.equal(second.allowed, false);
  assert.equal(second.reason, "DUPLICATE_TOOL_CALL");
  console.log("C PASS");
}

// D — tool outside allowlist blocked
{
  const gate = isToolCallAllowed({
    toolName: "get_underwriting",
    allowedTools: ["get_policies"],
    calledTools: [],
  });
  assert.equal(gate.allowed, false);
  assert.equal(gate.reason, "TOOL_NOT_IN_ALLOWLIST");

  const invocation = await runSingleAdvisorTool({
    toolName: "get_underwriting",
    allowedTools: ["get_policies"],
    calledTools: [],
    context: mockContext,
    supabase: {},
    customerId: "test-customer",
    executors: mockExecutors,
  });
  assert.equal(invocation.blocked, true);
  assert.equal(invocation.result.confidence, "unknown");
  console.log("D PASS");
}

// E — 6 policies + gap 100% → contradiction
{
  const contradiction = detectContradictionBetweenPolicyCountAndGap({
    policyCount: 6,
    coverageGapResult: mockGapAllMissing,
  });
  assert.equal(contradiction.contradicted, true);

  const run = await runControlledAdvisorTools({
    supabase: {},
    customerId: "test-customer",
    classification: { intent: "coverage_gap_check" },
    preloadedContext: mockContext,
    executors: mockExecutors,
  });
  assert.equal(run.guardrail_summary.contradiction.contradicted, true);
  console.log("E PASS");
}

// F — missing coverage_summary → 미확인 (not 미보유)
{
  assert.equal(
    normalizeUnknownVsNotOwned({ status: "missing", hasCoverageSummary: false }),
    "미확인",
  );
  assert.equal(
    normalizeUnknownVsNotOwned({ status: "missing", hasCoverageSummary: true }),
    "미보유",
  );
  console.log("F PASS");
}

// G — tool failure → confidence unknown, no fabricated data
{
  const invocation = await runSingleAdvisorTool({
    toolName: "get_policies",
    allowedTools: ["get_policies"],
    calledTools: [],
    context: mockContext,
    supabase: {},
    customerId: "test-customer",
    executors: {
      get_policies: mockExecutors.failing_tool,
    },
  });
  assert.equal(invocation.result.ok, false);
  assert.equal(invocation.result.confidence, "unknown");
  assert.equal(invocation.result.data, null);

  const unsupported = assertNoUnsupportedFact("반드시 가입 가능합니다.");
  assert.equal(unsupported.ok, false);
  console.log("G PASS");
}

// Audit scaffold shape
{
  const audit = buildAdvisorAuditRecord({
    customerId: "c1",
    sessionId: "s1",
    conversationId: "conv1",
    userMessage: "테스트",
    classification: { intent: "general_consultation" },
    allowedTools: ["get_policies"],
    toolResults: [
      buildToolResult({ ok: true, tool: "get_policies", data: { policy_count: 1 }, confidence: "confirmed" }),
    ],
  });
  assert.equal(audit.customer_id, "c1");
  assert.equal(audit.storage_status, "payload_only_no_db_table");
  assert.equal(audit.called_tools.length, 1);
  console.log("audit scaffold PASS");
}

console.log("advisor-brain-p1-tool-scaffold-unit-test: PASS");
