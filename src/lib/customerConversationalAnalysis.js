import {
  assertCustomerApiOk,
  fetchCustomerApi,
  isCustomerUnauthorizedError,
  rethrowCustomerApiError,
} from "./customerApiAuth.js";
import { analyzeCustomerUnderwritingRisk } from "./customerUnderwritingRisk.js";
import { loadCustomerRecommendations } from "./customerRecommendations.js";
import { loadCustomerInsuranceDesign } from "./customerInsuranceDesign.js";
import { hasClaudeExplanation, normalizeClaudeExplanationEntry } from "./panelClaudeExplanation.js";
import {
  jobHasEnginePanelResults,
  mapJobResultsToAnalysisPanels,
} from "./analysisPanelJobUtils.js";

export { hasClaudeExplanation, normalizeClaudeExplanationEntry } from "./panelClaudeExplanation.js";
export { jobHasEnginePanelResults, mapJobResultsToAnalysisPanels } from "./analysisPanelJobUtils.js";
export { isCustomerUnauthorizedError };

const CONVERSATIONAL_ROUTE = "/api/customer-conversational-qa";
const ANALYSIS_JOB_ROUTE = "/api/customer-analysis-job";

function mapServerError(payload, status) {
  if (payload?.error_message) return payload.error_message;
  if (payload?.reason === "UNAUTHORIZED") return "로그인이 필요합니다.";
  if (status === 404) return "API 경로를 찾을 수 없습니다.";
  return "상담 요청을 처리하지 못했습니다.";
}

export async function sendConversationalQuestion({ question, autoProcess = false } = {}) {
  const trimmed = String(question ?? "").trim();
  if (!trimmed) throw new Error("질문을 입력해 주세요.");

  const { response, payload } = await fetchCustomerApi(CONVERSATIONAL_ROUTE, {
    body: { question: trimmed, auto_process: autoProcess },
  });

  try {
    assertCustomerApiOk({ response, payload }, mapServerError(payload, response.status));
  } catch (error) {
    rethrowCustomerApiError(error, {
      payload,
      response,
      fallbackMessage: mapServerError(payload, response.status),
      mapMessage: (body, status) => mapServerError(body, status),
    });
  }

  return {
    fastResponse: payload.fast_response,
    visualBlocks: payload.visual_blocks ?? [],
    visualBlocksGate: payload.visual_blocks_gate ?? null,
    initialResponseTimeMs: payload.initial_response_time_ms ?? 0,
    analysisJobId: payload.analysis_job_id ?? null,
    analysisJob: payload.analysis_job ?? null,
    responseSource: payload.source ?? null,
    cacheStatus: payload.cache_status,
    backgroundRefreshRequired: payload.background_refresh_required ?? false,
    backgroundRefreshTypes: payload.background_refresh_types ?? [],
    memoryVersion: payload.memory_version ?? 0,
    memoryFactCount: payload.memory_fact_count ?? 0,
  };
}

export async function fetchAnalysisJobStatus({ jobId, action = "status" } = {}) {
  const trimmedJobId = String(jobId ?? "").trim();
  if (!trimmedJobId) throw new Error("분석 작업 ID가 없습니다.");

  const { response, payload } = await fetchCustomerApi(ANALYSIS_JOB_ROUTE, {
    body: { job_id: trimmedJobId, action },
  });

  try {
    assertCustomerApiOk({ response, payload }, mapServerError(payload, response.status));
  } catch (error) {
    rethrowCustomerApiError(error, {
      payload,
      response,
      fallbackMessage: mapServerError(payload, response.status),
      mapMessage: (body, status) => mapServerError(body, status),
    });
  }

  return {
    analysisJob: payload.analysis_job ?? null,
    processResult: payload.process_result ?? null,
  };
}

export async function fetchLatestAnalysisJob() {
  const { response, payload } = await fetchCustomerApi(ANALYSIS_JOB_ROUTE, {
    body: { mode: "latest" },
  });

  try {
    assertCustomerApiOk({ response, payload }, mapServerError(payload, response.status));
  } catch (error) {
    rethrowCustomerApiError(error, {
      payload,
      response,
      fallbackMessage: mapServerError(payload, response.status),
      mapMessage: (body, status) => mapServerError(body, status),
    });
  }

  return payload.analysis_job ?? null;
}

