/**
 * Document policy extraction → full analysis pipeline refresh (all customers).
 */
import { createClient } from "@supabase/supabase-js";
import {
  ANALYSIS_PIPELINE_STAGES,
  loadAnalysisJob,
  runAnalysisJobToCompletion,
} from "./backgroundAnalysisJobRunner.js";
import { loadCustomerAnalysisCachePayload } from "./customerAnalysisCacheStore.js";
import { mapAnalysisJobForClient } from "./conversationalBackgroundAnalysisCore.js";
import { ensureCustomerMemoryContext } from "./customerMemoryContextSync.js";
const DOCUMENT_REFRESH_FAST_RESPONSE =
  "문서를 반영해 보장 상태를 갱신하고 있습니다.";
import { resolveSupabaseConfig } from "./policyTermsQaCore.js";

const DOCUMENT_REFRESH_QUESTION = "문서 업로드 후 보장·인수·추천·설계를 자동 갱신합니다.";

const PANEL_STAGE_KEYS = [
  "coverage_gap",
  "underwriting_risk",
  "recommendation",
  "insurance_design",
];

function createUserSupabaseClient(authHeader, env = process.env) {
  const { url, anonKey } = resolveSupabaseConfig(env);
  if (!url || !anonKey) return null;
  const token = String(authHeader ?? "").replace(/^Bearer\s+/i, "").trim();
  return createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: token ? { Authorization: `Bearer ${token}` } : {} },
  });
}

function createServiceRoleSupabaseClient(env = process.env) {
  const url = String(env.SUPABASE_URL ?? env.VITE_SUPABASE_URL ?? "").trim();
  const serviceRoleKey = String(env.SERVICE_ROLE_KEY ?? env.SUPABASE_SERVICE_ROLE_KEY ?? "").trim();
  if (!url || !serviceRoleKey) return null;
  return createClient(url, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
}

async function resolveCustomerId(supabase) {
  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError || !authData?.user) {
    return { ok: false, reason: "UNAUTHORIZED", error_message: "Authentication required." };
  }
  const { data: profile, error: profileError } = await supabase
    .from("customer_profiles")
    .select("id")
    .eq("user_id", authData.user.id)
    .maybeSingle();
  if (profileError || !profile?.id) {
    return { ok: false, reason: "CUSTOMER_PROFILE_NOT_FOUND", error_message: "Customer profile not found." };
  }
  return { ok: true, customerId: profile.id };
}

function buildPanelStageStatus(job) {
  const stagesCompleted = Array.isArray(job?.stages_completed) ? job.stages_completed : [];
  const resultJson = job?.result_json ?? {};
  const status = {};

  for (const stage of PANEL_STAGE_KEYS) {
    const hasResult = Boolean(resultJson[stage]);
    status[stage] = {
      completed: stagesCompleted.includes(stage),
      ok: stagesCompleted.includes(stage) && hasResult,
      error_message:
        job?.status === "failed" && job?.current_step === stage ? job.error_message ?? null : null,
    };
  }

  return status;
}

export async function handleDocumentPolicyAnalysisRefreshRequest({
  authHeader,
  documentId = null,
  env = process.env,
  adminSupabase = null,
  fetchImpl = fetch,
} = {}) {
  const userSupabase = createUserSupabaseClient(authHeader, env);
  if (!userSupabase) {
    return { ok: false, reason: "SUPABASE_NOT_CONFIGURED", error_message: "Supabase is not configured." };
  }

  const resolved = await resolveCustomerId(userSupabase);
  if (!resolved.ok) return resolved;

  const customerId = resolved.customerId;
  const adminClient = adminSupabase ?? createServiceRoleSupabaseClient(env);
  if (!adminClient) {
    return {
      ok: false,
      reason: "SERVICE_ROLE_NOT_CONFIGURED",
      error_message: "Service role client unavailable.",
    };
  }

  const trimmedDocumentId = String(documentId ?? "").trim() || null;
  let memoryContext = null;
  let memorySync = { ok: true, synced: false, reason: "skipped" };

  try {
    memoryContext = await ensureCustomerMemoryContext({
      supabase: adminClient,
      customerId,
      supabaseUrl: String(env.SUPABASE_URL ?? env.VITE_SUPABASE_URL ?? "").trim() || null,
      serviceRoleKey: String(env.SERVICE_ROLE_KEY ?? env.SUPABASE_SERVICE_ROLE_KEY ?? "").trim() || null,
      forceRebuild: false,
    });
    memorySync = {
      ok: memoryContext.memory_sync_status !== "failed",
      synced: memoryContext.memory_synced ?? false,
      status: memoryContext.memory_sync_status ?? "ready",
      reason: memoryContext.sync_assessment?.reason ?? null,
      error: memoryContext.memory_sync_error ?? null,
      memory_version: memoryContext.snapshot?.memory_version ?? 0,
      memory_fact_count: memoryContext.snapshot?.fact_count ?? 0,
      rebuild_summary: memoryContext.rebuild_summary ?? null,
    };
  } catch (error) {
    memorySync = {
      ok: false,
      synced: false,
      reason: "memory_sync_failed",
      error_message: error instanceof Error ? error.message : "memory_sync_failed",
      memory_version: 0,
      memory_fact_count: 0,
    };
    memoryContext = {
      snapshot: { memory_version: 0, fact_count: 0 },
      sourceContext: {},
      sourceSummary: {},
    };
  }

  const snapshot = memoryContext.snapshot;
  const cachePayload = await loadCustomerAnalysisCachePayload(
    adminClient,
    customerId,
    snapshot?.memory_version ?? 0,
  );

  const fastResponse = DOCUMENT_REFRESH_FAST_RESPONSE;

  const { data: jobRow, error: jobError } = await adminClient
    .from("analysis_jobs")
    .insert({
      customer_id: customerId,
      conversation_message_id: null,
      question: DOCUMENT_REFRESH_QUESTION,
      status: "queued",
      fast_response_text: fastResponse,
      source_memory_version: snapshot?.memory_version ?? 0,
      timing_metrics: { trigger_source: "document_policy_extraction" },
      result_json: {
        trigger_source: "document_policy_extraction",
        document_id: trimmedDocumentId,
        working_context: {
          trigger_source: "document_policy_extraction",
          document_id: trimmedDocumentId,
        },
      },
      stages_completed: [],
    })
    .select("*")
    .single();

  if (jobError || !jobRow) {
    return {
      ok: false,
      reason: "JOB_CREATE_FAILED",
      error_message: jobError?.message ?? "job_create_failed",
      memory_sync: memorySync,
    };
  }

  const processResult = await runAnalysisJobToCompletion({
    supabase: adminClient,
    jobId: jobRow.id,
    fetchImpl,
    env,
  });

  const latestJob = processResult?.job ?? (await loadAnalysisJob(adminClient, jobRow.id));
  const panelStages = buildPanelStageStatus(latestJob);
  const requiredPanelsOk = PANEL_STAGE_KEYS.every((stage) => panelStages[stage]?.ok);

  return {
    ok: latestJob?.status === "completed" && requiredPanelsOk,
    customer_id: customerId,
    document_id: trimmedDocumentId,
    analysis_job_id: jobRow.id,
    analysis_job: mapAnalysisJobForClient(latestJob),
    memory_sync: memorySync,
    panel_stages: panelStages,
    process_result: processResult,
    pipeline_stages: ANALYSIS_PIPELINE_STAGES,
    error_message:
      latestJob?.status === "failed"
        ? latestJob.error_message ?? "analysis_job_failed"
        : requiredPanelsOk
          ? null
          : "panel_results_incomplete",
  };
}
