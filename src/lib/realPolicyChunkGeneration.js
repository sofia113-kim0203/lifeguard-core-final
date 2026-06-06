import { supabase } from "./supabase.js";

const MISSING_REAL_POLICY_CHUNK_GENERATION_HINT =
  "실제 약관 Chunk 생성이 아직 배포되지 않았습니다. Supabase SQL Editor에서 supabase/scripts/phase14_real_policy_chunk_generation_foundation.sql 을 실행해 주세요.";

export const REAL_POLICY_CHUNK_GENERATION_STATUS_LABELS = {
  pending: "대기",
  processing: "처리 중",
  completed: "완료",
  failed: "실패",
};

export const REAL_POLICY_CHUNK_GENERATION_MISSING_LABELS = {
  text_extraction_run_not_found: "텍스트 추출 run 없음",
  invalid_extraction_status: "추출 상태가 Chunk 생성 가능하지 않음",
  policy_pdf_not_found: "Policy PDF 없음",
  policy_source_not_found: "Policy Source 없음",
  policy_source_mismatch: "Policy Source 불일치",
  no_extracted_pages: "추출된 페이지 없음",
  rag_source_not_found: "RAG 소스 없음",
  active_chunk_generation_run_exists: "활성 Chunk 생성 run 존재",
  chunk_generation_run_not_found: "Chunk 생성 run 없음",
  invalid_generation_status: "생성 상태가 유효하지 않음",
  already_generated: "이미 생성됨",
  chunks_already_exist: "청크가 이미 존재함",
  no_extracted_text_for_chunks: "청크 생성용 추출 텍스트 없음",
};

function mapError(error) {
  if (!error?.message) return "실제 약관 Chunk 생성을 처리하지 못했습니다.";
  const m = error.message;
  if (
    m.includes("lifeguard_register_real_policy_chunk_generation") ||
    m.includes("lifeguard_generate_real_policy_chunks") ||
    m.includes("real_policy_chunk_generation_runs") ||
    m.includes("real_policy_chunk_items") ||
    m.includes("does not exist")
  ) {
    return MISSING_REAL_POLICY_CHUNK_GENERATION_HINT;
  }
  if (m === "text_extraction_run_id_required") return "텍스트 추출 run ID가 필요합니다.";
  if (m === "policy_pdf_id_required") return "Policy PDF ID가 필요합니다.";
  if (m === "policy_source_id_required") return "Policy Source ID가 필요합니다.";
  if (m === "real_chunk_generation_run_id_required") return "Chunk 생성 run ID가 필요합니다.";
  if (m === "text_extraction_run_not_found") return "텍스트 추출 run을 찾을 수 없습니다.";
  if (m === "policy_pdf_not_found") return "Policy PDF를 찾을 수 없습니다.";
  if (m === "chunk_generation_run_not_found") return "Chunk 생성 run을 찾을 수 없습니다.";
  if (m === "invalid_extraction_status") return "현재 추출 상태에서는 Chunk 생성을 등록할 수 없습니다.";
  if (m === "invalid_generation_status") return "현재 생성 상태에서는 Chunk를 생성할 수 없습니다.";
  if (m === "already_generated") return "이미 Chunk가 생성되었습니다.";
  if (m === "chunks_already_exist") return "청크가 이미 존재합니다.";
  if (m === "rag_source_not_found") return "RAG 소스를 찾을 수 없습니다.";
  if (m === "active_chunk_generation_run_exists") return "이미 활성 Chunk 생성 run이 있습니다.";
  if (m === "forbidden") return "관리자 권한이 필요합니다.";
  return m;
}

export function normalizeRealPolicyChunkGenerationRegistration(data) {
  if (!data || typeof data !== "object") {
    return null;
  }

  const missing = Array.isArray(data.missing_information) ? data.missing_information : [];

  return {
    realChunkGenerationRunId: data.real_chunk_generation_run_id ?? null,
    generationStatus: data.generation_status ?? null,
    missingInformation: missing,
    sourcePageCount: data.source_page_count ?? 0,
    ragSourceId: data.rag_source_id ?? null,
    createdAt: data.created_at ?? null,
    raw: data,
  };
}

