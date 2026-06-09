/**
 * Phase 26 Step 2A — Background analysis job runner with cache + timing metrics.
 */
import { loadCustomerMemorySnapshot } from "./customerMemorySnapshot.js";
import { loadCoverageAnalysisContext } from "./customerCoverageGapCore.js";
import { loadUnderwritingAnalysisContext } from "./customerUnderwritingRiskCore.js";
import { loadRecommendationAnalysisContext } from "./customerRecommendationCore.js";
import { loadInsuranceDesignAnalysisContext } from "./customerInsuranceDesignCore.js";
import {
  buildCoverageGapExplanationPrompt,
} from "./customerCoverageGapCore.js";
import {
  buildUnderwritingExplanationPrompt,
} from "./customerUnderwritingRiskCore.js";
import {
  buildRecommendationExplanationPrompt,
} from "./customerRecommendationCore.js";
import {
  buildInsuranceDesignExplanationPrompt,
} from "./customerInsuranceDesignCore.js";
import { resolveAnthropicApiKey } from "./claudeGroundedExecutionCore.js";
import { resolveClaudeModel } from "./policyTermsQaCore.js";
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

async function callAnthropic({ apiKey, modelName, system, user, fetchImpl = fetch }) {
  const response = await fetchImpl("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: modelName,
      max_tokens: 1400,
      system,
      messages: [{ role: "user", content: user }],
    }),
  });

  if (!response.ok) {
    return {
      ok: false,
      reason: "CLAUDE_API_ERROR",
      errorMessage: `Claude API error (${response.status})`,
    };
  }

  const data = await response.json();
  const text = Array.isArray(data?.content)
    ? data.content
        .filter((block) => block?.type === "text")
        .map((block) => block.text)
        .join("\n")
        .trim()
    : "";

  if (!text) {
    return { ok: false, reason: "CLAUDE_EMPTY_RESPONSE", errorMessage: "Claude returned empty response." };
  }

  return { ok: true, answer: text, model: modelName, provider: "anthropic" };
}

function buildConnectedResultPrompt(question, context) {
  const user = [
    "고객이 상담 중 아래 질문을 했습니다. 백그라운드 정밀 분석이 완료되었습니다.",
    "제공된 분석 JSON만 사용해 질문에 연결된 설명을 작성하세요.",
    "Memory, Coverage Gap, Underwriting, Recommendation, Insurance Design 내용을 모두 반영하세요.",
    "데이터에 없는 보험사, 상품, 금액, 인수 승인/거절을 만들지 마세요.",
    "",
    `Question: ${question}`,
    "",
    "analysis_bundle_json:",
    JSON.stringify(
      {
        coverage_gap_result: context.coverageGapResult,
        underwriting_result: context.underwritingResult,
        recommendation_result: {
          customer_visible_top2: context.recommendationResult?.customer_visible_top2,
          recommendations_count: context.recommendationResult?.recommendations?.length,
          keep_existing: context.recommendationResult?.keep_existing,
        },
        insurance_design: {
          customer_visible_design: context.designBundle?.customer_visible_design,
          design_title: context.designBundle?.insurance_design?.design_title,
        },
      },
      null,
      2,
    ),
  ].join("\n");

  const system = [
    "You are a LIFEGUARD customer insurance consultation assistant.",
    "Explain completed background analysis results connected to the customer question.",
    "Respond in Korean with headings and bullet points.",
    "Do not invent facts not present in analysis_bundle_json.",
  ].join(" ");

  return { system, user };
}

async function runStageCompute(supabase, customerId, stageKey, workingContext) {
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
    const prompt = buildConnectedResultPrompt(workingContext.question, workingContext);
    const anthropicApiKey = resolveAnthropicApiKey();
    if (!anthropicApiKey) {
      return {
        skipped: true,
        reason: "ANTHROPIC_NOT_CONFIGURED",
        fallback_text: buildFallbackConnectedResponse(workingContext),
      };
    }

    const claudeResult = await callAnthropic({
      apiKey: anthropicApiKey,
      modelName: resolveClaudeModel(),
      system: prompt.system,
      user: prompt.user,
    });

    if (!claudeResult.ok) {
      return {
        skipped: true,
        reason: claudeResult.reason,
        fallback_text: buildFallbackConnectedResponse(workingContext),
      };
    }

    return {
      text: claudeResult.answer,
      model_name: claudeResult.model,
      provider: claudeResult.provider,
      stage_explanations: await buildStageExplanations(workingContext, anthropicApiKey),
    };
  }

  throw new Error(`unknown_stage: ${stageKey}`);
}

function buildFallbackConnectedResponse(workingContext) {
  const topGaps = (workingContext.coverageGapResult?.top_gaps ?? [])
    .slice(0, 3)
    .map((item) => item.coverage_label ?? item.coverage_category)
    .join(", ");
  const top2 = (workingContext.recommendationResult?.customer_visible_top2 ?? [])
    .map((item) => item.coverage_label ?? item.coverage_category)
    .join(", ");
  const designTitle = workingContext.designBundle?.customer_visible_design?.design_title ?? "";
  return [
    "백그라운드 정밀 분석이 완료되었습니다.",
    topGaps ? `보장 공백 우선 항목: ${topGaps}` : null,
    top2 ? `추천 Top 2: ${top2}` : null,
    designTitle ? `보험설계안: ${designTitle}` : null,
    "상세 설명은 AI 보험 추천 화면에서 확인하실 수 있습니다.",
  ]
    .filter(Boolean)
    .join("\n\n");
}

async function buildStageExplanations(workingContext, apiKey) {
  const explanations = {};
  const modelName = resolveClaudeModel();

  if (workingContext.coverageGapResult && workingContext.structuredMemory) {
    const prompt = buildCoverageGapExplanationPrompt(
      workingContext.structuredMemory,
      workingContext.coverageGapResult,
    );
    const result = await callAnthropic({
      apiKey,
      modelName,
      system: prompt.system,
      user: prompt.user,
    });
    if (result.ok) explanations.coverage_gap = result.answer;
  }

  if (workingContext.underwritingResult) {
    const prompt = buildUnderwritingExplanationPrompt(
      workingContext.structuredMemory,
      workingContext.coverageGapResult,
      workingContext.underwritingResult,
    );
    const result = await callAnthropic({
      apiKey,
      modelName,
      system: prompt.system,
      user: prompt.user,
    });
    if (result.ok) explanations.underwriting = result.answer;
  }

  if (workingContext.recommendationResult) {
    const prompt = buildRecommendationExplanationPrompt(
      workingContext.structuredMemory,
      workingContext.recommendationResult,
      workingContext.coverageGapResult,
      workingContext.underwritingResult,
    );
    const result = await callAnthropic({
      apiKey,
      modelName,
      system: prompt.system,
      user: prompt.user,
    });
    if (result.ok) explanations.recommendation = result.answer;
  }

  if (workingContext.designBundle) {
    const prompt = buildInsuranceDesignExplanationPrompt(
      workingContext.structuredMemory,
      workingContext.designBundle,
      workingContext,
    );
    const result = await callAnthropic({
      apiKey,
      modelName,
      system: prompt.system,
      user: prompt.user,
    });
    if (result.ok) explanations.insurance_design = result.answer;
  }

  return explanations;
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
      stageResult = await runStageCompute(supabase, job.customer_id, nextStage, workingContext);
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
        stageResult = await runStageCompute(supabase, job.customer_id, nextStage, workingContext);
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
      resultJson.claude_explanations = stageResult?.stage_explanations ?? {};
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
