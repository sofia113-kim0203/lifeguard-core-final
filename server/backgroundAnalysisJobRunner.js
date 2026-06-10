/**
 * Phase 26 Step 2A — Background analysis job runner with cache + timing metrics.
 */
import { loadCustomerMemorySnapshot } from "./customerMemorySnapshot.js";
import { loadCoverageAnalysisContext } from "./customerCoverageGapCore.js";
import { loadUnderwritingAnalysisContext } from "./customerUnderwritingRiskCore.js";
import { loadRecommendationAnalysisContext } from "./customerRecommendationCore.js";
import { loadInsuranceDesignAnalysisContext } from "./customerInsuranceDesignCore.js";
import { generateShortConnectedExplanation } from "./claudeShortExplanationCore.js";
import { buildAdvisorStyleFallback } from "./customerConversationalTone.js";
import { auditExplanationContext } from "./claudePerformanceAudit.js";
import {
  loadFreshCacheEntry,
  saveCustomerAnalysisCacheEntry,
} from "./customerAnalysisCacheStore.js";
import { generatePanelClaudeExplanations } from "./panelClaudeExplanationHydration.js";
import { getJobPipelineManifest } from "./intentGateLayer.js";

export const ANALYSIS_PIPELINE_STAGES = [
  "coverage_gap",
  "underwriting_risk",
  "recommendation",
  "insurance_design",
  "result_claude",
];

const STAGE_UI_LABELS = {
  coverage_gap: "가입 보험 확인 완료",
  underwriting_risk: "건강 정보 반영 완료",
  recommendation: "부족한 보장 검토 완료",
  insurance_design: "맞춤 안내 정리 완료",
  result_claude: "답변 정리 완료",
};

async function runStageCompute(supabase, customerId, stageKey, workingContext, options = {}) {
  if (stageKey === "coverage_gap") {
    const context = await loadCoverageAnalysisContext(supabase, customerId);
    workingContext.coverageGapResult = context.coverageGapResult;
    workingContext.structuredMemory = context.structuredMemory;
    workingContext.snapshot = context.snapshot;
    return context.coverageGapResult;
  }

  if (stageKey === "underwriting_risk") {
    const context = await loadUnderwritingAnalysisContext(supabase, customerId);
    workingContext.underwritingResult = context.underwritingResult;
    workingContext.coverageGapResult = context.coverageGapResult;
    workingContext.structuredMemory = context.structuredMemory;
    workingContext.snapshot = context.snapshot;
    return context.underwritingResult;
  }

  if (stageKey === "recommendation") {
    const context = await loadRecommendationAnalysisContext(supabase, customerId);
    workingContext.recommendationResult = context.recommendationResult;
    workingContext.underwritingResult = context.underwritingResult;
    workingContext.coverageGapResult = context.coverageGapResult;
    workingContext.structuredMemory = context.structuredMemory;
    workingContext.snapshot = context.snapshot;
    return context.recommendationResult;
  }

  if (stageKey === "insurance_design") {
    const context = await loadInsuranceDesignAnalysisContext(supabase, customerId);
    workingContext.designBundle = context.designBundle;
    workingContext.recommendationResult = context.recommendationResult;
    workingContext.underwritingResult = context.underwritingResult;
    workingContext.coverageGapResult = context.coverageGapResult;
    workingContext.structuredMemory = context.structuredMemory;
    workingContext.snapshot = context.snapshot;
    return context.designBundle;
  }

  if (stageKey === "result_claude") {
    const memoryVersion =
      options.memoryVersion ?? workingContext.snapshot?.memory_version ?? 0;
    const explanation = await generateShortConnectedExplanation({
      supabase,
      customerId,
      question: workingContext.question,
      workingContext,
      memoryVersion,
      analysisJobId: options.analysisJobId ?? null,
      fetchImpl: options.fetchImpl,
      env: options.env,
    });

    return {
      text: explanation.text,
      explanation_mode: explanation.explanation_mode ?? "short",
      cache_hit: explanation.cache_hit ?? false,
      detailed_available: explanation.detailed_available ?? false,
      model_name: explanation.model_name ?? null,
      provider: explanation.provider ?? null,
      performance: explanation.performance ?? null,
      audit: explanation.audit ?? auditExplanationContext(workingContext, workingContext.question),
      skipped: explanation.skipped ?? false,
      reason: explanation.reason ?? null,
    };
  }

  throw new Error(`unknown_stage: ${stageKey}`);
}

function buildFallbackConnectedResponse(workingContext) {
  return buildAdvisorStyleFallback(workingContext.question ?? "", workingContext);
}