export function normalizeRealPolicyChunkGenerationResult(data) {
  if (!data || typeof data !== "object") {
    return null;
  }

  const missing = Array.isArray(data.missing_information) ? data.missing_information : [];

  return {
    realChunkGenerationRunId: data.real_chunk_generation_run_id ?? null,
    generatedChunkCount: data.generated_chunk_count ?? 0,
    generationStatus: data.generation_status ?? null,
    missingInformation: missing,
    generatedAt: data.generated_at ?? null,
    raw: data,
  };
}

export async function registerRealPolicyChunkGeneration({
  textExtractionRunId,
  policyPdfId,
  policySourceId,
}) {
  const { data, error } = await supabase.rpc("lifeguard_register_real_policy_chunk_generation", {
    p_text_extraction_run_id: textExtractionRunId,
    p_policy_pdf_id: policyPdfId,
    p_policy_source_id: policySourceId,
  });

  if (error) {
    throw new Error(mapError(error));
  }

  return normalizeRealPolicyChunkGenerationRegistration(data);
}

export async function generateRealPolicyChunks(realChunkGenerationRunId) {
  const { data, error } = await supabase.rpc("lifeguard_generate_real_policy_chunks", {
    p_real_chunk_generation_run_id: realChunkGenerationRunId,
  });

  if (error) {
    throw new Error(mapError(error));
  }

  return normalizeRealPolicyChunkGenerationResult(data);
}

export async function loadRealPolicyChunkGenerationRun(runId) {
  if (!runId) return null;

  const { data, error } = await supabase
    .from("real_policy_chunk_generation_runs")
    .select(
      "id, text_extraction_run_id, policy_pdf_id, policy_source_id, generation_status, source_page_count, generated_chunk_count, generation_context, missing_information, error_message, created_at, completed_at, pdf:real_policy_pdf_registry(id, file_name, carrier:carrier_registry(carrier_name), product:carrier_product_registry(product_name)), source:real_policy_knowledge_sources(id, source_name, source_type), text_run:real_policy_text_extraction_runs(extraction_status, extracted_page_count)",
    )
    .eq("id", runId)
    .maybeSingle();

  if (error) {
    throw new Error(mapError(error));
  }

  return data;
}

export async function loadRealPolicyChunkItems(runId) {
  if (!runId) return [];

  const { data, error } = await supabase
    .from("real_policy_chunk_items")
    .select(
      "id, real_chunk_generation_run_id, chunk_registry_id, policy_pdf_id, policy_source_id, page_number, chunk_sequence, chunk_text, chunk_status, source_reference, created_at",
    )
    .eq("real_chunk_generation_run_id", runId)
    .order("chunk_sequence", { ascending: true });

  if (error) {
    throw new Error(mapError(error));
  }

  return data ?? [];
}

export async function loadRealPolicyTextExtractionRunsForChunkGeneration(limit = 50) {
  const { data, error } = await supabase
    .from("real_policy_text_extraction_runs")
    .select(
      "id, policy_pdf_id, extraction_status, extracted_page_count, created_at, pdf:real_policy_pdf_registry(id, file_name, policy_source_id, carrier:carrier_registry(carrier_name), product:carrier_product_registry(product_name), source:real_policy_knowledge_sources(id, source_name, source_type))",
    )
    .in("extraction_status", ["completed", "processing"])
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    throw new Error(mapError(error));
  }

  return data ?? [];
}

export async function loadRealPolicyChunkGenerationRuns(limit = 50) {
  const { data, error } = await supabase
    .from("real_policy_chunk_generation_runs")
    .select(
      "id, text_extraction_run_id, policy_pdf_id, policy_source_id, generation_status, source_page_count, generated_chunk_count, missing_information, error_message, created_at, completed_at, pdf:real_policy_pdf_registry(file_name), source:real_policy_knowledge_sources(source_name)",
    )
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    throw new Error(mapError(error));
  }

  return data ?? [];
}
