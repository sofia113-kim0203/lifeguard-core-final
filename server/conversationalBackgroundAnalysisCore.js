/**
 * Phase 26 Step 2A — Conversational Background Analysis orchestration.
 */
import { createClient } from "@supabase/supabase-js";
import { loadCustomerMemorySnapshot } from "./customerMemorySnapshot.js";
import { buildFastConversationalResponse } from "./fastResponseLayer.js";
import { loadCustomerAnalysisCachePayload } from "./customerAnalysisCacheStore.js";
import {
  ANALYSIS_PIPELINE_STAGES,
  loadAnalysisJob,
  processNextAnalysisJobStage,
  runAnalysisJobToCompletion,
} from "./backgroundAnalysisJobRunner.js";
import { resolveSupabaseConfig } from "./policyTermsQaCore.js";

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


async function postResultMessageIfNeeded(adminClient, customerId, job) {
  if (!job?.final_response_text) return null;
  if (job.result_json?.result_message_posted) return null;

  const message = await insertConversationMessage(adminClient, customerId, {
    role: "assistant",
    message: job.final_response_text,
    metadata: {
      source: "conversational_background_analysis",
      phase: "phase26-2a-result",
      analysis_job_id: job.id,
      connected_to_analysis: true,
      timing_metrics: job.timing_metrics ?? {},
    },
  });

  await adminClient
    .from("analysis_jobs")
    .update({
      result_json: { ...(job.result_json ?? {}), result_message_posted: true },
      updated_at: new Date().toISOString(),
    })
    .eq("id", job.id);

  return message;
}


async function insertConversationMessage(adminSupabase, customerId, { role, message, metadata = {} }) {
  const { data, error } = await adminSupabase
    .from("customer_conversations")
    .insert({
      customer_id: customerId,
      role,
      message: String(message ?? "").trim(),
      metadata_json: metadata,
    })
    .select("id, customer_id, role, message, metadata_json, created_at")
    .single();

  if (error) {
    throw new Error(`conversation_insert_failed: ${error.message}`);
  }
  return data;
}

export function mapAnalysisJobForClient(job) {
  if (!job) return null;
  const stagesCompleted = Array.isArray(job.stages_completed) ? job.stages_completed : [];
  const progress = ANALYSIS_PIPELINE_STAGES.map((stage) => ({
    stage,
    status: stagesCompleted.includes(stage)
      ? "completed"
      : job.current_step === stage
        ? "processing"
        : "pending",
    label:
      job.result_json?.stage_labels?.[stage] ??
      (stage === "coverage_gap"
        ? "Coverage 분석"
        : stage === "underwriting_risk"
          ? "Underwriting 분석"
          : stage === "recommendation"
            ? "Recommendation 생성"
            : stage === "insurance_design"
              ? "보험설계 생성"
              : "결과 설명"),
  }));

  return {
    id: job.id,
    customer_id: job.customer_id,
    conversation_message_id: job.conversation_message_id,
    question: job.question,
    status: job.status,
    current_step: job.current_step,
    stages_completed: stagesCompleted,
    progress,
    timing_metrics: job.timing_metrics ?? {},
    fast_response_text: job.fast_response_text,
    final_response_text: job.final_response_text,
    result_json: job.result_json ?? {},
    error_message: job.error_message,
    source_memory_version: job.source_memory_version,
    created_at: job.created_at,
    updated_at: job.updated_at,
    started_at: job.started_at,
    completed_at: job.completed_at,
  };
}

