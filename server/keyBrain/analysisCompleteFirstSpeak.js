/**
 * Analysis complete — judgment helpers only (speak via keySpeak).
 */
import { extractRecommendationTop2Items } from "../salesDirectorRecommendationContext.js";

export function jobHasStoredRecommendation(analysisJob = {}) {
  const result = analysisJob?.result_json ?? analysisJob?.resultJson ?? null;
  const payload = result?.recommendation ?? null;
  return extractRecommendationTop2Items(payload).length > 0;
}
