/** Pure helpers for mapping analysis_jobs payloads to recommendation panel state. */

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
