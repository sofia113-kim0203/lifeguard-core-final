/**
 * POST /api/customer-document-analysis-refresh
 * Runs analysis pipeline after document policy extraction.
 */

import { readJsonBody } from "../server/claudeGroundedExecutionCore.js";
import { handleDocumentPolicyAnalysisRefreshRequest } from "../server/documentPolicyAnalysisRefresh.js";
import { isKeyUploadEntryActiveEnabled } from "../server/keyBrain/uploadEntryFlags.js";
import { gateFactoryWithKeyWorkOrder, recordKeyWorkOrderFactoryUse } from "../server/keyBrain/workOrder.js";
import {
  createUserSupabaseClient,
  readCustomerAuthHeader,
  requireCustomerAuth,
} from "../server/requireCustomerAuth.js";

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

  const documentId = String(body.document_id ?? body.documentId ?? "").trim() || null;
  const workOrderId = String(body.work_order_id ?? body.workOrderId ?? "").trim() || null;

  if (isKeyUploadEntryActiveEnabled(process.env) && documentId) {
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
      factory: "analysis_refresh",
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
      factory: "analysis_refresh",
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
    const result = await handleDocumentPolicyAnalysisRefreshRequest({
      authHeader,
      documentId,
    });

    res.statusCode = result.ok ? 200 : 422;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify(result));
  } catch (error) {
    res.statusCode = 500;
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        ok: false,
        reason: "analysis_refresh_failed",
        error_message: error instanceof Error ? error.message : "analysis_refresh_failed",
      }),
    );
  }
}
