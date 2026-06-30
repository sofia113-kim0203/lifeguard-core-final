/**
 * ACTIVATION-3 — Entity loop branch decision (Legacy vs Corporate path).
 * Principle 18: uncertain → legacy. Flag OFF → legacy preserved.
 */
import { ENTITY_TYPES } from "./entityTypes.js";

export const ENTITY_LOOP_BRANCH_DECISION_V1 = "entity-loop-branch-decision-v1";

export function resolveEntityLoopBranchDecision(entityRuntime = {}) {
  const trace = entityRuntime.trace ?? {};
  const skippedReason = trace.skipped_reason ?? null;

  if (entityRuntime.corporate_branch_active === true && entityRuntime.contract) {
    return {
      path: "corporate",
      skip_personal_factories: true,
      use_corporate_contract: true,
      contract: entityRuntime.contract,
      runtime_decision: {
        contract_version: ENTITY_LOOP_BRANCH_DECISION_V1,
        selected_path: "corporate_path",
        alternative_path: "legacy_path",
        selection_reason: "corporate_branch_active · entity contract loaded · personal factories skipped",
        entity_type: entityRuntime.contract?.entity_type ?? ENTITY_TYPES.CORPORATE,
        compose_route: entityRuntime.contract?.compose_route ?? null,
        primary_contract: entityRuntime.contract?.primary_contract ?? null,
      },
    };
  }

  let selectionReason = "default_individual_legacy_path";
  if (skippedReason === "entity_runtime_wiring_flag_off") {
    selectionReason = "entity_runtime_wiring_flag_off · legacy path preserved";
  } else if (entityRuntime.wiring_active && trace.entity_type === ENTITY_TYPES.INDIVIDUAL) {
    selectionReason = "individual_session · personal factories";
  } else if (entityRuntime.wiring_active && trace.resolver_fallback === true) {
    selectionReason = "principle_18_fallback_individual · legacy path";
  } else if (skippedReason) {
    selectionReason = `${skippedReason} · legacy path`;
  }

  return {
    path: "legacy",
    skip_personal_factories: false,
    use_corporate_contract: false,
    contract: null,
    runtime_decision: {
      contract_version: ENTITY_LOOP_BRANCH_DECISION_V1,
      selected_path: "legacy_path",
      alternative_path: "corporate_path",
      selection_reason: selectionReason,
      entity_type: trace.entity_type ?? null,
      compose_route: trace.compose_route ?? null,
      primary_contract: trace.primary_contract ?? null,
    },
  };
}
