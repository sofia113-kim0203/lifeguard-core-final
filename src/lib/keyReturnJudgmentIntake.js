import { assertCustomerApiOk, fetchCustomerApi } from "./customerApiAuth.js";

const ROUTE_PATH = "/api/key-return-judgment-intake";

export async function requestKeyReturnJudgmentIntake(
  sessionId,
  { anchorJobId = null, transitionObservedAt = null } = {},
) {
  const trimmedSessionId = String(sessionId ?? "").trim();
  if (!trimmedSessionId) {
    return { ok: false, skipped: true, reason: "missing_session_id" };
  }

  try {
    const { response, payload } = await fetchCustomerApi(ROUTE_PATH, {
      body: {
        session_id: trimmedSessionId,
        anchor_job_id: anchorJobId ?? null,
        transition_observed_at: transitionObservedAt ?? new Date().toISOString(),
      },
    });

    if (response.status === 200 && payload?.mode === "off") {
      return { ok: true, mode: "off", intake_skipped: true };
    }

    if (!response.ok || payload?.ok === false) {
      return {
        ok: false,
        mode: "intake_error",
        reason: payload?.reason ?? payload?.error_message ?? `http_${response.status}`,
      };
    }

    assertCustomerApiOk({ response, payload }, "KEY return judgment intake failed");

    if (payload?.return_judgment_skipped) {
      return {
        ok: true,
        mode: payload.mode ?? "active",
        return_judgment_skipped: true,
        skip_reasons: payload.skip_reasons ?? [],
        gap_hours: payload.gap_hours ?? null,
        session_id: payload.session_id ?? trimmedSessionId,
        anchor_job_id: payload.anchor_job_id ?? null,
        intake_trace: payload.intake_trace ?? null,
      };
    }

    return {
      ok: true,
      mode: payload.mode ?? "active",
      key_entry: payload.key_entry ?? "return_judgment",
      session_id: payload.session_id ?? trimmedSessionId,
      anchor_job_id: payload.anchor_job_id ?? null,
      gap_hours: payload.gap_hours ?? null,
      return_judgment_sentence: payload.return_judgment_sentence ?? null,
      intake_trace: payload.intake_trace ?? null,
    };
  } catch (error) {
    return {
      ok: false,
      mode: "intake_error",
      reason: error instanceof Error ? error.message : "key_return_judgment_intake_failed",
    };
  }
}
