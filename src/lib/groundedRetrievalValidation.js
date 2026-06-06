import { supabase } from "./supabase.js";
import {
  loadCarriersForManualKnowledge,
  loadProductsForManualKnowledge,
} from "./manualKnowledgeIngestion.js";

const MISSING_VALIDATION_HINT =
  "Grounded Retrieval 검증이 아직 배포되지 않았습니다. Supabase SQL Editor에서 supabase/scripts/phase12_grounded_retrieval_validation_foundation.sql 을 실행해 주세요.";

export const VALIDATION_STATUS_LABELS = {
  pending: "대기",
  running: "검증 중",
  passed: "통과",
  failed: "실패",
  insufficient_context: "컨텍스트 부족",
};

export const VALIDATION_STAGE_NAME_LABELS = {
  vector_search: "Vector Search",
  grounding_context: "Grounding Context",
  claude_grounding: "Claude Grounding",
  claude_execution_readiness: "Claude Execution Readiness",
};

export const VALIDATION_STAGE_STATUS_LABELS = {
  pending: "대기",
  completed: "완료",
  failed: "실패",
  insufficient_context: "컨텍스트 부족",
};

export const VALIDATION_MISSING_LABELS = {
  no_query: "검색어 없음",
  carrier_not_found: "보험사를 찾을 수 없음",
  product_not_found: "상품을 찾을 수 없음",
  no_validation_customer: "검증용 고객 없음",
  vector_search_failed: "Vector Search 실패",
  grounding_context_failed: "Grounding Context 실패",
  claude_grounding_failed: "Claude Grounding 실패",
  claude_grounding_run_missing: "Claude Grounding Run 없음",
  claude_execution_readiness_failed: "Claude Execution Readiness 실패",
  no_matching_chunks: "일치하는 Chunk 없음",
  no_sources_found: "소스 없음",
  insufficient_context: "컨텍스트 부족",
  no_sources: "소스 없음",
  grounding_not_ready: "Grounding 미준비",
};

function mapError(error) {
  if (!error?.message) return "Grounded Retrieval 검증을 처리하지 못했습니다.";
  const m = error.message;
  if (
    m.includes("lifeguard_validate_grounded_retrieval") ||
    m.includes("grounded_retrieval_validation_runs") ||
    m.includes("grounded_retrieval_validation_stages") ||
    m.includes("does not exist")
  ) {
    return MISSING_VALIDATION_HINT;
  }
  if (m === "forbidden") return "관리자 권한이 필요합니다.";
  return m;
}

export { loadCarriersForManualKnowledge, loadProductsForManualKnowledge };

export function normalizeGroundedRetrievalValidation(data) {
  if (!data || typeof data !== "object") {
    return null;
  }

  const missing = Array.isArray(data.missing_information) ? data.missing_information : [];

  return {
    validationRunId: data.validation_run_id ?? null,
    validationStatus: data.validation_status ?? null,
    vectorResultCount: data.vector_result_count ?? 0,
    groundingSourceCount: data.grounding_source_count ?? 0,
    claudeReady: data.claude_ready ?? false,
    missingInformation: missing,
    validationContext: data.validation_context ?? {},
    createdAt: data.created_at ?? null,
    raw: data,
  };
}

export async function validateGroundedRetrieval({ query, carrierId, productId }) {
  const { data, error } = await supabase.rpc("lifeguard_validate_grounded_retrieval", {
    p_query: query,
    p_carrier_id: carrierId || null,
    p_product_id: productId || null,
  });

  if (error) {
    throw new Error(mapError(error));
  }

  return normalizeGroundedRetrievalValidation(data);
}

export async function loadGroundedRetrievalValidationRun(runId) {
  if (!runId) return null;

  const { data, error } = await supabase
    .from("grounded_retrieval_validation_runs")
    .select(
      "id, query, carrier_id, product_id, validation_status, vector_result_count, grounding_source_count, claude_ready, validation_context, missing_information, error_message, created_at, completed_at"
    )
    .eq("id", runId)
    .maybeSingle();

  if (error) {
    throw new Error(mapError(error));
  }

  return data;
}

export async function loadGroundedRetrievalValidationStages(runId) {
  if (!runId) return [];

  const { data, error } = await supabase
    .from("grounded_retrieval_validation_stages")
    .select(
      "id, validation_run_id, stage_name, stage_status, stage_context, missing_information, error_message, created_at"
    )
    .eq("validation_run_id", runId)
    .order("created_at", { ascending: true });

  if (error) {
    throw new Error(mapError(error));
  }

  return data ?? [];
}
