/**
 * Advisor Brain P1 — Controlled tool runner with limits, allowlist, and guardrails.
 * Not wired into live customer response path in this PR.
 */
import { computePolicyExplorerStats } from "../../src/lib/policyExplorer.js";
import { buildStructuredMemoryProfile } from "../customerMemorySnapshot.js";
import { loadCoverageAnalysisContext } from "../customerCoverageGapCore.js";
import { loadUnderwritingAnalysisContext } from "../customerUnderwritingRiskCore.js";
import { handlePolicyTermsQaRequest } from "../policyTermsQaCore.js";
import { createAdvisorBrainContext } from "./advisorBrainContext.js";
import {
  applyGuardrailsToPolicies,
  buildUncertaintyNotice,
  detectContradictionBetweenPolicyCountAndGap,
} from "./advisorBrainGuardrails.js";
import { buildAdvisorAuditRecord } from "./advisorAuditLog.js";
import { getToolDefinition, isRegisteredTool, resolveAllowedTools } from "./advisorToolRegistry.js";

export const MAX_TOOL_CALLS_PER_TURN = 3;
export const MAX_TOOL_DEPTH = 1;
export const TOOL_TIMEOUT_MS = 8000;

export function buildToolResult({
  ok,
  tool,
  data = null,
  error = null,
  confidence = "unknown",
  source = null,
} = {}) {
  return {
    ok: Boolean(ok),
    tool,
    data,
    error: error ?? null,
    confidence,
    source: source ?? getToolDefinition(tool)?.source ?? null,
  };
}

function withTimeout(promise, timeoutMs, label) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`${label}_timeout_after_${timeoutMs}ms`));
    }, timeoutMs);

    Promise.resolve(promise)
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch((error) => {
        clearTimeout(timer);
        reject(error);
      });
  });
}

export function dedupeAllowedTools(allowedTools = []) {
  const seen = new Set();
  const ordered = [];
  for (const tool of allowedTools ?? []) {
    if (!tool || seen.has(tool)) continue;
    seen.add(tool);
    ordered.push(tool);
  }
  return ordered;
}

export function isToolCallAllowed({ toolName, allowedTools, calledTools, depth = 0 }) {
  if (depth > MAX_TOOL_DEPTH) {
    return { allowed: false, reason: "MAX_DEPTH_EXCEEDED" };
  }
  if (!isRegisteredTool(toolName)) {
    return { allowed: false, reason: "TOOL_NOT_REGISTERED" };
  }
  if (!(allowedTools ?? []).includes(toolName)) {
    return { allowed: false, reason: "TOOL_NOT_IN_ALLOWLIST" };
  }
  if ((calledTools ?? []).includes(toolName)) {
    return { allowed: false, reason: "DUPLICATE_TOOL_CALL" };
  }
  if ((calledTools ?? []).length >= MAX_TOOL_CALLS_PER_TURN) {
    return { allowed: false, reason: "MAX_TOOL_CALLS_EXCEEDED" };
  }
  return { allowed: true, reason: null };
}

async function executeGetPolicies(context) {
  const policies = applyGuardrailsToPolicies(context.policies ?? []);
  return buildToolResult({
    ok: true,
    tool: "get_policies",
    data: {
      policies,
      policy_count: context.policyCount,
      policy_ids: context.unified?.policy_ids ?? policies.map((p) => p.id).filter(Boolean),
    },
    confidence: policies.length ? "confirmed" : "partial",
    source: "unified_customer_state",
  });
}

async function executePremiumLookup(context) {
  const stats = computePolicyExplorerStats(context.policies ?? []);
  return buildToolResult({
    ok: true,
    tool: "premium_lookup",
    data: stats,
    confidence: stats.totalCount > 0 ? "confirmed" : "partial",
    source: "policy_explorer_stats",
  });
}

