import { supabase } from "./supabase.js";
import {
  loadCarriersForManualKnowledge,
  loadProductsForManualKnowledge,
} from "./manualKnowledgeIngestion.js";

const MISSING_VECTOR_SEARCH_HINT =
  "약관 Vector Search가 아직 배포되지 않았습니다. Supabase SQL Editor에서 supabase/scripts/phase11_vector_search_foundation.sql 을 실행해 주세요.";

export const POLICY_VECTOR_SEARCH_MISSING_LABELS = {
  no_query: "검색어 없음",
  no_available_vectors: "사용 가능한 벡터 없음",
  no_matching_chunks: "일치하는 청크 없음",
  carrier_not_found: "보험사를 찾을 수 없음",
  product_not_found: "상품을 찾을 수 없음",
  no_vector_registry_table: "벡터 레지스트리 테이블 없음",
  no_chunk_registry_table: "청크 레지스트리 테이블 없음",
};

function mapError(error) {
  if (!error?.message) return "약관 Vector Search를 처리하지 못했습니다.";
  const m = error.message;
  if (
    m.includes("lifeguard_search_policy_vectors") ||
    m.includes("lifeguard_check_policy_vector_search_readiness") ||
    m.includes("policy_vector_search_runs") ||
    m.includes("policy_vector_search_results") ||
    m.includes("does not exist")
  ) {
    return MISSING_VECTOR_SEARCH_HINT;
  }
  if (m === "forbidden") return "관리자 권한이 필요합니다.";
  return m;
}

export { loadCarriersForManualKnowledge, loadProductsForManualKnowledge };

export function normalizeVectorSearchReadiness(data) {
  if (!data || typeof data !== "object") {
    return null;
  }

  const missing = Array.isArray(data.missing_information)
    ? data.missing_information
    : [];

  return {
    availableVectorCount: data.available_vector_count ?? 0,
    approvedChunkCount: data.approved_chunk_count ?? 0,
    missingInformation: missing,
    carrierId: data.carrier_id ?? null,
    productId: data.product_id ?? null,
    checkedAt: data.checked_at ?? null,
    raw: data,
  };
}

export function normalizeVectorSearch(data) {
  if (!data || typeof data !== "object") {
    return null;
  }

  const missing = Array.isArray(data.missing_information)
    ? data.missing_information
    : [];

  return {
    vectorSearchRunId: data.vector_search_run_id ?? null,
    results: Array.isArray(data.results) ? data.results : [],
    resultCount: data.result_count ?? 0,
    searchStatus: data.search_status ?? null,
    missingInformation: missing,
    searchContext: data.search_context ?? {},
    createdAt: data.created_at ?? null,
    raw: data,
  };
}

export async function checkPolicyVectorSearchReadiness({ carrierId, productId }) {
  const { data, error } = await supabase.rpc(
    "lifeguard_check_policy_vector_search_readiness",
    {
      p_carrier_id: carrierId || null,
      p_product_id: productId || null,
    }
  );

  if (error) {
    throw new Error(mapError(error));
  }

  return normalizeVectorSearchReadiness(data);
}

export async function searchPolicyVectors({ query, carrierId, productId }) {
  const { data, error } = await supabase.rpc("lifeguard_search_policy_vectors", {
    p_query: query ?? "",
    p_carrier_id: carrierId || null,
    p_product_id: productId || null,
  });

  if (error) {
    throw new Error(mapError(error));
  }

  return normalizeVectorSearch(data);
}
