import { supabase } from "./supabase.js";
import {
  loadCarriersForManualKnowledge,
  loadProductsForManualKnowledge,
} from "./manualKnowledgeIngestion.js";

const MISSING_POLICY_RAG_HINT =
  "약관 RAG 소스 관리가 아직 배포되지 않았습니다. Supabase SQL Editor에서 supabase/scripts/phase11_policy_rag_foundation.sql 을 실행해 주세요.";

export const POLICY_RAG_SOURCE_TYPE_LABELS = {
  manual_knowledge: "수작업 지식",
  policy_document: "약관 문서",
  carrier_knowledge: "보험사 지식",
  underwriting_manual: "인수지침",
  product_brochure: "상품 안내서",
  claim_case: "보험금 사례",
  special_clause: "특약",
};

export const POLICY_RAG_SOURCE_STATUS_LABELS = {
  registered: "등록됨",
  queued: "대기",
  chunked: "청크 완료",
  embedded: "임베딩 완료",
  failed: "실패",
};

export const POLICY_RAG_MISSING_LABELS = {
  carrier_not_found: "보험사를 찾을 수 없음",
  product_not_found: "상품을 찾을 수 없음",
  manual_not_approved_for_rag: "RAG 승인되지 않은 수작업 지식",
  manual_entry_not_found: "수작업 지식 항목 없음",
  no_policy_documents_table: "약관 문서 테이블 없음",
  policy_document_not_found: "약관 문서 없음",
  no_carrier_knowledge_table: "보험사 지식 테이블 없음",
  carrier_knowledge_not_found: "보험사 지식 없음",
  typed_source_not_found: "해당 유형 소스 없음",
  no_rag_results: "RAG 검색 결과 없음",
  no_rag_sources_deployed: "RAG 소스 미배포",
  source_not_found: "소스를 찾을 수 없음",
};

function mapError(error) {
  if (!error?.message) return "약관 RAG를 처리하지 못했습니다.";
  const m = error.message;
  if (
    m.includes("lifeguard_register_policy_rag_source") ||
    m.includes("lifeguard_search_policy_rag") ||
    m.includes("policy_rag_source_registry") ||
    m.includes("policy_rag_processing_runs") ||
    m.includes("policy_rag_retrieval_logs") ||
    m.includes("does not exist")
  ) {
    return MISSING_POLICY_RAG_HINT;
  }
  if (m === "source_type_required" || m === "invalid_source_type") {
    return "소스 유형을 선택해 주세요.";
  }
  if (m === "source_id_required") return "소스 ID를 입력해 주세요.";
  if (m === "carrier_id_required") return "보험사를 선택해 주세요.";
  if (m === "carrier_not_found") return "보험사를 찾을 수 없습니다.";
  if (m === "product_not_found") return "상품을 찾을 수 없습니다.";
  if (m === "source_not_found") return "등록 가능한 기존 소스를 찾을 수 없습니다.";
  if (m === "forbidden") return "관리자 권한이 필요합니다.";
  return m;
}

export { loadCarriersForManualKnowledge, loadProductsForManualKnowledge };

export function normalizePolicyRagRegistration(data) {
  if (!data || typeof data !== "object") {
    return null;
  }

  const missing = Array.isArray(data.missing_information)
    ? data.missing_information
    : [];

  return {
    ragSourceId: data.rag_source_id ?? null,
    ragProcessingRunId: data.rag_processing_run_id ?? null,
    sourceStatus: data.source_status ?? null,
    missingInformation: missing,
    processingContext: data.processing_context ?? {},
    createdAt: data.created_at ?? null,
    raw: data,
  };
}

export function normalizePolicyRagSearch(data) {
  if (!data || typeof data !== "object") {
    return null;
  }

  const missing = Array.isArray(data.missing_information)
    ? data.missing_information
    : [];

  return {
    ragRetrievalLogId: data.rag_retrieval_log_id ?? null,
    results: Array.isArray(data.results) ? data.results : [],
    retrievedChunks: Array.isArray(data.retrieved_chunks) ? data.retrieved_chunks : [],
    sourceReferences: Array.isArray(data.source_references) ? data.source_references : [],
    resultCount: data.result_count ?? 0,
    missingInformation: missing,
    retrievalContext: data.retrieval_context ?? {},
    createdAt: data.created_at ?? null,
    raw: data,
  };
}

export async function loadPolicyRagSources() {
  const { data, error } = await supabase
    .from("policy_rag_source_registry")
    .select(
      "id, source_type, source_id, carrier_id, product_id, source_status, source_reference, created_at, carrier:carrier_registry(carrier_name), product:carrier_product_registry(product_name)"
    )
    .order("created_at", { ascending: false })
    .limit(100);

  if (error) {
    throw new Error(mapError(error));
  }

  return (data ?? []).map((row) => ({
    ragSourceId: row.id,
    sourceType: row.source_type,
    sourceId: row.source_id,
    carrierId: row.carrier_id,
    productId: row.product_id,
    sourceStatus: row.source_status,
    sourceReference: row.source_reference,
    carrierName: row.carrier?.carrier_name ?? null,
    productName: row.product?.product_name ?? null,
    createdAt: row.created_at,
  }));
}

export async function registerPolicyRagSource({
  sourceType,
  sourceId,
  carrierId,
  productId,
  sourceReference,
}) {
  const { data, error } = await supabase.rpc("lifeguard_register_policy_rag_source", {
    p_source_type: sourceType,
    p_source_id: sourceId,
    p_carrier_id: carrierId,
    p_product_id: productId || null,
    p_source_reference: sourceReference?.trim() || null,
  });

  if (error) {
    throw new Error(mapError(error));
  }

  return normalizePolicyRagRegistration(data);
}

export async function searchPolicyRag({ query, carrierId, productId }) {
  const { data, error } = await supabase.rpc("lifeguard_search_policy_rag", {
    p_query: query ?? "",
    p_carrier_id: carrierId || null,
    p_product_id: productId || null,
  });

  if (error) {
    throw new Error(mapError(error));
  }

  return normalizePolicyRagSearch(data);
}
