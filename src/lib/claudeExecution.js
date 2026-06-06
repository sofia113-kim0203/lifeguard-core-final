import { supabase } from "./supabase.js";

const MISSING_CLAUDE_EXECUTION_HINT =
  "Claude 실행이 아직 배포되지 않았습니다. Supabase SQL Editor에서 supabase/scripts/phase12_claude_execution_foundation.sql 을 실행해 주세요.";

export const CLAUDE_EXECUTION_STATUS_LABELS = {
  pending: "대기",
  ready: "실행 준비 완료",
  processing: "처리 중",
  completed: "완료",
  failed: "실패",
};

export const CLAUDE_EXECUTION_MISSING_LABELS = {
  claude_grounding_run_not_found: "Claude grounding run 없음",
  claude_execution_run_not_found: "Claude execution run 없음",
  no_query: "검색어 없음",
  no_sources: "소스 없음",
  grounding_not_ready: "Grounding 준비 미완료",
  response_context_empty: "응답 컨텍스트 없음",
  error_message_or_response_required: "오류 메시지 또는 응답 필요",
};

function mapError(error) {
  if (!error?.message) return "Claude 실행을 처리하지 못했습니다.";
  const m = error.message;
  if (
    m.includes("lifeguard_prepare_claude_execution") ||
    m.includes("lifeguard_store_claude_execution_result") ||
    m.includes("claude_execution_runs") ||
    m.includes("claude_execution_items") ||
    m.includes("does not exist")
  ) {
    return MISSING_CLAUDE_EXECUTION_HINT;
  }
  if (m === "claude_grounding_run_id_required") return "Claude grounding run ID가 필요합니다.";
  if (m === "claude_execution_run_id_required") return "Claude execution run ID가 필요합니다.";
  if (m === "model_name_required") return "Model을 입력해 주세요.";
  if (m === "execution_status_required" || m === "invalid_execution_status") {
    return "실행 상태를 선택해 주세요.";
  }
  if (m === "claude_grounding_run_not_found") return "Claude grounding run을 찾을 수 없습니다.";
  if (m === "claude_execution_run_not_found") return "Claude execution run을 찾을 수 없습니다.";
  if (m === "response_context_empty") return "응답 컨텍스트를 입력해 주세요.";
  if (m === "forbidden") return "관리자 권한이 필요합니다.";
  return m;
}

export function normalizeClaudeExecutionPreparation(data) {
  if (!data || typeof data !== "object") {
    return null;
  }

  const missing = Array.isArray(data.missing_information)
    ? data.missing_information
    : [];

  return {
    claudeExecutionRunId: data.claude_execution_run_id ?? null,
    executionStatus: data.execution_status ?? null,
    sourceCount: data.source_count ?? 0,
    missingInformation: missing,
    requestContext: data.request_context ?? {},
    createdAt: data.created_at ?? null,
    raw: data,
  };
}

export function normalizeClaudeExecutionResult(data) {
  if (!data || typeof data !== "object") {
    return null;
  }

  const missing = Array.isArray(data.missing_information)
    ? data.missing_information
    : [];

  return {
    claudeExecutionRunId: data.claude_execution_run_id ?? null,
    executionStatus: data.execution_status ?? null,
    responseContext: data.response_context ?? {},
    missingInformation: missing,
    storedAt: data.stored_at ?? null,
    raw: data,
  };
}

export async function prepareClaudeExecution({ claudeGroundingRunId, modelName }) {
  const { data, error } = await supabase.rpc("lifeguard_prepare_claude_execution", {
    p_claude_grounding_run_id: claudeGroundingRunId,
    p_model_name: modelName,
  });

  if (error) {
    throw new Error(mapError(error));
  }

  return normalizeClaudeExecutionPreparation(data);
}

export async function storeClaudeExecutionResult({
  claudeExecutionRunId,
  responseContext,
  executionStatus,
  errorMessage,
}) {
  const { data, error } = await supabase.rpc("lifeguard_store_claude_execution_result", {
    p_claude_execution_run_id: claudeExecutionRunId,
    p_response_context: responseContext ?? {},
    p_execution_status: executionStatus,
    p_error_message: errorMessage?.trim() || null,
  });

  if (error) {
    throw new Error(mapError(error));
  }

  return normalizeClaudeExecutionResult(data);
}

export async function loadClaudeExecutionRun(runId) {
  if (!runId) return null;

  const { data, error } = await supabase
    .from("claude_execution_runs")
    .select(
      "id, claude_grounding_run_id, execution_status, model_name, request_context, response_context, source_count, error_message, created_at, completed_at"
    )
    .eq("id", runId)
    .maybeSingle();

  if (error) {
    throw new Error(mapError(error));
  }

  return data;
}

export async function loadClaudeExecutionItems(runId) {
  if (!runId) return [];

  const { data, error } = await supabase
    .from("claude_execution_items")
    .select(
      "id, claude_execution_run_id, query, execution_status, response_reference, error_message, created_at"
    )
    .eq("claude_execution_run_id", runId)
    .order("created_at", { ascending: true });

  if (error) {
    throw new Error(mapError(error));
  }

  return data ?? [];
}

export async function loadRecentClaudeGroundingRuns(limit = 20) {
  const { data, error } = await supabase
    .from("claude_grounding_runs")
    .select("id, query, response_status, request_context, created_at")
    .in("response_status", ["ready_for_claude", "completed"])
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    throw new Error(mapError(error));
  }

  return data ?? [];
}
