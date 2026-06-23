/**
 * P6-2A — Sales Director Loop skeleton (wraps existing Tom paths; no engine rewrite).
 */
import { classifyConsultationIntent } from "./intentGateLayer.js";
import {
  runHomeAgentTomTurn,
  resolveTomInternalRoute,
  TOM_INTERNAL_ROUTES,
} from "./homeAgentTom.js";
import { matchP5BrainPilotQuestion } from "./p5BrainPilotQuestions.js";
import { shouldUseTomGapLightPath } from "./tomGapLightPath.js";
import {
  buildLoadedContextFromSnapshot,
  buildReconciliationWarning,
  loadCustomerContextSnapshot,
  snapshotToContextBundle,
} from "./customerContextSnapshot.js";
import {
  buildFactoryCalled,
  buildSalesDirectorObservability,
  detectLoadedContextContradictions,
  SALES_DIRECTOR_MODES,
} from "./customerObservability.js";
import { loadUnifiedCustomerState } from "./unifiedCustomerState.js";
import {
  buildSnapshotToolTraceOnly,
  planSalesDirectorToolBrain,
  runSalesDirectorToolBrainSlice,
} from "./salesDirectorToolBrain.js";
import { refineWithConversationBrain } from "./salesDirectorConversationBrain.js";
import {
  createSalesDirectorLatencyBucket,
  markLatencyMs,
} from "./salesDirectorLatencyAudit.js";

export { SALES_DIRECTOR_MODES } from "./customerObservability.js";

export function normalizeSalesDirectorQuestion(question = "") {
  return String(question ?? "").replace(/\s+/g, " ").trim();
}

