import { assertCustomerApiOk, fetchCustomerApi } from "./customerApiAuth.js";

const ROUTE_PATH = "/api/key-analysis-complete-intake";

/**
 * P4 — call KEY analysis complete intake after Session transition.
 * Never throws — UI must continue if intake fails.
 */
export async function requestKeyAnalysisCompleteIntake(
  jobId,
  { transitionObservedAt = null } = {},
) {
  const trimmedId = String(jobId ?? "").trim();
  if (!trimmedId) {
    return { ok: false, skipped: true, reason: "missing_job_id" };
  }

  try {
    const { response, payload } = await fetchCustomerApi(ROUTE_PATH, {
      body: {
        job_id: trimmedId,
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

    assertCustomerApiOk({ response, payload }, "KEY analysis complete intake failed");

    return {
      ok: true,
      mode: payload.mode ?? "active",
      key_entry: payload.key_entry ?? "analysis_complete",
      job_id: payload.job_id ?? trimmedId,
      customer_initiative_sentence:
        payload.customer_initiative_sentence ??
        payload.intake_trace?.customer_initiative_sentence ??
        null,
      key_first_judgment: payload.key_first_judgment ?? payload.intake_trace?.key_first_judgment ?? null,
      customer_speak_changed: Boolean(payload.customer_speak_changed),
      intake_trace: payload.intake_trace ?? null,
    };
  } catch (error) {
    return {
      ok: false,
      mode: "intake_error",
      reason: error instanceof Error ? error.message : "key_analysis_complete_intake_failed",
    };
  }
}
