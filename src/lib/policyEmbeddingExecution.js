import { supabase } from "./supabase.js";

const MISSING_EMBEDDING_EXECUTION_HINT =
  "실제 Embedding 실행이 아직 배포되지 않았습니다. Supabase SQL Editor에서 supabase/scripts/phase12_embedding_execution_foundation.sql 을 실행해 주세요.";

export const EMBEDDING_EXECUTION_STATUS_LABELS = {
  pending: "대기",
  running: "실행 중",
  completed: "완료",
  failed: "실패",
  partial: "부분 완료",
};

export const EMBEDDING_EXECUTION_ITEM_STATUS_LABELS = {
  pending: "대기",
  processing: "처리 중",
  embedded: "임베딩 완료",
  failed: "실패",
  skipped: "건너뜀",
};

export const EMBEDDING_EXECUTION_MISSING_LABELS = {
  no_embedding_queue_table: "Embedding 큐 테이블 없음",
  no_queued_items: "대기 중인 항목 없음",
  execution_item_not_found: "실행 항목을 찾을 수 없음",
  vector_reference_required: "Vector Reference 필요",
};

function mapError(error) {
  if (!error?.message) return "Embedding 실행을 처리하지 못했습니다.";
  const m = error.message;
  if (
    m.includes("lifeguard_prepare_embedding_execution") ||
    m.includes("lifeguard_store_embedding_execution_result") ||
    m.includes("policy_embedding_execution_runs") ||
    m.includes("policy_embedding_execution_items") ||
    m.includes("does not exist")
  ) {
    return MISSING_EMBEDDING_EXECUTION_HINT;
  }
  if (m === "embedding_provider_required") return "Provider를 입력해 주세요.";
  if (m === "embedding_model_required") return "Model을 입력해 주세요.";
  if (m === "embedding_execution_item_id_required") return "실행 항목을 선택해 주세요.";
  if (m === "execution_status_required" || m === "invalid_execution_status") {
    return "실행 상태를 선택해 주세요.";
  }
  if (m === "execution_item_not_found") return "실행 항목을 찾을 수 없습니다.";
  if (m === "vector_reference_required") return "Vector Reference를 입력해 주세요.";
  if (m === "forbidden") return "관리자 권한이 필요합니다.";
  return m;
}

export function normalizeEmbeddingExecutionPreparation(data) {
  if (!data || typeof data !== "object") {
    return null;
  }

  const missing = Array.isArray(data.missing_information)
    ? data.missing_information
    : [];

  return {
    embeddingExecutionRunId: data.embedding_execution_run_id ?? null,
    queuedCount: data.queued_count ?? 0,
    executionStatus: data.execution_status ?? null,
    missingInformation: missing,
    executionContext: data.execution_context ?? {},
    createdAt: data.created_at ?? null,
    raw: data,
  };
}

export function normalizeEmbeddingExecutionResult(data) {
  if (!data || typeof data !== "object") {
    return null;
  }

  const missing = Array.isArray(data.missing_information)
    ? data.missing_information
    : [];

  return {
    embeddingExecutionItemId: data.embedding_execution_item_id ?? null,
    embeddingExecutionRunId: data.embedding_execution_run_id ?? null,
    executionStatus: data.execution_status ?? null,
    vectorReference: data.vector_reference ?? null,
    runStatus: data.run_status ?? null,
    processedCount: data.processed_count ?? 0,
    failedCount: data.failed_count ?? 0,
    missingInformation: missing,
    storedAt: data.stored_at ?? null,
    raw: data,
  };
}

export async function prepareEmbeddingExecution({ embeddingProvider, embeddingModel }) {
  const { data, error } = await supabase.rpc("lifeguard_prepare_embedding_execution", {
    p_embedding_provider: embeddingProvider,
    p_embedding_model: embeddingModel,
  });

  if (error) {
    throw new Error(mapError(error));
  }

  return normalizeEmbeddingExecutionPreparation(data);
}

export async function storeEmbeddingExecutionResult({
  embeddingExecutionItemId,
  vectorReference,
  executionStatus,
  errorMessage,
}) {
  const { data, error } = await supabase.rpc("lifeguard_store_embedding_execution_result", {
    p_embedding_execution_item_id: embeddingExecutionItemId,
    p_vector_reference: vectorReference?.trim() || null,
    p_execution_status: executionStatus,
    p_error_message: errorMessage?.trim() || null,
  });

  if (error) {
    throw new Error(mapError(error));
  }

  return normalizeEmbeddingExecutionResult(data);
}

export async function loadEmbeddingExecutionRun(runId) {
  if (!runId) return null;

  const { data, error } = await supabase
    .from("policy_embedding_execution_runs")
    .select(
      "id, embedding_provider, embedding_model, execution_status, queued_count, processed_count, failed_count, execution_context, error_message, created_at"
    )
    .eq("id", runId)
    .maybeSingle();

  if (error) {
    throw new Error(mapError(error));
  }

  return data;
}

export async function loadEmbeddingExecutionItems(runId) {
  if (!runId) return [];

  const { data, error } = await supabase
    .from("policy_embedding_execution_items")
    .select(
      "id, embedding_execution_run_id, embedding_queue_id, chunk_registry_id, execution_status, vector_reference, error_message, created_at, processed_at"
    )
    .eq("embedding_execution_run_id", runId)
    .order("created_at", { ascending: true });

  if (error) {
    throw new Error(mapError(error));
  }

  return data ?? [];
}
