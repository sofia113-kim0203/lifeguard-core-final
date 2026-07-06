import { assertCustomerApiOk, fetchCustomerApi } from "./customerApiAuth.js";

const ROUTE_PATH = "/api/key-bridge-intake";

/**
 * P5-B — call KEY bridge intake after thread restore settled.
 * Never throws — UI must continue if intake fails.
 */
export async function requestKeyBridgeIntake(
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

    assertCustomerApiOk({ response, payload }, "KEY bridge intake failed");

    if (payload?.bridge_skipped) {
      return {
        ok: true,
        mode: payload.mode ?? "active",
        bridge_skipped: true,
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
      key_entry: payload.key_entry ?? "bridge",
      session_id: payload.session_id ?? trimmedSessionId,
      anchor_job_id: payload.anchor_job_id ?? null,
      gap_hours: payload.gap_hours ?? null,
      bridge_sentence: payload.bridge_sentence ?? null,
      intake_trace: payload.intake_trace ?? null,
    };
  } catch (error) {
    return {
      ok: false,
      mode: "intake_error",
      reason: error instanceof Error ? error.message : "key_bridge_intake_failed",
    };
  }
}
