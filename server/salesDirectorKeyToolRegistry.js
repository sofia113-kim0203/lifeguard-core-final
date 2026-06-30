/**
 * P10-1 — Sales Director KEY tool registry (Factories = tools).
 * Snapshot / Memory / Coverage Gap / Underwriting / Recommendation / Design (stored read) / Premium.
 */
import {
  classifyConsultationIntent,
  computePremiumLookupStats,
  PREMIUM_BURDEN_COMPANION_CLUSTER_ID,
  COVERAGE_ANXIETY_COMPANION_CLUSTER_ID,
  RC_CONTINUITY_COMPANION_CLUSTER_ID,
} from "./intentGateLayer.js";
import { loadSalesDirectorCoverageGapContext } from "./salesDirectorCoverageGapContext.js";
import { loadSalesDirectorUnderwritingRiskContext } from "./salesDirectorUnderwritingRiskContext.js";
import { loadSalesDirectorRecommendationContext } from "./salesDirectorRecommendationContext.js";
import { buildEmptyDesignContext } from "./salesDirectorInsuranceDesignContext.js";
import {
  matchToolBrainSliceQuestion,
  SALES_DIRECTOR_TOOL_BRAIN_SLICES,
  SALES_DIRECTOR_TOOL_FORBIDDEN,
} from "./salesDirectorToolBrain.js";

/** Mirrors resolveSalesDirectorJudgmentIntent COVERAGE_JUDGMENT rules — no formatter import (cycle). */
const COVERAGE_JUDGMENT_QUESTION_RE =
  /내\s*보험\s*괜찮|보험\s*괜찮|내\s*보장\s*괜찮|암\s*보험\s*부족|암보험\s*부족|암\s*부족|내\s*보험\s*부족|보험\s*부족한(?:\s*부분)?|부족한\s*부분\s*있|뭐가\s*빠져|빠져\s*있|빠진\s*(?:게|것|부분)/;

/** J07/J08/J09 — stored underwriting panel read (not a new engine). */
const UNDERWRITING_BOUND_QUESTION_RE =
  /(?:고혈압|당뇨|질병|건강(?:\s*상태)?|수술|입원|진단|혈압|투약|복용).{0,24}(?:가입\s*(?:가능|돼|되)|들\s*수|거절|인수)|(?:가입\s*(?:가능|돼|되)|들\s*수|거절(?:될|되)|인수).{0,24}(?:고혈압|당뇨|질병|건강|수술|입원|진단|혈압)|건강\s*상태.{0,12}거절|(?:암|실손|운전자|뇌|심장).{0,20}(?:들\s*수|지금\s*가입|새로\s*가입|가입\s*(?:가능|돼))/;

