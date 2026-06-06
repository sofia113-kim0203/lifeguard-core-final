import { supabase } from "./supabase.js";
import {
  loadCarriersForManualKnowledge,
  loadProductsForManualKnowledge,
  MANUAL_KNOWLEDGE_ENTRY_TYPE_LABELS,
} from "./manualKnowledgeIngestion.js";

const MISSING_SEARCH_REVIEW_HINT =
  "수작업 지식 검색/검토가 아직 배포되지 않았습니다. Supabase SQL Editor에서 supabase/scripts/phase11_manual_knowledge_search_review_foundation.sql 을 실행해 주세요.";

export const MANUAL_KNOWLEDGE_REVIEW_STATUS_LABELS = {
  pending_review: "검토 대기",
  in_review: "검토 중",
  approved_for_rag: "RAG 사용 승인",
  needs_revision: "수정 필요",
  archived: "보관",
};

export const MANUAL_KNOWLEDGE_SEARCH_MISSING_LABELS = {
  no_manual_entries_table: "수작업 지식 테이블 없음",
  no_search_results: "검색 결과 없음",
  carrier_not_found: "보험사를 찾을 수 없음",
  product_not_found: "상품을 찾을 수 없음",
  invalid_entry_type: "지식 유형이 올바르지 않음",
  manual_entry_not_found: "지식 항목을 찾을 수 없음",
  invalid_review_status: "검토상태가 올바르지 않음",
  entry_archived: "보관된 항목",
};

function mapError(error) {
  if (!error?.message) return "수작업 지식 검색/검토를 처리하지 못했습니다.";
  const m = error.message;
  if (
    m.includes("lifeguard_search_manual_knowledge") ||
    m.includes("lifeguard_mark_manual_knowledge_review") ||
    m.includes("manual_knowledge_search_logs") ||
    m.includes("manual_knowledge_review_queue") ||
    m.includes("does not exist")
  ) {
    return MISSING_SEARCH_REVIEW_HINT;
  }
  if (m === "manual_entry_id_required") return "검토할 지식 항목을 선택해 주세요.";
  if (m === "review_status_required" || m === "invalid_review_status") {
    return "검토상태를 선택해 주세요.";
  }
  if (m === "manual_entry_not_found") return "지식 항목을 찾을 수 없습니다.";
  if (m === "entry_archived") return "보관된 항목은 검토할 수 없습니다.";
  if (m === "invalid_entry_type") return "지식 유형이 올바르지 않습니다.";
  if (m === "forbidden") return "관리자 권한이 필요합니다.";
  return m;
}

export { loadCarriersForManualKnowledge, loadProductsForManualKnowledge, MANUAL_KNOWLEDGE_ENTRY_TYPE_LABELS };

export function normalizeManualKnowledgeSearch(data) {
  if (!data || typeof data !== "object") {
    return null;
  }

  const missing = Array.isArray(data.missing_information)
    ? data.missing_information
    : [];

  const results = Array.isArray(data.results) ? data.results : [];

  return {
    searchLogId: data.search_log_id ?? null,
    results,
    resultCount: data.result_count ?? 0,
    searchContext: data.search_context ?? {},
    missingInformation: missing,
    createdAt: data.created_at ?? null,
    raw: data,
  };
}

export function normalizeManualKnowledgeReview(data) {
  if (!data || typeof data !== "object") {
    return null;
  }

  const missing = Array.isArray(data.missing_information)
    ? data.missing_information
    : [];

  return {
    reviewQueueId: data.review_queue_id ?? null,
    manualEntryId: data.manual_entry_id ?? null,
    reviewStatus: data.review_status ?? null,
    reviewNote: data.review_note ?? "",
    missingInformation: missing,
    reviewedAt: data.reviewed_at ?? null,
    raw: data,
  };
}

export async function searchManualKnowledge({
  query,
  carrierId,
  productId,
  entryType,
}) {
  const { data, error } = await supabase.rpc("lifeguard_search_manual_knowledge", {
    p_query: query ?? "",
    p_carrier_id: carrierId || null,
    p_product_id: productId || null,
    p_entry_type: entryType || null,
  });

  if (error) {
    throw new Error(mapError(error));
  }

  return normalizeManualKnowledgeSearch(data);
}

export async function markManualKnowledgeReview({
  manualEntryId,
  reviewStatus,
  reviewNote,
}) {
  const { data, error } = await supabase.rpc("lifeguard_mark_manual_knowledge_review", {
    p_manual_entry_id: manualEntryId,
    p_review_status: reviewStatus,
    p_review_note: reviewNote?.trim() || null,
  });

  if (error) {
    throw new Error(mapError(error));
  }

  return normalizeManualKnowledgeReview(data);
}
