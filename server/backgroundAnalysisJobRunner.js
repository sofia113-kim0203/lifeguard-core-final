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

export const ANALYSIS_PIPELINE_STAGES = [
  "coverage_gap",
  "underwriting_risk",
  "recommendation",
  "insurance_design",
  "result_claude",
];

const STAGE_UI_LABELS = {
  coverage_gap: "Coverage 분석 완료",
  underwriting_risk: "Underwriting 분석 완료",
  recommendation: "Recommendation 생성 완료",
  insurance_design: "보험설계 생성 완료",
  result_claude: "분석 결과 설명 생성 완료",
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
  const nextStage = ANALYSIS_PIPELINE_STAGES.find((stage) => !stagesCompleted.includes(stage));
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
