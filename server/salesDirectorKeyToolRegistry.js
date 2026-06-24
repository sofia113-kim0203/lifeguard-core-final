/**
 * P10-1 — Sales Director KEY tool registry (Factories = tools).
 * Snapshot / Memory / Coverage Gap / Premium only — no underwriting/recommendation/design.
 */
import { classifyConsultationIntent, computePremiumLookupStats } from "./intentGateLayer.js";
import { loadSalesDirectorCoverageGapContext } from "./salesDirectorCoverageGapContext.js";

export const KEY_TOOLS = {
  SNAPSHOT: "snapshot",
  MEMORY: "memory",
  COVERAGE_GAP: "coverage_gap",
  PREMIUM_STATS: "premium_stats",
};

export const KEY_SKIPPED_LAYERS = [
  "tom",
  "conversation_brain",
  "free_thinking",
  "judgment_frame",
  "explanation_frame",
  "tool_brain",
];

const DEFAULT_BLOCKED_INTENTS = ["recommendation_request", "design_request"];

export function isKeyOrchestratorEnabled(env = process.env) {
  return String(env.SALES_DIRECTOR_KEY_ORCHESTRATOR ?? "").trim() === "1";
}

export function isKeyLegacyFallbackEnabled(env = process.env) {
  const raw = String(env.SALES_DIRECTOR_KEY_LEGACY_FALLBACK ?? "1")
    .trim()
    .toLowerCase();
  return raw !== "0" && raw !== "false";
}

export function parseKeyBlockedIntents(env = process.env) {
  const raw = String(
    env.SALES_DIRECTOR_KEY_BLOCK_INTENTS ?? DEFAULT_BLOCKED_INTENTS.join(","),
  ).trim();
  if (!raw) return new Set();
  return new Set(
    raw
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean),
  );
}

export function parseKeyCustomerAllowlist(env = process.env) {
  const raw = String(env.SALES_DIRECTOR_KEY_CUSTOMER_ALLOWLIST ?? "").trim();
  if (!raw) return null;
  return new Set(
    raw
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean),
  );
}

export function isKeyBlockedIntent(intent = "", env = process.env) {
  return parseKeyBlockedIntents(env).has(intent);
}

export function shouldUseSalesDirectorKeyOrchestrator({
  question = "",
  customerId = null,
  consultationIntent = null,
  env = process.env,
} = {}) {
  if (!isKeyOrchestratorEnabled(env)) return false;

  const classification = consultationIntent ?? classifyConsultationIntent(question);
  if (isKeyBlockedIntent(classification.intent ?? "", env)) return false;

  const allowlist = parseKeyCustomerAllowlist(env);
  if (allowlist && (!customerId || !allowlist.has(customerId))) return false;

  return true;
}

function dedupeTools(tools = []) {
  const seen = new Set();
  const ordered = [];
  for (const tool of tools) {
    if (!tool || seen.has(tool)) continue;
    seen.add(tool);
    ordered.push(tool);
  }
  return ordered;
}

/**
 * Intent-aware tool plan (stored gap / premium_stats only in P10-1 skeleton).
 */
export function planKeyTools(classification = {}, loadedContext = null) {
  const intent = classification.intent ?? "general_consultation";
  const subIntent = classification.lookup_sub_intent ?? null;
  const tools = [KEY_TOOLS.SNAPSHOT];

  if (loadedContext?.memory === "present") {
    tools.push(KEY_TOOLS.MEMORY);
  }

  if (intent === "factual_lookup") {
    if (subIntent === "premium_lookup") {
      tools.push(KEY_TOOLS.PREMIUM_STATS);
    } else if (subIntent === "coverage_presence") {
      tools.push(KEY_TOOLS.COVERAGE_GAP);
    }
  } else if (
    intent === "coverage_gap_check" ||
    intent === "coverage_review_request" ||
    intent === "general_consultation"
  ) {
    tools.push(KEY_TOOLS.COVERAGE_GAP);
  }

  return {
    intent,
    subIntent,
    tools: dedupeTools(tools),
  };
}

function runSnapshotTool(customerContextBundle = null, loadedContext = null) {
  const policies = customerContextBundle?.policies ?? [];
  return {
    ok: true,
    tool: KEY_TOOLS.SNAPSHOT,
    policy_count: policies.length,
    snapshot_used: loadedContext?.policies === "present" && policies.length > 0,
  };
}

