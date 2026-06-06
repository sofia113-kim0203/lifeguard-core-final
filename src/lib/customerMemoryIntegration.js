import { supabase } from "./supabase.js";
import { loadCustomersForGroundingTest } from "./customerGrounding.js";

const MISSING_MEMORY_HINT =
  "고객 메모리 통합이 아직 배포되지 않았습니다. Supabase SQL Editor에서 supabase/scripts/phase13_customer_memory_integration_foundation.sql 을 실행해 주세요.";

export const MEMORY_TYPE_LABELS = {
  profile: "프로필",
  conversation: "대화",
  insurance: "보험",
  medical: "의료",
  tax: "세무",
  claim: "청구",
  policy: "약관",
  preference: "선호",
};

export const MEMORY_STATUS_LABELS = {
  active: "활성",
  archived: "보관",
  deleted: "삭제",
};

export const MEMORY_CONTEXT_STATUS_LABELS = {
  pending: "대기",
  processing: "처리 중",
  completed: "완료",
  failed: "실패",
};

export const MEMORY_MISSING_LABELS = {
  customer_not_found: "고객을 찾을 수 없음",
  no_active_memories: "활성 메모리 없음",
  insufficient_context: "컨텍스트 부족",
};

const MEMORY_TYPES = Object.keys(MEMORY_TYPE_LABELS);

function mapError(error) {
  if (!error?.message) return "고객 메모리를 처리하지 못했습니다.";
  const m = error.message;
  if (
    m.includes("lifeguard_register_customer_memory") ||
    m.includes("lifeguard_prepare_customer_memory_context") ||
    m.includes("customer_memory_registry") ||
    m.includes("customer_memory_context_runs") ||
    m.includes("does not exist")
  ) {
    return MISSING_MEMORY_HINT;
  }
  if (m === "customer_id_required") return "고객을 선택해 주세요.";
  if (m === "memory_type_required" || m === "invalid_memory_type") return "메모리 유형을 선택해 주세요.";
  if (m === "memory_title_required") return "메모리 제목을 입력해 주세요.";
  if (m === "memory_content_required") return "메모리 내용을 입력해 주세요.";
  if (m === "customer_not_found") return "고객을 찾을 수 없습니다.";
  if (m === "forbidden") return "관리자 권한이 필요합니다.";
  return m;
}

export { loadCustomersForGroundingTest, MEMORY_TYPES };

export function normalizeCustomerMemoryRegistration(data) {
  if (!data || typeof data !== "object") {
    return null;
  }

  const missing = Array.isArray(data.missing_information) ? data.missing_information : [];

  return {
    customerMemoryId: data.customer_memory_id ?? null,
    memoryStatus: data.memory_status ?? null,
    missingInformation: missing,
    createdAt: data.created_at ?? null,
    raw: data,
  };
}

export function normalizeCustomerMemoryContext(data) {
  if (!data || typeof data !== "object") {
    return null;
  }

  const missing = Array.isArray(data.missing_information) ? data.missing_information : [];

  return {
    memoryContextRunId: data.memory_context_run_id ?? null,
    memoryCount: data.memory_count ?? 0,
    groundingSourceCount: data.grounding_source_count ?? 0,
    contextStatus: data.context_status ?? null,
    missingInformation: missing,
    contextSummary: data.context_summary ?? {},
    createdAt: data.created_at ?? null,
    raw: data,
  };
}

export async function registerCustomerMemory({
  customerId,
  memoryType,
  memoryTitle,
  memoryContent,
  memorySource,
}) {
  const { data, error } = await supabase.rpc("lifeguard_register_customer_memory", {
    p_customer_id: customerId,
    p_memory_type: memoryType,
    p_memory_title: memoryTitle,
    p_memory_content: memoryContent,
    p_memory_source: memorySource?.trim() || null,
  });

  if (error) {
    throw new Error(mapError(error));
  }

  return normalizeCustomerMemoryRegistration(data);
}

export async function prepareCustomerMemoryContext({ customerId }) {
  const { data, error } = await supabase.rpc("lifeguard_prepare_customer_memory_context", {
    p_customer_id: customerId,
  });

  if (error) {
    throw new Error(mapError(error));
  }

  return normalizeCustomerMemoryContext(data);
}

export async function loadCustomerMemories(customerId) {
  if (!customerId) return [];

  const { data, error } = await supabase
    .from("customer_memory_registry")
    .select(
      "id, customer_id, memory_type, memory_title, memory_content, memory_source, memory_status, created_at, updated_at"
    )
    .eq("customer_id", customerId)
    .eq("memory_status", "active")
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error(mapError(error));
  }

  return data ?? [];
}

export async function loadCustomerMemoryContextRun(runId) {
  if (!runId) return null;

  const { data, error } = await supabase
    .from("customer_memory_context_runs")
    .select(
      "id, customer_id, context_status, memory_count, grounding_source_count, context_summary, missing_information, error_message, created_at"
    )
    .eq("id", runId)
    .maybeSingle();

  if (error) {
    throw new Error(mapError(error));
  }

  return data;
}
