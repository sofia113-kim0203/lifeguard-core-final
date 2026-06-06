import { supabase } from "./supabase.js";

const MISSING_REAL_POLICY_EMBEDDING_EXECUTION_HINT =
  "실제 약관 Embedding 실행이 아직 배포되지 않았습니다. Supabase SQL Editor에서 supabase/scripts/phase14_real_policy_embedding_execution_integration.sql 을 실행해 주세요.";

export const REAL_POLICY_EMBEDDING_EXECUTION_STATUS_LABELS = {
  pending: "대기",
  processing: "처리 중",
  completed: "완료",
  failed: "실패",
  partial: "부분 완료",
};

export const REAL_POLICY_EMBEDDING_EXECUTION_ITEM_STATUS_LABELS = {
  pending: "대기",
  processing: "처리 중",
  embedded: "임베딩 완료",
  failed: "실패",
  skipped: "건너뜀",
};

export const REAL_POLICY_EMBEDDING_EXECUTION_MISSING_LABELS = {
  preparation_run_not_found: "준비 run 없음",
  preparation_run_not_ready: "준비 run 준비 미완료",
  no_queued_preparation_items: "큐된 준비 항목 없음",
  active_execution_run_exists: "활성 실행 run 존재",
  no_execution_items_created: "실행 항목 생성 실패",
  execution_item_create_failed: "실행 항목 생성 실패",
  execution_item_not_found: "실행 항목 없음",
  vector_reference_required: "Vector Reference 필요",
};

function mapError(error) {
  if (!error?.message) return "실제 약관 Embedding 실행을 처리하지 못했습니다.";
  const m = error.message;
  if (
    m.includes("lifeguard_prepare_real_policy_embedding_execution") ||
    m.includes("lifeguard_store_real_policy_embedding_execution_result") ||
    m.includes("real_policy_embedding_execution_runs") ||
    m.includes("real_policy_embedding_execution_items") ||
    m.includes("does not exist")
  ) {
    return MISSING_REAL_POLICY_EMBEDDING_EXECUTION_HINT;
  }
  if (m === "real_embedding_preparation_run_id_required") return "준비 run ID가 필요합니다.";
  if (m === "real_policy_embedding_execution_item_id_required") return "실행 항목 ID가 필요합니다.";
  if (m === "preparation_run_not_found") return "준비 run을 찾을 수 없습니다.";
  if (m === "preparation_run_not_ready") return "준비 run이 실행 가능한 상태가 아닙니다.";
  if (m === "active_execution_run_exists") return "이미 활성 실행 run이 있습니다.";
  if (m === "execution_item_not_found") return "실행 항목을 찾을 수 없습니다.";
  if (m === "item_status_required" || m === "invalid_item_status") return "항목 상태가 유효하지 않습니다.";
  if (m === "vector_reference_required") return "Vector Reference를 입력해 주세요.";
  if (m === "forbidden") return "관리자 권한이 필요합니다.";
  return m;
}

export function normalizeRealPolicyEmbeddingExecutionPreparation(data) {
  if (!data || typeof data !== "object") {
    return null;
  }

  const missing = Array.isArray(data.missing_information) ? data.missing_information : [];

  return {
    realPolicyEmbeddingExecutionRunId: data.real_policy_embedding_execution_run_id ?? null,
    embeddingExecutionRunId: data.embedding_execution_run_id ?? null,
    queuedChunkCount: data.queued_chunk_count ?? 0,
    executionStatus: data.execution_status ?? null,
    missingInformation: missing,
    createdAt: data.created_at ?? null,
    raw: data,
  };
}

export function normalizeRealPolicyEmbeddingExecutionResult(data) {
  if (!data || typeof data !== "object") {
    return null;
  }

  const missing = Array.isArray(data.missing_information) ? data.missing_information : [];

  return {
    realPolicyEmbeddingExecutionItemId: data.real_policy_embedding_execution_item_id ?? null,
    realPolicyEmbeddingExecutionRunId: data.real_policy_embedding_execution_run_id ?? null,
    itemStatus: data.item_status ?? null,
    vectorReference: data.vector_reference ?? null,
    executionStatus: data.execution_status ?? null,
    processedChunkCount: data.processed_chunk_count ?? 0,
    failedChunkCount: data.failed_chunk_count ?? 0,
    missingInformation: missing,
    storedAt: data.stored_at ?? null,
    raw: data,
  };
}

