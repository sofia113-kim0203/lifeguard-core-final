/**
 * Normalize analysis panel payloads (API camelCase vs job snake_case).
 */

export function pickCustomerVisibleTop2(recResult) {
  if (!recResult) return [];
  const direct =
    recResult.customerVisibleTop2 ??
    recResult.customer_visible_top2 ??
    recResult.recommendationResult?.customer_visible_top2 ??
    recResult.recommendationResult?.customerVisibleTop2;
  return Array.isArray(direct) ? direct : [];
}

export function pickRecommendations(recResult) {
  if (!recResult) return [];
  const direct =
    recResult.recommendations ??
    recResult.recommendationResult?.recommendations;
  return Array.isArray(direct) ? direct : [];
}

export function pickKeepExistingRecommendations(recResult) {
  if (!recResult) return [];
  const direct =
    recResult.keepExistingRecommendations ??
    recResult.keep_existing_recommendations ??
    recResult.recommendationResult?.keep_existing ??
    recResult.recommendationResult?.keepExistingRecommendations;
  return Array.isArray(direct) ? direct : [];
}

export function normalizeRecommendationPanelState(source, extras = {}) {
  if (!source) return null;
  const customerVisibleTop2 = pickCustomerVisibleTop2(source);
  const recommendations = pickRecommendations(source);
  const keepExistingRecommendations = pickKeepExistingRecommendations(source);
  const recommendationResult =
    source.recommendationResult ??
    (source.recommendations || source.customer_visible_top2 || source.customerVisibleTop2
      ? source
      : null);

  return {
    recommendationResult,
    customerVisibleTop2,
    recommendations,
    keepExistingRecommendations,
    requiredDocuments:
      source.requiredDocuments ??
      source.required_documents ??
      recommendationResult?.required_documents ??
      [],
    claudeExplanation: source.claudeExplanation ?? source.claude_explanation ?? extras.claudeExplanation ?? null,
    claudeMeta: source.claudeMeta ?? source.claude_meta ?? extras.claudeMeta ?? null,
    memoryUsed: source.memoryUsed ?? source.memory_used ?? extras.memoryUsed ?? false,
    coverageGapUsed: source.coverageGapUsed ?? source.coverage_gap_used ?? extras.coverageGapUsed ?? false,
    underwritingUsed: source.underwritingUsed ?? source.underwriting_used ?? extras.underwritingUsed ?? false,
    customerId: source.customerId ?? source.customer_id ?? null,
    memoryVersion: source.memoryVersion ?? source.memory_version ?? null,
    memoryFactCount: source.memoryFactCount ?? source.memory_fact_count ?? null,
    usedMemorySources: source.usedMemorySources ?? source.used_memory_sources ?? [],
    structuredMemory: source.structuredMemory ?? source.structured_memory ?? null,
  };
}

export function recommendationPanelHasTop2(recResult) {
  return pickCustomerVisibleTop2(recResult).length > 0;
}
