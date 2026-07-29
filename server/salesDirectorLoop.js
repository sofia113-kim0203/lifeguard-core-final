/**
 * P6-2A — Sales Director Loop observability helpers (speak via ONE KEY Core).
 */
import { classifyConsultationIntent, hasInsuranceTopicSignal } from "./intentGateLayer.js";
import {
  hasHighStakesSignal,
  isCasualHomeQuestion,
  isConversationalInsuranceBridgeQuestion,
} from "./homeBrainRouter.js";
import { matchP5BrainPilotQuestion } from "./p5BrainPilotQuestions.js";
import {
  buildFactoryCalled,
  buildSalesDirectorObservability,
  detectLoadedContextContradictions,
  SALES_DIRECTOR_MODES,
} from "./customerObservability.js";

export { SALES_DIRECTOR_MODES } from "./customerObservability.js";

export function normalizeSalesDirectorQuestion(question = "") {
  return String(question ?? "").replace(/\s+/g, " ").trim();
}

function resolveTomInternalRouteForMode(question = "", consultationIntent = null) {
  const classification = consultationIntent ?? classifyConsultationIntent(question);
  if (hasHighStakesSignal(question, classification)) return "defer";
  if (isConversationalInsuranceBridgeQuestion(question, classification)) return "chat";
  if (isCasualHomeQuestion(question, classification)) return "chat";
  if (hasInsuranceTopicSignal(question)) return "defer";
  return "defer";
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
      tomInternalRoute: "chat",
      consultationIntent: classification,
    };
  }

  const tomInternalRoute = resolveTomInternalRouteForMode(trimmedQuestion, classification);
  if (tomInternalRoute === "defer") {
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
    tomInternalRoute: "chat",
    consultationIntent: classification,
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
    factsUsed,
    loadedContextContradictions,
    salesDirectorTrace,
  });

  return {
    ...observability,
    sales_director_loop: true,
    sales_director_mode: modeDecision?.mode ?? null,
    legacy_response_source: agentTurn?.responseSource ?? null,
    legacy_tom_internal_route: agentTurn?.tomInternalRoute ?? null,
  };
}

function resolveFactsUsedActivePolicyCount(agentTurn) {
  const factBundle = agentTurn?.factBundle ?? {};
  if (typeof factBundle.active_policy_count === "number") {
    return factBundle.active_policy_count;
  }
  if (typeof factBundle.policy_count === "number") {
    return factBundle.policy_count;
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
