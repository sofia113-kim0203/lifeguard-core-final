/**
 * Conversational Background Analysis — KEY Master speak only.
 */
import { createClient } from "@supabase/supabase-js";
import { ensureCustomerMemoryContext } from "./customerMemoryContextSync.js";
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
import { stripLegacyClaudeFromJobResultJson } from "./stripLegacyClaudeFromJobResultJson.js";
import { runOneKeyCoreTurn, resolveOneKeyCoreS1Env } from "./keyCore/oneKeyCoreTurn.js";
import { buildKeyCustomerTextFailureEnvelope } from "./keyCore/keyCustomerMonopoly.js";

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

async function resolveKeyMasterConversationalSpeak({
  userSupabase,
  customerId,
  question,
  history = [],
  env = process.env,
  fetchImpl = fetch,
  startedAt = Date.now(),
} = {}) {
  const keyEnv = resolveOneKeyCoreS1Env(env);
  const coreResult = await runOneKeyCoreTurn({
    userSupabase,
    customerId,
    question,
    history,
    env: keyEnv,
    fetchImpl,
    startedAt,
  });

  const trace = coreResult.oneKeyCoreTrace ?? null;
  if (coreResult.ok) {
    const customerText = String(coreResult.keySpeakOriginal ?? coreResult.customerText ?? "").trim();
    if (customerText) {
      return {
        ok: true,
        customerText,
        visualBlocks: coreResult.visualBlocks ?? [],
        keySpeakOriginal: coreResult.keySpeakOriginal ?? customerText,
        trace,
        responseSource: coreResult.agentTurn?.responseSource ?? "one_key_core_s1",
        key_monopoly_failure: false,
      };
    }
  }

  const failure = buildKeyCustomerTextFailureEnvelope({
    reason: coreResult.reason ?? "one_key_core_failed",
    trace,
  });
  return {
    ok: true,
    customerText: failure.keySpeakOriginal ?? failure.customerText,
    keySpeakOriginal: failure.keySpeakOriginal,
    trace: failure.oneKeyCoreTrace ?? trace,
    responseSource: failure.agentTurn?.responseSource ?? "one_key_core_s1",
    key_monopoly_failure: true,
  };
}

function buildVisualBlocksMeta({ trace = null, visualBlocks = [] } = {}) {
  const speakStep = trace?.steps?.find((row) => row.step === "speak");
  const gate =
    speakStep?.visual_blocks_gate ??
    speakStep?.key_voice_trace?.visual_blocks_gate ??
    null;
  const blocks = visualBlocks.length ? visualBlocks : speakStep?.visual_blocks ?? [];
  return {
    visual_blocks: blocks,
    visual_blocks_gate: gate
      ? {
          accepted_count: gate.accepted_count ?? blocks.length,
          omitted_count: gate.omitted_count ?? 0,
          omitted: gate.omitted ?? [],
        }
      : null,
  };
}

