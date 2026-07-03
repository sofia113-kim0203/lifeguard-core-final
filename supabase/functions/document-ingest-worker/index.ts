import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { classifyDocumentType } from "./classify.ts";
import { applyChunkEmbeddings, replaceDocumentChunks } from "./chunk.ts";
import { runExtract, type DocumentRecord } from "./extract.ts";
import {
  completeIngestTrace,
  failIngestTrace,
  startIngestTrace,
} from "./trace.ts";
import { isKeyUploadEntryActive, markWorkOrderFactoryUsed, validateKeyWorkOrderGate } from "./workOrderGate.ts";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const WORKER_PHASE = "22D-step2";

function jsonResponse(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

function safeErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message.slice(0, 500);
  return "document_ingest_failed";
}

function resolveServiceRoleKey(): string | undefined {
  const supabaseServiceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")?.trim();
  if (supabaseServiceRoleKey) return supabaseServiceRoleKey;

  const serviceRoleKey = Deno.env.get("SERVICE_ROLE_KEY")?.trim();
  if (serviceRoleKey) return serviceRoleKey;

  const secretKeys = Deno.env.get("SUPABASE_SECRET_KEYS")?.trim();
  if (!secretKeys) return undefined;

  if (secretKeys.startsWith("[")) {
    try {
      const parsed = JSON.parse(secretKeys) as unknown;
      if (Array.isArray(parsed) && parsed.length > 0) {
        const preferred = parsed.find(
          (entry) => typeof entry === "string" && entry.startsWith("sb_secret_"),
        );
        return (preferred ?? parsed[0]) as string;
      }
    } catch {
      // fall through to raw value
    }
  }

  return secretKeys;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS });
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "method_not_allowed" }, 405);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = resolveServiceRoleKey();

  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    return jsonResponse({ error: "worker_not_configured" }, 500);
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return jsonResponse({ error: "unauthorized" }, 401);
  }

  let documentId: string;
  let workOrderId: string | undefined;
  try {
    const body = await req.json();
    documentId = String(body?.document_id ?? "").trim();
    workOrderId = String(body?.work_order_id ?? "").trim() || undefined;
    if (!documentId) {
      return jsonResponse({ error: "document_id_required" }, 422);
    }
  } catch {
    return jsonResponse({ error: "invalid_json_body" }, 422);
  }

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  let traceId: string | null = null;
  let document: DocumentRecord | null = null;

  try {
    const { data: authData, error: authError } = await userClient.auth.getUser();
    if (authError || !authData.user) {
      return jsonResponse({ error: "unauthorized" }, 401);
    }

    const { data: profile, error: profileError } = await userClient
      .from("customer_profiles")
      .select("id")
      .eq("user_id", authData.user.id)
      .maybeSingle();

    if (profileError || !profile?.id) {
      return jsonResponse({ error: "customer_profile_not_found" }, 403);
    }

    const customerId = profile.id;

    const { data: docRow, error: docError } = await userClient
      .from("customer_documents")
      .select(
        "id, customer_id, storage_path, mime_type, original_filename, ingest_status, ingest_job_id, document_type, customer_hint_type, consent_snapshot, metadata_json",
      )
      .eq("id", documentId)
      .is("deleted_at", null)
      .maybeSingle();

    if (docError || !docRow || docRow.customer_id !== customerId) {
      return jsonResponse({ error: "document_not_found" }, 404);
    }

    document = docRow as DocumentRecord;

    if (isKeyUploadEntryActive(Deno.env.get("KEY_UPLOAD_ENTRY"))) {
      const gate = validateKeyWorkOrderGate({
        workOrderId,
        documentId,
        customerId,
        metadataJson: (document.metadata_json ?? null) as Record<string, unknown> | null,
        factory: "document_ocr",
      });
      if (!gate.ok) {
        return jsonResponse(
          {
            error: gate.reason,
            error_message: gate.message,
            work_order_required: gate.reason === "work_order_required",
            ordered_by: null,
          },
          gate.status,
        );
      }

      const consumedMetadata = markWorkOrderFactoryUsed(
        (document.metadata_json ?? null) as Record<string, unknown> | null,
        gate.record,
        "document_ocr",
      );
      await adminClient
        .from("customer_documents")
        .update({
          metadata_json: consumedMetadata,
          updated_at: new Date().toISOString(),
        })
        .eq("id", documentId)
        .eq("customer_id", customerId);
      document.metadata_json = consumedMetadata as DocumentRecord["metadata_json"];
    }

    if (document.ingest_status !== "queued") {
      return jsonResponse(
        {
          error: "document_not_queued",
          ingest_status: document.ingest_status,
        },
        409,
      );
    }

    const { data: hasAnalysisConsent, error: consentError } = await adminClient.rpc(
      "lifeguard_has_consent",
      { p_customer_id: customerId, p_consent_type: "document_analysis" },
    );

    if (consentError) {
      throw new Error(`consent_check_failed: ${consentError.message}`);
    }

    if (!hasAnalysisConsent) {
      await adminClient
        .from("customer_documents")
        .update({
          ingest_status: "analysis_blocked_by_consent",
          error_message: null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", documentId)
        .eq("customer_id", customerId);

      return jsonResponse(
        {
          error: "document_analysis_consent_required",
          ingest_status: "analysis_blocked_by_consent",
        },
        403,
      );
    }

    const trace = await startIngestTrace(adminClient, {
      customerId,
      documentId,
      ingestJobId: document.ingest_job_id,
      consentSnapshot: (document.consent_snapshot ?? {}) as Record<string, unknown>,
    });
    traceId = trace.id;

    const { error: processingError } = await adminClient
      .from("customer_documents")
      .update({
        ingest_status: "processing",
        error_message: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", documentId)
      .eq("customer_id", customerId);

    if (processingError) {
      throw new Error(`processing_status_failed: ${processingError.message}`);
    }

    const classifiedDocumentType = classifyDocumentType(document);
    const extractResult = await runExtract(adminClient, document);

    const chunkResult = await replaceDocumentChunks(adminClient, {
      customerId,
      documentId,
      docTitle: document.original_filename,
      content: extractResult.content,
      extractionRoute: extractResult.extractionRoute,
      ocrConfidenceAvg: extractResult.ocrConfidenceAvg,
      workerPhase: WORKER_PHASE,
    });

    const embeddingResult = await applyChunkEmbeddings(adminClient, {
      customerId,
      documentId,
      chunks: chunkResult.chunks,
    });

    const mergedMetadata = {
      ...(document.metadata_json ?? {}),
      phase: WORKER_PHASE,
      ocr_provider: extractResult.ocrProvider,
      extraction_route: extractResult.extractionRoute,
      chunk_count: chunkResult.count,
      embedding_model: embeddingResult.embeddingModel,
      storage_verified: extractResult.storageVerified,
      classified_document_type: classifiedDocumentType,
      ...(extractResult.ocrConfidenceAvg !== null
        ? { ocr_confidence_avg: extractResult.ocrConfidenceAvg }
        : {}),
    };

    const { error: readyError } = await adminClient
      .from("customer_documents")
      .update({
        ingest_status: "ready",
        document_type: classifiedDocumentType,
        page_count: extractResult.pageCount,
        metadata_json: mergedMetadata,
        error_message: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", documentId)
      .eq("customer_id", customerId);

    if (readyError) {
      throw new Error(`ready_status_failed: ${readyError.message}`);
    }

    await completeIngestTrace(adminClient, traceId, {
      chunkCount: chunkResult.count,
      ocrConfidenceAvg: extractResult.ocrConfidenceAvg,
      steps: {
        phase: WORKER_PHASE,
        worker: "document-ingest-worker",
        ocr_provider: extractResult.ocrProvider,
        extraction_route: extractResult.extractionRoute,
        classified_document_type: classifiedDocumentType,
        storage_verified: extractResult.storageVerified,
        chunk_count: chunkResult.count,
        embedding_model: embeddingResult.embeddingModel,
        embedded_count: embeddingResult.embeddedCount,
        ...(extractResult.ocrConfidenceAvg !== null
          ? { ocr_confidence_avg: extractResult.ocrConfidenceAvg }
          : {}),
      },
    });

    return jsonResponse({
      document_id: documentId,
      ingest_status: "ready",
      chunk_count: chunkResult.count,
      phase: WORKER_PHASE,
      ocr_provider: extractResult.ocrProvider,
      extraction_route: extractResult.extractionRoute,
      embedding_model: embeddingResult.embeddingModel,
      classified_document_type: classifiedDocumentType,
      ...(extractResult.ocrConfidenceAvg !== null
        ? { ocr_confidence_avg: extractResult.ocrConfidenceAvg }
        : {}),
    });
  } catch (error) {
    const message = safeErrorMessage(error);

    if (document) {
      await adminClient
        .from("customer_documents")
        .update({
          ingest_status: "failed",
          error_message: message,
          updated_at: new Date().toISOString(),
        })
        .eq("id", documentId)
        .eq("customer_id", document.customer_id);
    }

    await failIngestTrace(adminClient, traceId, {
      errorCode: message.split(":")[0] ?? "document_ingest_failed",
      steps: {
        phase: WORKER_PHASE,
        worker: "document-ingest-worker",
        error: message,
      },
    });

    return jsonResponse(
      {
        error: "document_ingest_failed",
        message,
        document_id: documentId,
        ingest_status: "failed",
      },
      500,
    );
  }
});
