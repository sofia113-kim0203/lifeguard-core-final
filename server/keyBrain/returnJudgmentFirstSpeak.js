/**
 * RETURN_JUDGMENT — judgment shadow only (speak via keySpeak).
 */

function jobHasPanelResults(analysisJob = {}) {
  const result = analysisJob?.result_json ?? analysisJob?.resultJson ?? null;
  if (!result || typeof result !== "object") return false;
  return Boolean(
    result.coverage_gap ||
      result.underwriting_risk ||
      result.recommendation ||
      result.insurance_design,
  );
}

export function buildReturnJudgment({ analysisJob = {}, loadedContext = null, contextSnapshot = null } = {}) {
  const hasPanels = jobHasPanelResults(analysisJob);
  return {
    schema_version: "key-return-judgment-p5c-v1",
    actor: "KEY",
    gate: "P5-C-ENTRY",
    analysis_job_id: analysisJob.id ?? null,
    panel_results_present: hasPanels,
    posture: hasPanels ? "return_judgment_ready" : "return_judgment_hold",
    judgment_scope: {
      knowable: hasPanels ? ["stored_panels_available", "return_judgment_next_step"] : [],
      unknowable: hasPanels ? [] : ["panel_highlights_before_results"],
      must_not_claim: ["bridge_replay", "memory_inventory", "product_push"],
    },
    context_snapshot_id: contextSnapshot?.context_snapshot_id ?? null,
    customer_context_status: loadedContext
      ? {
          memory: loadedContext.memory ?? "empty",
          policies: loadedContext.policies ?? "empty",
        }
      : null,
  };
}

export { jobHasPanelResults };
