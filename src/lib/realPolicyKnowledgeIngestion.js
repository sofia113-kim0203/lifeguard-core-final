import { supabase } from "./supabase.js";
import {
  loadCarriersForManualKnowledge,
  loadProductsForManualKnowledge,
} from "./manualKnowledgeIngestion.js";

const MISSING_REAL_POLICY_KNOWLEDGE_HINT =
  "실제 약관 자료 등록이 아직 배포되지 않았습니다. Supabase SQL Editor에서 supabase/scripts/phase14_real_policy_knowledge_ingestion_foundation.sql 을 실행해 주세요.";

export const REAL_POLICY_SOURCE_TYPES = [
  "policy_terms",
  "product_brochure",
  "underwriting_manual",
  "claim_case",
  "special_clause",
  "carrier_guideline",
];

export const REAL_POLICY_SOURCE_TYPE_LABELS = {
  policy_terms: "약관",
  product_brochure: "상품설명서",
  underwriting_manual: "인수지침서",
  claim_case: "보험금 사례",
  special_clause: "특약",
  carrier_guideline: "보험사 가이드라인",
};

export const REAL_POLICY_SOURCE_STATUS_LABELS = {
  uploaded: "업로드됨",
  registered: "등록됨",
  pending_review: "검토 대기",
  approved: "승인됨",
  rejected: "반려됨",
};

export const REAL_POLICY_REVIEW_STATUS_LABELS = {
  pending: "대기",
  approved: "승인",
  rejected: "반려",
};

export const REAL_POLICY_MISSING_LABELS = {
  carrier_not_found: "보험사를 찾을 수 없음",
  product_not_found: "상품을 찾을 수 없음",
  product_not_specified: "상품 미지정",
  source_file_not_linked: "PDF 저장소 연결 없음",
  duplicate_source_reference: "중복 파일 참조",
};

function mapError(error) {
  if (!error?.message) return "실제 약관 자료를 처리하지 못했습니다.";
  const m = error.message;
  if (
    m.includes("lifeguard_register_real_policy_source") ||
    m.includes("lifeguard_review_real_policy_source") ||
    m.includes("real_policy_knowledge_sources") ||
    m.includes("real_policy_knowledge_review_queue") ||
    m.includes("does not exist")
  ) {
    return MISSING_REAL_POLICY_KNOWLEDGE_HINT;
  }
  if (m === "carrier_id_required") return "보험사를 선택해 주세요.";
  if (m === "source_name_required") return "자료명을 입력해 주세요.";
  if (m === "source_type_required" || m === "invalid_source_type") return "자료 유형을 선택해 주세요.";
  if (m === "source_file_reference_required") return "파일 참조를 입력해 주세요.";
  if (m === "source_version_required") return "버전을 입력해 주세요.";
  if (m === "carrier_not_found") return "보험사를 찾을 수 없습니다.";
  if (m === "product_not_found") return "상품을 찾을 수 없습니다.";
  if (m === "duplicate_source_reference") return "동일 파일 참조가 이미 등록되어 있습니다.";
  if (m === "policy_source_id_required") return "Policy source ID가 필요합니다.";
  if (m === "policy_source_not_found") return "Policy source를 찾을 수 없습니다.";
  if (m === "review_status_required" || m === "invalid_review_status") return "검토 상태를 선택해 주세요.";
  if (m === "forbidden") return "관리자 권한이 필요합니다.";
  return m;
}

export { loadCarriersForManualKnowledge, loadProductsForManualKnowledge };

export function normalizeRealPolicySourceRegistration(data) {
  if (!data || typeof data !== "object") {
    return null;
  }

  const missing = Array.isArray(data.missing_information) ? data.missing_information : [];

  return {
    policySourceId: data.policy_source_id ?? null,
    reviewId: data.review_id ?? null,
    sourceStatus: data.source_status ?? null,
    missingInformation: missing,
    createdAt: data.created_at ?? null,
    raw: data,
  };
}

export function normalizeRealPolicySourceReview(data) {
  if (!data || typeof data !== "object") {
    return null;
  }

  return {
    reviewId: data.review_id ?? null,
    policySourceId: data.policy_source_id ?? null,
    sourceStatus: data.source_status ?? null,
    reviewStatus: data.review_status ?? null,
    reviewedAt: data.reviewed_at ?? null,
    raw: data,
  };
}

export async function registerRealPolicySource({
  carrierId,
  productId,
  sourceName,
  sourceType,
  sourceFileReference,
  sourceVersion,
  sourceNotes,
}) {
  const { data, error } = await supabase.rpc("lifeguard_register_real_policy_source", {
    p_carrier_id: carrierId,
    p_product_id: productId || null,
    p_source_name: sourceName,
    p_source_type: sourceType,
    p_source_file_reference: sourceFileReference,
    p_source_version: sourceVersion,
    p_source_notes: sourceNotes?.trim() || null,
  });

  if (error) {
    throw new Error(mapError(error));
  }

  return normalizeRealPolicySourceRegistration(data);
}

export async function reviewRealPolicySource({ policySourceId, reviewStatus, reviewNotes }) {
  const { data, error } = await supabase.rpc("lifeguard_review_real_policy_source", {
    p_policy_source_id: policySourceId,
    p_review_status: reviewStatus,
    p_review_notes: reviewNotes?.trim() || null,
  });

  if (error) {
    throw new Error(mapError(error));
  }

  return normalizeRealPolicySourceReview(data);
}

export async function loadRealPolicyKnowledgeSources(limit = 50) {
  const { data, error } = await supabase
    .from("real_policy_knowledge_sources")
    .select(
      "id, carrier_id, product_id, source_name, source_type, source_file_reference, source_version, source_status, source_notes, uploaded_by, created_at, carrier:carrier_registry(carrier_name), product:carrier_product_registry(product_name)",
    )
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    throw new Error(mapError(error));
  }

  return data ?? [];
}

export async function loadRealPolicyKnowledgeReviews(sourceId) {
  if (!sourceId) return [];

  const { data, error } = await supabase
    .from("real_policy_knowledge_review_queue")
    .select("id, policy_source_id, review_status, review_notes, reviewed_by, reviewed_at, created_at")
    .eq("policy_source_id", sourceId)
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error(mapError(error));
  }

  return data ?? [];
}

export async function loadLatestReviewForSource(sourceId) {
  const rows = await loadRealPolicyKnowledgeReviews(sourceId);
  return rows[0] ?? null;
}