export async function handleConversationalQuestionRequest({
  question,
  authHeader,
  env = process.env,
  adminSupabase = null,
  testCustomerId = null,
  autoProcess = false,
  fetchImpl = fetch,
} = {}) {
  const startedAt = Date.now();
  const trimmedQuestion = String(question ?? "").trim();
  if (!trimmedQuestion) {
    return { ok: false, reason: "QUESTION_REQUIRED", error_message: "question is required." };
  }

  let customerId = String(testCustomerId ?? "").trim() || null;
  let userSupabase = null;

  if (!customerId) {
    userSupabase = createUserSupabaseClient(authHeader, env);
    if (!userSupabase) {
      return { ok: false, reason: "SUPABASE_NOT_CONFIGURED", error_message: "Supabase is not configured." };
    }
    const resolved = await resolveCustomerId(userSupabase);
    if (!resolved.ok) return resolved;
    customerId = resolved.customerId;
  }

  const adminClient = adminSupabase ?? createServiceRoleSupabaseClient(env);
  if (!adminClient) {
    return { ok: false, reason: "SERVICE_ROLE_NOT_CONFIGURED", error_message: "Service role client unavailable." };
  }

  const snapshot = await loadCustomerMemorySnapshot(adminClient, customerId);
  const cachePayload = await loadCustomerAnalysisCachePayload(
    adminClient,
    customerId,
    snapshot.memory_version ?? 0,
  );

  const fastResponse = buildFastConversationalResponse({
    question: trimmedQuestion,
    memorySnapshot: snapshot,
    cachePayload,
  });

  const userMessage = await insertConversationMessage(adminClient, customerId, {
    role: "user",
    message: trimmedQuestion,
    metadata: { source: "customer_dashboard", phase: "phase26-2a" },
  });

  const { data: jobRow, error: jobError } = await adminClient
    .from("analysis_jobs")
    .insert({
      customer_id: customerId,
      conversation_message_id: userMessage.id,
      question: trimmedQuestion,
      status: "queued",
      fast_response_text: fastResponse,
      source_memory_version: snapshot.memory_version ?? 0,
      timing_metrics: {},
      result_json: {},
      stages_completed: [],
    })
    .select("*")
    .single();

  if (jobError) {
    return {
      ok: false,
      reason: "JOB_CREATE_FAILED",
      error_message: jobError.message,
    };
  }

  const initialResponseTimeMs = Date.now() - startedAt;

  await adminClient
    .from("analysis_jobs")
    .update({
      timing_metrics: { initial_response_time_ms: initialResponseTimeMs },
      updated_at: new Date().toISOString(),
    })
    .eq("id", jobRow.id);

  const assistantMessage = await insertConversationMessage(adminClient, customerId, {
    role: "assistant",
    message: fastResponse,
    metadata: {
      source: "conversational_background_analysis",
      phase: "phase26-2a-fast",
      analysis_job_id: jobRow.id,
      memory_version: snapshot.memory_version ?? 0,
      memory_fact_count: snapshot.fact_count ?? 0,
      cache_status: cachePayload.cache_status,
      background_refresh_types: cachePayload.background_refresh_types,
      initial_response_time_ms: initialResponseTimeMs,
    },
  });

  let processingResult = null;
  if (autoProcess) {
    processingResult = await runAnalysisJobToCompletion({
      supabase: adminClient,
      jobId: jobRow.id,
      fetchImpl,
      env,
    });

    const completedJob = processingResult?.job ?? (await loadAnalysisJob(adminClient, jobRow.id));
    await postResultMessageIfNeeded(adminClient, customerId, completedJob);
  }

  const latestJob = await loadAnalysisJob(adminClient, jobRow.id);

  return {
    ok: true,
    customer_id: customerId,
    question: trimmedQuestion,
    fast_response: fastResponse,
    initial_response_time_ms: initialResponseTimeMs,
    analysis_job_id: jobRow.id,
    analysis_job: mapAnalysisJobForClient(latestJob),
    user_message_id: userMessage.id,
    assistant_message_id: assistantMessage.id,
    cache_status: cachePayload.cache_status,
    background_refresh_required: cachePayload.background_refresh_required,
    background_refresh_types: cachePayload.background_refresh_types,
    memory_version: snapshot.memory_version ?? 0,
    memory_fact_count: snapshot.fact_count ?? 0,
    processing: processingResult ?? null,
  };
}