export async function prepareRealPolicyEmbeddingExecution(realEmbeddingPreparationRunId) {
  const { data, error } = await supabase.rpc("lifeguard_prepare_real_policy_embedding_execution", {
    p_real_embedding_preparation_run_id: realEmbeddingPreparationRunId,
  });

  if (error) {
    throw new Error(mapError(error));
  }

  return normalizeRealPolicyEmbeddingExecutionPreparation(data);
}

export async function storeRealPolicyEmbeddingExecutionResult({
  realPolicyEmbeddingExecutionItemId,
  vectorReference,
  itemStatus,
  errorMessage,
}) {
  const { data, error } = await supabase.rpc("lifeguard_store_real_policy_embedding_execution_result", {
    p_real_policy_embedding_execution_item_id: realPolicyEmbeddingExecutionItemId,
    p_vector_reference: vectorReference?.trim() || null,
    p_item_status: itemStatus,
    p_error_message: errorMessage?.trim() || null,
  });

  if (error) {
    throw new Error(mapError(error));
  }

  return normalizeRealPolicyEmbeddingExecutionResult(data);
}

export async function loadRealPolicyEmbeddingPreparationRunsForExecution(limit = 50) {
  const { data, error } = await supabase
    .from("real_policy_embedding_preparation_runs")
    .select(
      "id, real_chunk_generation_run_id, rag_source_id, embedding_provider, embedding_model, preparation_status, queued_chunk_count, created_at, chunk_run:real_policy_chunk_generation_runs(pdf:real_policy_pdf_registry(file_name))",
    )
    .in("preparation_status", ["completed", "partial", "queued"])
    .gt("queued_chunk_count", 0)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    throw new Error(mapError(error));
  }

  return data ?? [];
}

export async function loadRealPolicyEmbeddingExecutionRun(runId) {
  if (!runId) return null;

  const { data, error } = await supabase
    .from("real_policy_embedding_execution_runs")
    .select(
      "id, real_embedding_preparation_run_id, embedding_execution_run_id, rag_source_id, embedding_provider, embedding_model, execution_status, queued_chunk_count, processed_chunk_count, failed_chunk_count, execution_context, missing_information, error_message, created_at, completed_at, prep_run:real_policy_embedding_preparation_runs(id, preparation_status, queued_chunk_count), rag_source:policy_rag_source_registry(source_reference)",
    )
    .eq("id", runId)
    .maybeSingle();

  if (error) {
    throw new Error(mapError(error));
  }

  return data;
}

export async function loadRealPolicyEmbeddingExecutionItems(runId) {
  if (!runId) return [];

  const { data, error } = await supabase
    .from("real_policy_embedding_execution_items")
    .select(
      "id, real_policy_embedding_execution_run_id, real_embedding_preparation_item_id, real_policy_chunk_item_id, embedding_queue_id, embedding_execution_item_id, chunk_registry_id, item_status, vector_reference, error_message, created_at, completed_at",
    )
    .eq("real_policy_embedding_execution_run_id", runId)
    .order("created_at", { ascending: true });

  if (error) {
    throw new Error(mapError(error));
  }

  return data ?? [];
}

export async function loadRealPolicyEmbeddingExecutionRuns(limit = 50) {
  const { data, error } = await supabase
    .from("real_policy_embedding_execution_runs")
    .select(
      "id, real_embedding_preparation_run_id, embedding_execution_run_id, embedding_provider, embedding_model, execution_status, queued_chunk_count, processed_chunk_count, failed_chunk_count, error_message, created_at, completed_at",
    )
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    throw new Error(mapError(error));
  }

  return data ?? [];
}
