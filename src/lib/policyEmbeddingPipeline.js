import { supabase } from "./supabase.js";

const ROUTE_PATH = "/api/policy-embedding-pipeline";

const MISSING_EMBEDDING_PIPELINE_HINT =
  "Embedding Pipeline이 아직 배포되지 않았습니다. Supabase SQL Editor에서 supabase/scripts/phase12_embedding_pipeline_foundation.sql 을 실행해 주세요.";

export const EMBEDDING_PIPELINE_STATUS_LABELS = {
  pending: "대기",
  queued: "큐 등록",
  processing: "처리 중",
  completed: "완료",
  failed: "실패",
  partial: "부분 완료",
};

export const EMBEDDING_PIPELINE_ITEM_STATUS_LABELS = {
  pending: "대기",
  queued: "큐 등록",
  processing: "처리 중",
  embedded: "임베딩 완료",
  failed: "실패",
  skipped: "건너뜀",
};

export const EMBEDDING_PIPELINE_MISSING_LABELS = {
  rag_source_not_found: "RAG Source 없음",
  no_approved_chunks: "승인된 Chunk 없음",
  no_chunks_queued: "큐에 등록된 Chunk 없음",
  no_execution_items_for_source: "해당 소스 실행 항목 없음",
  pipeline_item_not_found: "Pipeline 항목 없음",
  vector_reference_required: "Vector Reference 필요",
};

function mapRpcError(message) {
  if (!message) return "Embedding Pipeline을 처리하지 못했습니다.";
  if (
    message.includes("lifeguard_prepare_embedding_pipeline") ||
    message.includes("lifeguard_link_embedding_pipeline_result") ||
    message.includes("policy_embedding_pipeline_runs") ||
    message.includes("policy_embedding_pipeline_items") ||
    message.includes("does not exist")
  ) {
    return MISSING_EMBEDDING_PIPELINE_HINT;
  }
  if (message === "rag_source_id_required") return "RAG Source를 선택해 주세요.";
  if (message === "embedding_provider_required") return "Provider를 입력해 주세요.";
  if (message === "embedding_model_required") return "Model을 입력해 주세요.";
  if (message === "embedding_pipeline_item_id_required") return "Pipeline 항목을 선택해 주세요.";
  if (message === "item_status_required" || message === "invalid_item_status") {
    return "항목 상태를 선택해 주세요.";
  }
  if (message === "pipeline_item_not_found") return "Pipeline 항목을 찾을 수 없습니다.";
  if (message === "vector_reference_required") return "Vector Reference를 입력해 주세요.";
  if (message === "forbidden") return "관리자 권한이 필요합니다.";
  return message;
}

function mapRouteError(payload, status) {
  if (payload?.error_message) return mapRpcError(payload.error_message);
  if (payload?.reason === "SUPABASE_NOT_CONFIGURED") {
    return "서버 Supabase 설정이 없습니다.";
  }
  if (payload?.reason === "INVALID_BODY") return "요청 본문이 올바르지 않습니다.";
  if (status === 404) {
    return "Embedding Pipeline API 경로를 찾을 수 없습니다. 서버 라우트 배포를 확인해 주세요.";
  }
  return "Embedding Pipeline을 처리하지 못했습니다.";
}

async function postPolicyEmbeddingPipeline(body) {
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

export function normalizeEmbeddingPipelinePreparation(data) {
  if (!data || typeof data !== "object") {
    return null;
  }

  const missing = Array.isArray(data.missing_information) ? data.missing_information : [];

  return {
    embeddingPipelineRunId: data.embedding_pipeline_run_id ?? null,
    approvedChunkCount: data.approved_chunk_count ?? 0,
    queuedCount: data.queued_count ?? 0,
    executionCount: data.execution_count ?? 0,
    pipelineStatus: data.pipeline_status ?? null,
    missingInformation: missing,
    createdAt: data.created_at ?? null,
    raw: data,
  };
}

export function normalizeEmbeddingPipelineLinkResult(data) {
  if (!data || typeof data !== "object") {
    return null;
  }

  const missing = Array.isArray(data.missing_information) ? data.missing_information : [];

  return {
    embeddingPipelineItemId: data.embedding_pipeline_item_id ?? null,
    vectorRegistryId: data.vector_registry_id ?? null,
    itemStatus: data.item_status ?? null,
    vectorReference: data.vector_reference ?? null,
    pipelineStatus: data.pipeline_status ?? null,
    embeddedCount: data.embedded_count ?? 0,
    failedCount: data.failed_count ?? 0,
    missingInformation: missing,
    linkedAt: data.linked_at ?? null,
    raw: data,
  };
}

export async function prepareEmbeddingPipeline({ ragSourceId, embeddingProvider, embeddingModel }) {
  const { response, payload } = await postPolicyEmbeddingPipeline({
    mode: "prepare",
    ragSourceId,
    embeddingProvider,
    embeddingModel,
  });

  if (!response.ok || payload.ok === false) {
    throw new Error(mapRouteError(payload, response.status));
  }

  return normalizeEmbeddingPipelinePreparation(payload);
}

export async function linkEmbeddingPipelineResult({
  embeddingPipelineItemId,
  vectorReference,
  itemStatus,
  errorMessage,
}) {
  const { response, payload } = await postPolicyEmbeddingPipeline({
    mode: "link_result",
    embeddingPipelineItemId,
    vectorReference,
    itemStatus,
    errorMessage,
  });

  if (!response.ok || payload.ok === false) {
    throw new Error(mapRouteError(payload, response.status));
  }

  return normalizeEmbeddingPipelineLinkResult(payload);
}

export async function loadEmbeddingPipelineRun(runId) {
  if (!runId) return null;

  const { data, error } = await supabase
    .from("policy_embedding_pipeline_runs")
    .select(
      "id, rag_source_id, embedding_provider, embedding_model, pipeline_status, approved_chunk_count, queued_count, execution_count, embedded_count, failed_count, pipeline_context, missing_information, error_message, created_at, completed_at"
    )
    .eq("id", runId)
    .maybeSingle();

  if (error) {
    throw new Error(mapRpcError(error.message));
  }

  return data;
}

export async function loadEmbeddingPipelineItems(runId) {
  if (!runId) return [];

  const { data, error } = await supabase
    .from("policy_embedding_pipeline_items")
    .select(
      "id, embedding_pipeline_run_id, chunk_registry_id, embedding_queue_id, embedding_execution_item_id, vector_registry_id, item_status, vector_reference, error_message, created_at, completed_at"
    )
    .eq("embedding_pipeline_run_id", runId)
    .order("created_at", { ascending: true });

  if (error) {
    throw new Error(mapRpcError(error.message));
  }

  return data ?? [];
}

export { loadPolicyRagSources } from "./policyEmbeddingPreparation.js";
