/**
 * P4 — POST /api/key-analysis-complete-intake
 * KEY Master only — runOneKeyCoreTurn({ event: "analysis_complete" }).
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
import { KEY_ENTRY } from "../server/salesDirectorKeyOrchestrator.js";
import {
  resolveOneKeyCoreAnalysisCompleteEnv,
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

  const transitionObservedAt = body.transition_observed_at ?? null;
  const responseMode = mode === KEY_UPLOAD_ENTRY_MODES.ACTIVE ? "active" : "shadow";

  const coreResult = await runOneKeyCoreTurn({
    event: "analysis_complete",
    userSupabase: supabase,
    customerId: auth.customerId,
    analysisJob,
    transitionObservedAt,
    env: resolveOneKeyCoreAnalysisCompleteEnv(process.env),
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
      key_speak_master: true,
      intake_trace: resolvedTrace,
      key_first_judgment: resolvedTrace.key_first_judgment ?? null,
      customer_initiative_sentence: resolvedTrace.customer_initiative_sentence ?? null,
      persona_outlet: "keySpeak(key_master)",
      customer_speak_changed: Boolean(resolvedTrace.customer_speak_changed),
      work_order_id: null,
    }),
  );
}
