/**
 * P5-C — POST /api/key-return-judgment-intake
 * KEY Master only — runOneKeyCoreTurn({ event: "return_judgment" }).
 */

import { readJsonBody } from "../server/claudeGroundedExecutionCore.js";
import {
  computeGapHours,
  KEY_BRIDGE_ANCHOR_WINDOW_MS,
  KEY_BRIDGE_GAP_MIN_HOURS,
  resolveBridgeAnchorJobId,
  threadHasKeyBridgeRow,
} from "../server/keyBrain/bridgeIntakeGate.js";
import {
  evaluateReturnJudgmentEmitGate,
  hasSameDayReturnJudgmentForAnchor,
  threadHasReturnJudgmentRow,
} from "../server/keyBrain/returnJudgmentIntakeGate.js";
import { buildKeyReturnJudgmentIntakeShadowTrace } from "../server/keyBrain/returnJudgmentIntakeShadow.js";
import { jobHasPanelResults } from "../server/keyBrain/returnJudgmentFirstSpeak.js";
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
import { KEY_ENTRY } from "../server/salesDirectorKeyOrchestrator.js";
import {
  resolveOneKeyCoreReturnJudgmentEnv,
  runOneKeyCoreTurn,
} from "../server/keyCore/oneKeyCoreTurn.js";

const JOB_SELECT =
  "id, customer_id, status, completed_at, result_json, stages_completed, created_at, updated_at";
const CONVERSATION_SELECT = "id, role, message, metadata_json, created_at";

function rowMetadata(row) {
  return row?.metadata_json ?? row?.metadata ?? {};
}

function filterSessionRows(rows, sessionId) {
  return (rows ?? []).filter((row) => String(rowMetadata(row).session_id) === String(sessionId));
}

function resolveLastActivityAt(sessionRows) {
  let latest = null;
  for (const row of sessionRows ?? []) {
    const at = row?.created_at ?? row?.createdAt;
    if (!at) continue;
    if (!latest || new Date(at).getTime() > new Date(latest).getTime()) {
      latest = at;
    }
  }
  return latest;
}

function sessionHasKeyPresence(sessionRows) {
  return (sessionRows ?? []).some((row) => rowMetadata(row).key_presence === true);
}

async function loadCustomerConversationRows(supabase, customerId, { limit = 500 } = {}) {
  const { data, error } = await supabase
    .from("customer_conversations")
    .select(CONVERSATION_SELECT)
    .eq("customer_id", customerId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) throw new Error(error.message ?? "conversation_load_failed");
  return data ?? [];
}

