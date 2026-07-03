/**
 * KU-2b — KEY first judgment record (trace only · no customer speech).
 */
export const KEY_FIRST_JUDGMENT_SCHEMA_VERSION = "key-first-judgment-ku2b-v1";

/**
 * @param {object} input
 * @param {object} [input.document]
 * @param {object|null} [input.keyInterprets] — from intake key_interprets payload
 * @param {object|null} [input.loadedContext] — from buildLoadedContextFromSnapshot
 * @param {object|null} [input.contextSnapshot] — chat-equivalent snapshot
 * @param {string} [input.recordedAt]
 */
export function buildKeyFirstJudgment({
  document = {},
  keyInterprets = null,
  loadedContext = null,
  contextSnapshot = null,
  recordedAt = new Date().toISOString(),
} = {}) {
  const interpret = keyInterprets && typeof keyInterprets === "object" ? keyInterprets : {};
  const judgmentScope = interpret.judgment_scope ?? {
    knowable: [],
    unknowable: [],
    must_not_claim: [],
  };

  return {
    schema_version: KEY_FIRST_JUDGMENT_SCHEMA_VERSION,
    actor: "KEY",
    gate: "KU-2b",
    document_id: document.id ?? null,
    document_kind_guess: interpret.document_kind_guess ?? "unknown_pending_peek",
    judgment_scope: judgmentScope,
    hold: interpret.hold ?? { needed: true, other_document_request: null },
    posture: interpret.orient_speech_planned?.posture ?? "provisional_metadata",
    context_snapshot_id: contextSnapshot?.context_snapshot_id ?? null,
    customer_context_status: loadedContext
      ? {
          memory: loadedContext.memory ?? "empty",
          policies: loadedContext.policies ?? "empty",
          documents: loadedContext.documents ?? "empty",
          conversations:
            typeof loadedContext.conversations === "object"
              ? loadedContext.conversations.status ?? "empty"
              : loadedContext.conversations ?? "empty",
        }
      : null,
    recorded_at: recordedAt,
  };
}

/**
 * Tom KU-2b merge gate — key_first_judgment must precede legacy_pipeline_continued.
 * @param {Array<{ step?: string }>} traceSteps
 */
export function validateKu2bJudgmentBeforeLegacy(traceSteps = []) {
  const steps = traceSteps.map((row) => String(row?.step ?? ""));
  const judgmentIdx = steps.indexOf("key_first_judgment");
  const legacyIdx = steps.indexOf("legacy_pipeline_continued");

  if (judgmentIdx === -1) {
    return { ok: false, reason: "missing_key_first_judgment" };
  }
  if (legacyIdx === -1) {
    return { ok: true, reason: "legacy_not_appended_yet" };
  }
  if (judgmentIdx >= legacyIdx) {
    return { ok: false, reason: "judgment_not_before_legacy" };
  }
  return { ok: true, reason: "judgment_before_legacy" };
}
