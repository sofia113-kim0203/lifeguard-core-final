/** Pure helpers for mapping analysis_jobs payloads to recommendation panel state. */

const ENGINE_PIPELINE_STAGES = [
  "coverage_gap",
  "underwriting_risk",
  "recommendation",
  "insurance_design",
];

export function mapJobResultsToAnalysisPanels(job) {
  if (!job?.result_json) return null;
  const result = job.result_json;
  return {
    coverageGapResult: result.coverage_gap ?? null,
    underwritingResult: result.underwriting_risk ?? null,
    recommendationResult: result.recommendation ?? null,
    designBundle: result.insurance_design ?? null,
    claudeExplanations: result.claude_explanations ?? {},
    finalClaude: result.final_claude ?? null,
    panelClaudePolicyCount: result.panel_claude_policy_count ?? null,
    panelClaudePolicyIds: result.panel_claude_policy_ids ?? [],
  };
}

/** True when job carries at least one engine stage payload for recommendation panels. */
export function jobHasEnginePanelResults(job) {
  const mapped = mapJobResultsToAnalysisPanels(job);
  if (!mapped) return false;
  return Boolean(
    mapped.coverageGapResult ||
      mapped.underwritingResult ||
      mapped.recommendationResult ||
      mapped.designBundle,
  );
}

/** True when the job pipeline can populate recommendation panels (not chat-only). */
export function jobHasEnginePipeline(job) {
  const manifest = job?.result_json?.intent_gate?.pipeline_manifest;
  if (Array.isArray(manifest) && manifest.length > 0) {
    return manifest.some((stage) => ENGINE_PIPELINE_STAGES.includes(stage));
  }
  const stages = job?.stages_completed;
  if (Array.isArray(stages) && stages.length > 0) {
    return stages.some((stage) => ENGINE_PIPELINE_STAGES.includes(stage));
  }
  return false;
}

/** Only engine-pipeline jobs in flight should block or clear recommendation panels. */
export function jobBlocksPanelLoading(job) {
  if (!job) return false;
  const inFlight = job.status === "processing" || job.status === "queued";
  return inFlight && jobHasEnginePipeline(job);
}

/** Completed engine job suitable for panel display while a newer job is in flight. */
export function isCompletedPanelFallbackJob(job) {
  if (!job || job.status !== "completed") return false;
  return jobHasEnginePanelResults(job);
}

/**
 * When session/external carries a newer in-flight engine job, pick a completed job from
 * fetchLatestAnalysisJob (backend completed-first) to keep panels populated.
 */
export function pickCompletedFallbackJob(inFlightJob, latestJobFromApi) {
  if (!jobBlocksPanelLoading(inFlightJob)) return null;
  if (!isCompletedPanelFallbackJob(latestJobFromApi)) return null;
  if (inFlightJob?.id && latestJobFromApi?.id && inFlightJob.id === latestJobFromApi.id) {
    return null;
  }
  return latestJobFromApi;
}

/** Defer applying in-flight partial results when a completed fallback is on screen. */
export function shouldDeferInFlightPanelApply(inFlightJob, completedFallbackJob) {
  return Boolean(completedFallbackJob && jobBlocksPanelLoading(inFlightJob));
}
