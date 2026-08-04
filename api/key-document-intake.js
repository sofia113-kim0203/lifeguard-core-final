/**
 * KU-1 — POST /api/key-document-intake
 * KEY Master only — runOneKeyCoreTurn({ event: "document" }).
 */

import { readJsonBody } from "../server/claudeGroundedExecutionCore.js";
import {
  getKeyUploadEntryMode,
  KEY_UPLOAD_ENTRY_MODES,
} from "../server/keyBrain/uploadEntryFlags.js";
import {
  createUserSupabaseClient,
  readCustomerAuthHeader,
  requireCustomerAuth,
} from "../server/requireCustomerAuth.js";
import {
  resolveOneKeyCoreDocumentEnv,
  runOneKeyCoreTurn,
} from "../server/keyCore/oneKeyCoreTurn.js";

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
  // Customer path: off/shadow fail-closed (no legacy factory skip).
  if (mode !== KEY_UPLOAD_ENTRY_MODES.ACTIVE) {
    res.statusCode = 409;
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        ok: false,
        mode,
        reason: "key_upload_entry_not_active",
        intake_skipped: false,
      }),
    );
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
  const responseMode = mode === KEY_UPLOAD_ENTRY_MODES.ACTIVE ? "active" : "shadow";
  const customerQuestion = String(body.question ?? body.customer_question ?? "").trim();

  const coreResult = await runOneKeyCoreTurn({
    event: "document",
    userSupabase: supabase,
    customerId: auth.customerId,
    document,
    hasAnalysisConsent,
    uploadSource: String(body.upload_source ?? "web"),
    categoryKey: body.category_key ?? null,
    uploadEntryMode: mode,
    customerQuestion,
    env: resolveOneKeyCoreDocumentEnv(process.env),
  });

  if (!coreResult.ok) {
    res.statusCode = 500;
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        ok: false,
        reason: coreResult.reason ?? "one_key_core_document_failed",
        error_message: coreResult.error_message ?? null,
        one_key_core_trace: coreResult.one_key_core_trace ?? null,
      }),
    );
    return;
  }

  const resolvedTrace = coreResult.intakeTrace;
  res.statusCode = 200;
  res.setHeader("Content-Type", "application/json");
  res.end(
    JSON.stringify({
      ok: true,
      mode: responseMode,
      subject: "KEY",
      document_id: documentId,
      response_source: coreResult.response_source,
      one_key_core_event: "document",
      key_speak_master: true,
      intake_trace: resolvedTrace,
      key_first_judgment: resolvedTrace.key_first_judgment ?? null,
      customer_first_sentence: resolvedTrace.customer_first_sentence ?? null,
      persona_outlet: resolvedTrace.persona_outlet ?? "keySpeak(key_master)",
      work_order_id: coreResult.workOrderId ?? null,
      work_order_ordered_by: coreResult.workOrderId ? "KEY" : null,
      factory_executed: false,
      customer_speak_changed: Boolean(resolvedTrace.customer_speak_changed),
    }),
  );
}
