/**
 * Legacy-S1 — Strip stored Claude prose from analysis_jobs result_json at read/API boundary.
 * DB rows are unchanged; only customer-facing payloads are sanitized.
 */

const STRIPPED_STAGE_TEXT_FIELDS = ["text", "fallback_text"];

function stripClaudeStageObject(stage) {
  if (!stage || typeof stage !== "object") {
    return stage;
  }
  const stripped = { ...stage };
  for (const field of STRIPPED_STAGE_TEXT_FIELDS) {
    if (Object.hasOwn(stripped, field)) {
      stripped[field] = null;
    }
  }
  return stripped;
}

export function stripLegacyClaudeFromJobResultJson(resultJson) {
  if (!resultJson || typeof resultJson !== "object") {
    return {};
  }

  const sanitized = { ...resultJson };

  if (Object.hasOwn(sanitized, "claude_explanations")) {
    delete sanitized.claude_explanations;
  }

  if (sanitized.result_claude) {
    sanitized.result_claude = stripClaudeStageObject(sanitized.result_claude);
  }

  if (sanitized.final_claude) {
    sanitized.final_claude = stripClaudeStageObject(sanitized.final_claude);
  }

  return sanitized;
}
