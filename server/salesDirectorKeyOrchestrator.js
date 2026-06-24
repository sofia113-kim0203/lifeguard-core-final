/**
 * P10-1 — Sales Director KEY orchestrator skeleton.
 * Factories = tools; KEY assembles factBundle then exits before Tom/CB/FT/Frame.
 */
import { classifyConsultationIntent } from "./intentGateLayer.js";
import { TOM_INTERNAL_ROUTES } from "./homeAgentTom.js";
import { SALES_DIRECTOR_MODES } from "./customerObservability.js";
import {
  createSalesDirectorLatencyBucket,
  markLatencyMs,
} from "./salesDirectorLatencyAudit.js";
import {
  KEY_SKIPPED_LAYERS,
  isKeyLegacyFallbackEnabled,
  planKeyTools,
  runKeyTools,
  shouldUseSalesDirectorKeyOrchestrator,
} from "./salesDirectorKeyToolRegistry.js";

export {
  isKeyLegacyFallbackEnabled,
  isKeyOrchestratorEnabled,
  shouldUseSalesDirectorKeyOrchestrator,
} from "./salesDirectorKeyToolRegistry.js";

function createKeyTruthGatePlaceholder({ draftText = "", factBundle = {}, loadedContext = null } = {}) {
  return {
    status: "placeholder_p10_1_key",
    claims_validation: null,
    final_text_independent_scan: null,
    claims: [],
    draft_text_length: String(draftText ?? "").length,
    loaded_context_snapshot: loadedContext
      ? {
          policies: loadedContext.policies ?? null,
          documents: loadedContext.documents ?? null,
          memory: loadedContext.memory ?? null,
        }
      : null,
    fact_bundle_policy_count: factBundle?.policy_count ?? 0,
  };
}

function buildKeyModeDecision(consultationIntent = null) {
  return {
    mode: SALES_DIRECTOR_MODES.KEY,
    key_orchestrator: true,
    pilotKey: null,
    tomInternalRoute: TOM_INTERNAL_ROUTES.CHAT,
    consultationIntent,
  };
}

function buildKeyAgentTurn({
  question = "",
  consultationIntent = null,
  customerContextBundle = null,
  toolRun = null,
} = {}) {
  const policies = customerContextBundle?.policies ?? [];
  return {
    text: "",
    tomInternalRoute: TOM_INTERNAL_ROUTES.CHAT,
    consultationIntent,
    toolUsed: null,
    responseSource: "sales_director_key",
    factBundle: {
      question,
      policy_count: policies.length,
      policies,
      memory_fact_count: customerContextBundle?.memoryFactCount ?? 0,
      customer_context_used: true,
      key_orchestrator: true,
      key_tools_called: toolRun?.tools_called ?? [],
      premium_stats: toolRun?.premium_stats ?? null,
      snapshot_tool_used: toolRun?.snapshot_used === true,
      memory_tool_used: toolRun?.memory_used === true,
      coverage_gap_used: toolRun?.coverage_gap_used === true,
      has_stored_coverage_analysis: toolRun?.coverage_gap_used === true,
    },
    tomGapVoiceHandled: false,
    trace: {
      agent: "sales_director_key",
      key_orchestrator: toolRun?.trace ?? null,
      skipped_layers: KEY_SKIPPED_LAYERS,
    },
  };
}

/**
 * Run KEY orchestrator turn. Returns { handled, result?, reason? }.
 * When handled=false and legacy fallback is on, caller continues legacy loop.
 */
export async function runSalesDirectorKeyTurn({
  userSupabase,
  customerId,
  question,
  history: _history = [],
  env = process.env,
  fetchImpl: _fetchImpl = fetch,
  startedAt = Date.now(),
  streamHandlers: _streamHandlers = null,
  requestStartedAt: _requestStartedAt = null,
  snapshot,
  unified,
  loadedContext,
  customerContextBundle,
  reconciliationWarning,
  modeDecision = null,
  latency = null,
  loopStartedAt = null,
} = {}) {
  const consultationIntent =
    modeDecision?.consultationIntent ?? classifyConsultationIntent(question);
  const keyLatency = latency ?? createSalesDirectorLatencyBucket();
  const keyModeDecision = buildKeyModeDecision(consultationIntent);

  const planStart = Date.now();
  const plan = planKeyTools(consultationIntent, loadedContext);
  keyLatency.key_plan_ms = markLatencyMs(planStart);

  const toolsStart = Date.now();
  const toolRun = await runKeyTools({
    plan,
    userSupabase,
    customerId,
    customerContextBundle,
    loadedContext,
    existingGapContext: customerContextBundle?.coverageGapContext ?? null,
  });
  keyLatency.key_tools_ms = markLatencyMs(toolsStart);

  if (!toolRun.ok) {
    return {
      handled: false,
      reason: toolRun.reason ?? "key_tools_failed",
      legacy_fallback: isKeyLegacyFallbackEnabled(env),
    };
  }

  if (toolRun.coverageGapContext) {
    customerContextBundle.coverageGapContext = toolRun.coverageGapContext;
  }

  const agentTurn = buildKeyAgentTurn({
    question,
    consultationIntent,
    customerContextBundle,
    toolRun,
  });

  const truthGate = createKeyTruthGatePlaceholder({
    draftText: agentTurn.text,
    factBundle: agentTurn.factBundle,
    loadedContext,
  });

  const salesDirectorTrace = {
    sales_director_loop: true,
    sales_director_mode: SALES_DIRECTOR_MODES.KEY,
    sales_director_step: "key_tools_complete",
    legacy_response_source: agentTurn.responseSource,
    legacy_tom_internal_route: agentTurn.tomInternalRoute,
    key_orchestrator: {
      status: "p10_1_skeleton",
      plan,
      tools_called: toolRun.tools_called ?? [],
      skipped_layers: KEY_SKIPPED_LAYERS,
      tool_results: toolRun.tool_results ?? [],
    },
    tool_brain: null,
    conversation_brain: null,
    truth_gate: truthGate,
    snapshot_cache_hit: keyLatency.snapshot_cache_hit === true,
    latency: {
      ...keyLatency,
      total_ms: markLatencyMs(loopStartedAt ?? startedAt),
    },
  };

  return {
    handled: true,
    result: {
      ok: true,
      contextSnapshot: snapshot,
      unifiedState: unified,
      loadedContext,
      reconciliationWarning,
      customerContextBundle,
      modeDecision: keyModeDecision,
      agentTurn,
      salesDirectorTrace,
      truthGate,
      latency: keyLatency,
      loopStartedAt: loopStartedAt ?? startedAt,
    },
  };
}
