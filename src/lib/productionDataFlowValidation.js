import { supabase } from "./supabase.js";

const MISSING_VALIDATION_HINT =
  "운영 데이터 흐름 검증이 아직 배포되지 않았습니다. Supabase SQL Editor에서 supabase/scripts/phase13_production_data_flow_validation_foundation.sql 을 실행해 주세요.";

export const PRODUCTION_VALIDATION_STATUS_LABELS = {
  pending: "대기",
  running: "검증 중",
  passed: "통과",
  failed: "실패",
  partial: "부분 통과",
};

export const PRODUCTION_VALIDATION_STAGE_NAME_LABELS = {
  pdf_ingestion: "PDF 적재",
  text_extraction: "텍스트 추출",
  chunk_generation: "Chunk 생성",
  embedding_pipeline: "Embedding Pipeline",
  vector_search: "Vector Search",
  grounding_context: "Grounding Context",
  claude_grounding: "Claude Grounding",
  claude_execution: "Claude Execution",
};

export const PRODUCTION_VALIDATION_STAGE_STATUS_LABELS = {
  passed: "통과",
  failed: "실패",
  missing_dependency: "의존성 누락",
  not_ready: "미준비",
};

export const PRODUCTION_VALIDATION_MISSING_LABELS = {
  pdf_ingestion_table_missing: "PDF 적재 테이블 없음",
  no_pdf_ingestion_runs: "PDF 적재 Run 없음",
  no_ready_pdf_ingestion_runs: "준비된 PDF 적재 Run 없음",
  pdf_ingestion_not_ready: "PDF 적재 미준비",
  text_extraction_table_missing: "텍스트 추출 테이블 없음",
  no_text_extraction_runs: "텍스트 추출 Run 없음",
  no_extracted_text_runs: "추출 완료 Run 없음",
  text_extraction_not_ready: "텍스트 추출 미준비",
  chunk_generation_table_missing: "Chunk 생성 테이블 없음",
  no_chunk_generation_runs: "Chunk 생성 Run 없음",
  no_generated_chunk_runs: "생성 완료 Chunk Run 없음",
  embedding_pipeline_table_missing: "Embedding Pipeline 테이블 없음",
  no_embedding_pipeline_runs: "Embedding Pipeline Run 없음",
  no_ready_embedding_pipeline_runs: "준비된 Embedding Pipeline Run 없음",
  vector_search_table_missing: "Vector Search 테이블 없음",
  no_vector_search_runs: "Vector Search Run 없음",
  no_completed_vector_search_runs: "완료된 Vector Search Run 없음",
  grounding_context_table_missing: "Grounding Context 테이블 없음",
  no_grounding_context_runs: "Grounding Context Run 없음",
  no_completed_grounding_context_runs: "완료된 Grounding Context Run 없음",
  claude_grounding_table_missing: "Claude Grounding 테이블 없음",
  no_claude_grounding_runs: "Claude Grounding Run 없음",
  no_ready_claude_grounding_runs: "준비된 Claude Grounding Run 없음",
  claude_execution_table_missing: "Claude Execution 테이블 없음",
  no_claude_execution_runs: "Claude Execution Run 없음",
  no_ready_claude_execution_runs: "준비된 Claude Execution Run 없음",
};

function mapError(error) {
  if (!error?.message) return "운영 데이터 흐름 검증을 처리하지 못했습니다.";
  const m = error.message;
  if (
    m.includes("lifeguard_validate_production_data_flow") ||
    m.includes("production_data_flow_validation_runs") ||
    m.includes("production_data_flow_validation_stages") ||
    m.includes("does not exist")
  ) {
    return MISSING_VALIDATION_HINT;
  }
  if (m === "forbidden") return "관리자 권한이 필요합니다.";
  return m;
}

export function normalizeProductionDataFlowValidation(data) {
  if (!data || typeof data !== "object") {
    return null;
  }

  const missing = Array.isArray(data.missing_information) ? data.missing_information : [];

  return {
    productionValidationRunId: data.production_validation_run_id ?? null,
    validationStatus: data.validation_status ?? null,
    readinessScore: data.readiness_score ?? 0,
    completedStages: data.completed_stages ?? 0,
    failedStages: data.failed_stages ?? 0,
    missingInformation: missing,
    validationContext: data.validation_context ?? {},
    createdAt: data.created_at ?? null,
    raw: data,
  };
}

export async function validateProductionDataFlow({ validationScope }) {
  const { data, error } = await supabase.rpc("lifeguard_validate_production_data_flow", {
    p_validation_scope: validationScope?.trim() || "full_pipeline",
  });

  if (error) {
    throw new Error(mapError(error));
  }

  return normalizeProductionDataFlowValidation(data);
}

export async function loadProductionDataFlowValidationRun(runId) {
  if (!runId) return null;

  const { data, error } = await supabase
    .from("production_data_flow_validation_runs")
    .select(
      "id, validation_scope, validation_status, total_stages, completed_stages, failed_stages, readiness_score, validation_context, missing_information, error_message, created_at, completed_at"
    )
    .eq("id", runId)
    .maybeSingle();

  if (error) {
    throw new Error(mapError(error));
  }

  return data;
}

export async function loadProductionDataFlowValidationStages(runId) {
  if (!runId) return [];

  const { data, error } = await supabase
    .from("production_data_flow_validation_stages")
    .select(
      "id, production_validation_run_id, stage_name, stage_status, stage_context, missing_information, error_message, created_at"
    )
    .eq("production_validation_run_id", runId)
    .order("created_at", { ascending: true });

  if (error) {
    throw new Error(mapError(error));
  }

  return data ?? [];
}