async function sleepWithAbort(ms, signal) {
  if (signal?.aborted) return;
  await new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    if (!signal) return;
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}

export async function processAnalysisJobUntilComplete({
  jobId,
  onProgress,
  pollIntervalMs = 900,
  maxAttempts = 120,
  signal = null,
} = {}) {
  const trimmedJobId = String(jobId ?? "").trim();
  if (!trimmedJobId) throw new Error("분석 작업 ID가 없습니다.");

  let attempts = 0;
  let latestJob = null;

  while (attempts < maxAttempts) {
    if (signal?.aborted) {
      return latestJob;
    }

    const { analysisJob, processResult } = await fetchAnalysisJobStatus({
      jobId: trimmedJobId,
      action: "process",
    });
    latestJob = analysisJob;

    if (signal?.aborted) {
      return latestJob;
    }

    if (typeof onProgress === "function") {
      onProgress(latestJob);
    }
    if (!latestJob) break;
    if (latestJob.status === "completed" || latestJob.status === "failed") {
      return latestJob;
    }
    if (processResult?.skipped) {
      return latestJob;
    }

    attempts += 1;
    await sleepWithAbort(pollIntervalMs, signal);
    if (signal?.aborted) {
      return latestJob;
    }
  }

  return latestJob;
}

const PANEL_CLAUDE_HYDRATORS = {
  underwriting: analyzeCustomerUnderwritingRisk,
  recommendation: loadCustomerRecommendations,
  insurance_design: loadCustomerInsuranceDesign,
};

export async function hydrateMissingClaudeExplanations({
  claudeExplanations = {},
  panels = ["underwriting", "recommendation", "insurance_design"],
  hasPanelData = {},
} = {}) {
  // FACTORY-SPEAK Hydration-S1 — panel Claude hydration blocked; KEY speaks from structured codes.
  const FACTORY_SPEAK_BLOCK_ALL_PANEL_CLAUDE_HYDRATION = true;
  if (FACTORY_SPEAK_BLOCK_ALL_PANEL_CLAUDE_HYDRATION) {
    const hydrationResults = panels.map((panel) => ({
      panel,
      ok: true,
      skipped: true,
      reason: "FACTORY_SPEAK_HYDRATION_BLOCKED",
    }));
    return { claudeExplanations: { ...claudeExplanations }, hydrationResults };
  }

  const hydrated = { ...claudeExplanations };
  const hydrationResults = [];

  for (const panel of panels) {
    if (hasPanelData[panel] === false) {
      continue;
    }
    if (hasClaudeExplanation(hydrated[panel])) {
      hydrationResults.push({ panel, ok: true, skipped: true, reason: "already_present" });
      continue;
    }

    const hydrator = PANEL_CLAUDE_HYDRATORS[panel];
    if (!hydrator) {
      hydrationResults.push({ panel, ok: false, reason: "unknown_panel" });
      continue;
    }

    try {
      const result = await hydrator({ skipClaude: false });
      hydrated[panel] = {
        explanation: result.claudeExplanation ?? null,
        meta: {
          ...(result.claudeMeta ?? {}),
          hydrated_at: new Date().toISOString(),
          source: "client_panel_api",
        },
      };
      hydrationResults.push({
        panel,
        ok: hasClaudeExplanation(hydrated[panel]),
        reason: hasClaudeExplanation(hydrated[panel]) ? null : result.claudeMeta?.reason ?? "empty_explanation",
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "hydration_failed";
      hydrated[panel] = {
        explanation: null,
        meta: {
          skipped: true,
          reason: "HYDRATION_FAILED",
          error_message: errorMessage,
          hydrated_at: new Date().toISOString(),
          source: "client_panel_api",
        },
      };
      hydrationResults.push({ panel, ok: false, reason: "HYDRATION_FAILED", error_message: errorMessage });
    }
  }

  return { claudeExplanations: hydrated, hydrationResults };
}

export function jobHasDisplayablePanelResults(job) {
  return jobHasEnginePanelResults(job);
}
