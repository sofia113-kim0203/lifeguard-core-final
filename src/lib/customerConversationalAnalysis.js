import {
  assertCustomerApiOk,
  fetchCustomerApi,
  isCustomerUnauthorizedError,
  rethrowCustomerApiError,
} from "./customerApiAuth.js";

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
    initialResponseTimeMs: payload.initial_response_time_ms ?? 0,
    analysisJobId: payload.analysis_job_id,
    analysisJob: payload.analysis_job ?? null,
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

export { isCustomerUnauthorizedError };

export async function processAnalysisJobUntilComplete({
  jobId,
  onProgress,
  pollIntervalMs = 900,
  maxAttempts = 120,
} = {}) {
  const trimmedJobId = String(jobId ?? "").trim();
  if (!trimmedJobId) throw new Error("분석 작업 ID가 없습니다.");

  let attempts = 0;
  let latestJob = null;

  while (attempts < maxAttempts) {
    const { analysisJob, processResult } = await fetchAnalysisJobStatus({
      jobId: trimmedJobId,
      action: "process",
    });
    latestJob = analysisJob;
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
    if (attempts < maxAttempts) {
      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    }
  }

  return latestJob;
}

export function mapJobResultsToAnalysisPanels(job) {
  if (!job?.result_json) return null;
  const result = job.result_json;
  return {
    coverageGapResult: result.coverage_gap ?? null,
    underwritingResult: result.underwriting_risk ?? null,
    recommendationResult: result.recommendation ?? null,
    designBundle: result.insurance_design ?? null,
    claudeExplanations: result.claude_explanations ?? {},
    finalClaude: result.final_claude ?? null,
  };
}

export function jobHasDisplayablePanelResults(job) {
  const mapped = mapJobResultsToAnalysisPanels(job);
  return Boolean(
    mapped?.coverageGapResult ||
      mapped?.underwritingResult ||
      mapped?.recommendationResult ||
      mapped?.designBundle,
  );
}