export async function handleAnalysisJobStatusRequest({
  jobId,
  authHeader,
  action = "status",
  env = process.env,
  adminSupabase = null,
  testCustomerId = null,
  fetchImpl = fetch,
} = {}) {
  const trimmedJobId = String(jobId ?? "").trim();
  if (!trimmedJobId) {
    return { ok: false, reason: "JOB_ID_REQUIRED", error_message: "job_id is required." };
  }

  let customerId = String(testCustomerId ?? "").trim() || null;
  let userSupabase = null;

  if (!customerId) {
    userSupabase = createUserSupabaseClient(authHeader, env);
    if (!userSupabase) {
      return { ok: false, reason: "SUPABASE_NOT_CONFIGURED", error_message: "Supabase is not configured." };
    }
    const resolved = await resolveCustomerId(userSupabase);
    if (!resolved.ok) return resolved;
    customerId = resolved.customerId;
  }

  const adminClient = adminSupabase ?? createServiceRoleSupabaseClient(env) ?? userSupabase;
  if (!adminClient) {
    return { ok: false, reason: "SUPABASE_CLIENT_NOT_AVAILABLE", error_message: "Supabase client unavailable." };
  }

  const job = await loadAnalysisJob(adminClient, trimmedJobId);
  if (!job) {
    return { ok: false, reason: "JOB_NOT_FOUND", error_message: "Analysis job not found." };
  }
  if (job.customer_id !== customerId) {
    return { ok: false, reason: "FORBIDDEN", error_message: "Job does not belong to customer." };
  }

  let processResult = null;
  if (action === "process" && job.status !== "completed" && job.status !== "failed") {
    processResult = await processNextAnalysisJobStage({
      supabase: adminClient,
      jobId: trimmedJobId,
      fetchImpl,
      env,
    });

    const refreshedJob = processResult?.job ?? (await loadAnalysisJob(adminClient, trimmedJobId));
    await postResultMessageIfNeeded(adminClient, customerId, refreshedJob);
  }

  const latestJob = await loadAnalysisJob(adminClient, trimmedJobId);
  return {
    ok: true,
    analysis_job: mapAnalysisJobForClient(latestJob),
    process_result: processResult,
  };
}

export async function handleLatestAnalysisJobRequest({
  authHeader,
  env = process.env,
  adminSupabase = null,
  testCustomerId = null,
} = {}) {
  let customerId = String(testCustomerId ?? "").trim() || null;
  let userSupabase = null;

  if (!customerId) {
    userSupabase = createUserSupabaseClient(authHeader, env);
    if (!userSupabase) {
      return { ok: false, reason: "SUPABASE_NOT_CONFIGURED", error_message: "Supabase is not configured." };
    }
    const resolved = await resolveCustomerId(userSupabase);
    if (!resolved.ok) return resolved;
    customerId = resolved.customerId;
  }

  const adminClient = adminSupabase ?? createServiceRoleSupabaseClient(env) ?? userSupabase;
  const { data, error } = await adminClient
    .from("analysis_jobs")
    .select("*")
    .eq("customer_id", customerId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    return { ok: false, reason: "JOB_LOOKUP_FAILED", error_message: error.message };
  }

  return {
    ok: true,
    analysis_job: mapAnalysisJobForClient(data),
  };
}

export function parseConversationalQuestionBody(body) {
  if (!body || typeof body !== "object") return null;
  const question = String(body.question ?? body.message ?? "").trim();
  if (!question) return null;
  const autoProcess = body.auto_process === true || body.autoProcess === true;
  return { question, autoProcess };
}

export function parseAnalysisJobBody(body) {
  if (!body || typeof body !== "object") return null;
  const jobId = String(body.job_id ?? body.jobId ?? "").trim();
  if (!jobId) return null;
  const actionRaw = String(body.action ?? "status").trim().toLowerCase();
  const action = actionRaw === "process" ? "process" : "status";
  return { jobId, action };
}
