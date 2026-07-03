/**
 * KU-1 — POST /api/key-document-intake
 * KU-2a+2b+2c — active: unified KEY upload authority (judgment + speak + Work Order gate).
 */

import { readJsonBody } from "../server/claudeGroundedExecutionCore.js";
import {
  buildLoadedContextFromSnapshot,
  loadSalesDirectorTurnContext,
  snapshotToContextBundle,
} from "../server/customerContextSnapshot.js";
import { buildKeyDocumentIntakeShadowTrace } from "../server/keyBrain/documentIntakeShadow.js";
import {
  appendKeyFirstSpeakTrace,
  buildCustomerFirstSentence,
} from "../server/keyBrain/documentFirstSpeak.js";
import {
  KEY_ENTRY,
  runSalesDirectorKeyTurn,
} from "../server/salesDirectorKeyOrchestrator.js";
import {
  getKeyUploadEntryMode,
  isKeyUploadEntryActiveEnabled,
  KEY_UPLOAD_ACTIVE_GATE,
  KEY_UPLOAD_ENTRY_MODES,
} from "../server/keyBrain/uploadEntryFlags.js";
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
  const activeAuthority = isKeyUploadEntryActiveEnabled(process.env);

  let contextSnapshot = null;
  let loadedContext = null;
  let snapshotFromCache = false;
  let unifiedState = null;
  try {
    const turnContext = await loadSalesDirectorTurnContext(supabase, auth.customerId, {
      requestHistory: [],
    });
    contextSnapshot = turnContext.snapshot;
    unifiedState = turnContext.unifiedState;
    loadedContext = buildLoadedContextFromSnapshot(contextSnapshot);
    snapshotFromCache = turnContext.from_cache === true;
  } catch {
    res.statusCode = 500;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ ok: false, reason: "context_snapshot_load_failed" }));
    return;
  }

  let keyRuntimeEntered = false;
  if (activeAuthority) {
    const customerContextBundle = snapshotToContextBundle(contextSnapshot) ?? {};
    const keyTurn = await runSalesDirectorKeyTurn({
      userSupabase: supabase,
      customerId: auth.customerId,
      question: "",
      keyEntry: KEY_ENTRY.DOCUMENT_INTAKE,
      document,
      hasAnalysisConsent,
      snapshot: contextSnapshot,
      unified: unifiedState,
      loadedContext,
      customerContextBundle,
      reconciliationWarning: null,
      env: process.env,
    });

    if (!keyTurn?.handled || !keyTurn.result) {
      res.statusCode = 500;
      res.setHeader("Content-Type", "application/json");
      res.end(
        JSON.stringify({
          ok: false,
          reason: "key_runtime_failed",
          detail: keyTurn?.reason ?? "runSalesDirectorKeyTurn_not_handled",
        }),
      );
      return;
    }
    keyRuntimeEntered = true;
  }

  const intakeTrace = buildKeyDocumentIntakeShadowTrace({
    document,
    hasAnalysisConsent,
    uploadSource: String(body.upload_source ?? "web"),
    categoryKey: body.category_key ?? null,
    includeFirstJudgment: activeAuthority,
    loadedContext,
    contextSnapshot,
    snapshotFromCache,
    keyRuntimeEntered,
    keyEntry: KEY_ENTRY.DOCUMENT_INTAKE,
  });

  let customerFirstSentence = null;
  if (activeAuthority && intakeTrace.key_first_judgment) {
    customerFirstSentence = buildCustomerFirstSentence(intakeTrace.key_first_judgment, { document });
  }
  let resolvedTrace = customerFirstSentence
    ? appendKeyFirstSpeakTrace(intakeTrace, customerFirstSentence)
    : intakeTrace;

  const responseMode = mode === KEY_UPLOAD_ENTRY_MODES.ACTIVE ? "active" : "shadow";
  let workOrderId = null;

  if (mode === KEY_UPLOAD_ENTRY_MODES.ACTIVE) {
    workOrderId = mintKeyWorkOrderId();
    const workOrderRecord = buildKeyWorkOrderRecord({
      workOrderId,
      customerId: auth.customerId,
      documentId,
      dispatchPlan: resolvedTrace.dispatch_plan,
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

    resolvedTrace.gate = KEY_UPLOAD_ACTIVE_GATE;
    resolvedTrace.work_order = workOrderRecord;
    resolvedTrace.trace_steps = [
      ...(resolvedTrace.trace_steps ?? []),
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
      intake_trace: resolvedTrace,
      key_first_judgment: resolvedTrace.key_first_judgment ?? null,
      customer_first_sentence: resolvedTrace.customer_first_sentence ?? null,
      work_order_id: workOrderId,
      work_order_ordered_by: workOrderId ? "KEY" : null,
      factory_executed: false,
      customer_speak_changed: Boolean(resolvedTrace.customer_speak_changed),
    }),
  );
}
