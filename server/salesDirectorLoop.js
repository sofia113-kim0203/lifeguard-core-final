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

  let snapshot = contextSnapshot;
  let unified = unifiedState;
  if (!snapshot || !unified) {
    [snapshot, unified] = await Promise.all([
      snapshot ?? loadCustomerContextSnapshot(userSupabase, customerId, { requestHistory: history }),
      unified ?? loadUnifiedCustomerState(userSupabase, customerId),
    ]);
  }

  const snapshotCheck = assertSnapshotReady(snapshot);
  if (!snapshotCheck.ok) return snapshotCheck;

  const { loadedContext, bundle: customerContextBundle } = snapshotCheck;
  const reconciliationWarning = buildReconciliationWarning(unified, snapshot);

  const modeDecision = decideSalesDirectorMode({
    question: trimmedQuestion,
    consultationIntent: classifyConsultationIntent(trimmedQuestion),
    env,
  });

  const agentTurn = await runHomeAgentTomTurn({
    question: trimmedQuestion,
    history,
    userSupabase,
    customerId,
    customerContextBundle,
    env,
    fetchImpl,
    startedAt,
  });

  const truthGate = createTruthGatePlaceholder({
    draftText: agentTurn.text,
    factBundle: agentTurn.factBundle ?? {},
    loadedContext,
  });

  const salesDirectorTrace = {
    sales_director_loop: true,
    sales_director_mode: modeDecision.mode,
    sales_director_step: "handler_complete",
    legacy_response_source: agentTurn.responseSource ?? null,
    legacy_tom_internal_route: agentTurn.tomInternalRoute ?? null,
    truth_gate: truthGate,
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
  const policies = agentTurn?.factBundle?.policies ?? customerContextBundle?.policies ?? [];
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
