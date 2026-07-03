/**
 * POST /api/customer-document-policy-extract
 * Runs OCR chunk → policy extraction → profile_insurance_policies + KEY EA-1 evidence foundation.
 */

import { readJsonBody } from "../server/claudeGroundedExecutionCore.js";
import {
  buildLoadedContextFromSnapshot,
  loadSalesDirectorTurnContext,
} from "../server/customerContextSnapshot.js";
import { runDocumentPolicyExtraction } from "../server/documentPolicyExtractionPipeline.js";
import { buildPhaseAFollowUpCustomerSpeak } from "../server/keyBrain/du1DocumentUploadFirstSpeak.js";
import { isKeyUploadEntryActiveEnabled } from "../server/keyBrain/uploadEntryFlags.js";
import { gateFactoryWithKeyWorkOrder, recordKeyWorkOrderFactoryUse } from "../server/keyBrain/workOrder.js";
import {
  createUserSupabaseClient,
  readCustomerAuthHeader,
  requireCustomerAuth,
} from "../server/requireCustomerAuth.js";

const DOCUMENT_SELECT =
  "id, customer_id, original_filename, ingest_status, doc_class, customer_hint_type, mime_type, metadata_json, created_at";

async function buildPhaseAFollowUpFromDocument({
  supabase,
  customerId,
  documentRow,
  result = null,
} = {}) {
  const meta = documentRow?.metadata_json ?? result?.metadata_json ?? {};
  const extractionReady =
    result?.ok === true || meta.policy_extraction_status === "completed";
  if (!extractionReady || !documentRow) return null;

  const turnContext = await loadSalesDirectorTurnContext(supabase, customerId, {
    requestHistory: [],
  });

  return buildPhaseAFollowUpCustomerSpeak({
    document: documentRow,
    contextSnapshot: turnContext.snapshot,
    loadedContext: buildLoadedContextFromSnapshot(turnContext.snapshot),
    multiExtraction: result?.extraction ?? meta.policy_extraction ?? null,
    linkedPolicyIds: result?.policy_ids ?? meta.profile_policy_ids ?? [],
    ea1CustomerSummary: meta.key_ea1_customer_summary ?? null,
  });
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.statusCode = 405;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ ok: false, reason: "METHOD_NOT_ALLOWED" }));
    return;
  }

  const authHeader = readCustomerAuthHeader(req);
  const supabase = createUserSupabaseClient(authHeader);
  const auth = await requireCustomerAuth(supabase);
  if (!auth.ok) {
    res.statusCode = auth.reason === "UNAUTHORIZED" ? 401 : 403;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ ok: false, reason: auth.reason, error_message: auth.error_message }));
    return;
  }

  let body = {};
  try {
    body = await readJsonBody(req);
  } catch {
    body = {};
  }

  const documentId = String(body.document_id ?? "").trim();

  if (!auth.customerId) {
    res.statusCode = 401;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ ok: false, error: "customer_auth_missing_customer_id" }));
    return;
  }

  if (!documentId) {
    res.statusCode = 422;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ ok: false, error: "document_id_required" }));
    return;
  }

  const workOrderId = String(body.work_order_id ?? body.workOrderId ?? "").trim() || null;

  if (isKeyUploadEntryActiveEnabled(process.env)) {
    const { data: documentRow, error: documentError } = await supabase
      .from("customer_documents")
      .select("id, customer_id, metadata_json")
      .eq("id", documentId)
      .eq("customer_id", auth.customerId)
      .is("deleted_at", null)
      .maybeSingle();

    if (documentError || !documentRow) {
      res.statusCode = 404;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ ok: false, reason: "document_not_found" }));
      return;
    }

    const gate = gateFactoryWithKeyWorkOrder({
      activeGateEnabled: true,
      workOrderId,
      documentId,
      customerId: auth.customerId,
      metadataJson: documentRow.metadata_json ?? {},
      factory: "policy_extract",
    });

    if (!gate.ok) {
      res.statusCode = gate.status ?? 403;
      res.setHeader("Content-Type", "application/json");
      res.end(
        JSON.stringify({
          ok: false,
          reason: gate.reason,
          error_message: gate.message,
          work_order_required: gate.reason === "work_order_required",
          ordered_by: gate.ordered_by ?? null,
        }),
      );
      return;
    }

    const useRecord = await recordKeyWorkOrderFactoryUse(supabase, {
      documentId,
      customerId: auth.customerId,
      metadataJson: documentRow.metadata_json ?? {},
      workOrderId,
      factory: "policy_extract",
    });
    if (!useRecord.ok) {
      res.statusCode = useRecord.status ?? 403;
      res.setHeader("Content-Type", "application/json");
      res.end(
        JSON.stringify({
          ok: false,
          reason: useRecord.reason,
          error_message: useRecord.message,
          ordered_by: useRecord.ordered_by ?? null,
        }),
      );
      return;
    }
  }

  try {
    const forceRetry =
      body.force_retry === true ||
      body.forceRetry === true;
    const result = await runDocumentPolicyExtraction({
      customerId: auth.customerId,
      documentId,
      env: process.env,
      invokeMemory: body.invoke_memory !== false,
      forceRetry,
    });

    let keyFollowUp = null;
    try {
      const { data: documentRow } = await supabase
        .from("customer_documents")
        .select(DOCUMENT_SELECT)
        .eq("id", documentId)
        .eq("customer_id", auth.customerId)
        .is("deleted_at", null)
        .maybeSingle();

      keyFollowUp = await buildPhaseAFollowUpFromDocument({
        supabase,
        customerId: auth.customerId,
        documentRow,
        result,
      });
    } catch {
      keyFollowUp = null;
    }

    res.statusCode = result.ok ? 200 : 422;
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        ok: result.ok,
        customer_id: auth.customerId,
        document_id: documentId,
        ...result,
        key_follow_up_sentence: keyFollowUp?.text ?? null,
        key_follow_up_segments: keyFollowUp?.segments ?? null,
      }),
    );
  } catch (error) {
    let keyFollowUp = null;
    try {
      const { data: documentRow } = await supabase
        .from("customer_documents")
        .select(DOCUMENT_SELECT)
        .eq("id", documentId)
        .eq("customer_id", auth.customerId)
        .is("deleted_at", null)
        .maybeSingle();
      keyFollowUp = await buildPhaseAFollowUpFromDocument({
        supabase,
        customerId: auth.customerId,
        documentRow,
      });
    } catch {
      keyFollowUp = null;
    }

    res.statusCode = keyFollowUp?.text ? 422 : 500;
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        ok: false,
        reason: "policy_extraction_failed",
        error_message: error instanceof Error ? error.message : "policy_extraction_failed",
        key_follow_up_sentence: keyFollowUp?.text ?? null,
        key_follow_up_segments: keyFollowUp?.segments ?? null,
      }),
    );
  }
}