function buildKeyMasterConversationalMeta({
  trace = null,
  keyMonopolyFailure = false,
  visualBlocks = [],
} = {}) {
  return {
    one_key_core_s1: true,
    one_key_core_s1_used: true,
    key_speak_master: true,
    phase: "key_master_conversational",
    one_key_core_trace: trace ?? null,
    key_monopoly_failure: keyMonopolyFailure === true,
    ...buildVisualBlocksMeta({ trace, visualBlocks }),
  };
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
    result_json: stripLegacyClaudeFromJobResultJson(job.result_json ?? {}),
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

  const keySupabase = userSupabase ?? adminClient;
  const conversationHistory = await loadRecentConversationHistory(adminClient, customerId, 10);
  const intentClassification = classifyConsultationIntent(trimmedQuestion);

  const keySpeak = await resolveKeyMasterConversationalSpeak({
    userSupabase: keySupabase,
    customerId,
    question: trimmedQuestion,
    history: conversationHistory,
    env,
    fetchImpl,
    startedAt,
  });

  const customerText = keySpeak.customerText;
  const visualBlocks = keySpeak.visualBlocks ?? [];
  const visualBlocksMeta = buildVisualBlocksMeta({ trace: keySpeak.trace, visualBlocks });
  const keyMeta = buildKeyMasterConversationalMeta({
    trace: keySpeak.trace,
    keyMonopolyFailure: keySpeak.key_monopoly_failure === true,
    visualBlocks,
  });

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

  const userMessage = await insertConversationMessage(adminClient, customerId, {
    role: "user",
    message: trimmedQuestion,
    metadata: { source: "customer_dashboard", phase: "key_master_conversational" },
  });

  const { data: jobRow, error: jobError } = await adminClient
    .from("analysis_jobs")
    .insert({
      customer_id: customerId,
      conversation_message_id: userMessage.id,
      question: trimmedQuestion,
      status: "queued",
      fast_response_text: customerText,
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
    message: customerText,
    metadata: {
      source: "conversational_background_analysis",
      phase: "key_master_conversational",
      analysis_job_id: jobRow.id,
      response_source: keySpeak.responseSource,
      key_speak_original: keySpeak.keySpeakOriginal,
      key_text_equal: keySpeak.keySpeakOriginal === customerText,
      memory_version: snapshot.memory_version ?? 0,
      memory_fact_count: snapshot.fact_count ?? 0,
      memory_synced: memoryContext.memory_synced,
      source_data_available: memoryContext.data_available,
      cache_status: cachePayload.cache_status,
      background_refresh_types: cachePayload.background_refresh_types,
      initial_response_time_ms: initialResponseTimeMs,
      ...keyMeta,
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
    fast_response: customerText,
    visual_blocks: visualBlocksMeta.visual_blocks,
    visual_blocks_gate: visualBlocksMeta.visual_blocks_gate,
    key_speak_original: keySpeak.keySpeakOriginal,
    key_text_equal: keySpeak.keySpeakOriginal === customerText,
    response_source: keySpeak.responseSource,
    initial_response_time_ms: initialResponseTimeMs,
    analysis_job_id: jobRow.id,
    analysis_job: mapAnalysisJobForClient(latestJob),
    one_key_core_s1_active: true,
    one_key_core_s1_used: true,
    key_speak_master: true,
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
    ...keyMeta,
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

    const refreshedJob = processResult?.job ?? (await loadAnalysisJob(processClient, trimmedJobId));
    if (refreshedJob?.status === "completed") {
      await postResultMessageIfNeeded(processClient, customerId, refreshedJob);
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

/** True when result_json contains at least one engine panel payload. */
export function isDisplayableAnalysisJob(job) {
  const result = job?.result_json ?? {};
  return Boolean(
    result.recommendation ||
      result.insurance_design ||
      result.coverage_gap ||
      result.underwriting_risk,
  );
}

/** Lower tier wins when selecting among completed jobs (1 = highest priority). */
export function analysisJobDisplayTier(job) {
  const result = job?.result_json ?? {};
  if (result.recommendation || result.insurance_design) return 1;
  if (result.coverage_gap || result.underwriting_risk) return 2;
  return 3;
}

/**
 * Pick the best completed job for panel display, then fall back to latest-any.
 * `completedJobs` must be ordered newest-first (created_at DESC).
 */
export function selectDisplayableAnalysisJob(completedJobs = [], latestAnyJob = null) {
  const completed = Array.isArray(completedJobs) ? completedJobs : [];

  for (const tier of [1, 2]) {
    const match = completed.find(
      (job) => isDisplayableAnalysisJob(job) && analysisJobDisplayTier(job) === tier,
    );
    if (match) return match;
  }

  if (completed.length > 0) {
    return completed[0];
  }

  return latestAnyJob ?? null;
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
  // completed job is often result_claude-only (partial) while an older COMPLETED job holds
  // full panel results. Scan recent completed jobs and pick the best displayable payload.
  const { data: completedRows, error: completedError } = await adminClient
    .from("analysis_jobs")
    .select("*")
    .eq("customer_id", customerId)
    .eq("status", "completed")
    .order("created_at", { ascending: false })
    .limit(20);

  if (completedError) {
    return { ok: false, reason: "JOB_LOOKUP_FAILED", error_message: completedError.message };
  }

  let latestAnyJob = null;
  if (!Array.isArray(completedRows) || completedRows.length === 0) {
    const { data: latestRows, error: latestError } = await adminClient
      .from("analysis_jobs")
      .select("*")
      .eq("customer_id", customerId)
      .order("created_at", { ascending: false })
      .limit(1);

    if (latestError) {
      return { ok: false, reason: "JOB_LOOKUP_FAILED", error_message: latestError.message };
    }

    latestAnyJob = Array.isArray(latestRows) && latestRows.length > 0 ? latestRows[0] : null;
  }

  const data = selectDisplayableAnalysisJob(completedRows ?? [], latestAnyJob);

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
