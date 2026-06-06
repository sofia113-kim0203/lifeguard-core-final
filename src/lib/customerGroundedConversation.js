import { supabase } from "./supabase.js";
import { loadCustomersForGroundingTest } from "./customerGrounding.js";

const MISSING_GROUNDED_CONVERSATION_HINT =
  "고객 Grounded 대화가 아직 배포되지 않았습니다. Supabase SQL Editor에서 supabase/scripts/phase13_customer_grounded_conversation_foundation.sql 을 실행해 주세요.";

export const GROUNDED_CONVERSATION_RUN_STATUS_LABELS = {
  pending: "대기",
  processing: "처리 중",
  completed: "완료",
  failed: "실패",
  insufficient_context: "컨텍스트 부족",
};

export const GROUNDED_CONVERSATION_SOURCE_TYPE_LABELS = {
  customer_memory: "고객 메모리",
  conversation_memory: "대화 메모리",
  policy_grounding: "Policy Grounding",
  rag_source: "RAG Source",
  vector_search: "Vector Search",
};

export const GROUNDED_CONVERSATION_SOURCE_STATUS_LABELS = {
  selected: "선택됨",
  skipped: "건너뜀",
  missing: "없음",
};

export const GROUNDED_CONVERSATION_MISSING_LABELS = {
  no_query: "검색어 없음",
  customer_not_found: "고객을 찾을 수 없음",
  conversation_id_required: "Conversation ID 필요",
  customer_memory_context_failed: "고객 메모리 컨텍스트 실패",
  conversation_memory_context_failed: "대화 메모리 컨텍스트 실패",
  grounding_context_failed: "Grounding Context 실패",
  claude_grounding_prep_failed: "Claude Grounding 준비 실패",
  insufficient_context: "컨텍스트 부족",
  no_active_memories: "활성 메모리 없음",
  no_stored_conversation_messages: "저장된 대화 메시지 없음",
};

function mapError(error) {
  if (!error?.message) return "고객 Grounded 대화를 처리하지 못했습니다.";
  const m = error.message;
  if (
    m.includes("lifeguard_prepare_customer_grounded_conversation") ||
    m.includes("customer_grounded_conversation_runs") ||
    m.includes("customer_grounded_conversation_sources") ||
    m.includes("does not exist")
  ) {
    return MISSING_GROUNDED_CONVERSATION_HINT;
  }
  if (m === "customer_id_required") return "고객을 선택해 주세요.";
  if (m === "conversation_id_required") return "Conversation ID를 입력해 주세요.";
  if (m === "query_required") return "Query를 입력해 주세요.";
  if (m === "customer_not_found") return "고객을 찾을 수 없습니다.";
  if (m === "forbidden") return "관리자 권한이 필요합니다.";
  return m;
}

export { loadCustomersForGroundingTest };

export function normalizeCustomerGroundedConversation(data) {
  if (!data || typeof data !== "object") {
    return null;
  }

  const missing = Array.isArray(data.missing_information) ? data.missing_information : [];
  const contextSummary = data.context_summary ?? {};

  return {
    groundedConversationRunId: data.grounded_conversation_run_id ?? null,
    memoryCount: data.memory_count ?? 0,
    conversationMemoryCount: data.conversation_memory_count ?? 0,
    groundingSourceCount: data.grounding_source_count ?? 0,
    claudeGroundingReady: data.claude_grounding_ready ?? false,
    contextSummary,
    missingInformation: missing,
    runStatus: data.run_status ?? null,
    createdAt: data.created_at ?? null,
    raw: data,
  };
}

export async function prepareCustomerGroundedConversation({
  customerId,
  conversationId,
  query,
}) {
  const { data, error } = await supabase.rpc("lifeguard_prepare_customer_grounded_conversation", {
    p_customer_id: customerId,
    p_conversation_id: conversationId,
    p_query: query,
  });

  if (error) {
    throw new Error(mapError(error));
  }

  return normalizeCustomerGroundedConversation(data);
}

export async function loadCustomerGroundedConversationRun(runId) {
  if (!runId) return null;

  const { data, error } = await supabase
    .from("customer_grounded_conversation_runs")
    .select(
      "id, customer_id, conversation_id, query, run_status, memory_count, conversation_memory_count, grounding_source_count, claude_grounding_ready, context_summary, missing_information, error_message, created_at, completed_at"
    )
    .eq("id", runId)
    .maybeSingle();

  if (error) {
    throw new Error(mapError(error));
  }

  return data;
}

export async function loadCustomerGroundedConversationSources(runId) {
  if (!runId) return [];

  const { data, error } = await supabase
    .from("customer_grounded_conversation_sources")
    .select("id, grounded_conversation_run_id, source_type, source_reference, source_status, created_at")
    .eq("grounded_conversation_run_id", runId)
    .order("created_at", { ascending: true });

  if (error) {
    throw new Error(mapError(error));
  }

  return data ?? [];
}
