import { supabase } from "./supabase.js";
import { loadRealPolicyPdfRegistry } from "./realPolicyPdfUploadStorage.js";
import { loadCustomersForGroundingTest } from "./customerGrounding.js";
import {
  loadCarriersForManualKnowledge,
  loadProductsForManualKnowledge,
} from "./manualKnowledgeIngestion.js";

const MISSING_INTEGRATION_HINT =
  "실제 약관 Vector Search 연동이 아직 배포되지 않았습니다. Supabase SQL Editor에서 supabase/scripts/phase14_real_policy_vector_search_integration.sql 을 실행해 주세요.";

export const REAL_POLICY_VECTOR_SEARCH_MISSING_LABELS = {
  no_query: "검색어 없음",
  query_required: "검색어 필요",
  policy_pdf_not_found: "Policy PDF 없음",
  carrier_scope_mismatch: "보험사 범위 불일치",
  product_scope_mismatch: "상품 범위 불일치",
  no_matching_real_policy_chunks: "일치하는 실제 약관 Chunk 없음",
  vector_search_failed: "Vector Search 실패",
  grounding_context_failed: "Grounding Context 실패",
  missing_policy_scope: "약관 범위 없음",
  customer_not_found: "고객 없음",
  customer_memory_context_failed: "고객 메모리 컨텍스트 실패",
  conversation_memory_context_failed: "대화 메모리 컨텍스트 실패",
  insufficient_context: "컨텍스트 부족",
};

function mapError(error) {
  if (!error?.message) return "실제 약관 Vector Search 연동을 처리하지 못했습니다.";
  const m = error.message;
  if (
    m.includes("lifeguard_search_real_policy_vectors") ||
    m.includes("lifeguard_prepare_real_policy_grounding_context") ||
    m.includes("lifeguard_prepare_customer_real_policy_grounded_conversation") ||
    m.includes("does not exist")
  ) {
    return MISSING_INTEGRATION_HINT;
  }
  if (m === "forbidden") return "관리자 권한이 필요합니다.";
  if (m === "query_required") return "Query를 입력해 주세요.";
  if (m === "policy_pdf_not_found") return "Policy PDF를 찾을 수 없습니다.";
  if (m === "customer_id_required") return "고객을 선택해 주세요.";
  if (m === "conversation_id_required") return "Conversation ID를 입력해 주세요.";
  if (m === "customer_not_found") return "고객을 찾을 수 없습니다.";
  return m;
}

export {
  loadRealPolicyPdfRegistry,
  loadCustomersForGroundingTest,
  loadCarriersForManualKnowledge,
  loadProductsForManualKnowledge,
};

export function normalizeRealPolicyVectorSearch(data) {
  if (!data || typeof data !== "object") {
    return null;
  }

  const missing = Array.isArray(data.missing_information) ? data.missing_information : [];

  return {
    vectorSearchRunId: data.vector_search_run_id ?? null,
    policyPdfId: data.policy_pdf_id ?? null,
    carrierId: data.carrier_id ?? null,
    productId: data.product_id ?? null,
    fileName: data.file_name ?? null,
    fileVersion: data.file_version ?? null,
    results: Array.isArray(data.results) ? data.results : [],
    resultCount: data.result_count ?? 0,
    searchStatus: data.search_status ?? null,
    missingInformation: missing,
    searchContext: data.search_context ?? {},
    createdAt: data.created_at ?? null,
    raw: data,
  };
}

export function normalizeRealPolicyGroundingContext(data) {
  if (!data || typeof data !== "object") {
    return null;
  }

  const missing = Array.isArray(data.missing_information) ? data.missing_information : [];

  return {
    groundingContextRunId: data.grounding_context_run_id ?? null,
    policyPdfId: data.policy_pdf_id ?? null,
    carrierId: data.carrier_id ?? null,
    productId: data.product_id ?? null,
    fileName: data.file_name ?? null,
    fileVersion: data.file_version ?? null,
    sourceCount: data.source_count ?? 0,
    groundingStatus: data.grounding_status ?? null,
    groundingContext: data.grounding_context ?? {},
    sourceReferences: Array.isArray(data.source_references) ? data.source_references : [],
    missingInformation: missing,
    createdAt: data.created_at ?? null,
    raw: data,
  };
}

export function normalizeCustomerRealPolicyGroundedConversation(data) {
  if (!data || typeof data !== "object") {
    return null;
  }

  const missing = Array.isArray(data.missing_information) ? data.missing_information : [];

  return {
    groundedConversationRunId: data.grounded_conversation_run_id ?? null,
    memoryCount: data.memory_count ?? 0,
    conversationMemoryCount: data.conversation_memory_count ?? 0,
    groundingSourceCount: data.grounding_source_count ?? 0,
    claudeGroundingReady: data.claude_grounding_ready ?? false,
    contextSummary: data.context_summary ?? {},
    missingInformation: missing,
    runStatus: data.run_status ?? null,
    policyPdfId: data.policy_pdf_id ?? null,
    carrierId: data.carrier_id ?? null,
    productId: data.product_id ?? null,
    createdAt: data.created_at ?? null,
    raw: data,
  };
}

export async function searchRealPolicyVectors({
  policyPdfId,
  carrierId,
  productId,
  query,
}) {
  const { data, error } = await supabase.rpc("lifeguard_search_real_policy_vectors", {
    p_policy_pdf_id: policyPdfId || null,
    p_carrier_id: carrierId || null,
    p_product_id: productId || null,
    p_query: query ?? "",
  });

  if (error) {
    throw new Error(mapError(error));
  }

  return normalizeRealPolicyVectorSearch(data);
}

export async function prepareRealPolicyGroundingContext({
  policyPdfId,
  carrierId,
  productId,
  query,
}) {
  const { data, error } = await supabase.rpc("lifeguard_prepare_real_policy_grounding_context", {
    p_policy_pdf_id: policyPdfId || null,
    p_carrier_id: carrierId || null,
    p_product_id: productId || null,
    p_query: query ?? "",
  });

  if (error) {
    throw new Error(mapError(error));
  }

  return normalizeRealPolicyGroundingContext(data);
}

export async function prepareCustomerRealPolicyGroundedConversation({
  customerId,
  conversationId,
  policyPdfId,
  carrierId,
  productId,
  query,
}) {
  const { data, error } = await supabase.rpc(
    "lifeguard_prepare_customer_real_policy_grounded_conversation",
    {
      p_customer_id: customerId,
      p_conversation_id: conversationId,
      p_policy_pdf_id: policyPdfId || null,
      p_carrier_id: carrierId || null,
      p_product_id: productId || null,
      p_query: query,
    }
  );

  if (error) {
    throw new Error(mapError(error));
  }

  return normalizeCustomerRealPolicyGroundedConversation(data);
}
