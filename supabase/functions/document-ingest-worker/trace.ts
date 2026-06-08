import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";

export type IngestTraceRecord = {
  id: string;
};

const WORKER_PHASE = "22D-step1B";

export async function startIngestTrace(
  admin: SupabaseClient,
  params: {
    customerId: string;
    documentId: string;
    ingestJobId: string | null;
    consentSnapshot: Record<string, unknown>;
  },
): Promise<IngestTraceRecord> {
  const { data, error } = await admin
    .from("document_ingest_traces")
    .insert({
      customer_id: params.customerId,
      document_id: params.documentId,
      ingest_job_id: params.ingestJobId,
      status: "started",
      steps_json: { phase: WORKER_PHASE, worker: "document-ingest-worker" },
      consent_snapshot: params.consentSnapshot,
    })
    .select("id")
    .single();

  if (error || !data) {
    throw new Error(`ingest_trace_start_failed: ${error?.message ?? "unknown"}`);
  }

  return { id: data.id };
}

export async function completeIngestTrace(
  admin: SupabaseClient,
  traceId: string,
  params: {
    chunkCount: number;
    ocrConfidenceAvg: number | null;
    steps: Record<string, unknown>;
  },
): Promise<void> {
  const { error } = await admin
    .from("document_ingest_traces")
    .update({
      status: "completed",
      chunk_count: params.chunkCount,
      ocr_confidence_avg: params.ocrConfidenceAvg,
      steps_json: params.steps,
      completed_at: new Date().toISOString(),
    })
    .eq("id", traceId);

  if (error) {
    throw new Error(`ingest_trace_complete_failed: ${error.message}`);
  }
}

export async function failIngestTrace(
  admin: SupabaseClient,
  traceId: string | null,
  params: {
    errorCode: string;
    steps: Record<string, unknown>;
  },
): Promise<void> {
  if (!traceId) return;

  await admin
    .from("document_ingest_traces")
    .update({
      status: "failed",
      error_code: params.errorCode,
      steps_json: params.steps,
      completed_at: new Date().toISOString(),
    })
    .eq("id", traceId);
}
