import { assertCustomerApiOk, fetchCustomerApi } from "./customerApiAuth.js";

const ROUTE_PATH = "/api/key-document-intake";

/**
 * KU-1 shadow — call KEY intake after uploadDocument insert.
 * Never throws — legacy pipeline must continue.
 */
export async function requestKeyDocumentIntake(documentId, { categoryKey = null, uploadSource = "web" } = {}) {
  const trimmedId = String(documentId ?? "").trim();
  if (!trimmedId) {
    return { ok: false, skipped: true, reason: "missing_document_id" };
  }

  try {
    const { response, payload } = await fetchCustomerApi(ROUTE_PATH, {
      body: {
        document_id: trimmedId,
        category_key: categoryKey,
        upload_source: uploadSource,
      },
    });

    if (response.status === 200 && payload?.mode === "off") {
      return { ok: true, mode: "off", intake_skipped: true };
    }

    if (!response.ok || payload?.ok === false) {
      return {
        ok: false,
        mode: "shadow_error",
        reason: payload?.reason ?? payload?.error_message ?? `http_${response.status}`,
      };
    }

    assertCustomerApiOk({ response, payload }, "KEY intake failed");

    return {
      ok: true,
      mode: payload.mode ?? "shadow",
      work_order_id: payload.work_order_id ?? null,
      work_order_ordered_by: payload.work_order_ordered_by ?? null,
      intake_trace: payload.intake_trace ?? null,
    };
  } catch (error) {
    return {
      ok: false,
      mode: "shadow_error",
      reason: error instanceof Error ? error.message : "key_intake_failed",
    };
  }
}

export function appendLegacyPipelineContinuedClientTrace(intakeTrace, { ingestStarted = true } = {}) {
  if (!intakeTrace || typeof intakeTrace !== "object") return intakeTrace;
  const continued = {
    step: "legacy_pipeline_continued",
    at: "uploadDocument_after_intake",
    ingest_enqueue_started: ingestStarted,
    note: "KU-1 shadow — existing enqueueDocumentIngest + pipeline unchanged",
  };
  return {
    ...intakeTrace,
    legacy_pipeline_continued: continued,
    trace_steps: [...(intakeTrace.trace_steps ?? []), continued],
  };
}
