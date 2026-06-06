import { supabase } from "./supabase.js";
import {
  loadCarriersForManualKnowledge,
  loadProductsForManualKnowledge,
} from "./manualKnowledgeIngestion.js";

const MISSING_POLICY_PDF_HINT =
  "실제 약관 PDF 적재가 아직 배포되지 않았습니다. Supabase SQL Editor에서 supabase/scripts/phase12_policy_pdf_ingestion_foundation.sql 을 실행해 주세요.";

export const POLICY_PDF_INGESTION_STATUS_LABELS = {
  uploaded: "업로드됨",
  registered: "등록됨",
  queued_for_text_extraction: "텍스트 추출 대기",
  extracted: "추출 완료",
  failed: "실패",
};

export const POLICY_PDF_MISSING_LABELS = {
  carrier_not_found: "보험사를 찾을 수 없음",
  product_not_found: "상품을 찾을 수 없음",
  unexpected_mime_type: "예상 MIME 유형이 아님",
  file_size_missing: "파일 크기 없음",
  pdf_ingestion_run_not_found: "PDF 적재 run 없음",
  invalid_ingestion_status: "적재 상태가 링크 가능하지 않음",
  no_policy_documents_table: "약관 문서 테이블 없음",
  policy_document_insert_failed: "약관 문서 등록 실패",
  policy_document_not_found: "약관 문서 없음",
};

function mapError(error) {
  if (!error?.message) return "약관 PDF 적재를 처리하지 못했습니다.";
  const m = error.message;
  if (
    m.includes("lifeguard_register_policy_pdf_ingestion") ||
    m.includes("lifeguard_link_policy_pdf_to_rag_source") ||
    m.includes("policy_pdf_ingestion_runs") ||
    m.includes("policy_pdf_storage_items") ||
    m.includes("does not exist")
  ) {
    return MISSING_POLICY_PDF_HINT;
  }
  if (m === "carrier_id_required") return "보험사를 선택해 주세요.";
  if (m === "original_filename_required") return "파일명을 입력해 주세요.";
  if (m === "storage_path_required") return "Storage Path를 입력해 주세요.";
  if (m === "pdf_ingestion_run_id_required") return "PDF 적재 run ID가 필요합니다.";
  if (m === "pdf_ingestion_run_not_found") return "PDF 적재 run을 찾을 수 없습니다.";
  if (m === "invalid_ingestion_status") return "현재 상태에서는 RAG 링크할 수 없습니다.";
  if (m === "carrier_not_found") return "보험사를 찾을 수 없습니다.";
  if (m === "product_not_found") return "상품을 찾을 수 없습니다.";
  if (m === "forbidden") return "관리자 권한이 필요합니다.";
  return m;
}

export { loadCarriersForManualKnowledge, loadProductsForManualKnowledge };

export function normalizePolicyPdfRegistration(data) {
  if (!data || typeof data !== "object") {
    return null;
  }

  const missing = Array.isArray(data.missing_information)
    ? data.missing_information
    : [];

  return {
    pdfIngestionRunId: data.pdf_ingestion_run_id ?? null,
    ingestionStatus: data.ingestion_status ?? null,
    missingInformation: missing,
    sourceReference: data.source_reference ?? null,
    storagePath: data.storage_path ?? null,
    createdAt: data.created_at ?? null,
    raw: data,
  };
}

export function normalizePolicyPdfRagLink(data) {
  if (!data || typeof data !== "object") {
    return null;
  }

  const missing = Array.isArray(data.missing_information)
    ? data.missing_information
    : [];

  return {
    pdfIngestionRunId: data.pdf_ingestion_run_id ?? null,
    ragSourceId: data.rag_source_id ?? null,
    sourceStatus: data.source_status ?? null,
    missingInformation: missing,
    linkedAt: data.linked_at ?? null,
    raw: data,
  };
}

export async function registerPolicyPdfIngestion({
  carrierId,
  productId,
  originalFilename,
  storagePath,
  mimeType,
  fileSize,
  sourceReference,
}) {
  const { data, error } = await supabase.rpc("lifeguard_register_policy_pdf_ingestion", {
    p_carrier_id: carrierId,
    p_product_id: productId || null,
    p_original_filename: originalFilename,
    p_storage_path: storagePath,
    p_mime_type: mimeType || "application/pdf",
    p_file_size: fileSize ?? null,
    p_source_reference: sourceReference?.trim() || null,
  });

  if (error) {
    throw new Error(mapError(error));
  }

  return normalizePolicyPdfRegistration(data);
}

export async function linkPolicyPdfToRagSource(pdfIngestionRunId) {
  const { data, error } = await supabase.rpc("lifeguard_link_policy_pdf_to_rag_source", {
    p_pdf_ingestion_run_id: pdfIngestionRunId,
  });

  if (error) {
    throw new Error(mapError(error));
  }

  return normalizePolicyPdfRagLink(data);
}

export async function loadPolicyPdfIngestionRuns(limit = 50) {
  const { data, error } = await supabase
    .from("policy_pdf_ingestion_runs")
    .select(
      "id, carrier_id, product_id, original_filename, storage_path, mime_type, file_size, ingestion_status, source_reference, missing_information, error_message, created_at, carrier:carrier_registry(carrier_name), product:carrier_product_registry(product_name)"
    )
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    throw new Error(mapError(error));
  }

  return data ?? [];
}
