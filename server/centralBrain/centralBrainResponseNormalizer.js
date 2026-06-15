/**
 * P2 Central Brain — Customer-visible text normalization (LIFEGUARD voice).
 */

const INTERNAL_NAME_PATTERNS = [
  /\bTom\b/gi,
  /Advisor\s*Brain/gi,
  /Central\s*Brain/gi,
  /\bPlanner\b/gi,
  /Evidence\s*Loader/gi,
  /Coverage\s*Gap\s*Engine/gi,
  /Underwriting\s*Engine/gi,
  /Recommendation\s*Engine/gi,
  /Design\s*Engine/gi,
  /analysis_jobs?/gi,
  /result_json/gi,
];

const REPORT_DUMP_PATTERNS = [
  /보장분석\s*결과/i,
  /추천결과/i,
  /인수심사\s*위험도/i,
  /분석\s*결과에\s*따르면/i,
];

export function normalizeCentralBrainResponse(message = "") {
  let text = String(message ?? "").trim();
  if (!text) return text;

  for (const pattern of INTERNAL_NAME_PATTERNS) {
    text = text.replace(pattern, "");
  }

  for (const pattern of REPORT_DUMP_PATTERNS) {
    text = text.replace(pattern, "확인된 자료");
  }

  text = text
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();

  return text;
}

export function detectInternalNameLeak(message = "") {
  const text = String(message ?? "");
  return INTERNAL_NAME_PATTERNS.filter((pattern) => {
    pattern.lastIndex = 0;
    return pattern.test(text);
  }).map((pattern) => pattern.source);
}

export function mergeConversationMetadata(existing = {}, extension = {}) {
  const base =
    existing && typeof existing === "object" && !Array.isArray(existing) ? { ...existing } : {};
  const extra =
    extension && typeof extension === "object" && !Array.isArray(extension) ? extension : {};

  const merged = { ...base };
  for (const [key, value] of Object.entries(extra)) {
    if (
      value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      merged[key] &&
      typeof merged[key] === "object" &&
      !Array.isArray(merged[key])
    ) {
      merged[key] = mergeConversationMetadata(merged[key], value);
    } else if (value !== undefined) {
      merged[key] = value;
    }
  }
  return merged;
}

export function buildCentralBrainAssistantMetadata({
  centralMode,
  plan,
  bundle,
  initialResponseTimeMs,
  existing = {},
} = {}) {
  return mergeConversationMetadata(existing, {
    source: "conversational_background_analysis",
    phase: "central-brain-p2",
    central_brain_mode: centralMode,
    central_brain_read_only: true,
    analysis_job_skipped: true,
    live_engines_executed: false,
    evidence_plan_id: plan?.evidence_plan_id ?? null,
    bundle_id: bundle?.bundle_id ?? null,
    evidence_sufficiency: bundle?.sufficiency ?? null,
    initial_response_time_ms: initialResponseTimeMs ?? null,
    answer_shape: "counsel",
    honesty_tier: "evidence_first",
  });
}