async function executeGetCustomerMemory(context) {
  const snapshot = context.snapshot;
  if (!snapshot) {
    return buildToolResult({
      ok: false,
      tool: "get_customer_memory",
      data: null,
      error: "snapshot_unavailable",
      confidence: "unknown",
      source: "customer_memory_snapshot",
    });
  }
  const structured = context.structuredMemory ?? buildStructuredMemoryProfile(snapshot);
  return buildToolResult({
    ok: true,
    tool: "get_customer_memory",
    data: structured,
    confidence: structured.fact_count > 0 ? "confirmed" : "partial",
    source: "customer_memory_snapshot",
  });
}

async function executeGetCoverageGap({ supabase, customerId }) {
  const context = await loadCoverageAnalysisContext(supabase, customerId);
  return buildToolResult({
    ok: true,
    tool: "get_coverage_gap",
    data: context.coverageGapResult ?? null,
    confidence: context.coverageGapResult ? "confirmed" : "partial",
    source: "coverage_gap_engine",
  });
}

async function executeGetUnderwriting({ supabase, customerId }) {
  const context = await loadUnderwritingAnalysisContext(supabase, customerId);
  return buildToolResult({
    ok: true,
    tool: "get_underwriting",
    data: context.underwritingResult ?? null,
    confidence: context.underwritingResult ? "confirmed" : "partial",
    source: "underwriting_engine",
  });
}

async function executeSearchPolicyTerms({ supabase, customerId, userMessage, fetchImpl, env }) {
  const result = await handlePolicyTermsQaRequest({
    question: userMessage,
    mode: "rag_only",
    adminSupabase: supabase,
    testCustomerId: customerId,
    fetchImpl,
    env,
  });

  if (!result?.ok) {
    return buildToolResult({
      ok: false,
      tool: "search_policy_terms",
      data: null,
      error: result?.error_message ?? result?.reason ?? "policy_terms_search_failed",
      confidence: "unknown",
      source: "policy_terms_rag",
    });
  }

  return buildToolResult({
    ok: true,
    tool: "search_policy_terms",
    data: {
      used_sources: result.used_sources ?? [],
      rag_row_count: result.rag_row_count ?? 0,
      context_used: result.context_used ?? false,
      insufficient_context: result.insufficient_context ?? false,
      document_context_preview: result.document_context_preview ?? null,
      knowledge_document_id: result.knowledge_document_id ?? null,
    },
    confidence: result.context_used ? "confirmed" : result.rag_row_count > 0 ? "partial" : "unknown",
    source: "policy_terms_rag",
  });
}

export const DEFAULT_TOOL_EXECUTORS = {
  get_policies: executeGetPolicies,
  premium_lookup: executePremiumLookup,
  get_customer_memory: executeGetCustomerMemory,
  get_coverage_gap: executeGetCoverageGap,
  get_underwriting: executeGetUnderwriting,
  search_policy_terms: executeSearchPolicyTerms,
};

export async function runSingleAdvisorTool({
  toolName,
  allowedTools,
  calledTools,
  context,
  supabase,
  customerId,
  userMessage = "",
  executors = DEFAULT_TOOL_EXECUTORS,
  fetchImpl = fetch,
  env = process.env,
  depth = 0,
}) {
  const gate = isToolCallAllowed({ toolName, allowedTools, calledTools, depth });
  if (!gate.allowed) {
    return {
      executed: false,
      blocked: true,
      reason: gate.reason,
      result: buildToolResult({
        ok: false,
        tool: toolName,
        data: null,
        error: gate.reason,
        confidence: "unknown",
      }),
    };
  }

  const executor = executors[toolName];
  if (typeof executor !== "function") {
    return {
      executed: false,
      blocked: true,
      reason: "EXECUTOR_NOT_FOUND",
      result: buildToolResult({
        ok: false,
        tool: toolName,
        data: null,
        error: "EXECUTOR_NOT_FOUND",
        confidence: "unknown",
      }),
    };
  }

  try {
    const result = await withTimeout(
      executor({
        context,
        supabase,
        customerId,
        userMessage,
        fetchImpl,
        env,
      }),
      TOOL_TIMEOUT_MS,
      toolName,
    );
    return { executed: true, blocked: false, reason: null, result };
  } catch (error) {
    return {
      executed: false,
      blocked: false,
      reason: "TOOL_EXECUTION_FAILED",
      result: buildToolResult({
        ok: false,
        tool: toolName,
        data: null,
        error: error instanceof Error ? error.message : "tool_execution_failed",
        confidence: "unknown",
      }),
    };
  }
}

