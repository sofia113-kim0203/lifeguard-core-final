/**
 * P6-1 — Observability contract helpers for customer-home-brain-fact.
 */
import { TOM_INTERNAL_ROUTES } from "./homeAgentTom.js";

const P5_BRAIN_RESPONSE_SOURCES = new Set([
  "p5_brain_customer_state",
  "p5_brain_state_guarded",
]);

function isP5BrainResponseSource(responseSource) {
  return P5_BRAIN_RESPONSE_SOURCES.has(responseSource);
}

const GUARD_FALLBACK =
  "잠깐만요 — 지금은 그렇게 말씀드리기 어려워요. 편하게 다른 얘기 이어가도 돼요.";

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
    return responseSource === "lifeguard_claude" ? "casual_chat" : "casual_chat";
  }
  return "unknown";
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
  if (finalText !== originalText && isP5BrainResponseSource(responseSource)) {
    polishApplied.push("p5_polish");
  }
  if (afterFinalizeText !== originalText && !isP5BrainResponseSource(responseSource)) {
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
