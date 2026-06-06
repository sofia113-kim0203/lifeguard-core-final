import { supabase } from "./supabase.js";

const MISSING_POLICY_CHUNK_GENERATION_HINT =
  "약관 Chunk 생성이 아직 배포되지 않았습니다. Supabase SQL Editor에서 supabase/scripts/phase12_policy_chunk_generation_foundation.sql 을 실행해 주세요.";

export const POLICY_CHUNK_GENERATION_STATUS_LABELS = {
  pending: "대기",
  queued: "대기열",
  processing: "처리 중",
  generated: "생성 완료",
  failed: "실패",
};

export const POLICY_CHUNK_GENERATION_MISSING_LABELS = {
  text_extraction_run_not_found: "텍스트 추출 run 없음",
  invalid_extraction_status: "추출 상태가 Chunk 생성 가능하지 않음",
  no_extracted_pages: "추출된 페이지 없음",
  rag_source_not_found: "RAG 소스 없음",
  chunk_generation_run_not_found: "Chunk 생성 run 없음",
  invalid_generation_status: "생성 상태가 유효하지 않음",
  already_generated: "이미 생성됨",
  chunks_already_exist: "청크가 이미 존재함",
  no_extracted_text_for_chunks: "청크 생성용 추출 텍스트 없음",
};

function mapError(error) {
  if (!error?.message) return "약관 Chunk 생성을 처리하지 못했습니다.";
  const m = error.message;
  if (
    m.includes("lifeguard_register_policy_chunk_generation") ||
    m.includes("lifeguard_generate_policy_chunks_from_extracted_text") ||
    m.includes("policy_chunk_generation_runs") ||
    m.includes("policy_generated_chunk_items") ||
    m.includes("does not exist")
  ) {
    return MISSING_POLICY_CHUNK_GENERATION_HINT;
  }
  if (m === "text_extraction_run_id_required") return "텍스트 추출 run ID가 필요합니다.";
  if (m === "chunk_generation_run_id_required") return "Chunk 생성 run ID가 필요합니다.";
  if (m === "text_extraction_run_not_found") return "텍스트 추출 run을 찾을 수 없습니다.";
  if (m === "chunk_generation_run_not_found") return "Chunk 생성 run을 찾을 수 없습니다.";
  if (m === "invalid_extraction_status") return "현재 추출 상태에서는 Chunk 생성을 등록할 수 없습니다.";
  if (m === "invalid_generation_status") return "현재 생성 상태에서는 Chunk를 생성할 수 없습니다.";
  if (m === "already_generated") return "이미 Chunk가 생성되었습니다.";
  if (m === "chunks_already_exist") return "청크가 이미 존재합니다.";
  if (m === "rag_source_not_found") return "RAG 소스를 찾을 수 없습니다.";
  if (m === "forbidden") return "관리자 권한이 필요합니다.";
  return m;
}

export function normalizePolicyChunkGenerationRegistration(data) {
  if (!data || typeof data !== "object") {
    return null;
  }

  const missing = Array.isArray(data.missing_information)
    ? data.missing_information
    : [];

  return {
    chunkGenerationRunId: data.chunk_generation_run_id ?? null,
    generationStatus: data.generation_status ?? null,
    missingInformation: missing,
    totalPages: data.total_pages ?? 0,
    ragSourceId: data.rag_source_id ?? null,
    createdAt: data.created_at ?? null,
    raw: data,
  };
}

export function normalizePolicyChunkGenerationResult(data) {
  if (!data || typeof data !== "object") {
    return null;
  }

  const missing = Array.isArray(data.missing_information)
    ? data.missing_information
    : [];

  return {
    chunkGenerationRunId: data.chunk_generation_run_id ?? null,
    totalChunks: data.total_chunks ?? 0,
    totalPages: data.total_pages ?? 0,
    generationStatus: data.generation_status ?? null,
    missingInformation: missing,
    generatedAt: data.generated_at ?? null,
    raw: data,
  };
}

export async function registerPolicyChunkGeneration(textExtractionRunId) {
  const { data, error } = await supabase.rpc("lifeguard_register_policy_chunk_generation", {
    p_text_extraction_run_id: textExtractionRunId,
  });

  if (error) {
    throw new Error(mapError(error));
  }

  return normalizePolicyChunkGenerationRegistration(data);
}

export async function generatePolicyChunksFromExtractedText(chunkGenerationRunId) {
  const { data, error } = await supabase.rpc("lifeguard_generate_policy_chunks_from_extracted_text", {
    p_chunk_generation_run_id: chunkGenerationRunId,
  });

  if (error) {
    throw new Error(mapError(error));
  }

  return normalizePolicyChunkGenerationResult(data);
}

export async function loadPolicyChunkGenerationRun(runId) {
  if (!runId) return null;

  const { data, error } = await supabase
    .from("policy_chunk_generation_runs")
    .select(
      "id, text_extraction_run_id, rag_source_id, carrier_id, product_id, generation_status, total_pages, total_chunks, generation_context, missing_information, error_message, created_at, completed_at, carrier:carrier_registry(carrier_name), product:carrier_product_registry(product_name), extraction_run:policy_text_extraction_runs(pdf_ingestion_run_id, extraction_status)"
    )
    .eq("id", runId)
    .maybeSingle();

  if (error) {
    throw new Error(mapError(error));
  }

  return data;
}

export async function loadPolicyGeneratedChunkItems(runId) {
  if (!runId) return [];

  const { data, error } = await supabase
    .from("policy_generated_chunk_items")
    .select(
      "id, chunk_generation_run_id, chunk_registry_id, page_number, chunk_sequence, chunk_text, chunk_status, source_reference, created_at"
    )
    .eq("chunk_generation_run_id", runId)
    .order("chunk_sequence", { ascending: true });

  if (error) {
    throw new Error(mapError(error));
  }

  return data ?? [];
}

export async function loadTextExtractionRunsForChunkGeneration(limit = 50) {
  const { data, error } = await supabase
    .from("policy_text_extraction_runs")
    .select(
      "id, carrier_id, product_id, extraction_status, created_at, carrier:carrier_registry(carrier_name), product:carrier_product_registry(product_name), pdf_run:policy_pdf_ingestion_runs(original_filename)"
    )
    .in("extraction_status", ["extracted", "processing"])
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    throw new Error(mapError(error));
  }

  return data ?? [];
}
