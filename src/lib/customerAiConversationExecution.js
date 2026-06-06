import { supabase } from "./supabase.js";
import { loadCustomersForGroundingTest } from "./customerGrounding.js";

const ROUTE_PATH = "/api/customer-ai-conversation-execution";

const MISSING_AI_CONVERSATION_HINT =
  "고객 AI 대화 실행이 아직 배포되지 않았습니다. Supabase SQL Editor에서 supabase/scripts/phase13_customer_ai_conversation_execution_foundation.sql 을 실행해 주세요.";

export const AI_CONVERSATION_EXECUTION_STATUS_LABELS = {
  pending: "대기",
  preparing: "준비 중",
  ready: "실행 준비 완료",
  completed: "완료",
  failed: "실패",
};

export const AI_CONVERSATION_RESPONSE_STATUS_LABELS = {
  pending: "대기",
  prepared: "준비됨",
  stored: "저장됨",
  failed: "실패",
};

export const AI_CONVERSATION_MISSING_LABELS = {
  no_query: "검색어 없음",
  customer_not_found: "고객을 찾을 수 없음",
  grounded_conversation_failed: "Grounded 대화 실패",
  grounded_conversation_failed_status: "Grounded 대화 실패",
  grounded_conversation_insufficient_context: "Grounded 대화 컨텍스트 부족",
  claude_grounding_request_failed: "Claude Grounding 요청 실패",
  claude_execution_prep_failed: "Claude 실행 준비 실패",
  claude_grounding_run_missing: "Claude grounding run 없음",
  response_text_required: "응답 텍스트 필요",
};

function mapError(error) {
  if (!error?.message) return "고객 AI 대화 실행을 처리하지 못했습니다.";
  const m = error.message;
  if (
    m.includes("lifeguard_prepare_customer_ai_conversation") ||
    m.includes("lifeguard_store_customer_ai_response") ||
    m.includes("customer_ai_conversation_runs") ||
    m.includes("customer_ai_conversation_responses") ||
    m.includes("does not exist")
  ) {
    return MISSING_AI_CONVERSATION_HINT;
  }
  if (m === "customer_id_required") return "고객을 선택해 주세요.";
  if (m === "conversation_id_required") return "Conversation ID를 입력해 주세요.";
  if (m === "query_required") return "Query를 입력해 주세요.";
  if (m === "ai_conversation_run_id_required") return "AI conversation run ID가 필요합니다.";
  if (m === "ai_conversation_run_not_found") return "AI conversation run을 찾을 수 없습니다.";
  if (m === "response_text_required") return "응답 텍스트를 입력해 주세요.";
  if (m === "forbidden") return "관리자 권한이 필요합니다.";
  return m;
}

function mapServerError(payload, status) {
  if (payload?.error_message) return payload.error_message;
  if (payload?.reason === "ANTHROPIC_NOT_CONFIGURED") {
    return "서버에 Claude API 키가 설정되지 않았습니다.";
  }
  if (payload?.reason === "INVALID_BODY") return "요청 본문이 올바르지 않습니다.";
  if (status === 404) {
    return "고객 AI 대화 실행 API 경로를 찾을 수 없습니다. 서버 라우트 배포를 확인해 주세요.";
  }
  return "고객 AI 대화 실행을 처리하지 못했습니다.";
}

async function postCustomerAiConversationExecution(body) {
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

export { loadCustomersForGroundingTest };

export function normalizeCustomerAiConversationPreparation(data) {
  if (!data || typeof data !== "object") {
    return null;
  }

  const missing = Array.isArray(data.missing_information) ? data.missing_information : [];

  return {
    aiConversationRunId: data.ai_conversation_run_id ?? null,
    groundedConversationRunId: data.grounded_conversation_run_id ?? null,
    claudeExecutionRunId: data.claude_execution_run_id ?? null,
    executionStatus: data.execution_status ?? null,
    missingInformation: missing,
    raw: data,
  };
}

export function normalizeCustomerAiConversationExecution(data) {
  if (!data || typeof data !== "object") {
    return null;
  }

  return {
    ok: data.ok ?? false,
    aiConversationRunId: data.ai_conversation_run_id ?? null,
    claudeExecutionRunId: data.claude_execution_run_id ?? null,
    executionStatus: data.execution_status ?? null,
    responsePreview: data.response_preview ?? {},
    aiResponseId: data.ai_response_id ?? null,
    responseStatus: data.response_status ?? null,
    errorMessage: data.error_message ?? null,
    raw: data,
  };
}

export async function prepareCustomerAiConversation({ customerId, conversationId, query }) {
  const { response, payload } = await postCustomerAiConversationExecution({
    mode: "prepare",
    customer_id: customerId,
    conversation_id: conversationId,
    query,
  });

  if (!response.ok || payload.ok === false) {
    throw new Error(mapServerError(payload, response.status));
  }

  return normalizeCustomerAiConversationPreparation(payload);
}

export async function executeCustomerAiConversation(aiConversationRunId) {
  if (!aiConversationRunId) {
    throw new Error("AI conversation run ID가 필요합니다.");
  }

  const { response, payload } = await postCustomerAiConversationExecution({
    mode: "execute",
    ai_conversation_run_id: aiConversationRunId,
  });

  if (!response.ok || payload.ok === false) {
    throw new Error(mapServerError(payload, response.status));
  }

  return normalizeCustomerAiConversationExecution(payload);
}

export async function storeCustomerAiResponse({
  aiConversationRunId,
  responseText,
  responseSourceCount,
}) {
  const { data, error } = await supabase.rpc("lifeguard_store_customer_ai_response", {
    p_ai_conversation_run_id: aiConversationRunId,
    p_response_text: responseText,
    p_response_source_count: responseSourceCount ?? 0,
  });

  if (error) {
    throw new Error(mapError(error));
  }

  return {
    aiResponseId: data?.ai_response_id ?? null,
    responseStatus: data?.response_status ?? null,
    raw: data,
  };
}

export async function loadCustomerAiConversationRun(runId) {
  if (!runId) return null;

  const { data, error } = await supabase
    .from("customer_ai_conversation_runs")
    .select(
      "id, customer_id, conversation_id, query, execution_status, grounded_conversation_run_id, claude_execution_run_id, response_preview, response_status, missing_information, error_message, created_at, completed_at",
    )
    .eq("id", runId)
    .maybeSingle();

  if (error) {
    throw new Error(mapError(error));
  }

  return data;
}

export async function loadCustomerAiConversationResponses(runId) {
  if (!runId) return [];

  const { data, error } = await supabase
    .from("customer_ai_conversation_responses")
    .select(
      "id, ai_conversation_run_id, customer_id, conversation_id, response_text, response_source_count, response_status, created_at",
    )
    .eq("ai_conversation_run_id", runId)
    .order("created_at", { ascending: true });

  if (error) {
    throw new Error(mapError(error));
  }

  return data ?? [];
}
