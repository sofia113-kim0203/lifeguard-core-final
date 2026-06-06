import { supabase } from "./supabase.js";

const ROUTE_PATH = "/api/claude-grounded-execution";

const READINESS_MISSING_LABELS = {
  execution_run_id_required: "실행 run ID 필요",
  claude_api_not_configured: "서버 Claude API 설정 없음",
  supabase_not_configured: "서버 Supabase 설정 없음",
  execution_run_load_failed: "실행 run 조회 실패",
  execution_run_not_found: "실행 run 없음",
  request_context_missing: "request_context 없음",
  query_missing: "query 없음",
  model_name_missing: "model_name 없음",
  invalid_execution_status: "실행 상태가 ready/pending이 아님",
};

const READINESS_WARNING_LABELS = {
  no_grounding_sources: "Grounding 소스가 0개입니다. 제한된 응답이 예상됩니다.",
};

function mapError(payload, status) {
  if (payload?.error_message) return payload.error_message;
  if (payload?.reason === "ANTHROPIC_NOT_CONFIGURED") {
    return "서버에 Claude API 키가 설정되지 않았습니다.";
  }
  if (payload?.reason === "INVALID_BODY") return "실행 run ID가 필요합니다.";
  if (payload?.reason === "RUN_NOT_FOUND") return "Claude execution run을 찾을 수 없습니다.";
  if (payload?.reason === "INVALID_EXECUTION_STATUS") {
    return "실행 상태가 ready 또는 pending이어야 합니다.";
  }
  if (status === 404) {
    return "Claude 실행 API 경로를 찾을 수 없습니다. 서버 라우트 배포를 확인해 주세요.";
  }
  return "Claude 실행을 처리하지 못했습니다.";
}

async function postClaudeGroundedExecution(body) {
  const headers = { "Content-Type": "application/json" };
  const { data: sessionData } = await supabase.auth.getSession();
  const accessToken = sessionData?.session?.access_token;
  if (accessToken) {
    headers.Authorization = `Bearer ${accessToken}`;
  }

  const response = await fetch(ROUTE_PATH, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });

  let payload = {};
  try {
    payload = await response.json();
  } catch {
    payload = {};
  }

  return { response, payload };
}

export function normalizeClaudeGroundedExecutionReadiness(data) {
  if (!data || typeof data !== "object") {
    return null;
  }

  const missing = Array.isArray(data.missing_information) ? data.missing_information : [];
  const warnings = Array.isArray(data.warning_messages) ? data.warning_messages : [];

  return {
    ready: data.ready ?? false,
    claudeExecutionRunId: data.claude_execution_run_id ?? null,
    executionStatus: data.execution_status ?? null,
    sourceCount: data.source_count ?? null,
    missingInformation: missing,
    warningMessages: warnings,
    raw: data,
  };
}

export function normalizeClaudeGroundedExecutionResult(data) {
  if (!data || typeof data !== "object") {
    return null;
  }

  return {
    ok: data.ok ?? false,
    claudeExecutionRunId: data.claude_execution_run_id ?? null,
    executionStatus: data.execution_status ?? null,
    responsePreview: data.response_preview ?? {},
    errorMessage: data.error_message ?? null,
    reason: data.reason ?? null,
    raw: data,
  };
}

export { READINESS_MISSING_LABELS, READINESS_WARNING_LABELS };

export async function checkClaudeGroundedExecutionReadiness(claudeExecutionRunId) {
  if (!claudeExecutionRunId) {
    throw new Error("Claude execution run ID가 필요합니다.");
  }

  const { response, payload } = await postClaudeGroundedExecution({
    mode: "readiness",
    claude_execution_run_id: claudeExecutionRunId,
  });

  if (!response.ok) {
    throw new Error(mapError(payload, response.status));
  }

  return normalizeClaudeGroundedExecutionReadiness(payload);
}

export async function runClaudeGroundedExecution(claudeExecutionRunId) {
  if (!claudeExecutionRunId) {
    throw new Error("Claude execution run ID가 필요합니다.");
  }

  const { response, payload } = await postClaudeGroundedExecution({
    mode: "execute",
    claude_execution_run_id: claudeExecutionRunId,
  });

  if (!response.ok || payload.ok === false) {
    throw new Error(mapError(payload, response.status));
  }

  return normalizeClaudeGroundedExecutionResult(payload);
}
