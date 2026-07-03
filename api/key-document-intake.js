/**
 * KU-1 — POST /api/key-document-intake
 * KU-2a — active: mint KEY Work Order (execution gate only).
 * KU-2b — judgment flag: key_first_judgment trace before factory.
 */

import { readJsonBody } from "../server/claudeGroundedExecutionCore.js";
import { buildKeyDocumentIntakeShadowTrace } from "../server/keyBrain/documentIntakeShadow.js";
import {
  getKeyUploadEntryMode,
  KEY_UPLOAD_ENTRY_MODES,
} from "../server/keyBrain/uploadEntryFlags.js";
import { isKeyUploadJudgmentEnabled } from "../server/keyBrain/uploadJudgmentFlags.js";
import {
  buildKeyWorkOrderRecord,
  mintKeyWorkOrderId,
  persistKeyWorkOrder,
  recordKeyWorkOrderFactoryUse,
  resolveKeyWorkOrderTtlMs,
} from "../server/keyBrain/workOrder.js";
import {
  createUserSupabaseClient,
  readCustomerAuthHeader,
  requireCustomerAuth,
} from "../server/requireCustomerAuth.js";

const DOCUMENT_SELECT =
  "id, customer_id, original_filename, ingest_status, doc_class, customer_hint_type, mime_type, metadata_json, created_at";

async function hasDocumentAnalysisConsent(supabase, customerId) {
  const { data, error } = await supabase
    .from("customer_consents")
    .select("id")
    .eq("customer_id", customerId)
    .eq("consent_type", "document_analysis")
    .eq("granted", true)
    .limit(1);
  if (error) return false;
  return (data ?? []).length > 0;
}

/** @param {import('http').IncomingMessage} req @param {import('http').ServerResponse} res */
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") {
    res.statusCode = 200;
    res.end();
    return;
  }

  if (req.method !== "POST") {
    res.statusCode = 405;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ ok: false, reason: "METHOD_NOT_ALLOWED" }));
    return;
  }

  const mode = getKeyUploadEntryMode(process.env);
  if (mode === KEY_UPLOAD_ENTRY_MODES.OFF) {
    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ ok: true, mode: "off", intake_skipped: true }));
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
    body = req.body && typeof req.body === "object" ? req.body : await readJsonBody(req);
  } catch {
    body = {};
  }

  const documentId = String(body.document_id ?? "").trim();
  if (!documentId) {
    res.statusCode = 422;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ ok: false, reason: "document_id_required" }));
    return;
  }

  const { data: document, error: docError } = await supabase
    .from("customer_documents")
    .select(DOCUMENT_SELECT)
    .eq("id", documentId)
    .eq("customer_id", auth.customerId)
    .is("deleted_at", null)
    .maybeSingle();

  if (docError) {
    res.statusCode = 500;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ ok: false, reason: "document_lookup_failed" }));
    return;
  }

  if (!document) {
    res.statusCode = 404;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ ok: false, reason: "document_not_found" }));
    return;
  }

  const hasAnalysisConsent = await hasDocumentAnalysisConsent(supabase, auth.customerId);
  const judgmentEnabled = isKeyUploadJudgmentEnabled(process.env);
  const intakeTrace = buildKeyDocumentIntakeShadowTrace({
    document,
    hasAnalysisConsent,
    uploadSource: String(body.upload_source ?? "web"),
    categoryKey: body.category_key ?? null,
    includeFirstJudgment: judgmentEnabled,
  });

  const responseMode = mode === KEY_UPLOAD_ENTRY_MODES.ACTIVE ? "active" : "shadow";
  let workOrderId = null;

  if (mode === KEY_UPLOAD_ENTRY_MODES.ACTIVE) {
    workOrderId = mintKeyWorkOrderId();
    const workOrderRecord = buildKeyWorkOrderRecord({
      workOrderId,
      customerId: auth.customerId,
      documentId,
      dispatchPlan: intakeTrace.dispatch_plan,
      ttlMs: resolveKeyWorkOrderTtlMs(process.env),
    });

    try {
      await persistKeyWorkOrder(supabase, {
        documentId,
        customerId: auth.customerId,
        workOrderRecord,
        existingMetadata: document.metadata_json ?? {},
      });
    } catch {
      res.statusCode = 500;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ ok: false, reason: "work_order_persist_failed" }));
      return;
    }

    intakeTrace.gate = judgmentEnabled ? "KU-2b" : "KU-2a";
    intakeTrace.work_order = workOrderRecord;
    intakeTrace.trace_steps = [
      ...(intakeTrace.trace_steps ?? []),
      {
        step: "work_order_issued",
        actor: "KEY",
        work_order_id: workOrderId,
        ordered_by: "KEY",
        gate: "KU-2a",
      },
    ];
  }

  res.statusCode = 200;
  res.setHeader("Content-Type", "application/json");
  res.end(
    JSON.stringify({
      ok: true,
      mode: responseMode,
      subject: "KEY",
      document_id: documentId,
      intake_trace: intakeTrace,
      key_first_judgment: intakeTrace.key_first_judgment ?? null,
      work_order_id: workOrderId,
      work_order_ordered_by: workOrderId ? "KEY" : null,
      factory_executed: false,
      customer_speak_changed: false,
    }),
  );
}
