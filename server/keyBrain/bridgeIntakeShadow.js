/**
 * P5-B — KEY Bridge intake trace (shadow/active observability).
 */

export function buildKeyBridgeIntakeShadowTrace({
  sessionId = null,
  gapHours = null,
  anchorJobId = null,
  keyRuntimeEntered = false,
  keyEntry = "bridge",
  gate = {},
} = {}) {
  return {
    schema_version: "key-bridge-intake-trace-p5b-v1",
    session_id: sessionId,
    gap_hours: gapHours,
    anchor_job_id: anchorJobId,
    key_entry: keyEntry,
    key_runtime_entered: keyRuntimeEntered,
    gate,
    trace_steps: [
      { step: "thread_restore_assumed", at: new Date().toISOString() },
      { step: "gap_evaluated", gap_hours: gapHours },
      { step: "anchor_resolved", anchor_job_id: anchorJobId },
      ...(keyRuntimeEntered ? [{ step: "key_runtime_entered", key_entry: keyEntry }] : []),
      ...(gate.emit ? [{ step: "bridge_emit_allowed" }] : [{ step: "bridge_emit_blocked", reasons: gate.reasons }]),
    ],
  };
}
