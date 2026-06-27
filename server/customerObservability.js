/**
 * P6-1 / P6-2A — Observability contract helpers for customer-home-brain-fact.
 */
import { TOM_INTERNAL_ROUTES } from "./homeAgentTom.js";

export const SALES_DIRECTOR_MODES = {
  PILOT: "sales_director_pilot_mode",
  CHAT: "sales_director_chat_mode",
  DEFER: "sales_director_guarded_hold_mode",
  GAP: "sales_director_factory_gap_mode",
  KEY: "sales_director_key_mode",
};

const P5_BRAIN_RESPONSE_SOURCES = new Set([
  "p5_brain_customer_state",
  "p5_brain_state_guarded",
]);

const SALES_DIRECTOR_PILOT_RESPONSE_SOURCES = new Set([
  "sales_director_pilot_compose",
  "sales_director_pilot_guarded",
  "sales_director_tool_brain",
  "sales_director_conversation_brain",
  "sales_director_free_thinking",
  "sales_director_key",
]);

function isP5BrainResponseSource(responseSource) {
  return P5_BRAIN_RESPONSE_SOURCES.has(responseSource);
}

export function isSalesDirectorPilotResponseSource(responseSource) {
  return (
    isP5BrainResponseSource(responseSource) || SALES_DIRECTOR_PILOT_RESPONSE_SOURCES.has(responseSource)
  );
}

const GUARD_FALLBACK =
  "잠깐만요 — 지금은 그렇게 말씀드리기 어려워요. 편하게 다른 얘기 이어가도 돼요.";

/** Legacy mapper — kept for non-loop callers/tests. */
export function mapSelectedRoute({
  tomInternalRoute = null,
  toolUsed = null,
  pilotKey = null,
  responseSource = null,
} = {}) {
  if (pilotKey) return "p5_pilot";
  if (toolUsed === "gap_audit" || tomInternalRoute === TOM_INTERNAL_ROUTES.GAP_TOOL) {
    return "gap_audit";
  }
  if (tomInternalRoute === TOM_INTERNAL_ROUTES.DEFER || responseSource === "tom_internal_defer") {
    return "guarded_hold";
  }
  if (tomInternalRoute === TOM_INTERNAL_ROUTES.CHAT) {
    return "casual_chat";
  }
  return "unknown";
}

export function mapSalesDirectorResponseSource({
  mode = null,
  legacyResponseSource = null,
  p5Guarded = false,
} = {}) {
  switch (mode) {
    case SALES_DIRECTOR_MODES.PILOT:
      return p5Guarded ? "sales_director_pilot_guarded" : "sales_director_pilot_compose";
    case SALES_DIRECTOR_MODES.GAP:
      return "sales_director_factory_gap";
    case SALES_DIRECTOR_MODES.KEY:
      return "sales_director_key";
    case SALES_DIRECTOR_MODES.DEFER:
      return "sales_director_guarded_hold";
    case SALES_DIRECTOR_MODES.CHAT:
      return legacyResponseSource === "lifeguard_claude"
        ? "sales_director_chat_compose"
        : "sales_director_chat_fallback";
    default:
      return "sales_director_unknown";
  }
}

export function mapSalesDirectorSelectedRoute(mode = null) {
  return mode ?? "sales_director_unknown";
}

export function buildFactoryCalled({ toolUsed = null } = {}) {
  if (toolUsed === "gap_audit") return ["gap_audit"];
  return [];
}

export function buildGuardResult({
  responseSource = null,
  originalText = "",
  afterFinalizeText = "",
  finalText = "",
  p5BrainGuarded = false,
} = {}) {
  const polishApplied = [];
  if (
    finalText !== originalText &&
    (isP5BrainResponseSource(responseSource) || isSalesDirectorPilotResponseSource(responseSource))
  ) {
    polishApplied.push("p5_polish");
  }
  if (
    afterFinalizeText !== originalText &&
    !isP5BrainResponseSource(responseSource) &&
    !isSalesDirectorPilotResponseSource(responseSource)
  ) {
    polishApplied.push("one_brain_finalize");
  }

  const hardBlock = finalText === GUARD_FALLBACK && finalText !== afterFinalizeText;

  return {
    hard_block: hardBlock,
    polish_applied: polishApplied,
    p5_brain_guarded: p5BrainGuarded === true,
    full_fallback: hardBlock,
  };
}

export function detectLoadedContextContradictions({
  loadedContext = null,
  factsUsed = null,
  factBundle = {},
} = {}) {
  const contradictions = [];

  if (loadedContext?.policies === "present" && (factsUsed?.totalCount ?? 0) === 0) {
    contradictions.push({
      field: "policies",
      loaded_context: loadedContext.policies,
      facts_used_total_count: factsUsed?.totalCount ?? 0,
      fact_bundle_policy_count: factBundle?.policy_count ?? 0,
    });
  }
  if (
    loadedContext?.documents === "present" &&
    (factBundle?.document_count ?? 0) === 0 &&
    (factsUsed?.totalCount ?? 0) === 0
  ) {
    contradictions.push({
      field: "documents",
      loaded_context: loadedContext.documents,
      fact_bundle_document_count: factBundle?.document_count ?? 0,
    });
  }
  if (loadedContext?.memory === "present" && (factsUsed?.memoryFactCount ?? 0) === 0) {
    contradictions.push({
      field: "memory",
      loaded_context: loadedContext.memory,
      facts_used_memory_fact_count: factsUsed?.memoryFactCount ?? 0,
      fact_bundle_memory_fact_count: factBundle?.memory_fact_count ?? 0,
    });
  }

  return contradictions.length > 0 ? { contradictions } : null;
}

export function buildObservabilityPayload({
  responseSource = null,
  tomInternalRoute = null,
  toolUsed = null,
  pilotKey = null,
  loadedContext = null,
  factoryCalled = [],
  guardResult = null,
  contextSnapshotId = null,
  reconciliationWarning = null,
} = {}) {
  return {
    response_source: responseSource,
    selected_route: mapSelectedRoute({
      tomInternalRoute,
      toolUsed,
      pilotKey,
      responseSource,
    }),
    loaded_context: loadedContext,
    factory_called: factoryCalled,
    guard_result: guardResult,
    context_snapshot_id: contextSnapshotId,
    reconciliation_warning: reconciliationWarning,
  };
}

export function buildSalesDirectorObservability({
  mode = null,
  legacyResponseSource = null,
  p5Guarded = false,
  toolUsed = null,
  loadedContext = null,
  factoryCalled = [],
  guardResult = null,
  contextSnapshotId = null,
  reconciliationWarning = null,
  loadedContextContradictions = null,
  salesDirectorTrace = null,
} = {}) {
  return {
    response_source: mapSalesDirectorResponseSource({ mode, legacyResponseSource, p5Guarded }),
    selected_route: mapSalesDirectorSelectedRoute(mode),
    loaded_context: loadedContext,
    factory_called: factoryCalled,
    guard_result: guardResult,
    context_snapshot_id: contextSnapshotId,
    reconciliation_warning: reconciliationWarning,
    loaded_context_contradictions: loadedContextContradictions,
    sales_director_trace: salesDirectorTrace,
  };
}
