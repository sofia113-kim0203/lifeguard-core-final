/**
 * P4 — POST /api/key-analysis-complete-intake
 * Session transition → KEY_ENTRY.ANALYSIS_COMPLETE → runSalesDirectorKeyTurn → initiative Speech.
 * S02-2 — ONE_KEY_CORE_ANALYSIS_COMPLETE=1 → runOneKeyCoreTurn({ event: "analysis_complete" }).
 */

import { readJsonBody } from "../server/claudeGroundedExecutionCore.js";
import {
  appendAnalysisCompleteInitiativeSpeakTrace,
  buildKeyAnalysisCompleteIntakeShadowTrace,
} from "../server/keyBrain/analysisCompleteIntakeShadow.js";
import {
  resolveAnalysisCompleteInitiativeSentence,
} from "../server/keyBrain/analysisCompleteFirstSpeak.js";
import {
  buildLoadedContextFromSnapshot,
  loadSalesDirectorTurnContext,
  snapshotToContextBundle,
} from "../server/customerContextSnapshot.js";
import {
  KEY_ENTRY,
  runSalesDirectorKeyTurn,
} from "../server/salesDirectorKeyOrchestrator.js";
import {
  getKeyUploadEntryMode,
  isKeyUploadEntryActiveEnabled,
  KEY_UPLOAD_ENTRY_MODES,
} from "../server/keyBrain/uploadEntryFlags.js";
import {
  createUserSupabaseClient,
  readCustomerAuthHeader,
  requireCustomerAuth,
} from "../server/requireCustomerAuth.js";
import {
  isOneKeyCoreAnalysisCompleteEnabled,
  runOneKeyCoreTurn,
} from "../server/keyCore/oneKeyCoreTurn.js";

const JOB_SELECT =
  "id, customer_id, status, completed_at, result_json, stages_completed, created_at, updated_at";

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

  const jobId = String(body.job_id ?? "").trim();
  if (!jobId) {
    res.statusCode = 422;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ ok: false, reason: "job_id_required" }));
    return;
  }

  const { data: analysisJob, error: jobError } = await supabase
    .from("analysis_jobs")
    .select(JOB_SELECT)
    .eq("id", jobId)
    .eq("customer_id", auth.customerId)
    .maybeSingle();

  if (jobError) {
    res.statusCode = 500;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ ok: false, reason: "job_lookup_failed" }));
    return;
  }

  if (!analysisJob) {
    res.statusCode = 404;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ ok: false, reason: "job_not_found" }));
    return;
  }

  if (analysisJob.status !== "completed") {
    res.statusCode = 422;
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        ok: false,
        reason: "job_not_completed",
        status: analysisJob.status ?? null,
      }),
    );
    return;
  }

  const activeAuthority = isKeyUploadEntryActiveEnabled(process.env);
  const transitionObservedAt = body.transition_observed_at ?? null;
  const responseMode = mode === KEY_UPLOAD_ENTRY_MODES.ACTIVE ? "active" : "shadow";

  if (isOneKeyCoreAnalysisCompleteEnabled(process.env)) {
    const coreResult = await runOneKeyCoreTurn({
      event: "analysis_complete",
      userSupabase: supabase,
      customerId: auth.customerId,
      analysisJob,
      transitionObservedAt,
      env: process.env,
    });

    if (!coreResult.ok) {
      res.statusCode = 500;
      res.setHeader("Content-Type", "application/json");
      res.end(
        JSON.stringify({
          ok: false,
          reason: coreResult.reason ?? "one_key_core_analysis_complete_failed",
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
        key_entry: KEY_ENTRY.ANALYSIS_COMPLETE,
        job_id: jobId,
        response_source: coreResult.response_source,
        one_key_core_event: "analysis_complete",
        intake_trace: resolvedTrace,
        key_first_judgment: resolvedTrace.key_first_judgment ?? null,
        customer_initiative_sentence: resolvedTrace.customer_initiative_sentence ?? null,
        persona_outlet: resolvedTrace.persona_outlet ?? null,
        customer_speak_changed: Boolean(resolvedTrace.customer_speak_changed),
        work_order_id: null,
      }),
    );
    return;
  }

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
  let keyTurnResult = null;
  if (activeAuthority) {
    const customerContextBundle = snapshotToContextBundle(contextSnapshot) ?? {};
    const keyTurn = await runSalesDirectorKeyTurn({
      userSupabase: supabase,
      customerId: auth.customerId,
      question: "",
      keyEntry: KEY_ENTRY.ANALYSIS_COMPLETE,
      analysisJob,
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
    keyTurnResult = keyTurn.result;
    keyRuntimeEntered = true;
  }

  let intakeTrace = buildKeyAnalysisCompleteIntakeShadowTrace({
    analysisJob,
    loadedContext,
    contextSnapshot,
    snapshotFromCache,
    keyRuntimeEntered,
    keyEntry: KEY_ENTRY.ANALYSIS_COMPLETE,
    transitionObservedAt,
  });

  let customerInitiativeSentence = null;
  let personaMeta = null;
  if (activeAuthority && intakeTrace.key_first_judgment) {
    const finalized = resolveAnalysisCompleteInitiativeSentence({
      keyTurnResult,
      analysisJob,
      loadedContext,
    });
    if (finalized?.text) {
      customerInitiativeSentence = finalized.text;
      personaMeta = finalized;
      intakeTrace = appendAnalysisCompleteInitiativeSpeakTrace(
        intakeTrace,
        customerInitiativeSentence,
        personaMeta,
      );
    }
  }

  res.statusCode = 200;
  res.setHeader("Content-Type", "application/json");
  res.end(
    JSON.stringify({
      ok: true,
      mode: responseMode,
      subject: "KEY",
      key_entry: KEY_ENTRY.ANALYSIS_COMPLETE,
      job_id: jobId,
      intake_trace: intakeTrace,
      key_first_judgment: intakeTrace.key_first_judgment ?? null,
      customer_initiative_sentence: customerInitiativeSentence,
      persona_outlet: intakeTrace.persona_outlet ?? null,
      customer_speak_changed: Boolean(intakeTrace.customer_speak_changed),
    }),
  );
}