/** P6-2B placeholder — Truth Gate v0.2 design hooks only. */
export function createTruthGatePlaceholder({ draftText = "", factBundle = {}, loadedContext = null } = {}) {
  return {
    status: "placeholder_p6_2b",
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

export function decideSalesDirectorMode({
  question = "",
  consultationIntent = null,
  env = process.env,
} = {}) {
  const trimmedQuestion = normalizeSalesDirectorQuestion(question);
  const classification = consultationIntent ?? classifyConsultationIntent(trimmedQuestion);
  const pilotKey = matchP5BrainPilotQuestion(trimmedQuestion);

  if (pilotKey) {
    return {
      mode: SALES_DIRECTOR_MODES.PILOT,
      pilotKey,
      tomInternalRoute: TOM_INTERNAL_ROUTES.CHAT,
      consultationIntent: classification,
    };
  }

  const tomInternalRoute = resolveTomInternalRoute(trimmedQuestion, classification);
  if (
    tomInternalRoute === TOM_INTERNAL_ROUTES.GAP_TOOL &&
    shouldUseTomGapLightPath(classification, env)
  ) {
    return {
      mode: SALES_DIRECTOR_MODES.GAP,
      pilotKey: null,
      tomInternalRoute,
      consultationIntent: classification,
    };
  }
  if (tomInternalRoute === TOM_INTERNAL_ROUTES.DEFER) {
    return {
      mode: SALES_DIRECTOR_MODES.DEFER,
      pilotKey: null,
      tomInternalRoute,
      consultationIntent: classification,
    };
  }
  return {
    mode: SALES_DIRECTOR_MODES.CHAT,
    pilotKey: null,
    tomInternalRoute: TOM_INTERNAL_ROUTES.CHAT,
    consultationIntent: classification,
  };
}

function assertSnapshotReady(contextSnapshot) {
  const loadedContext = buildLoadedContextFromSnapshot(contextSnapshot);
  if (!contextSnapshot || !contextSnapshot.context_snapshot_id || !loadedContext) {
    return {
      ok: false,
      reason: "SNAPSHOT_REQUIRED",
      error_message: "Customer context snapshot is required before composing a response.",
    };
  }
  return { ok: true, loadedContext, bundle: snapshotToContextBundle(contextSnapshot) };
}

/**
 * P6-2A loop skeleton:
 * load snapshot → understand intent → decide mode → existing handler → compose (caller) → observability
 */
export async function runSalesDirectorLoopTurn({
  userSupabase,
  customerId,
  question,
  history = [],
  contextSnapshot = null,
  unifiedState = null,
  env = process.env,
  fetchImpl = fetch,
  startedAt = Date.now(),
} = {}) {
  const trimmedQuestion = normalizeSalesDirectorQuestion(question);
  const loopStartedAt = startedAt ?? Date.now();
  const latency = createSalesDirectorLatencyBucket();

  let snapshot = contextSnapshot;
  let unified = unifiedState;
  if (!snapshot || !unified) {
    const snapshotLoadStart = Date.now();
    [snapshot, unified] = await Promise.all([
      snapshot ?? loadCustomerContextSnapshot(userSupabase, customerId, { requestHistory: history }),
      unified ?? loadUnifiedCustomerState(userSupabase, customerId),
    ]);
    latency.snapshot_ms = markLatencyMs(snapshotLoadStart);
  }

  const memoryHydrateStart = Date.now();
  const snapshotCheck = assertSnapshotReady(snapshot);
  if (!snapshotCheck.ok) return snapshotCheck;

  const { loadedContext, bundle: customerContextBundle } = snapshotCheck;
  const reconciliationWarning = buildReconciliationWarning(unified, snapshot);

  const modeDecision = decideSalesDirectorMode({
    question: trimmedQuestion,
    consultationIntent: classifyConsultationIntent(trimmedQuestion),
    env,
  });
  latency.memory_ms = markLatencyMs(memoryHydrateStart);

  const toolBrainStart = Date.now();
  const toolPlan = planSalesDirectorToolBrain({
    question: trimmedQuestion,
    loadedContext,
    modeDecision,
    pilotKey: modeDecision.pilotKey,
  });

  let toolBrainResult = runSalesDirectorToolBrainSlice({
    plan: toolPlan,
    question: trimmedQuestion,
    customerContextBundle,
    loadedContext,
    consultationIntent: modeDecision.consultationIntent,
  });
  latency.tool_brain_ms = markLatencyMs(toolBrainStart);

  let agentTurn;
  if (toolBrainResult?.handled) {
    agentTurn = toolBrainResult.agentTurn;
    if (modeDecision.mode !== SALES_DIRECTOR_MODES.GAP) {
      modeDecision.tool_brain_handled = true;
      modeDecision.mode = SALES_DIRECTOR_MODES.PILOT;
    }
  } else {
    const handlerStart = Date.now();
    agentTurn = await runHomeAgentTomTurn({
      question: trimmedQuestion,
      history,
      userSupabase,
      customerId,
      customerContextBundle,
      env,
      fetchImpl,
      startedAt: loopStartedAt,
    });
    latency.handler_ms = markLatencyMs(handlerStart);
  }

  const conversationRefinement = await refineWithConversationBrain({
    agentTurn,
    question: trimmedQuestion,
    history,
    customerContextBundle,
    loadedContext,
    consultationIntent: modeDecision.consultationIntent,
    contextSnapshotId: snapshot.context_snapshot_id ?? "",
    fetchImpl,
    env,
    latencyBucket: latency,
  });
  if (conversationRefinement.applied) {
    agentTurn = conversationRefinement.agentTurn;
    if (modeDecision.mode !== SALES_DIRECTOR_MODES.GAP) {
      modeDecision.conversation_brain_handled = true;
      modeDecision.mode = SALES_DIRECTOR_MODES.PILOT;
    }
  }

  const snapshotToolTrace =
    toolPlan.snapshot_trace_only === true
      ? buildSnapshotToolTraceOnly({ plan: toolPlan, loadedContext, customerContextBundle })
      : toolBrainResult?.agentTurn?.toolBrainTrace ?? null;

  const truthGate = createTruthGatePlaceholder({
    draftText: agentTurn.text,
    factBundle: agentTurn.factBundle ?? {},
    loadedContext,
  });

  const salesDirectorTrace = {
    sales_director_loop: true,
    sales_director_mode: modeDecision.mode,
    sales_director_step: conversationRefinement.freeThinkingApplied
      ? "free_thinking_complete"
      : conversationRefinement.applied
        ? "conversation_brain_complete"
        : toolBrainResult?.handled
          ? "tool_brain_complete"
          : "handler_complete",
    legacy_response_source: agentTurn.responseSource ?? null,
    legacy_tom_internal_route: agentTurn.tomInternalRoute ?? null,
    tool_brain: snapshotToolTrace ?? agentTurn.trace?.tool_brain ?? null,
    conversation_brain: agentTurn.trace?.conversation_brain ?? null,
    truth_gate: truthGate,
    latency: {
      ...latency,
      total_ms: markLatencyMs(loopStartedAt),
    },
  };

  return {
    ok: true,
    contextSnapshot: snapshot,
    unifiedState: unified,
    loadedContext,
    reconciliationWarning,
    customerContextBundle,
    modeDecision,
    agentTurn,
    salesDirectorTrace,
    truthGate,
    latency,
    loopStartedAt,
  };
}

export function buildSalesDirectorLoopObservability({
  modeDecision,
  agentTurn,
  loadedContext,
  guardResult,
  contextSnapshotId,
  reconciliationWarning,
  factsUsed = null,
  loadedContextContradictions = null,
  salesDirectorTrace = null,
}) {
  const observability = buildSalesDirectorObservability({
    mode: modeDecision?.mode,
    legacyResponseSource: agentTurn?.responseSource ?? null,
    p5Guarded:
      agentTurn?.responseSource === "p5_brain_state_guarded" ||
      agentTurn?.factBundle?.p5_brain_guarded === true,
    toolUsed: agentTurn?.toolUsed,
    loadedContext,
    factoryCalled: buildFactoryCalled({ toolUsed: agentTurn?.toolUsed }),
    guardResult,
    contextSnapshotId,
    reconciliationWarning,
    loadedContextContradictions,
    salesDirectorTrace,
  });

  return {
    ...observability,
    sales_director_loop: true,
    sales_director_mode: modeDecision?.mode ?? null,
  };
}

export function buildSalesDirectorFactsUsed({
  agentTurn,
  customerContextBundle,
  loadedContext,
  computeStats,
  buildFactsUsed,
}) {
  const fromFactBundle = agentTurn?.factBundle?.policies;
  const snapshotPolicies = customerContextBundle?.policies ?? [];
  const policies =
    Array.isArray(fromFactBundle) && fromFactBundle.length > 0
      ? fromFactBundle
      : loadedContext?.policies === "present" && snapshotPolicies.length > 0
        ? snapshotPolicies
        : fromFactBundle ?? snapshotPolicies ?? [];
  const memoryFactCount =
    agentTurn?.factBundle?.memory_fact_count ?? customerContextBundle?.memoryFactCount ?? 0;
  const factsUsed = buildFactsUsed(
    {
      policies,
      policy_count: policies.length || agentTurn?.factBundle?.policy_count || 0,
      memory_fact_count: memoryFactCount,
      memory_status: memoryFactCount > 0 ? "ready" : "empty",
    },
    computeStats(policies),
  );

  const loadedContextContradictions = detectLoadedContextContradictions({
    loadedContext,
    factsUsed,
    factBundle: agentTurn?.factBundle ?? {},
  });

  return { factsUsed, loadedContextContradictions };
}
