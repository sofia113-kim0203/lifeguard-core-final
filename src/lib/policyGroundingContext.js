import { supabase } from "./supabase.js";
import {
  loadCarriersForManualKnowledge,
  loadProductsForManualKnowledge,
} from "./manualKnowledgeIngestion.js";

const MISSING_GROUNDING_CONTEXT_HINT =
  "Grounding Context가 아직 배포되지 않았습니다. Supabase SQL Editor에서 supabase/scripts/phase11_grounding_context_foundation.sql 을 실행해 주세요.";

export const POLICY_GROUNDING_MISSING_LABELS = {
  no_query: "검색어 없음",
  no_sources_found: "소스 없음",
  insufficient_context: "컨텍스트 부족",
  carrier_not_found: "보험사를 찾을 수 없음",
  product_not_found: "상품을 찾을 수 없음",
  no_vector_registry_table: "벡터 레지스트리 테이블 없음",
  no_chunk_registry_table: "청크 레지스트리 테이블 없음",
};

function mapError(error) {
  if (!error?.message) return "Grounding Context를 처리하지 못했습니다.";
  const m = error.message;
  if (
    m.includes("lifeguard_prepare_grounding_context") ||
    m.includes("lifeguard_check_grounding_readiness") ||
    m.includes("policy_grounding_context_runs") ||
    m.includes("policy_grounding_context_sources") ||
    m.includes("does not exist")
  ) {
    return MISSING_GROUNDING_CONTEXT_HINT;
  }
  if (m === "forbidden") return "관리자 권한이 필요합니다.";
  return m;
}

export { loadCarriersForManualKnowledge, loadProductsForManualKnowledge };

export function normalizeGroundingReadiness(data) {
  if (!data || typeof data !== "object") {
    return null;
  }

  const missing = Array.isArray(data.missing_information)
    ? data.missing_information
    : [];

  return {
    sourceCount: data.source_count ?? 0,
    availableVectorCount: data.available_vector_count ?? 0,
    approvedChunkCount: data.approved_chunk_count ?? 0,
    manualApprovedCount: data.manual_approved_count ?? 0,
    missingInformation: missing,
    carrierId: data.carrier_id ?? null,
    productId: data.product_id ?? null,
    checkedAt: data.checked_at ?? null,
    raw: data,
  };
}

export function normalizeGroundingContext(data) {
  if (!data || typeof data !== "object") {
    return null;
  }

  const missing = Array.isArray(data.missing_information)
    ? data.missing_information
    : [];

  const groundingContext = data.grounding_context ?? {};
  const sourceReferences = Array.isArray(data.source_references)
    ? data.source_references
    : Array.isArray(groundingContext.source_references)
      ? groundingContext.source_references
      : [];

  return {
    groundingContextRunId: data.grounding_context_run_id ?? null,
    sourceCount: data.source_count ?? 0,
    groundingStatus: data.grounding_status ?? null,
    groundingContext,
    sourceReferences,
    missingInformation: missing,
    createdAt: data.created_at ?? null,
    raw: data,
  };
}

export async function checkGroundingReadiness({ carrierId, productId }) {
  const { data, error } = await supabase.rpc("lifeguard_check_grounding_readiness", {
    p_carrier_id: carrierId || null,
    p_product_id: productId || null,
  });

  if (error) {
    throw new Error(mapError(error));
  }

  return normalizeGroundingReadiness(data);
}

export async function prepareGroundingContext({ query, carrierId, productId }) {
  const { data, error } = await supabase.rpc("lifeguard_prepare_grounding_context", {
    p_query: query ?? "",
    p_carrier_id: carrierId || null,
    p_product_id: productId || null,
  });

  if (error) {
    throw new Error(mapError(error));
  }

  return normalizeGroundingContext(data);
}

export async function loadGroundingContextSources(groundingContextRunId) {
  if (!groundingContextRunId) return [];

  const { data, error } = await supabase
    .from("policy_grounding_context_sources")
    .select(
      "id, grounding_context_run_id, rag_source_id, chunk_registry_id, source_reference, source_type, source_context, created_at"
    )
    .eq("grounding_context_run_id", groundingContextRunId)
    .order("created_at", { ascending: true });

  if (error) {
    throw new Error(mapError(error));
  }

  return data ?? [];
}