async function resolveAnchorAnalysisJob(supabase, customerId, sessionRows, preferredJobId = null) {
  const nowMs = Date.now();
  const windowStartMs = nowMs - KEY_BRIDGE_ANCHOR_WINDOW_MS;

  const tryJob = async (jobId) => {
    if (!jobId) return null;
    const { data, error } = await supabase
      .from("analysis_jobs")
      .select(JOB_SELECT)
      .eq("id", jobId)
      .eq("customer_id", customerId)
      .maybeSingle();
    if (error || !data) return null;
    if (data.status !== "completed") return null;
    const completedAt = data.completed_at ?? data.updated_at ?? data.created_at;
    if (!completedAt) return null;
    if (new Date(completedAt).getTime() < windowStartMs) return null;
    return data;
  };

  const fromSession = resolveBridgeAnchorJobId(sessionRows, preferredJobId);
  const primary = await tryJob(fromSession);
  if (primary) return primary;

  const { data: latestJobs, error } = await supabase
    .from("analysis_jobs")
    .select(JOB_SELECT)
    .eq("customer_id", customerId)
    .eq("status", "completed")
    .order("completed_at", { ascending: false })
    .limit(5);

  if (error || !latestJobs?.length) return null;

  for (const job of latestJobs) {
    const completedAt = job.completed_at ?? job.updated_at ?? job.created_at;
    if (!completedAt) continue;
    if (new Date(completedAt).getTime() >= windowStartMs) return job;
  }
  return null;
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

  const sessionId = String(body.session_id ?? "").trim();
  if (!sessionId) {
    res.statusCode = 422;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ ok: false, reason: "session_id_required" }));
    return;
  }

  const transitionObservedAt = body.transition_observed_at ?? new Date().toISOString();
  const now = new Date(transitionObservedAt);
  const activeAuthority = isKeyUploadEntryActiveEnabled(process.env);

  let allRows = [];
  try {
    allRows = await loadCustomerConversationRows(supabase, auth.customerId);
  } catch {
    res.statusCode = 500;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ ok: false, reason: "conversation_load_failed" }));
    return;
  }

  const sessionRows = filterSessionRows(allRows, sessionId);
  const lastActivityAt = resolveLastActivityAt(sessionRows);
  const gapHours = computeGapHours(lastActivityAt, now);
  const hasThreadMessages = sessionRows.length > 0 && sessionHasKeyPresence(sessionRows);
  const hasBridgeInSession = threadHasKeyBridgeRow(sessionRows);
  const hasReturnJudgmentInSession = threadHasReturnJudgmentRow(sessionRows);

  const anchorJob = await resolveAnchorAnalysisJob(
    supabase,
    auth.customerId,
    sessionRows,
    body.anchor_job_id ?? null,
  );
  const anchorJobId = anchorJob?.id ?? null;
  const panelResultsPresent = jobHasPanelResults(anchorJob);
  const sameDayReturnJudgment = hasSameDayReturnJudgmentForAnchor(sessionRows, anchorJobId, now);

  const gate = evaluateReturnJudgmentEmitGate({
    gapHours,
    hasThreadMessages,
    hasBridgeInSession,
    hasAnchor: Boolean(anchorJobId),
    hasReturnJudgmentInSession,
    sameDayAnchorReturnJudgment: sameDayReturnJudgment,
    uploadEntryActive: activeAuthority,
    panelResultsPresent,
  });

  const intakeTrace = buildKeyReturnJudgmentIntakeShadowTrace({
    sessionId,
    gapHours,
    anchorJobId,
    keyRuntimeEntered: false,
    keyEntry: KEY_ENTRY.RETURN_JUDGMENT,
    gate,
  });

  if (!gate.emit) {
    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        ok: true,
        mode: mode === KEY_UPLOAD_ENTRY_MODES.ACTIVE ? "active" : "shadow",
        return_judgment_skipped: true,
        skip_reasons: gate.reasons,
        gap_hours: gapHours,
        gap_min_hours: KEY_BRIDGE_GAP_MIN_HOURS,
        session_id: sessionId,
        anchor_job_id: anchorJobId,
        intake_trace: intakeTrace,
      }),
    );
    return;
  }

  const responseMode = mode === KEY_UPLOAD_ENTRY_MODES.ACTIVE ? "active" : "shadow";

  if (!activeAuthority) {
    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        ok: true,
        mode: responseMode,
        return_judgment_skipped: true,
        skip_reasons: ["upload_entry_inactive"],
        session_id: sessionId,
        anchor_job_id: anchorJobId,
        intake_trace: intakeTrace,
      }),
    );
    return;
  }

  const coreResult = await runOneKeyCoreTurn({
    event: "return_judgment",
    userSupabase: supabase,
    customerId: auth.customerId,
    sessionId,
    analysisJob: anchorJob,
    gapHours,
    gate,
    transitionObservedAt,
    env: resolveOneKeyCoreReturnJudgmentEnv(process.env),
  });

  if (!coreResult.ok) {
    if (coreResult.reason === "forbidden_speech_guard") {
      res.statusCode = 200;
      res.setHeader("Content-Type", "application/json");
      res.end(
        JSON.stringify({
          ok: true,
          mode: responseMode,
          return_judgment_skipped: true,
          skip_reasons: ["forbidden_speech_guard"],
          session_id: sessionId,
          anchor_job_id: anchorJobId,
          intake_trace: coreResult.intakeTrace ?? intakeTrace,
        }),
      );
      return;
    }

    res.statusCode = 500;
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        ok: false,
        reason: coreResult.reason ?? "one_key_core_return_judgment_failed",
        error_message: coreResult.error_message ?? null,
        one_key_core_trace: coreResult.oneKeyCoreTrace ?? null,
      }),
    );
    return;
  }

  res.statusCode = 200;
  res.setHeader("Content-Type", "application/json");
  res.end(
    JSON.stringify({
      ok: true,
      mode: responseMode,
      subject: "KEY",
      key_entry: KEY_ENTRY.RETURN_JUDGMENT,
      session_id: sessionId,
      anchor_job_id: anchorJobId,
      gap_hours: gapHours,
      return_judgment_sentence: coreResult.returnJudgmentSentence,
      persona_outlet: "keySpeak(key_master)",
      key_speak_master: true,
      key_first_judgment: coreResult.keyFirstJudgment,
      intake_trace: coreResult.intakeTrace,
      response_source: coreResult.response_source,
      one_key_core_event: "return_judgment",
      work_order_id: null,
    }),
  );
}
