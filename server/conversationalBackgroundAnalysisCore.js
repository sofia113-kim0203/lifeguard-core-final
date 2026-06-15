/**
 * Phase 26 Step 2A — Conversational Background Analysis orchestration.
 */
import { createClient } from "@supabase/supabase-js";
import { ensureCustomerMemoryContext } from "./customerMemoryContextSync.js";
import { buildConversationalAnswer, buildCasualChatResponse } from "./fastResponseLayer.js";
import { loadCustomerAnalysisCachePayload } from "./customerAnalysisCacheStore.js";
import {
  ANALYSIS_PIPELINE_STAGES,
  loadAnalysisJob,
  processNextAnalysisJobStage,
  runAnalysisJobToCompletion,
} from "./backgroundAnalysisJobRunner.js";
import { resolveSupabaseConfig } from "./policyTermsQaCore.js";
import {
  buildFactualLookupAnswer,
  buildIntentGatePayload,
  buildPolicyDetailAnswer,
  classifyConsultationIntent,
  getJobPipelineManifest,
  getJobSkippedStages,
  hasRequiredResultsForResultClaude,
  resolvePipelineManifest,
} from "./intentGateLayer.js";
import {
  buildAdvisorBrainAnswer,
  shouldActivateAdvisorBrainForClassification,
} from "./advisorBrain/advisorBrainResponder.js";
import { isAdvisorConversationQuestion } from "./advisorBrain/advisorConversationResponder.js";
import { isRecommendationReasonClassification } from "./advisorBrain/advisorRecommendationReasonResponder.js";
import {
  isCentralBrainActive,
  mergeConversationMetadata,
  runCentralBrainTurn,
} from "./centralBrain/index.js";

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

function getPendingAnalysisStage(job) {
  const stagesCompleted = Array.isArray(job?.stages_completed) ? job.stages_completed : [];
  return ANALYSIS_PIPELINE_STAGES.find((stage) => !stagesCompleted.includes(stage)) ?? null;
}

async function maybeAdvancePendingResultClaudeStage(adminClient, job) {
  if (!adminClient || !job) return job;
  if (job.status === "completed" || job.status === "failed") return job;
  if (getPendingAnalysisStage(job) !== "result_claude") return job;
  if (!hasRequiredResultsForResultClaude(job)) return job;

  const processResult = await processNextAnalysisJobStage({
    supabase: adminClient,
    jobId: job.id,
  });
  return processResult?.job ?? (await loadAnalysisJob(adminClient, job.id));
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


async function findExistingResultMessage(adminClient, customerId, jobId) {
  const { data, error } = await adminClient
    .from("customer_conversations")
    .select("id, customer_id, role, message, metadata_json, created_at")
    .eq("customer_id", customerId)
    .eq("role", "assistant")
    .contains("metadata_json", { phase: "phase26-2a-result", analysis_job_id: jobId })
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(`conversation_lookup_failed: ${error.message}`);
  }
  return data ?? null;
}

async function tryClaimResultMessagePost(adminClient, job) {
  const { data, error } = await adminClient
    .from("analysis_jobs")
    .update({
      result_json: {
        ...(job.result_json ?? {}),
        result_message_posted: true,
        result_message_claimed_at: new Date().toISOString(),
      },
      updated_at: new Date().toISOString(),
    })
    .eq("id", job.id)
    .or(
      "result_json.is.null,result_json->>result_message_posted.is.null,result_json->>result_message_posted.eq.false",
    )
    .select("*")
    .maybeSingle();

  if (error) {
    throw new Error(`result_message_claim_failed: ${error.message}`);
  }
  return data ?? null;
}

