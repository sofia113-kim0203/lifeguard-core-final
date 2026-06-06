import { supabase } from "./supabase.js";
import { loadPolicyRagSources, POLICY_RAG_SOURCE_TYPE_LABELS } from "./policyRag.js";

const MISSING_REAL_POLICY_EMBEDDING_PREP_HINT =
  "실제 약관 Embedding 준비가 아직 배포되지 않았습니다. Supabase SQL Editor에서 supabase/scripts/phase14_real_policy_embedding_preparation_foundation.sql 을 실행해 주세요.";

export const REAL_POLICY_EMBEDDING_PREPARATION_STATUS_LABELS = {
  pending: "대기",
  processing: "처리 중",
  queued: "큐 등록",
  completed: "완료",
  failed: "실패",
  partial: "부분 완료",
};

export const REAL_POLICY_EMBEDDING_PREPARATION_MISSING_LABELS = {
  chunk_generation_run_not_found: "Chunk 생성 run 없음",
  chunk_generation_not_completed: "Chunk 생성 미완료",
  rag_source_not_found: "RAG 소스 없음",
  no_approved_chunks: "승인된 청크 없음",
  no_chunks_queued: "큐에 등록된 청크 없음",
  chunk_registry_missing: "청크 레지스트리 없음",
  chunk_not_approved: "승인되지 않은 청크",
  rag_source_mismatch: "RAG 소스 불일치",
  already_queued: "이미 큐에 등록됨",
  queue_insert_skipped: "큐 등록 건너뜀",
};

function mapError(error) {
  if (!error?.message) return "실제 약관 Embedding 준비를 처리하지 못했습니다.";
  const m = error.message;
  if (
    m.includes("lifeguard_prepare_real_policy_embedding") ||
    m.includes("real_policy_embedding_preparation_runs") ||
    m.includes("real_policy_embedding_preparation_items") ||
    m.includes("does not exist")
  ) {
    return MISSING_REAL_POLICY_EMBEDDING_PREP_HINT;
  }
  if (m === "real_chunk_generation_run_id_required") return "Chunk 생성 run ID가 필요합니다.";
  if (m === "rag_source_id_required") return "RAG 소스를 선택해 주세요.";
  if (m === "embedding_provider_required") return "Provider를 입력해 주세요.";
  if (m === "embedding_model_required") return "Model을 입력해 주세요.";
  if (m === "chunk_generation_run_not_found") return "Chunk 생성 run을 찾을 수 없습니다.";
  if (m === "chunk_generation_not_completed") return "완료된 Chunk 생성 run만 준비할 수 있습니다.";
  if (m === "rag_source_not_found") return "RAG 소스를 찾을 수 없습니다.";
  if (m === "forbidden") return "관리자 권한이 필요합니다.";
  return m;
}

export { loadPolicyRagSources, POLICY_RAG_SOURCE_TYPE_LABELS };

export function normalizeRealPolicyEmbeddingPreparation(data) {
  if (!data || typeof data !== "object") {
    return null;
  }

  const missing = Array.isArray(data.missing_information) ? data.missing_information : [];

  return {
    realEmbeddingPreparationRunId: data.real_embedding_preparation_run_id ?? null,
    approvedChunkCount: data.approved_chunk_count ?? 0,
    queuedChunkCount: data.queued_chunk_count ?? 0,
    skippedChunkCount: data.skipped_chunk_count ?? 0,
    preparationStatus: data.preparation_status ?? null,
    missingInformation: missing,
    createdAt: data.created_at ?? null,
    raw: data,
  };
}

export async function prepareRealPolicyEmbedding({
  realChunkGenerationRunId,
  ragSourceId,
  embeddingProvider,
  embeddingModel,
}) {
  const { data, error } = await supabase.rpc("lifeguard_prepare_real_policy_embedding", {
    p_real_chunk_generation_run_id: realChunkGenerationRunId,
    p_rag_source_id: ragSourceId,
    p_embedding_provider: embeddingProvider,
    p_embedding_model: embeddingModel,
  });

  if (error) {
    throw new Error(mapError(error));
  }

  return normalizeRealPolicyEmbeddingPreparation(data);
}

export async function loadRealPolicyChunkGenerationRunsForEmbeddingPrep(limit = 50) {
  const { data, error } = await supabase
    .from("real_policy_chunk_generation_runs")
    .select(
      "id, policy_pdf_id, policy_source_id, generation_status, generated_chunk_count, generation_context, created_at, pdf:real_policy_pdf_registry(file_name), source:real_policy_knowledge_sources(source_name)",
    )
    .eq("generation_status", "completed")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    throw new Error(mapError(error));
  }

  return data ?? [];
}

export async function loadRealPolicyEmbeddingPreparationRun(runId) {
  if (!runId) return null;

  const { data, error } = await supabase
    .from("real_policy_embedding_preparation_runs")
    .select(
      "id, real_chunk_generation_run_id, rag_source_id, embedding_provider, embedding_model, preparation_status, approved_chunk_count, queued_chunk_count, skipped_chunk_count, preparation_context, missing_information, error_message, created_at, completed_at, chunk_run:real_policy_chunk_generation_runs(id, generated_chunk_count, pdf:real_policy_pdf_registry(file_name)), rag_source:policy_rag_source_registry(source_type, source_reference)",
    )
    .eq("id", runId)
    .maybeSingle();

  if (error) {
    throw new Error(mapError(error));
  }

  return data;
}

export async function loadRealPolicyEmbeddingPreparationRuns(limit = 50) {
  const { data, error } = await supabase
    .from("real_policy_embedding_preparation_runs")
    .select(
      "id, real_chunk_generation_run_id, rag_source_id, embedding_provider, embedding_model, preparation_status, approved_chunk_count, queued_chunk_count, skipped_chunk_count, missing_information, error_message, created_at, completed_at, chunk_run:real_policy_chunk_generation_runs(pdf:real_policy_pdf_registry(file_name))",
    )
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    throw new Error(mapError(error));
  }

  return data ?? [];
}

export async function loadApprovedRealPolicyChunkCount(realChunkGenerationRunId, ragSourceId) {
  if (!realChunkGenerationRunId || !ragSourceId) return 0;

  const { data, error } = await supabase
    .from("real_policy_chunk_items")
    .select("id, chunk_registry_id, chunk_status, registry:policy_chunk_registry!inner(id, chunk_status, rag_source_id)")
    .eq("real_chunk_generation_run_id", realChunkGenerationRunId)
    .eq("chunk_status", "approved")
    .eq("registry.chunk_status", "approved")
    .eq("registry.rag_source_id", ragSourceId);

  if (error) {
    throw new Error(mapError(error));
  }

  return data?.length ?? 0;
}