export const KEY_TOOLS = {
  SNAPSHOT: "snapshot",
  MEMORY: "memory",
  COVERAGE_GAP: "coverage_gap",
  UNDERWRITING: "underwriting",
  RECOMMENDATION: "recommendation",
  DESIGN: "design",
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

function shouldAddCoverageGapTool(classification = {}, question = "") {
  const intent = classification.intent ?? "";
  const subIntent = classification.lookup_sub_intent ?? null;

  if (intent === "coverage_gap_check" || intent === "coverage_review_request") {
    return true;
  }

  if (intent === "factual_lookup" && subIntent === "coverage_presence") {
    if (matchToolBrainSliceQuestion(question) === SALES_DIRECTOR_TOOL_BRAIN_SLICES.INSURANCE_PRESENCE) {
      return false;
    }
    return true;
  }

  if (COVERAGE_JUDGMENT_QUESTION_RE.test(String(question ?? ""))) {
    return true;
  }

  return false;
}

function shouldAddUnderwritingTool(classification = {}, question = "") {
  const intent = classification.intent ?? "";
  if (intent === "underwriting_bound_check") return true;
  if (UNDERWRITING_BOUND_QUESTION_RE.test(String(question ?? ""))) return true;
  return false;
}

function shouldAddRecommendationTool(classification = {}, question = "") {
  const intent = classification.intent ?? "";
  if (intent !== "recommendation_priority_check") return false;
  if (intent === "recommendation_request") return false;
  return true;
}

/** J-DESIGN-KEY-TOOL — stored-read design sub-intents only (preloaded context). */
function shouldAddDesignTool(classification = {}) {
  const intent = classification.intent ?? "";
  if (intent === "design_priority_check" || intent === "design_review_check") return true;
  if (intent === "design_request") return false;
  return false;
}

function runDesignTool({ existingDesignContext = null } = {}) {
  if (existingDesignContext?.loaded) {
    const hasPriority = (existingDesignContext.priority_coverages ?? []).length > 0;
    const hasReview =
      Boolean(existingDesignContext.design_summary) ||
      (existingDesignContext.keep_existing_coverages ?? []).length > 0;
    return {
      ok: true,
      tool: KEY_TOOLS.DESIGN,
      design_context: existingDesignContext,
      design_used: hasPriority || hasReview || existingDesignContext.record_count > 0,
      design_loaded: true,
      source: "preloaded",
    };
  }

  return {
    ok: true,
    tool: KEY_TOOLS.DESIGN,
    design_context: existingDesignContext ?? buildEmptyDesignContext(),
    design_used: false,
    design_loaded: false,
    source: "preloaded_absent",
  };
}

/**
 * Intent-aware tool plan — P11-2D Tool Brain slice parity via matchToolBrainSliceQuestion.
 */
export function planKeyTools(classification = {}, loadedContext = null, question = "") {
  const intent = classification.intent ?? "general_consultation";
  const subIntent = classification.lookup_sub_intent ?? null;
  const legacySlice = matchToolBrainSliceQuestion(question);
  const tools = [KEY_TOOLS.SNAPSHOT];
  let coverage_gap_suppressed = false;
  let coverage_gap_suppress_reason = null;

  if (loadedContext?.memory === "present") {
    tools.push(KEY_TOOLS.MEMORY);
  }

  if (classification.companion_cluster === PREMIUM_BURDEN_COMPANION_CLUSTER_ID) {
    tools.push(KEY_TOOLS.PREMIUM_STATS);
    return {
      intent,
      subIntent,
      legacy_slice: null,
      companion_cluster: classification.companion_cluster,
      tools: dedupeTools(tools),
      coverage_gap_suppressed: true,
      coverage_gap_suppress_reason: "companion_cluster_jc_premium_burden_v1",
    };
  }

  if (classification.companion_cluster === COVERAGE_ANXIETY_COMPANION_CLUSTER_ID) {
    tools.push(KEY_TOOLS.COVERAGE_GAP);
    return {
      intent,
      subIntent,
      legacy_slice: null,
      companion_cluster: classification.companion_cluster,
      tools: dedupeTools(tools),
      coverage_gap_suppressed: false,
      coverage_gap_suppress_reason: null,
    };
  }

  if (classification.companion_cluster === RC_CONTINUITY_COMPANION_CLUSTER_ID) {
    return {
      intent,
      subIntent,
      legacy_slice: null,
      companion_cluster: classification.companion_cluster,
      tools: dedupeTools([KEY_TOOLS.MEMORY]),
      coverage_gap_suppressed: true,
      coverage_gap_suppress_reason: "companion_cluster_rc_continuity_companion_v1",
    };
  }

  if (legacySlice === SALES_DIRECTOR_TOOL_BRAIN_SLICES.PREMIUM_BURDEN) {
    tools.push(KEY_TOOLS.PREMIUM_STATS);
    coverage_gap_suppressed = true;
    coverage_gap_suppress_reason = "tool_brain_slice_parity_p11_2c";
    return {
      intent,
      subIntent,
      legacy_slice: legacySlice,
      tools: dedupeTools(tools),
      coverage_gap_suppressed,
      coverage_gap_suppress_reason,
    };
  }

  if (legacySlice === SALES_DIRECTOR_TOOL_BRAIN_SLICES.INSURANCE_PRESENCE) {
    coverage_gap_suppressed = true;
    coverage_gap_suppress_reason = "tool_brain_slice_parity_p11_2c";
    return {
      intent,
      subIntent,
      legacy_slice: legacySlice,
      tools: dedupeTools(tools),
      coverage_gap_suppressed,
      coverage_gap_suppress_reason,
    };
  }

  if (shouldAddCoverageGapTool(classification, question)) {
    tools.push(KEY_TOOLS.COVERAGE_GAP);
  }

  if (shouldAddUnderwritingTool(classification, question)) {
    tools.push(KEY_TOOLS.UNDERWRITING);
  }

  if (shouldAddRecommendationTool(classification, question)) {
    tools.push(KEY_TOOLS.RECOMMENDATION);
  }

  if (shouldAddDesignTool(classification)) {
    tools.push(KEY_TOOLS.DESIGN);
  }

  if (
    tools.includes(KEY_TOOLS.UNDERWRITING) &&
    !coverage_gap_suppressed &&
    /(?:암|실손|운전자|뇌|심장)/.test(String(question ?? "")) &&
    !tools.includes(KEY_TOOLS.COVERAGE_GAP)
  ) {
    tools.push(KEY_TOOLS.COVERAGE_GAP);
  }

  if (intent === "factual_lookup" && subIntent === "premium_lookup") {
    tools.push(KEY_TOOLS.PREMIUM_STATS);
  }

  return {
    intent,
    subIntent,
    legacy_slice: legacySlice,
    tools: dedupeTools(tools),
    coverage_gap_suppressed,
    coverage_gap_suppress_reason,
  };
}

function extractPolicyIdsFromPolicies(policies = []) {
  return (policies ?? []).map((policy) => policy?.id).filter(Boolean);
}

export function resolveKeyActivePolicyCount({ unified = null, customerContextBundle = null } = {}) {
  if (unified?.active_policy_count != null) {
    return {
      active_policy_count: Number(unified.active_policy_count),
      active_policy_count_source: "unified_state",
      active_policy_ids: unified?.policy_ids ?? extractPolicyIdsFromPolicies(unified?.policies),
    };
  }
  if (unified?.policy_count != null) {
    return {
      active_policy_count: Number(unified.policy_count),
      active_policy_count_source: "unified_state",
      active_policy_ids: unified?.policy_ids ?? extractPolicyIdsFromPolicies(unified?.policies),
    };
  }
  if (customerContextBundle?.active_policy_count != null) {
    return {
      active_policy_count: Number(customerContextBundle.active_policy_count),
      active_policy_count_source: "unified_state",
      active_policy_ids:
        customerContextBundle?.active_policy_ids ??
        extractPolicyIdsFromPolicies(customerContextBundle?.policies),
    };
  }
  if (customerContextBundle?.policy_count != null) {
    return {
      active_policy_count: Number(customerContextBundle.policy_count),
      active_policy_count_source: "unified_state",
      active_policy_ids:
        customerContextBundle?.active_policy_ids ??
        extractPolicyIdsFromPolicies(customerContextBundle?.policies),
    };
  }
  return {
    active_policy_count: null,
    active_policy_count_source: null,
    active_policy_ids: unified?.policy_ids ?? extractPolicyIdsFromPolicies(unified?.policies),
  };
}

export function buildKeyFactBundlePolicyFields({ unified = null, customerContextBundle = null } = {}) {
  const resolved = resolveKeyActivePolicyCount({ unified, customerContextBundle });
  return {
    active_policy_count: resolved.active_policy_count,
    active_policy_count_source: resolved.active_policy_count_source,
    active_policy_ids: resolved.active_policy_ids,
    policy_count: resolved.active_policy_count,
  };
}

export function buildToolBrainAbsorbedTrace({
  plan = null,
  toolRun = null,
  customerContextBundle = null,
  unified = null,
} = {}) {
  if (!plan?.legacy_slice) return null;

  const snapshotResult = (toolRun?.tool_results ?? []).find((result) => result.tool === KEY_TOOLS.SNAPSHOT);
  const countContract = resolveKeyActivePolicyCount({ unified, customerContextBundle });
  const activePolicyCount =
    snapshotResult?.active_policy_count ?? countContract.active_policy_count ?? null;

  return {
    status: "p11_2c_absorbed",
    legacy_slice: plan.legacy_slice,
    legacy_matcher: "matchToolBrainSliceQuestion",
    tools_called: toolRun?.tools_called ?? [],
    forbidden_skipped: SALES_DIRECTOR_TOOL_FORBIDDEN,
    snapshot_used: toolRun?.snapshot_used === true,
    memory_used: toolRun?.memory_used === true,
    policy_count_from_snapshot: activePolicyCount,
    active_policy_count_from_snapshot: activePolicyCount,
    premium_stats_used: (toolRun?.tools_called ?? []).includes(KEY_TOOLS.PREMIUM_STATS),
    coverage_gap_suppressed: plan.coverage_gap_suppressed === true,
    coverage_gap_suppress_reason: plan.coverage_gap_suppress_reason ?? null,
    compose_mode: "tool_brain_fixed_slots",
  };
}

function runSnapshotTool(customerContextBundle = null, loadedContext = null, unified = null) {
  const policies = customerContextBundle?.policies ?? [];
  const countContract = resolveKeyActivePolicyCount({ unified, customerContextBundle });
  return {
    ok: true,
    tool: KEY_TOOLS.SNAPSHOT,
    active_policy_count: countContract.active_policy_count,
    active_policy_count_source: countContract.active_policy_count_source,
    active_policy_ids: countContract.active_policy_ids,
    policy_count: countContract.active_policy_count,
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

async function runUnderwritingTool({
  userSupabase,
  customerId,
  existingUnderwritingContext = null,
} = {}) {
  if (existingUnderwritingContext?.loaded) {
    return {
      ok: true,
      tool: KEY_TOOLS.UNDERWRITING,
      underwriting_context: existingUnderwritingContext,
      underwriting_used: Boolean(
        existingUnderwritingContext.signals?.length ||
          existingUnderwritingContext.record_count > 0,
      ),
      underwriting_loaded: true,
      source: "preloaded",
    };
  }

  if (!userSupabase || !customerId) {
    return {
      ok: false,
      tool: KEY_TOOLS.UNDERWRITING,
      error: "supabase_or_customer_required",
    };
  }

  const underwriting_context = await loadSalesDirectorUnderwritingRiskContext(
    userSupabase,
    customerId,
  );
  return {
    ok: true,
    tool: KEY_TOOLS.UNDERWRITING,
    underwriting_context,
    underwriting_used: underwriting_context?.loaded === true,
    underwriting_loaded: underwriting_context?.loaded === true,
    source: "analysis_jobs",
  };
}

async function runRecommendationTool({
  userSupabase,
  customerId,
  existingRecommendationContext = null,
} = {}) {
  if (existingRecommendationContext?.loaded) {
    return {
      ok: true,
      tool: KEY_TOOLS.RECOMMENDATION,
      recommendation_context: existingRecommendationContext,
      recommendation_used: Boolean(existingRecommendationContext.priority_labels?.length),
      recommendation_loaded: true,
      source: "preloaded",
    };
  }

  if (!userSupabase || !customerId) {
    return {
      ok: false,
      tool: KEY_TOOLS.RECOMMENDATION,
      error: "supabase_or_customer_required",
    };
  }

  const recommendation_context = await loadSalesDirectorRecommendationContext(
    userSupabase,
    customerId,
  );
  return {
    ok: true,
    tool: KEY_TOOLS.RECOMMENDATION,
    recommendation_context,
    recommendation_used: recommendation_context?.loaded === true,
    recommendation_loaded: recommendation_context?.loaded === true,
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
  existingUnderwritingContext = null,
  existingRecommendationContext = null,
  existingDesignContext = null,
  unified = null,
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
  let underwritingContext =
    existingUnderwritingContext ?? customerContextBundle?.underwritingRiskContext ?? null;
  let recommendationContext =
    existingRecommendationContext ?? customerContextBundle?.recommendationContext ?? null;
  let designContext = existingDesignContext ?? customerContextBundle?.designContext ?? null;
  let snapshot_used = false;
  let memory_used = false;
  let premium_used = false;
  let coverage_gap_used = false;
  let underwriting_used = false;
  let underwriting_loaded = false;
  let recommendation_used = false;
  let recommendation_loaded = false;
  let design_used = false;
  let design_loaded = false;

  const needsGap = plan.tools.includes(KEY_TOOLS.COVERAGE_GAP);
  const needsUnderwriting = plan.tools.includes(KEY_TOOLS.UNDERWRITING);
  const needsRecommendation = plan.tools.includes(KEY_TOOLS.RECOMMENDATION);
  let gapPromise = null;
  let underwritingPromise = null;
  let recommendationPromise = null;
  if (needsGap) {
    gapPromise = runCoverageGapTool({
      userSupabase,
      customerId,
      existingGapContext: coverageGapContext,
    });
  }
  if (needsUnderwriting) {
    underwritingPromise = runUnderwritingTool({
      userSupabase,
      customerId,
      existingUnderwritingContext: underwritingContext,
    });
  }
  if (needsRecommendation) {
    recommendationPromise = runRecommendationTool({
      userSupabase,
      customerId,
      existingRecommendationContext: recommendationContext,
    });
  }

  for (const tool of plan.tools) {
    if (tool === KEY_TOOLS.SNAPSHOT) {
      const result = runSnapshotTool(customerContextBundle, loadedContext, unified);
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
      continue;
    }
    if (tool === KEY_TOOLS.DESIGN) {
      const result = runDesignTool({ existingDesignContext: designContext });
      tool_results.push(result);
      tools_called.push(tool);
      designContext = result.design_context ?? designContext;
      design_used = result.design_used === true;
      design_loaded = result.design_loaded === true;
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

  if (underwritingPromise) {
    const uwResult = await underwritingPromise;
    tool_results.push(uwResult);
    if (uwResult.ok) {
      tools_called.push(KEY_TOOLS.UNDERWRITING);
      underwritingContext = uwResult.underwriting_context ?? underwritingContext;
      underwriting_used = uwResult.underwriting_used === true;
      underwriting_loaded = uwResult.underwriting_loaded === true;
    } else {
      return {
        ok: false,
        reason: uwResult.error ?? "underwriting_tool_failed",
        tools_called,
        tool_results,
      };
    }
  }

  if (recommendationPromise) {
    const recResult = await recommendationPromise;
    tool_results.push(recResult);
    if (recResult.ok) {
      tools_called.push(KEY_TOOLS.RECOMMENDATION);
      recommendationContext = recResult.recommendation_context ?? recommendationContext;
      recommendation_used = recResult.recommendation_used === true;
      recommendation_loaded = recResult.recommendation_loaded === true;
    } else {
      return {
        ok: false,
        reason: recResult.error ?? "recommendation_tool_failed",
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
    underwritingContext,
    recommendationContext,
    designContext,
    snapshot_used,
    memory_used,
    premium_used,
    coverage_gap_used,
    underwriting_used,
    underwriting_loaded,
    recommendation_used,
    recommendation_loaded,
    design_used,
    design_loaded,
    trace: {
      status: "p10_1_key_skeleton",
      plan,
      tools_called,
      snapshot_used,
      memory_used,
      premium_used,
      coverage_gap_used,
      underwriting_used,
      underwriting_loaded,
      recommendation_used,
      recommendation_loaded,
      design_used,
      design_loaded,
      coverage_gap_suppressed: plan?.coverage_gap_suppressed === true,
      coverage_gap_suppress_reason: plan?.coverage_gap_suppress_reason ?? null,
    },
  };
}