export async function loadAnalysisJob(supabase, jobId) {
  const { data, error } = await supabase
    .from("analysis_jobs")
    .select("*")
    .eq("id", jobId)
    .maybeSingle();

  if (error) {
    throw new Error(`analysis_job_load_failed: ${error.message}`);
  }
  return data;
}

export async function updateAnalysisJob(supabase, jobId, patch) {
  const { data, error } = await supabase
    .from("analysis_jobs")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", jobId)
    .select("*")
    .single();

  if (error) {
    throw new Error(`analysis_job_update_failed: ${error.message}`);
  }
  return data;
}

export async function processNextAnalysisJobStage({
  supabase,
  jobId,
  fetchImpl = fetch,
  env = process.env,
} = {}) {
  const job = await loadAnalysisJob(supabase, jobId);
  if (!job) {
    return { ok: false, reason: "JOB_NOT_FOUND", error_message: "Analysis job not found." };
  }

  if (job.status === "completed") {
    return { ok: true, job, already_completed: true };
  }
  if (job.status === "failed") {
    return { ok: false, reason: "JOB_FAILED", error_message: job.error_message ?? "job_failed" };
  }

  const stagesCompleted = Array.isArray(job.stages_completed) ? [...job.stages_completed] : [];
  const pipelineManifest = getJobPipelineManifest(job);
  const nextStage = pipelineManifest.find((stage) => !stagesCompleted.includes(stage));
  if (!nextStage) {
    const completedJob = await updateAnalysisJob(supabase, jobId, {
      status: "completed",
      current_step: null,
      completed_at: new Date().toISOString(),
    });
    return { ok: true, job: completedJob, already_completed: true };
  }

  const timingMetrics = { ...(job.timing_metrics ?? {}) };
  const resultJson = { ...(job.result_json ?? {}) };
  const workingContext = {
    question: job.question,
    intentGate: resultJson.intent_gate ?? resultJson.working_context?.intentGate ?? null,
    factual_lookup_answer: resultJson.working_context?.factual_lookup_answer ?? null,
    ...(resultJson.working_context ?? {}),
  };

  const snapshot =
    workingContext.snapshot ??
    (await loadCustomerMemorySnapshot(supabase, job.customer_id));
  const memoryVersion = job.source_memory_version ?? snapshot.memory_version ?? 0;

  let processingJob = job;
  if (job.status === "queued") {
    processingJob = await updateAnalysisJob(supabase, jobId, {
      status: "processing",
      started_at: job.started_at ?? new Date().toISOString(),
      current_step: nextStage,
    });
  } else {
    processingJob = await updateAnalysisJob(supabase, jobId, { current_step: nextStage });
  }

  const stageStart = Date.now();
  try {
    let stageResult;
    let fromCache = false;

    if (nextStage === "result_claude") {
      stageResult = await runStageCompute(supabase, job.customer_id, nextStage, workingContext, {
        memoryVersion,
        analysisJobId: jobId,
        fetchImpl,
        env,
      });
    } else {
      const { evaluation } = await loadFreshCacheEntry(
        supabase,
        job.customer_id,
        nextStage,
        memoryVersion,
      );

      if (evaluation.is_fresh) {
        const { entry } = await loadFreshCacheEntry(supabase, job.customer_id, nextStage, memoryVersion);
        stageResult = entry?.data ?? null;
        fromCache = true;
        hydrateWorkingContext(workingContext, nextStage, stageResult);
      } else {
        stageResult = await runStageCompute(supabase, job.customer_id, nextStage, workingContext, {
        memoryVersion,
        analysisJobId: jobId,
        fetchImpl,
        env,
      });
        await saveCustomerAnalysisCacheEntry(
          supabase,
          job.customer_id,
          nextStage,
          stageResult,
          memoryVersion,
        );
      }
    }

    const stageDuration = Date.now() - stageStart;
    const timingKey =
      nextStage === "coverage_gap"
        ? "coverage_time_ms"
        : nextStage === "underwriting_risk"
          ? "underwriting_time_ms"
          : nextStage === "recommendation"
            ? "recommendation_time_ms"
            : nextStage === "insurance_design"
              ? "design_time_ms"
              : "result_claude_time_ms";

    timingMetrics[timingKey] = stageDuration;
    timingMetrics[`${nextStage}_from_cache`] = fromCache;
    if (nextStage === "result_claude") {
      timingMetrics.result_claude_cache_hit = stageResult?.cache_hit ?? false;
      if (stageResult?.performance) {
        timingMetrics.result_claude_prompt_chars = stageResult.performance.prompt_chars;
        timingMetrics.result_claude_input_tokens = stageResult.performance.estimated_input_tokens;
        timingMetrics.result_claude_output_chars = stageResult.performance.output_chars;
        timingMetrics.result_claude_output_tokens = stageResult.performance.estimated_output_tokens;
      }
    }
    timingMetrics.total_analysis_time_ms = Object.entries(timingMetrics)
      .filter(([key]) =>
        ["coverage_time_ms", "underwriting_time_ms", "recommendation_time_ms", "design_time_ms", "result_claude_time_ms"].includes(key),
      )
      .reduce((sum, [, value]) => sum + Number(value ?? 0), 0);

    stagesCompleted.push(nextStage);
    resultJson[nextStage] = stageResult;
    resultJson.working_context = workingContext;
    resultJson.stage_labels = {
      ...(resultJson.stage_labels ?? {}),
      [nextStage]: STAGE_UI_LABELS[nextStage],
    };

    const patch = {
      stages_completed: stagesCompleted,
      result_json: resultJson,
      timing_metrics: timingMetrics,
      current_step: nextStage,
    };

    if (nextStage === "result_claude") {
      const intent = resultJson.intent_gate?.intent ?? workingContext.intentGate?.intent ?? null;
      if (intent !== "factual_lookup") {
        const panelClaudeStart = Date.now();
        const panelClaude = await generatePanelClaudeExplanations({
          supabase,
          customerId: job.customer_id,
          workingContext,
          fetchImpl,
          env,
        });
        timingMetrics.panel_claude_hydration_ms = panelClaude.duration_ms ?? Date.now() - panelClaudeStart;
        timingMetrics.panel_claude_policy_count = panelClaude.policy_count ?? 0;
        timingMetrics.total_analysis_time_ms =
          Number(timingMetrics.total_analysis_time_ms ?? 0) + Number(timingMetrics.panel_claude_hydration_ms ?? 0);

        resultJson.claude_explanations = panelClaude.explanations ?? {};
        resultJson.panel_claude_policy_count = panelClaude.policy_count ?? 0;
        resultJson.panel_claude_policy_ids = panelClaude.policy_ids ?? [];
      } else {
        timingMetrics.panel_claude_hydration_ms = 0;
        timingMetrics.panel_claude_policy_count = 0;
        resultJson.claude_explanations = {};
        resultJson.panel_claude_policy_count = 0;
        resultJson.panel_claude_policy_ids = [];
      }

      const finalText = stageResult?.text ?? stageResult?.fallback_text ?? buildFallbackConnectedResponse(workingContext);
      patch.final_response_text = finalText;
      patch.status = "completed";
      patch.completed_at = new Date().toISOString();
      patch.current_step = null;
      resultJson.final_claude = stageResult;
      resultJson.claude_performance = stageResult?.performance ?? null;
      resultJson.claude_audit = stageResult?.audit ?? null;
      resultJson.explanation_mode = stageResult?.explanation_mode ?? "short";
      resultJson.detailed_available = stageResult?.detailed_available ?? false;
      patch.result_json = resultJson;
      patch.timing_metrics = timingMetrics;
    }

    const updatedJob = await updateAnalysisJob(supabase, jobId, patch);
    return {
      ok: true,
      job: updatedJob,
      processed_stage: nextStage,
      stage_duration_ms: stageDuration,
      from_cache: fromCache,
      stage_label: STAGE_UI_LABELS[nextStage],
      completed: updatedJob.status === "completed",
    };
  } catch (error) {
    const failedJob = await updateAnalysisJob(supabase, jobId, {
      status: "failed",
      error_message: error instanceof Error ? error.message : "stage_failed",
      current_step: nextStage,
      timing_metrics: {
        ...timingMetrics,
        [`${nextStage}_time_ms`]: Date.now() - stageStart,
      },
    });
    return {
      ok: false,
      reason: "STAGE_FAILED",
      error_message: failedJob.error_message,
      job: failedJob,
      failed_stage: nextStage,
    };
  }
}

function hydrateWorkingContext(workingContext, stageKey, data) {
  if (stageKey === "coverage_gap") workingContext.coverageGapResult = data;
  if (stageKey === "underwriting_risk") workingContext.underwritingResult = data;
  if (stageKey === "recommendation") workingContext.recommendationResult = data;
  if (stageKey === "insurance_design") workingContext.designBundle = data;
}

export async function runAnalysisJobToCompletion({ supabase, jobId, maxStages = 10, fetchImpl, env } = {}) {
  let lastResult = null;
  for (let i = 0; i < maxStages; i += 1) {
    lastResult = await processNextAnalysisJobStage({ supabase, jobId, fetchImpl, env });
    if (!lastResult.ok || lastResult.completed || lastResult.already_completed) {
      break;
    }
  }
  return lastResult;
}