function runMemoryTool(customerContextBundle = null, loadedContext = null) {
  const memoryFactCount = customerContextBundle?.memoryFactCount ?? 0;
  const memoryUsed = loadedContext?.memory === "present" && memoryFactCount > 0;
  return {
    ok: true,
    tool: KEY_TOOLS.MEMORY,
    memory_fact_count: memoryFactCount,
    memory_used: memoryUsed,
  };
}

function runPremiumStatsTool(policies = []) {
  const premium_stats = computePremiumLookupStats(policies);
  return {
    ok: true,
    tool: KEY_TOOLS.PREMIUM_STATS,
    premium_stats,
    premium_used: premium_stats.premiumKnownCount > 0 || premium_stats.totalCount > 0,
  };
}

async function runCoverageGapTool({
  userSupabase,
  customerId,
  existingGapContext = null,
} = {}) {
  if (existingGapContext?.loaded) {
    return {
      ok: true,
      tool: KEY_TOOLS.COVERAGE_GAP,
      coverage_gap_context: existingGapContext,
      coverage_gap_used: Boolean(existingGapContext.signals?.length),
      source: "preloaded",
    };
  }

  if (!userSupabase || !customerId) {
    return {
      ok: false,
      tool: KEY_TOOLS.COVERAGE_GAP,
      error: "supabase_or_customer_required",
    };
  }

  const coverage_gap_context = await loadSalesDirectorCoverageGapContext(userSupabase, customerId);
  return {
    ok: true,
    tool: KEY_TOOLS.COVERAGE_GAP,
    coverage_gap_context,
    coverage_gap_used: coverage_gap_context?.loaded === true,
    source: "analysis_jobs",
  };
}

/**
 * Execute planned KEY tools (max parallel where async).
 */
export async function runKeyTools({
  plan = null,
  userSupabase = null,
  customerId = null,
  customerContextBundle = null,
  loadedContext = null,
  existingGapContext = null,
} = {}) {
  if (!plan?.tools?.length) {
    return {
      ok: false,
      reason: "empty_tool_plan",
      tools_called: [],
      tool_results: [],
    };
  }

  const policies = customerContextBundle?.policies ?? [];
  const tool_results = [];
  const tools_called = [];
  let premium_stats = null;
  let coverageGapContext = existingGapContext ?? customerContextBundle?.coverageGapContext ?? null;
  let snapshot_used = false;
  let memory_used = false;
  let premium_used = false;
  let coverage_gap_used = false;

  const needsGap = plan.tools.includes(KEY_TOOLS.COVERAGE_GAP);
  let gapPromise = null;
  if (needsGap) {
    gapPromise = runCoverageGapTool({
      userSupabase,
      customerId,
      existingGapContext: coverageGapContext,
    });
  }

  for (const tool of plan.tools) {
    if (tool === KEY_TOOLS.SNAPSHOT) {
      const result = runSnapshotTool(customerContextBundle, loadedContext);
      tool_results.push(result);
      tools_called.push(tool);
      snapshot_used = result.snapshot_used === true;
      continue;
    }
    if (tool === KEY_TOOLS.MEMORY) {
      const result = runMemoryTool(customerContextBundle, loadedContext);
      tool_results.push(result);
      tools_called.push(tool);
      memory_used = result.memory_used === true;
      continue;
    }
    if (tool === KEY_TOOLS.PREMIUM_STATS) {
      const result = runPremiumStatsTool(policies);
      tool_results.push(result);
      tools_called.push(tool);
      premium_stats = result.premium_stats;
      premium_used = result.premium_used === true;
    }
  }

  if (gapPromise) {
    const gapResult = await gapPromise;
    tool_results.push(gapResult);
    if (gapResult.ok) {
      tools_called.push(KEY_TOOLS.COVERAGE_GAP);
      coverageGapContext = gapResult.coverage_gap_context ?? coverageGapContext;
      coverage_gap_used = gapResult.coverage_gap_used === true;
    } else {
      return {
        ok: false,
        reason: gapResult.error ?? "coverage_gap_tool_failed",
        tools_called,
        tool_results,
      };
    }
  }

  return {
    ok: true,
    tools_called,
    tool_results,
    premium_stats,
    coverageGapContext,
    snapshot_used,
    memory_used,
    premium_used,
    coverage_gap_used,
    trace: {
      status: "p10_1_key_skeleton",
      plan,
      tools_called,
      snapshot_used,
      memory_used,
      premium_used,
      coverage_gap_used,
    },
  };
}
