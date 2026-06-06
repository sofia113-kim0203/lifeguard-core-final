import { supabase } from "./supabase.js";
import { loadCustomersForGroundingTest } from "./customerGrounding.js";

const MISSING_CONVERSATION_MEMORY_HINT =
  "고객 대화 메모리가 아직 배포되지 않았습니다. Supabase SQL Editor에서 supabase/scripts/phase13_customer_conversation_memory_foundation.sql 을 실행해 주세요.";

export const CONVERSATION_MEMORY_RUN_STATUS_LABELS = {
  pending: "대기",
  processing: "처리 중",
  completed: "완료",
  failed: "실패",
};

export const CONVERSATION_MEMORY_ITEM_TYPE_LABELS = {
  conversation: "대화",
  medical: "의료",
  insurance: "보험",
  claim: "청구",
  preference: "선호",
  question: "질문",
  answer: "답변",
  note: "메모",
};

export const CONVERSATION_MEMORY_ITEM_STATUS_LABELS = {
  captured: "캡처됨",
  stored: "저장됨",
  skipped: "건너뜀",
  failed: "실패",
};

export const CONVERSATION_MEMORY_MISSING_LABELS = {
  customer_not_found: "고객을 찾을 수 없음",
  conversation_not_found: "대화를 찾을 수 없음",
  conversation_id_required: "Conversation ID 필요",
  message_role_required: "Message Role 필요",
  message_text_required: "Message Text 필요",
  memory_type_required: "Memory Type 필요",
  memory_title_required: "Memory Title 필요",
  no_stored_conversation_messages: "저장된 대화 메시지 없음",
  registry_store_failed: "메모리 레지스트리 저장 실패",
};

const CONVERSATION_MEMORY_TYPES = Object.keys(CONVERSATION_MEMORY_ITEM_TYPE_LABELS);
const MESSAGE_ROLES = ["user", "assistant", "system"];

function mapError(error) {
  if (!error?.message) return "고객 대화 메모리를 처리하지 못했습니다.";
  const m = error.message;
  if (
    m.includes("lifeguard_capture_customer_conversation_memory") ||
    m.includes("lifeguard_prepare_customer_conversation_memory_context") ||
    m.includes("customer_conversation_memory_runs") ||
    m.includes("customer_conversation_memory_items") ||
    m.includes("does not exist")
  ) {
    return MISSING_CONVERSATION_MEMORY_HINT;
  }
  if (m === "customer_id_required") return "고객을 선택해 주세요.";
  if (m === "conversation_id_required") return "Conversation ID를 입력해 주세요.";
  if (m === "message_role_required") return "Message Role을 선택해 주세요.";
  if (m === "message_text_required") return "Message Text를 입력해 주세요.";
  if (m === "memory_type_required" || m === "invalid_memory_type") return "Memory Type을 선택해 주세요.";
  if (m === "memory_title_required") return "Memory Title을 입력해 주세요.";
  if (m === "customer_not_found") return "고객을 찾을 수 없습니다.";
  if (m === "conversation_not_found") return "대화를 찾을 수 없습니다.";
  if (m === "forbidden") return "관리자 권한이 필요합니다.";
  return m;
}

export { loadCustomersForGroundingTest, CONVERSATION_MEMORY_TYPES, MESSAGE_ROLES };

export function normalizeConversationMemoryCapture(data) {
  if (!data || typeof data !== "object") {
    return null;
  }

  const missing = Array.isArray(data.missing_information) ? data.missing_information : [];

  return {
    conversationMemoryItemId: data.conversation_memory_item_id ?? null,
    conversationMemoryRunId: data.conversation_memory_run_id ?? null,
    memoryStatus: data.memory_status ?? null,
    missingInformation: missing,
    createdAt: data.created_at ?? null,
    raw: data,
  };
}

export function normalizeConversationMemoryContext(data) {
  if (!data || typeof data !== "object") {
    return null;
  }

  const missing = Array.isArray(data.missing_information) ? data.missing_information : [];

  return {
    conversationMemoryRunId: data.conversation_memory_run_id ?? null,
    messageCount: data.message_count ?? 0,
    memoryStatus: data.memory_status ?? null,
    memoryContext: data.memory_context ?? {},
    missingInformation: missing,
    createdAt: data.created_at ?? null,
    raw: data,
  };
}

export async function captureCustomerConversationMemory({
  customerId,
  conversationId,
  messageRole,
  messageText,
  memoryType,
  memoryTitle,
}) {
  const { data, error } = await supabase.rpc("lifeguard_capture_customer_conversation_memory", {
    p_customer_id: customerId,
    p_conversation_id: conversationId,
    p_message_role: messageRole,
    p_message_text: messageText,
    p_memory_type: memoryType,
    p_memory_title: memoryTitle,
  });

  if (error) {
    throw new Error(mapError(error));
  }

  return normalizeConversationMemoryCapture(data);
}

export async function prepareCustomerConversationMemoryContext({
  customerId,
  conversationId,
}) {
  const { data, error } = await supabase.rpc("lifeguard_prepare_customer_conversation_memory_context", {
    p_customer_id: customerId,
    p_conversation_id: conversationId,
  });

  if (error) {
    throw new Error(mapError(error));
  }

  return normalizeConversationMemoryContext(data);
}

export async function loadConversationMemoryItems({ customerId, conversationId }) {
  if (!customerId || !conversationId) return [];

  const { data, error } = await supabase
    .from("customer_conversation_memory_items")
    .select(
      "id, conversation_memory_run_id, customer_id, conversation_id, message_role, message_text, memory_type, memory_title, memory_content, memory_status, created_at"
    )
    .eq("customer_id", customerId)
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true });

  if (error) {
    throw new Error(mapError(error));
  }

  return data ?? [];
}

export async function loadConversationMemoryRun(runId) {
  if (!runId) return null;

  const { data, error } = await supabase
    .from("customer_conversation_memory_runs")
    .select(
      "id, customer_id, conversation_id, memory_status, message_count, memory_context, missing_information, error_message, created_at, completed_at"
    )
    .eq("id", runId)
    .maybeSingle();

  if (error) {
    throw new Error(mapError(error));
  }

  return data;
}
