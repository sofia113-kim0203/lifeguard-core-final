/**
 * P2 Central Brain — Read-only evidence planning (no engine execution).
 */
import { resolveAllowedTools } from "../advisorBrain/advisorToolRegistry.js";

const READ_ONLY_LOADER_KEYS = [
  "unified_state",
  "memory_snapshot",
  "analysis_cache",
  "stored_job",
  "conversation_history",
];

const FORBIDDEN_LOADER_KEYS = [
  "coverage_gap_live",
  "underwriting_live",
  "recommendation_live",
  "design_live",
];

export function planCentralBrainEvidence({ route, memoryVersion = 0, cacheStatus = null } = {}) {
  const centralMode = route?.central_mode ?? null;
  const classification = route?.classification ?? {};

  if (!route?.active || !centralMode) {
    return {
      evidence_plan_id: null,
      central_mode: null,
      loaders: [],
      tools: [],
      use_stored_job: false,
      use_live_engines: false,
      skip_analysis_job: false,
      read_only: true,
      forbidden_loaders: FORBIDDEN_LOADER_KEYS,
      rationale: ["central_brain_inactive_or_legacy_lane"],
    };
  }

  const base = {
    evidence_plan_id: `cb-plan-${centralMode}-${Date.now()}`,
    central_mode: centralMode,
    use_live_engines: false,
    skip_analysis_job: true,
    read_only: true,
    forbidden_loaders: FORBIDDEN_LOADER_KEYS,
    memory_version: memoryVersion,
    cache_status: cacheStatus,
  };

  switch (centralMode) {
    case "coverage_gap_reason":
      return {
        ...base,
        loaders: [...READ_ONLY_LOADER_KEYS],
        tools: resolveAllowedTools(classification).filter(
          (tool) => tool !== "get_coverage_gap" && tool !== "get_underwriting",
        ),
        use_stored_job: true,
        rationale: [
          "stored_read_only",
          "no_live_coverage_gap_engine",
          "no_analysis_job",
        ],
      };
    case "factual_lookup":
      return {
        ...base,
        loaders: ["unified_state", "memory_snapshot", "analysis_cache", "stored_job", "conversation_history"],
        tools: resolveAllowedTools(classification).filter(
          (tool) => tool !== "get_coverage_gap" && tool !== "get_underwriting",
        ),
        use_stored_job: true,
        rationale: ["read_search_only", "no_live_engines", "no_analysis_job"],
      };
    case "recommendation_reason":
      return {
        ...base,
        loaders: ["stored_job"],
        tools: [],
        use_stored_job: true,
        rationale: ["stored_panels_only", "no_recommendation_engine", "no_analysis_job"],
      };
    case "advisor_conversation":
      return {
        ...base,
        loaders: ["stored_job", "conversation_history"],
        tools: [],
        use_stored_job: true,
        rationale: ["stored_panels_only", "no_live_engines", "no_analysis_job"],
      };
    default:
      return {
        ...base,
        loaders: [],
        tools: [],
        use_stored_job: false,
        skip_analysis_job: false,
        rationale: ["unknown_central_mode"],
      };
  }
}
