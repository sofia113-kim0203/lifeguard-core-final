import { supabase } from "./supabase.js";
import { loadPolicyRagSources, POLICY_RAG_SOURCE_TYPE_LABELS } from "./policyRag.js";

const MISSING_EMBEDDING_PREP_HINT =
  "약관 Embedding 준비가 아직 배포되지 않았습니다. Supabase SQL Editor에서 supabase/scripts/phase11_embedding_preparation_foundation.sql 을 실행해 주세요.";

export const POLICY_EMBEDDING_STATUS_LABELS = {
  queued: "대기",
  processing: "처리 중",
  embedded: "임베딩 완료",
  failed: "실패",
  skipped: "건너뜀",
};

export const POLICY_VECTOR_STATUS_LABELS = {
  pending: "대기",
  available: "사용 가능",
  failed: "실패",
  archived: "보관",
};

export const POLICY_EMBEDDING_MISSING_LABELS = {
  rag_source_not_found: "RAG 소스를 찾을 수 없음",
  no_chunk_registry_table: "청크 레지스트리 테이블 없음",
  no_approved_chunks: "승인된 청크 없음",
  chunk_not_found: "청크를 찾을 수 없음",
  chunk_not_approved: "승인되지 않은 청크",
};

function mapError(error) {
  if (!error?.message) return "약관 Embedding 준비를 처리하지 못했습니다.";
  const m = error.message;
  if (
    m.includes("lifeguard_prepare_policy_embedding_queue") ||
    m.includes("lifeguard_register_policy_vector_reference") ||
    m.includes("policy_embedding_queue") ||
    m.includes("policy_vector_registry") ||
    m.includes("does not exist")
  ) {
    return MISSING_EMBEDDING_PREP_HINT;
  }
  if (m === "rag_source_id_required") return "RAG 소스를 선택해 주세요.";
  if (m === "rag_source_not_found") return "RAG 소스를 찾을 수 없습니다.";
  if (m === "chunk_registry_id_required") return "청크를 선택해 주세요.";
  if (m === "chunk_not_found") return "청크를 찾을 수 없습니다.";
  if (m === "chunk_not_approved") return "승인된 청크만 등록할 수 있습니다.";
  if (m === "embedding_provider_required") return "Provider를 입력해 주세요.";
  if (m === "embedding_model_required") return "Model을 입력해 주세요.";
  if (m === "vector_reference_required") return "Vector Reference를 입력해 주세요.";
  if (m === "forbidden") return "관리자 권한이 필요합니다.";
  return m;
}

export { loadPolicyRagSources, POLICY_RAG_SOURCE_TYPE_LABELS };

export function normalizeEmbeddingQueuePreparation(data) {
  if (!data || typeof data !== "object") {
    return null;
  }

  const missing = Array.isArray(data.missing_information)
    ? data.missing_information
    : [];

  return {
    ragSourceId: data.rag_source_id ?? null,
    queuedCount: data.queued_count ?? 0,
    skippedCount: data.skipped_count ?? 0,
    approvedChunkCount: data.approved_chunk_count ?? 0,
    missingInformation: missing,
    createdAt: data.created_at ?? null,
    raw: data,
  };
}

export function normalizeVectorReferenceRegistration(data) {
  if (!data || typeof data !== "object") {
    return null;
  }

  const missing = Array.isArray(data.missing_information)
    ? data.missing_information
    : [];

  return {
    vectorRegistryId: data.vector_registry_id ?? null,
    chunkRegistryId: data.chunk_registry_id ?? null,
    ragSourceId: data.rag_source_id ?? null,
    vectorStatus: data.vector_status ?? null,
    vectorReference: data.vector_reference ?? null,
    embeddingProvider: data.embedding_provider ?? null,
    embeddingModel: data.embedding_model ?? null,
    missingInformation: missing,
    createdAt: data.created_at ?? null,
    raw: data,
  };
}

export async function loadPolicyChunkCount(ragSourceId) {
  if (!ragSourceId) return 0;

  const { count, error } = await supabase
    .from("policy_chunk_registry")
    .select("id", { count: "exact", head: true })
    .eq("rag_source_id", ragSourceId);

  if (error) {
    throw new Error(mapError(error));
  }

  return count ?? 0;
}

export async function loadPolicyEmbeddingQueueStats(ragSourceId) {
  if (!ragSourceId) {
    return { queued: 0, processing: 0, embedded: 0, failed: 0, skipped: 0, total: 0 };
  }

  const { data, error } = await supabase
    .from("policy_embedding_queue")
    .select("embedding_status")
    .eq("rag_source_id", ragSourceId);

  if (error) {
    throw new Error(mapError(error));
  }

  const stats = { queued: 0, processing: 0, embedded: 0, failed: 0, skipped: 0, total: 0 };
  for (const row of data ?? []) {
    const status = row.embedding_status;
    if (stats[status] !== undefined) {
      stats[status] += 1;
    }
    stats.total += 1;
  }
  return stats;
}

export async function loadPolicyEmbeddingQueue(ragSourceId) {
  if (!ragSourceId) return [];

  const { data, error } = await supabase
    .from("policy_embedding_queue")
    .select(
      "id, chunk_registry_id, rag_source_id, embedding_status, embedding_provider, embedding_model, queue_context, error_message, created_at, processed_at"
    )
    .eq("rag_source_id", ragSourceId)
    .order("created_at", { ascending: false })
    .limit(100);

  if (error) {
    throw new Error(mapError(error));
  }

  return data ?? [];
}

export async function loadPolicyVectorRegistry(ragSourceId) {
  if (!ragSourceId) return [];

  const { data, error } = await supabase
    .from("policy_vector_registry")
    .select(
      "id, chunk_registry_id, rag_source_id, embedding_provider, embedding_model, vector_status, vector_reference, metadata, created_at"
    )
    .eq("rag_source_id", ragSourceId)
    .order("created_at", { ascending: false })
    .limit(100);

  if (error) {
    throw new Error(mapError(error));
  }

  return data ?? [];
}

export async function loadApprovedChunks(ragSourceId) {
  if (!ragSourceId) return [];

  const { data, error } = await supabase
    .from("policy_chunk_registry")
    .select("id, chunk_sequence, source_reference, chunk_status")
    .eq("rag_source_id", ragSourceId)
    .eq("chunk_status", "approved")
    .order("chunk_sequence", { ascending: true });

  if (error) {
    throw new Error(mapError(error));
  }

  return data ?? [];
}

export async function preparePolicyEmbeddingQueue({ ragSourceId }) {
  const { data, error } = await supabase.rpc("lifeguard_prepare_policy_embedding_queue", {
    p_rag_source_id: ragSourceId,
  });

  if (error) {
    throw new Error(mapError(error));
  }

  return normalizeEmbeddingQueuePreparation(data);
}

export async function registerPolicyVectorReference({
  chunkRegistryId,
  embeddingProvider,
  embeddingModel,
  vectorReference,
}) {
  const { data, error } = await supabase.rpc("lifeguard_register_policy_vector_reference", {
    p_chunk_registry_id: chunkRegistryId,
    p_embedding_provider: embeddingProvider,
    p_embedding_model: embeddingModel,
    p_vector_reference: vectorReference,
  });

  if (error) {
    throw new Error(mapError(error));
  }

  return normalizeVectorReferenceRegistration(data);
}
