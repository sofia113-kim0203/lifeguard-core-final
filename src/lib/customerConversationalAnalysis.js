import { supabase } from "./supabase.js";
import { analyzeCustomerUnderwritingRisk } from "./customerUnderwritingRisk.js";
import { loadCustomerRecommendations } from "./customerRecommendations.js";
import { loadCustomerInsuranceDesign } from "./customerInsuranceDesign.js";
import { hasClaudeExplanation, normalizeClaudeExplanationEntry } from "./panelClaudeExplanation.js";

export { hasClaudeExplanation, normalizeClaudeExplanationEntry } from "./panelClaudeExplanation.js";

const CONVERSATIONAL_ROUTE = "/api/customer-conversational-qa";
const ANALYSIS_JOB_ROUTE = "/api/customer-analysis-job";

async function getAccessToken() {
  const { data, error } = await supabase.auth.getSession();
  if (error || !data?.session?.access_token) {
    throw new Error("로그인이 필요합니다.");
  }
  return data.session.access_token;
}

function mapServerError(payload, status) {
  if (payload?.error_message) return payload.error_message;
  if (payload?.reason === "UNAUTHORIZED") return "로그인이 필요합니다.";
  if (status === 404) return "API 경로를 찾을 수 없습니다.";
  return "상담 요청을 처리하지 못했습니다.";
}

export async function sendConversationalQuestion({ question, autoProcess = false } = {}) {
  const trimmed = String(question ?? "").trim();
  if (!trimmed) throw new Error("질문을 입력해 주세요.");

  const token = await getAccessToken();
  const response = await fetch(CONVERSATIONAL_ROUTE, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ question: trimmed, auto_process: autoProcess }),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload?.ok) {
    throw new Error(mapServerError(payload, response.status));
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

  const token = await getAccessToken();
  const response = await fetch(ANALYSIS_JOB_ROUTE, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ job_id: trimmedJobId, action }),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload?.ok) {
    throw new Error(mapServerError(payload, response.status));
  }

  return payload.analysis_job ?? null;
}

export async function fetchLatestAnalysisJob() {
  const token = await getAccessToken();
  const response = await fetch(ANALYSIS_JOB_ROUTE, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ mode: "latest" }),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload?.ok) {
    throw new Error(mapServerError(payload, response.status));
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
  pollIntervalMs = 1200,
  maxAttempts = 120,
  signal = null,
} = {}) {
  let attempts = 0;
  let latestJob = null;

  while (attempts < maxAttempts) {
    if (signal?.aborted) {
      return latestJob;
    }

    latestJob = await fetchAnalysisJobStatus({ jobId, action: "process" });
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

    attempts += 1;
    await sleepWithAbort(pollIntervalMs, signal);
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
    panelClaudePolicyCount: result.panel_claude_policy_count ?? null,
    panelClaudePolicyIds: result.panel_claude_policy_ids ?? [],
  };
}