async function postResultMessageIfNeeded(adminClient, customerId, job) {
  if (!job?.final_response_text) return null;

  const existing = await findExistingResultMessage(adminClient, customerId, job.id);
  if (existing) return existing;

  if (job.result_json?.result_message_posted) {
    return findExistingResultMessage(adminClient, customerId, job.id);
  }

  const claimed = await tryClaimResultMessagePost(adminClient, job);
  if (!claimed) {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const existingAfterClaim = await findExistingResultMessage(adminClient, customerId, job.id);
      if (existingAfterClaim) return existingAfterClaim;
      await new Promise((resolve) => setTimeout(resolve, 25 * (attempt + 1)));
    }
    return null;
  }

  return insertConversationMessage(adminClient, customerId, {
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
  const pipelineManifest = getJobPipelineManifest(job);
  const skippedStages = getJobSkippedStages(job);
  const progress = ANALYSIS_PIPELINE_STAGES.map((stage) => ({
    stage,
    status: stagesCompleted.includes(stage)
      ? "completed"
      : skippedStages.includes(stage)
        ? "skipped"
        : job.current_step === stage
          ? "processing"
          : pipelineManifest.includes(stage)
            ? "pending"
            : "skipped",
    label:
      job.result_json?.stage_labels?.[stage] ??
      (stage === "coverage_gap"
        ? "가입 보험 확인 중"
        : stage === "underwriting_risk"
          ? "건강 정보 반영 중"
          : stage === "recommendation"
            ? "부족한 보장 검토 중"
            : stage === "insurance_design"
              ? "맞춤 안내 정리 중"
              : "답변 정리 중"),
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

async function loadRecentConversationHistory(adminClient, customerId, limit = 10) {
  try {
    const { data } = await adminClient
      .from("customer_conversations")
      .select("role,message,created_at")
      .eq("customer_id", customerId)
      .order("created_at", { ascending: false })
      .limit(limit);

    return (data ?? [])
      .reverse()
      .map((row) => ({
        role: row.role,
        content: row.message,
      }));
  } catch {
    return [];
  }
}

async function handleCasualChatQuestionRequest({
  question,
  customerId,
  adminClient,
  startedAt,
  intentClassification,
  history = [],
  fetchImpl = fetch,
  env = process.env,
} = {}) {
  const pipelineManifest = resolvePipelineManifest(intentClassification.intent);
  const intentGate = buildIntentGatePayload(intentClassification, pipelineManifest);
  const casualResult = await buildCasualChatResponse({ question, history, fetchImpl, env });

  const userMessage = await insertConversationMessage(adminClient, customerId, {
    role: "user",
    message: question,
    metadata: {
      source: "customer_dashboard",
      phase: "casual-chat",
      intent: "casual_chat",
    },
  });

  const initialResponseTimeMs = Date.now() - startedAt;

  const assistantMessage = await insertConversationMessage(adminClient, customerId, {
    role: "assistant",
    message: casualResult.text,
    metadata: {
      source: "casual_claude",
      intent: "casual_chat",
      phase: "casual-chat",
      response_source: casualResult.response_source,
      model: casualResult.model ?? null,
      request_id: casualResult.request_id ?? null,
      initial_response_time_ms: initialResponseTimeMs,
    },
  });

  return {
    ok: true,
    customer_id: customerId,
    question,
    fast_response: casualResult.text,
    source: "casual_claude",
    initial_response_time_ms: initialResponseTimeMs,
    analysis_job_id: null,
    analysis_job: null,
    user_message_id: userMessage.id,
    assistant_message_id: assistantMessage.id,
    cache_status: null,
    background_refresh_required: false,
    background_refresh_types: [],
    memory_version: 0,
    memory_fact_count: 0,
    intent_gate: intentGate,
    memory_context: null,
    processing: null,
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

  const conversationHistory = await loadRecentConversationHistory(
    adminClient,
    customerId,
    10,
  );

  const intentClassification = classifyConsultationIntent(trimmedQuestion);

  if (intentClassification.intent === "casual_chat") {
    return handleCasualChatQuestionRequest({
      question: trimmedQuestion,
      customerId,
      adminClient,
      startedAt,
      intentClassification,
      history: conversationHistory,
      fetchImpl,
      env,
    });
  }

  const memoryContext = await ensureCustomerMemoryContext({
    supabase: adminClient,
    customerId,
    supabaseUrl: String(env.SUPABASE_URL ?? env.VITE_SUPABASE_URL ?? "").trim() || null,
    serviceRoleKey: String(env.SERVICE_ROLE_KEY ?? env.SUPABASE_SERVICE_ROLE_KEY ?? "").trim() || null,
  });
  const snapshot = memoryContext.snapshot;
  const cachePayload = await loadCustomerAnalysisCachePayload(
    adminClient,
    customerId,
    snapshot.memory_version ?? 0,
  );

  const pipelineManifest = resolvePipelineManifest(intentClassification.intent);
  const intentGate = buildIntentGatePayload(intentClassification, pipelineManifest);
  const workingContextInput = {
    snapshot,
    sourceContext: memoryContext.sourceContext,
    sourceSummary: memoryContext.sourceSummary,
  };
  const factualLookupAnswer = buildFactualLookupAnswer(trimmedQuestion, workingContextInput, intentGate);
  const policyDetailAnswer =
    intentGate.intent === "policy_detail"
      ? buildPolicyDetailAnswer(trimmedQuestion, workingContextInput)
      : null;

  const recommendationReasonMode = isRecommendationReasonClassification(
    intentClassification,
    trimmedQuestion,
  );
  const advisorConversationMode = isAdvisorConversationQuestion(
    intentClassification,
    trimmedQuestion,
  );
  const advisorStoredOnlyMode = recommendationReasonMode || advisorConversationMode;

  let centralBrainResult = null;

  // Direction1 Step2 — for analysis-type questions, run the live coverage/underwriting/
  // recommendation engines (same ones the screen uses) and ground the chat answer in the
  // computed results. Step4/5 and Central Brain activated turns skip live engine context.
  let analysisContext = null;
  if (isCentralBrainActive(env)) {
    centralBrainResult = await runCentralBrainTurn({
      question: trimmedQuestion,
      supabase: adminClient,
      customerId,
      env,
      fetchImpl,
      memorySnapshot: snapshot,
      cachePayload,
      conversationHistory,
      memoryVersion: snapshot.memory_version ?? 0,
    });
  }

  if (!advisorStoredOnlyMode && !centralBrainResult?.activated) {
    try {
      const { loadRecommendationAnalysisContext } = await import("./customerRecommendationCore.js");
      analysisContext = await loadRecommendationAnalysisContext(adminClient, customerId);
    } catch {
      analysisContext = null;
    }
  }

  let fastResponse = null;

  if (centralBrainResult?.activated && centralBrainResult?.ok && centralBrainResult?.message) {
    fastResponse = centralBrainResult.message;
  } else if (!isCentralBrainActive(env) && shouldActivateAdvisorBrainForClassification(intentClassification, env, trimmedQuestion)) {
    try {
      const advisorBrainResult = await buildAdvisorBrainAnswer({
        supabase: adminClient,
        customerId,
        question: trimmedQuestion,
        classification: intentClassification,
        env,
        fetchImpl,
      });
      if (advisorBrainResult?.ok && advisorBrainResult.message) {
        fastResponse = advisorBrainResult.message;
      }
    } catch {
      // Advisor Brain failure must fall back to the existing deterministic chat path.
    }
  }

  if (!fastResponse) {
    fastResponse = await buildConversationalAnswer({
      question: trimmedQuestion,
      memorySnapshot: snapshot,
      cachePayload,
      sourceContext: memoryContext.sourceContext,
      sourceSummary: memoryContext.sourceSummary,
      intentGate,
      analysisContext,
      history: conversationHistory,
      fetchImpl,
      env,
    });
  }

  if (advisorStoredOnlyMode || centralBrainResult?.skip_analysis_job) {
    const initialResponseTimeMs = Date.now() - startedAt;
    const userMessage = await insertConversationMessage(adminClient, customerId, {
      role: "user",
      message: trimmedQuestion,
      metadata: { source: "customer_dashboard", phase: "phase26-2a" },
    });
    const assistantMetadata = mergeConversationMetadata(
      {
        source: "conversational_background_analysis",
        phase: centralBrainResult?.activated ? "central-brain-p2" : "phase26-2a-fast",
        recommendation_reason_mode:
          recommendationReasonMode || centralBrainResult?.recommendation_reason_mode === true,
        advisor_conversation_mode:
          advisorConversationMode || centralBrainResult?.advisor_conversation_mode === true,
        analysis_job_skipped: true,
        memory_version: snapshot.memory_version ?? 0,
        memory_fact_count: snapshot.fact_count ?? 0,
        memory_synced: memoryContext.memory_synced,
        source_data_available: memoryContext.data_available,
        cache_status: cachePayload.cache_status,
        initial_response_time_ms: initialResponseTimeMs,
      },
      centralBrainResult?.metadata ?? {},
    );
    const assistantMessage = await insertConversationMessage(adminClient, customerId, {
      role: "assistant",
      message: fastResponse,
      metadata: assistantMetadata,
    });

    return {
      ok: true,
      customer_id: customerId,
      question: trimmedQuestion,
      fast_response: fastResponse,
      initial_response_time_ms: initialResponseTimeMs,
      analysis_job_id: null,
      analysis_job: null,
      recommendation_reason_mode:
        recommendationReasonMode || centralBrainResult?.recommendation_reason_mode === true,
      advisor_conversation_mode:
        advisorConversationMode || centralBrainResult?.advisor_conversation_mode === true,
      central_brain_mode: centralBrainResult?.central_brain_mode ?? null,
      central_brain_activated: centralBrainResult?.activated === true,
      job_skipped: true,
      user_message_id: userMessage.id,
      assistant_message_id: assistantMessage.id,
      cache_status: cachePayload.cache_status,
      background_refresh_required: cachePayload.background_refresh_required,
      background_refresh_types: cachePayload.background_refresh_types,
      memory_version: snapshot.memory_version ?? 0,
      memory_fact_count: snapshot.fact_count ?? 0,
      memory_context: {
        synced: memoryContext.memory_synced,
        status: memoryContext.memory_sync_status ?? "ready",
        error: memoryContext.memory_sync_error ?? null,
        sync_assessment: memoryContext.sync_assessment,
        rebuild_summary: memoryContext.rebuild_summary ?? null,
        data_available: memoryContext.data_available,
        source_summary: memoryContext.sourceSummary,
      },
      processing: null,
    };
  }

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
      result_json: {
        intent_gate: intentGate,
        working_context: {
          snapshot,
          sourceContext: memoryContext.sourceContext,
          sourceSummary: memoryContext.sourceSummary,
          sourceContextFlags: memoryContext.data_available,
          intentGate,
          factual_lookup_answer: factualLookupAnswer,
          policy_detail_answer: policyDetailAnswer,
        },
      },
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
      memory_synced: memoryContext.memory_synced,
      source_data_available: memoryContext.data_available,
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
    memory_context: {
      synced: memoryContext.memory_synced,
      status: memoryContext.memory_sync_status ?? "ready",
      error: memoryContext.memory_sync_error ?? null,
      sync_assessment: memoryContext.sync_assessment,
      rebuild_summary: memoryContext.rebuild_summary ?? null,
      data_available: memoryContext.data_available,
      source_summary: memoryContext.sourceSummary,
    },
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

  const readClient =
    adminSupabase ?? createServiceRoleSupabaseClient(env) ?? userSupabase;
  if (!readClient) {
    return { ok: false, reason: "SUPABASE_CLIENT_NOT_AVAILABLE", error_message: "Supabase client unavailable." };
  }

  const job = await loadAnalysisJob(readClient, trimmedJobId);
  if (!job) {
    return { ok: false, reason: "JOB_NOT_FOUND", error_message: "Analysis job not found." };
  }
  if (job.customer_id !== customerId) {
    return { ok: false, reason: "FORBIDDEN", error_message: "Job does not belong to customer." };
  }

  let processResult = null;
  if (action === "process" && job.status !== "completed" && job.status !== "failed") {
    const processClient = adminSupabase ?? createServiceRoleSupabaseClient(env);
    if (!processClient) {
      return {
        ok: true,
        analysis_job: mapAnalysisJobForClient(job),
        process_result: {
          ok: false,
          skipped: true,
          reason: "SERVICE_ROLE_NOT_CONFIGURED",
          error_message:
            "Background analysis processing requires SERVICE_ROLE_KEY on the API runtime.",
        },
      };
    }

    processResult = await processNextAnalysisJobStage({
      supabase: processClient,
      jobId: trimmedJobId,
      fetchImpl,
      env,
    });

    const refreshedJob = processResult?.job ?? (await loadAnalysisJob(adminClient, trimmedJobId));
    if (refreshedJob?.status === "completed") {
      await postResultMessageIfNeeded(adminClient, customerId, refreshedJob);
    }
  }

  const latestClient = adminSupabase ?? createServiceRoleSupabaseClient(env) ?? readClient;
  const latestJob = await loadAnalysisJob(latestClient, trimmedJobId);
  return {
    ok: true,
    analysis_job: mapAnalysisJobForClient(latestJob),
    process_result: processResult,
  };
}

/** @internal Test-only export for duplicate-response race verification */
export async function postResultMessageIfNeededForTest(adminClient, customerId, job) {
  return postResultMessageIfNeeded(adminClient, customerId, job);
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

  // The recommendation screen renders panel results from a job's result_json, but the NEWEST
  // job is often still 'processing' (e.g. stuck at result_claude) carrying only partial
  // results — which makes the panel show "분석 중 / 결과 없음" even though an older COMPLETED
  // job already holds all four panel results (coverage_gap / underwriting_risk /
  // recommendation / insurance_design). Prefer the latest COMPLETED job so the panel shows
  // real analysis; fall back to the newest job of any status only when none has completed.
  const { data: completedRows, error: completedError } = await adminClient
    .from("analysis_jobs")
    .select("*")
    .eq("customer_id", customerId)
    .eq("status", "completed")
    .order("created_at", { ascending: false })
    .limit(1);

  if (completedError) {
    return { ok: false, reason: "JOB_LOOKUP_FAILED", error_message: completedError.message };
  }

  let data = Array.isArray(completedRows) && completedRows.length > 0 ? completedRows[0] : null;

  if (!data) {
    const { data: latestRows, error: latestError } = await adminClient
      .from("analysis_jobs")
      .select("*")
      .eq("customer_id", customerId)
      .order("created_at", { ascending: false })
      .limit(1);

    if (latestError) {
      return { ok: false, reason: "JOB_LOOKUP_FAILED", error_message: latestError.message };
    }

    data = Array.isArray(latestRows) && latestRows.length > 0 ? latestRows[0] : null;
  }

  const serviceRoleClient = adminSupabase ?? createServiceRoleSupabaseClient(env);
  const refreshedJob = data
    ? await maybeAdvancePendingResultClaudeStage(serviceRoleClient, data)
    : null;

  return {
    ok: true,
    analysis_job: mapAnalysisJobForClient(refreshedJob),
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
