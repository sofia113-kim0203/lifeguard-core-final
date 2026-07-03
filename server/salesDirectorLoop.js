/**
 * P6-2A — Sales Director Loop skeleton (wraps existing Tom paths; no engine rewrite).
 */
import { classifyConsultationIntent } from "./intentGateLayer.js";
import {
  runHomeAgentTomTurn,
  resolveTomInternalRoute,
  TOM_INTERNAL_ROUTES,
  INSURANCE_DEFER_WITHOUT_TOOL_MESSAGE,
} from "./homeAgentTom.js";
import { matchP5BrainPilotQuestion } from "./p5BrainPilotQuestions.js";
import { shouldUseTomGapLightPath } from "./tomGapLightPath.js";
import {
  buildLoadedContextFromSnapshot,
  buildReconciliationWarning,
  loadSalesDirectorTurnContext,
  snapshotToContextBundle,
} from "./customerContextSnapshot.js";
import {
  buildFactoryCalled,
  buildSalesDirectorObservability,
  detectLoadedContextContradictions,
  SALES_DIRECTOR_MODES,
} from "./customerObservability.js";
import {
  buildSnapshotToolTraceOnly,
  planSalesDirectorToolBrain,
  runSalesDirectorToolBrainSlice,
} from "./salesDirectorToolBrain.js";
import { refineWithConversationBrain, shouldApplyConversationBrain } from "./salesDirectorConversationBrain.js";
import {
  createSalesDirectorLatencyBucket,
  markLatencyMs,
} from "./salesDirectorLatencyAudit.js";
import { loadSalesDirectorCoverageGapContext } from "./salesDirectorCoverageGapContext.js";
import { loadSalesDirectorUnderwritingRiskContext } from "./salesDirectorUnderwritingRiskContext.js";
import { loadSalesDirectorRecommendationContext } from "./salesDirectorRecommendationContext.js";
import { loadSalesDirectorInsuranceDesignContext } from "./salesDirectorInsuranceDesignContext.js";
import {
  isKeyLegacyFallbackEnabled,
  runSalesDirectorKeyTurn,
  shouldUseSalesDirectorKeyOrchestrator,
} from "./salesDirectorKeyOrchestrator.js";
import { resolveEntityRuntimeForTurn } from "./entity/entityConversationRouter.js";
import { resolveEntityLoopBranchDecision } from "./entity/entityLoopBranchDecision.js";
import { buildEntityContextPassthroughTrace } from "./entity/entityApiContextPassthrough.js";
import {
  runCorporateKeyLoopTurn,
  shouldRunCorporateKeyLoopTurn,
} from "./entity/corporate/runCorporateKeyLoopTurn.js";

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

  if (pilotKey && !classification.companion_cluster) {
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

function buildConversationBrainStubTurn(question, consultationIntent) {
  return {
    text: INSURANCE_DEFER_WITHOUT_TOOL_MESSAGE,
    tomInternalRoute: TOM_INTERNAL_ROUTES.DEFER,
    consultationIntent,
    toolUsed: null,
    responseSource: "tom_internal_defer",
    factBundle: { question, policy_count: 0, policies: [] },
    tomGapVoiceHandled: false,
    trace: { agent: "sales_director_stub_defer", tool_used: null, tom_ran: false },
  };
}

function buildLoopEntityRuntimeTraceFields(entityRuntime, branchDecision) {
  return {
    entity_runtime: {
      ...(entityRuntime.trace ?? {}),
      wired_to_loop: true,
    },
    runtime_decision: branchDecision?.runtime_decision ?? null,
  };
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
  streamHandlers = null,
  requestStartedAt = null,
  conversationContext = {},
  existingSession = null,
  entityRecord = null,
  membership = null,
} = {}) {
  const trimmedQuestion = normalizeSalesDirectorQuestion(question);
  const loopStartedAt = startedAt ?? Date.now();
  const latency = createSalesDirectorLatencyBucket();

  let snapshot = contextSnapshot;
  let unified = unifiedState;
  let coverageGapContext = null;
  let underwritingRiskContext = null;
  let recommendationContext = null;
  let designContext = null;
  if (!snapshot || !unified) {
    const snapshotLoadStart = Date.now();
    const [turnContext, gapContext, uwContext, recContext, desContext] = await Promise.all([
      loadSalesDirectorTurnContext(userSupabase, customerId, {
        requestHistory: history,
      }),
      loadSalesDirectorCoverageGapContext(userSupabase, customerId),
      loadSalesDirectorUnderwritingRiskContext(userSupabase, customerId),
      loadSalesDirectorRecommendationContext(userSupabase, customerId),
      loadSalesDirectorInsuranceDesignContext(userSupabase, customerId),
    ]);
    snapshot = snapshot ?? turnContext.snapshot;
    unified = unified ?? turnContext.unifiedState;
    coverageGapContext = gapContext;
    underwritingRiskContext = uwContext;
    recommendationContext = recContext;
    designContext = desContext;
    latency.snapshot_ms = markLatencyMs(snapshotLoadStart);
    if (turnContext.from_cache) {
      latency.snapshot_cache_hit = true;
    }
  } else {
    [coverageGapContext, underwritingRiskContext, recommendationContext, designContext] =
      await Promise.all([
        loadSalesDirectorCoverageGapContext(userSupabase, customerId),
        loadSalesDirectorUnderwritingRiskContext(userSupabase, customerId),
        loadSalesDirectorRecommendationContext(userSupabase, customerId),
        loadSalesDirectorInsuranceDesignContext(userSupabase, customerId),
      ]);
  }

  const memoryHydrateStart = Date.now();
  const snapshotCheck = assertSnapshotReady(snapshot);
  if (!snapshotCheck.ok) return snapshotCheck;

  const { loadedContext, bundle: customerContextBundle } = snapshotCheck;
  customerContextBundle.coverageGapContext = coverageGapContext ?? customerContextBundle.coverageGapContext;
  customerContextBundle.underwritingRiskContext =
    underwritingRiskContext ?? customerContextBundle.underwritingRiskContext;
  customerContextBundle.recommendationContext =
    recommendationContext ?? customerContextBundle.recommendationContext;
  customerContextBundle.designContext = designContext ?? customerContextBundle.designContext;
  const reconciliationWarning = buildReconciliationWarning(unified, snapshot);

  const modeDecision = decideSalesDirectorMode({
    question: trimmedQuestion,
    consultationIntent: classifyConsultationIntent(trimmedQuestion),
    env,
  });
  latency.memory_ms = markLatencyMs(memoryHydrateStart);

  const conversationContextResolved = conversationContext ?? {};
  const entityContextPassthrough = buildEntityContextPassthroughTrace({
    conversationContext: conversationContextResolved,
    existingSession,
    entityRecord,
    membership,
  });

  const entityRuntime = await resolveEntityRuntimeForTurn({
    userSupabase,
    customerId,
    conversationContext: conversationContextResolved,
    existingSession,
    entityRecord,
    membership,
    env,
  });
  const branchDecision = resolveEntityLoopBranchDecision(entityRuntime);
  const entityRuntimeTraceFields = buildLoopEntityRuntimeTraceFields(entityRuntime, branchDecision);

  let keyLoopTrace = {
    entered: false,
    handled: false,
    failed_reason: null,
    legacy_fallback: null,
    corporate_key_path: false,
  };

  if (shouldRunCorporateKeyLoopTurn({ branchDecision, entityRuntime })) {
    keyLoopTrace.entered = true;
    keyLoopTrace.corporate_key_path = true;
    const corpTurn = runCorporateKeyLoopTurn({
      question: trimmedQuestion,
      history,
      entityRuntime,
      branchDecision,
      snapshot,
      unified,
      loadedContext,
      customerContextBundle,
      reconciliationWarning,
      loopStartedAt,
      entityRuntimeTraceFields,
    });
    if (corpTurn?.handled && corpTurn.result) {
      keyLoopTrace.handled = true;
      corpTurn.result.salesDirectorTrace = {
        ...(corpTurn.result.salesDirectorTrace ?? {}),
        entity_context_passthrough: entityContextPassthrough,
        key_loop_trace: keyLoopTrace,
      };
      return corpTurn.result;
    }
  }

  if (
    shouldUseSalesDirectorKeyOrchestrator({
      question: trimmedQuestion,
      customerId,
      consultationIntent: modeDecision.consultationIntent,
      env,
    })
  ) {
    keyLoopTrace.entered = true;
    const keyTurn = await runSalesDirectorKeyTurn({
      userSupabase,
      customerId,
      question: trimmedQuestion,
      history,
      env,
      fetchImpl,
      startedAt: loopStartedAt,
      streamHandlers,
      requestStartedAt: requestStartedAt ?? startedAt,
      snapshot,
      unified,
      loadedContext,
      customerContextBundle,
      reconciliationWarning,
      modeDecision,
      latency,
      loopStartedAt,
    });

    if (keyTurn?.handled && keyTurn.result) {
      keyLoopTrace.handled = true;
      keyTurn.result.salesDirectorTrace = {
        ...(keyTurn.result.salesDirectorTrace ?? {}),
        ...entityRuntimeTraceFields,
        entity_context_passthrough: entityContextPassthrough,
        key_loop_trace: keyLoopTrace,
      };
      return keyTurn.result;
    }

    keyLoopTrace.failed_reason = keyTurn?.reason ?? "key_turn_not_handled";
    keyLoopTrace.legacy_fallback = keyTurn?.legacy_fallback ?? isKeyLegacyFallbackEnabled(env);

    if (!isKeyLegacyFallbackEnabled(env)) {
      return {
        ok: false,
        reason: "KEY_ORCHESTRATOR_FAILED",
        error_message: keyTurn?.reason ?? "key_turn_failed",
      };
    }
  }

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
    unified,
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
    const stubTurn = buildConversationBrainStubTurn(trimmedQuestion, modeDecision.consultationIntent);
    const conversationPlan = shouldApplyConversationBrain({
      question: trimmedQuestion,
      loadedContext,
      customerContextBundle,
      agentTurn: stubTurn,
    });
    if (conversationPlan.apply) {
      agentTurn = stubTurn;
      latency.handler_ms = 0;
    } else {
      const handlerStart = Date.now();
      agentTurn = await runHomeAgentTomTurn({
        question: trimmedQuestion,
        history,
        userSupabase,
        customerId,
        customerContextBundle,
        unified,
        env,
        fetchImpl,
        startedAt: loopStartedAt,
      });
      latency.handler_ms = markLatencyMs(handlerStart);
    }
  }

  const conversationRefinement = await refineWithConversationBrain({
    agentTurn,
    question: trimmedQuestion,
    history,
    customerContextBundle,
    loadedContext,
    unified,
    consultationIntent: modeDecision.consultationIntent,
    contextSnapshotId: snapshot.context_snapshot_id ?? "",
    fetchImpl,
    env,
    latencyBucket: latency,
    streamHandlers,
    requestStartedAt: requestStartedAt ?? startedAt,
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
      ? buildSnapshotToolTraceOnly({ plan: toolPlan, loadedContext, customerContextBundle, unified })
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
    ...entityRuntimeTraceFields,
    entity_context_passthrough: entityContextPassthrough,
    key_loop_trace: keyLoopTrace,
    truth_gate: truthGate,
    snapshot_cache_hit: latency.snapshot_cache_hit === true,
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

function resolveFactsUsedActivePolicyCount(agentTurn = {}) {
  const factBundle = agentTurn?.factBundle ?? {};
  if (factBundle.active_policy_count != null) {
    return Number(factBundle.active_policy_count);
  }
  if (factBundle.policy_count != null) {
    return Number(factBundle.policy_count);
  }
  return null;
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
  const activePolicyCount = resolveFactsUsedActivePolicyCount(agentTurn);
  const factsUsed = buildFactsUsed(
    {
      policies,
      active_policy_count: activePolicyCount,
      policy_count: activePolicyCount,
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
