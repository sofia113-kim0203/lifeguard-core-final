import { supabase } from "./supabase.js";
import { loadPolicyRagSources, POLICY_RAG_SOURCE_TYPE_LABELS } from "./policyRag.js";

const MISSING_CHUNK_PROCESSING_HINT =
  "약관 Chunk 처리가 아직 배포되지 않았습니다. Supabase SQL Editor에서 supabase/scripts/phase11_policy_chunk_processing_foundation.sql 을 실행해 주세요.";

export const POLICY_CHUNK_STATUS_LABELS = {
  created: "생성됨",
  approved: "승인",
  rejected: "거절",
  archived: "보관",
};

export const POLICY_CHUNK_PROCESSING_STATUS_LABELS = {
  pending: "대기",
  processing: "처리 중",
  completed: "완료",
  failed: "실패",
};

export const POLICY_CHUNK_MISSING_LABELS = {
  rag_source_not_found: "RAG 소스를 찾을 수 없음",
  no_manual_entries_table: "수작업 지식 테이블 없음",
  manual_not_approved_for_rag: "RAG 승인되지 않은 수작업 지식",
  manual_entry_not_found: "수작업 지식 항목 없음",
  no_policy_chunks_table: "약관 청크 테이블 없음",
  no_existing_chunks: "기존 청크 없음",
  unsupported_source_type: "지원하지 않는 소스 유형",
  chunk_not_found: "청크를 찾을 수 없음",
};

function mapError(error) {
  if (!error?.message) return "약관 Chunk 처리를 처리하지 못했습니다.";
  const m = error.message;
  if (
    m.includes("lifeguard_process_policy_chunks") ||
    m.includes("lifeguard_review_policy_chunk") ||
    m.includes("policy_chunk_processing_runs") ||
    m.includes("policy_chunk_registry") ||
    m.includes("does not exist")
  ) {
    return MISSING_CHUNK_PROCESSING_HINT;
  }
  if (m === "rag_source_id_required") return "RAG 소스를 선택해 주세요.";
  if (m === "rag_source_not_found") return "RAG 소스를 찾을 수 없습니다.";
  if (m === "chunk_registry_id_required") return "청크를 선택해 주세요.";
  if (m === "chunk_status_required" || m === "invalid_chunk_status") {
    return "청크 상태를 선택해 주세요.";
  }
  if (m === "chunk_not_found") return "청크를 찾을 수 없습니다.";
  if (m === "forbidden") return "관리자 권한이 필요합니다.";
  return m;
}

export { loadPolicyRagSources, POLICY_RAG_SOURCE_TYPE_LABELS };

export function normalizePolicyChunkProcessing(data) {
  if (!data || typeof data !== "object") {
    return null;
  }

  const missing = Array.isArray(data.missing_information)
    ? data.missing_information
    : [];

  return {
    chunkProcessingRunId: data.chunk_processing_run_id ?? null,
    ragSourceId: data.rag_source_id ?? null,
    totalChunks: data.total_chunks ?? 0,
    processingStatus: data.processing_status ?? null,
    missingInformation: missing,
    processingContext: data.processing_context ?? {},
    createdAt: data.created_at ?? null,
    raw: data,
  };
}

export function normalizePolicyChunkReview(data) {
  if (!data || typeof data !== "object") {
    return null;
  }

  const missing = Array.isArray(data.missing_information)
    ? data.missing_information
    : [];

  return {
    chunkRegistryId: data.chunk_registry_id ?? null,
    chunkStatus: data.chunk_status ?? null,
    missingInformation: missing,
    reviewedAt: data.reviewed_at ?? null,
    raw: data,
  };
}

export async function loadPolicyChunkRegistry(ragSourceId) {
  if (!ragSourceId) return [];

  let query = supabase
    .from("policy_chunk_registry")
    .select(
      "id, rag_source_id, source_type, source_reference, chunk_sequence, chunk_text, chunk_status, created_at"
    )
    .order("chunk_sequence", { ascending: true })
    .limit(200);

  query = query.eq("rag_source_id", ragSourceId);

  const { data, error } = await query;

  if (error) {
    throw new Error(mapError(error));
  }

  return (data ?? []).map((row) => ({
    chunkRegistryId: row.id,
    ragSourceId: row.rag_source_id,
    sourceType: row.source_type,
    sourceReference: row.source_reference,
    chunkSequence: row.chunk_sequence,
    chunkText: row.chunk_text,
    chunkStatus: row.chunk_status,
    createdAt: row.created_at,
  }));
}

export async function loadPolicyChunkProcessingRuns(ragSourceId) {
  if (!ragSourceId) return [];

  const { data, error } = await supabase
    .from("policy_chunk_processing_runs")
    .select(
      "id, rag_source_id, processing_status, total_chunks, processing_context, missing_information, created_at"
    )
    .eq("rag_source_id", ragSourceId)
    .order("created_at", { ascending: false })
    .limit(20);

  if (error) {
    throw new Error(mapError(error));
  }

  return (data ?? []).map((row) => ({
    chunkProcessingRunId: row.id,
    ragSourceId: row.rag_source_id,
    processingStatus: row.processing_status,
    totalChunks: row.total_chunks,
    processingContext: row.processing_context ?? {},
    missingInformation: Array.isArray(row.missing_information)
      ? row.missing_information
      : [],
    createdAt: row.created_at,
  }));
}

export async function processPolicyChunks({ ragSourceId }) {
  const { data, error } = await supabase.rpc("lifeguard_process_policy_chunks", {
    p_rag_source_id: ragSourceId,
  });

  if (error) {
    throw new Error(mapError(error));
  }

  return normalizePolicyChunkProcessing(data);
}

export async function reviewPolicyChunk({ chunkRegistryId, chunkStatus }) {
  const { data, error } = await supabase.rpc("lifeguard_review_policy_chunk", {
    p_chunk_registry_id: chunkRegistryId,
    p_chunk_status: chunkStatus,
  });

  if (error) {
    throw new Error(mapError(error));
  }

  return normalizePolicyChunkReview(data);
}