function buildGuardrailSummary({ context, toolResults }) {
  const policiesResult = toolResults.find((r) => r.tool === "get_policies" && r.ok);
  const gapResult = toolResults.find((r) => r.tool === "get_coverage_gap" && r.ok);

  const policyCount = policiesResult?.data?.policy_count ?? context.policyCount ?? 0;
  const contradiction = detectContradictionBetweenPolicyCountAndGap({
    policyCount,
    coverageGapResult: gapResult?.data ?? null,
  });

  const unknownItems = (policiesResult?.data?.policies ?? []).filter(
    (p) => p.advisor_guarded_ownership_status === "미확인",
  );

  const toolFailures = toolResults.filter((r) => !r.ok);

  return {
    contradiction,
    unknown_item_count: unknownItems.length,
    uncertainty_notice: buildUncertaintyNotice({
      contradictions: [contradiction],
      unknownItems,
      toolFailures,
    }),
  };
}

/**
 * Run controlled tools for one turn. Does not generate customer-facing text.
 */
export async function runControlledAdvisorTools({
  supabase,
  customerId,
  classification,
  userMessage = "",
  sessionId = null,
  conversationId = null,
  allowedToolsOverride = null,
  executors = DEFAULT_TOOL_EXECUTORS,
  fetchImpl = fetch,
  env = process.env,
  preloadedContext = null,
} = {}) {
  const allowedTools = dedupeAllowedTools(
    allowedToolsOverride ?? resolveAllowedTools(classification),
  );

  const context =
    preloadedContext ?? (await createAdvisorBrainContext({ supabase, customerId }));

  const toolResults = [];
  const calledTools = [];
  const blockedCalls = [];

  for (const toolName of allowedTools) {
    if (calledTools.length >= MAX_TOOL_CALLS_PER_TURN) {
      blockedCalls.push({ tool: toolName, reason: "MAX_TOOL_CALLS_EXCEEDED" });
      continue;
    }

    const invocation = await runSingleAdvisorTool({
      toolName,
      allowedTools,
      calledTools,
      context,
      supabase,
      customerId,
      userMessage,
      executors,
      fetchImpl,
      env,
    });

    if (invocation.blocked && invocation.reason === "DUPLICATE_TOOL_CALL") {
      blockedCalls.push({ tool: toolName, reason: invocation.reason });
      continue;
    }

    if (invocation.executed) {
      calledTools.push(toolName);
      toolResults.push(invocation.result);
    } else if (invocation.blocked) {
      blockedCalls.push({ tool: toolName, reason: invocation.reason });
    } else {
      calledTools.push(toolName);
      toolResults.push(invocation.result);
    }
  }

  const guardrailSummary = buildGuardrailSummary({ context, toolResults });

  const auditRecord = buildAdvisorAuditRecord({
    customerId,
    sessionId,
    conversationId,
    userMessage,
    classification,
    allowedTools,
    toolResults,
    guardrailSummary,
    finalCustomerText: null,
  });

  return {
    ok: true,
    allowed_tools: allowedTools,
    called_tools: calledTools,
    blocked_calls: blockedCalls,
    tool_results: toolResults,
    guardrail_summary: guardrailSummary,
    audit_record: auditRecord,
    context_loaded_once: Boolean(context._unifiedLoaded),
  };
}
