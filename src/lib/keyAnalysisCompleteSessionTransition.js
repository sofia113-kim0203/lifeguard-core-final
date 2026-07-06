const IN_FLIGHT_STATUSES = new Set(["processing", "queued", "pending", "running"]);
export const ANALYSIS_COMPLETE_INTAKE_DEDUPE_PREFIX = "lg_key_ac_intake_";

export function analysisCompleteIntakeDedupeKey(jobId) {
  return `${ANALYSIS_COMPLETE_INTAKE_DEDUPE_PREFIX}${String(jobId ?? "").trim()}`;
}

export function hasAnalysisCompleteIntakeDedupe(jobId, storage = null) {
  const id = String(jobId ?? "").trim();
  if (!id) return false;
  const store = storage ?? (typeof sessionStorage !== "undefined" ? sessionStorage : null);
  if (!store) return false;
  return store.getItem(analysisCompleteIntakeDedupeKey(id)) === "1";
}

export function markAnalysisCompleteIntakeDedupe(jobId, storage = null) {
  const id = String(jobId ?? "").trim();
  if (!id) return;
  const store = storage ?? (typeof sessionStorage !== "undefined" ? sessionStorage : null);
  if (!store) return;
  store.setItem(analysisCompleteIntakeDedupeKey(id), "1");
}

export function isAnalysisJobInFlight(status) {
  return IN_FLIGHT_STATUSES.has(String(status ?? "").trim());
}

/** Detect first transition into completed for a job (Session emitter SSOT). */
export function detectAnalysisCompleteTransition(priorJob, nextJob) {
  if (!nextJob?.id || nextJob.status !== "completed") return null;

  const priorId = priorJob?.id ?? null;
  const priorStatus = priorJob?.status ?? null;

  if (priorId === nextJob.id && priorStatus === "completed") return null;
  if (priorStatus === "completed" && priorId === nextJob.id) return null;
  if (priorStatus !== "completed") return nextJob;
  if (priorId && priorId !== nextJob.id) return nextJob;

  return null;
}

/** Tracked upload job — only fire when the specific jobId reaches completed. */
export function detectTrackedJobCompleteTransition(
  trackedJobId,
  priorStatus,
  nextJob,
) {
  const id = String(trackedJobId ?? "").trim();
  if (!id || !nextJob?.id || nextJob.id !== id) return null;
  if (nextJob.status !== "completed") return null;
  if (priorStatus === "completed") return null;
  return nextJob;
}

export const KEY_ANALYSIS_COMPLETE_EMITTER_TRACE_KEY = "lg_key_ac_emitter_trace";

export function readEmitterTrace(storage = null) {
  const store = storage ?? (typeof sessionStorage !== "undefined" ? sessionStorage : null);
  if (!store) return null;
  try {
    return JSON.parse(store.getItem(KEY_ANALYSIS_COMPLETE_EMITTER_TRACE_KEY) ?? "null");
  } catch {
    return null;
  }
}

export function writeEmitterTrace(partial, storage = null) {
  const store = storage ?? (typeof sessionStorage !== "undefined" ? sessionStorage : null);
  if (!store || !partial || typeof partial !== "object") return;
  const prev = readEmitterTrace(store) ?? {};
  store.setItem(
    KEY_ANALYSIS_COMPLETE_EMITTER_TRACE_KEY,
    JSON.stringify({ ...prev, ...partial, updated_at: new Date().toISOString() }),
  );
}

export const KEY_ANALYSIS_COMPLETE_POLL_INTERVAL_MS = 3000;
export const KEY_ANALYSIS_COMPLETE_POLL_MAX_MS = 300000;
