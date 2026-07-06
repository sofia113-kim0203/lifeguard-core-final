/**
 * P5-C — RETURN_JUDGMENT intake trace.
 */

export function buildKeyReturnJudgmentIntakeShadowTrace({
  sessionId = null,
  gapHours = null,
  anchorJobId = null,
  keyRuntimeEntered = false,
  keyEntry = "return_judgment",
  gate = {},
  keyFirstJudgment = null,
} = {}) {
  return {
    schema_version: "key-return-judgment-intake-trace-p5c-v1",
    session_id: sessionId,
    gap_hours: gapHours,
    anchor_job_id: anchorJobId,
    key_entry: keyEntry,
    key_runtime_entered: keyRuntimeEntered,
    gate,
    key_first_judgment: keyFirstJudgment,
    trace_steps: [
      { step: "bridge_precondition_met", at: new Date().toISOString() },
      { step: "gap_evaluated", gap_hours: gapHours },
      { step: "anchor_resolved", anchor_job_id: anchorJobId },
      ...(keyFirstJudgment ? [{ step: "key_first_judgment", payload: keyFirstJudgment }] : []),
      ...(keyRuntimeEntered ? [{ step: "key_runtime_entered", key_entry: keyEntry }] : []),
      ...(gate.emit ? [{ step: "return_judgment_emit_allowed" }] : [{ step: "return_judgment_emit_blocked", reasons: gate.reasons }]),
    ],
  };
}
