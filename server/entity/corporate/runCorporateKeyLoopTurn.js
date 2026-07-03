/**
 * Corporate KEY loop turn — same KEY path · corp-key-compose-v1 speech (CC-2 P3).
 */
import { SALES_DIRECTOR_MODES } from "../../customerObservability.js";
import { markLatencyMs, createSalesDirectorLatencyBucket } from "../../salesDirectorLatencyAudit.js";
import { buildCorporateKeyAgentTurn } from "./corporateKeySpeech.js";

export function shouldRunCorporateKeyLoopTurn({ branchDecision, entityRuntime } = {}) {
  return (
    branchDecision?.path === "corporate" &&
    entityRuntime?.corporate_branch_active === true &&
    entityRuntime?.contract?.key_compose?.available !== false &&
    entityRuntime?.contract?.compose_route === "corp-key-compose-v1"
  );
}

export function runCorporateKeyLoopTurn({
  question,
  history = [],
  entityRuntime,
  branchDecision,
  snapshot,
  unified,
  loadedContext,
  customerContextBundle,
  reconciliationWarning,
  loopStartedAt = Date.now(),
  entityRuntimeTraceFields = {},
} = {}) {
  const keyCompose = entityRuntime?.contract?.key_compose ?? {};
  const displayName =
    entityRuntime?.session?.display_name ??
    entityRuntime?.contract?.key_compose?.recommendation?.summary?.display_name ??
    null;

  const agentTurn = buildCorporateKeyAgentTurn({
    question,
    history,
    keyCompose,
    displayName,
  });

  const latency = createSalesDirectorLatencyBucket();
  latency.key_plan_ms = 0;
  latency.key_tools_ms = 0;
  latency.total_ms = markLatencyMs(loopStartedAt);

  const salesDirectorTrace = {
    sales_director_loop: true,
    sales_director_mode: SALES_DIRECTOR_MODES.KEY,
    sales_director_step: "corporate_key_speech_complete",
    legacy_response_source: agentTurn.responseSource,
    key_orchestrator: {
      status: "corporate_key_compose_v1",
      corporate_branch: true,
      compose_route: entityRuntime?.contract?.compose_route ?? null,
      primary_contract: entityRuntime?.contract?.primary_contract ?? null,
      speech_source: agentTurn.factBundle?.corporate_speech_source ?? null,
      journey_phase: agentTurn.factBundle?.corporate_journey_phase ?? null,
    },
    ...entityRuntimeTraceFields,
    entity_runtime: {
      ...(entityRuntimeTraceFields.entity_runtime ?? {}),
      wired_to_loop: true,
      loop_branch_path: "corporate",
    },
    key_loop_trace: {
      entered: true,
      handled: true,
      corporate_key_path: true,
      failed_reason: null,
      legacy_fallback: false,
    },
    runtime_decision: branchDecision?.runtime_decision ?? null,
    latency,
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
      modeDecision: {
        mode: SALES_DIRECTOR_MODES.KEY,
        key_orchestrator: true,
        corporate_key_path: true,
        consultationIntent: agentTurn.consultationIntent,
      },
      agentTurn,
      salesDirectorTrace,
      latency,
      loopStartedAt,
    },
  };
}
