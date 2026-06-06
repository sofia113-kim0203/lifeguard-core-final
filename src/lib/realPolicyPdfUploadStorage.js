import { supabase } from "./supabase.js";
import {
  loadCarriersForManualKnowledge,
  loadProductsForManualKnowledge,
} from "./manualKnowledgeIngestion.js";
import { loadRealPolicyKnowledgeSources } from "./realPolicyKnowledgeIngestion.js";

const MISSING_REAL_POLICY_PDF_HINT =
  "실제 약관 PDF 관리가 아직 배포되지 않았습니다. Supabase SQL Editor에서 supabase/scripts/phase14_real_policy_pdf_upload_storage_foundation.sql 을 실행해 주세요.";

export const REAL_POLICY_PDF_UPLOAD_STATUS_LABELS = {
  uploaded: "업로드됨",
  validated: "검증됨",
  linked: "연결됨",
  failed: "실패",
};

export const REAL_POLICY_PDF_VALIDATION_STATUS_LABELS = {
  pending: "대기",
  passed: "통과",
  failed: "실패",
};

export const REAL_POLICY_PDF_MISSING_LABELS = {
  carrier_not_found: "보험사를 찾을 수 없음",
  product_not_found: "상품을 찾을 수 없음",
  policy_source_not_found: "Policy source 없음",
  carrier_source_mismatch: "보험사 불일치",
  product_source_mismatch: "상품 불일치",
  policy_source_rejected: "Policy source 반려됨",
  unexpected_file_type: "예상 파일 유형이 아님",
  file_size_missing: "파일 크기 없음",
  duplicate_storage_reference: "중복 Storage 참조",
  file_name_missing: "파일명 없음",
  storage_path_missing: "Storage Path 없음",
  file_version_missing: "버전 없음",
  policy_source_missing: "Policy source 연결 없음",
  policy_source_file_mismatch: "Policy source 파일 불일치",
  storage_item_not_found: "Storage item 없음",
  ingestion_run_not_found: "PDF 적재 run 없음",
};

function mapError(error) {
  if (!error?.message) return "실제 약관 PDF를 처리하지 못했습니다.";
  const m = error.message;
  if (
    m.includes("lifeguard_register_real_policy_pdf") ||
    m.includes("lifeguard_validate_real_policy_pdf") ||
    m.includes("real_policy_pdf_registry") ||
    m.includes("real_policy_pdf_validation_runs") ||
    m.includes("does not exist")
  ) {
    return MISSING_REAL_POLICY_PDF_HINT;
  }
  if (m === "policy_source_id_required") return "Policy source를 선택해 주세요.";
  if (m === "carrier_id_required") return "보험사를 선택해 주세요.";
  if (m === "file_name_required") return "파일명을 입력해 주세요.";
  if (m === "storage_path_required") return "Storage Path를 입력해 주세요.";
  if (m === "file_version_required") return "버전을 입력해 주세요.";
  if (m === "policy_pdf_id_required") return "Policy PDF ID가 필요합니다.";
  if (m === "policy_pdf_not_found") return "Policy PDF를 찾을 수 없습니다.";
  if (m === "carrier_not_found") return "보험사를 찾을 수 없습니다.";
  if (m === "product_not_found") return "상품을 찾을 수 없습니다.";
  if (m === "policy_source_not_found") return "Policy source를 찾을 수 없습니다.";
  if (m === "duplicate_storage_reference") return "동일 Storage 참조가 이미 등록되어 있습니다.";
  if (m === "forbidden") return "관리자 권한이 필요합니다.";
  return m;
}

export { loadCarriersForManualKnowledge, loadProductsForManualKnowledge, loadRealPolicyKnowledgeSources };

export function normalizeRealPolicyPdfRegistration(data) {
  if (!data || typeof data !== "object") {
    return null;
  }

  const missing = Array.isArray(data.missing_information) ? data.missing_information : [];

  return {
    policyPdfId: data.policy_pdf_id ?? null,
    uploadStatus: data.upload_status ?? null,
    missingInformation: missing,
    createdAt: data.created_at ?? null,
    raw: data,
  };
}

export function normalizeRealPolicyPdfValidation(data) {
  if (!data || typeof data !== "object") {
    return null;
  }

  const missing = Array.isArray(data.missing_information) ? data.missing_information : [];

  return {
    pdfValidationRunId: data.pdf_validation_run_id ?? null,
    policyPdfId: data.policy_pdf_id ?? null,
    validationStatus: data.validation_status ?? null,
    uploadStatus: data.upload_status ?? null,
    missingInformation: missing,
    validationContext: data.validation_context ?? {},
    createdAt: data.created_at ?? null,
    raw: data,
  };
}

export async function registerRealPolicyPdf({
  policySourceId,
  carrierId,
  productId,
  fileName,
  fileSize,
  fileType,
  storagePath,
  fileVersion,
}) {
  const { data, error } = await supabase.rpc("lifeguard_register_real_policy_pdf", {
    p_policy_source_id: policySourceId,
    p_carrier_id: carrierId,
    p_product_id: productId || null,
    p_file_name: fileName,
    p_file_size: fileSize ?? null,
    p_file_type: fileType || "application/pdf",
    p_storage_path: storagePath,
    p_file_version: fileVersion,
  });

  if (error) {
    throw new Error(mapError(error));
  }

  return normalizeRealPolicyPdfRegistration(data);
}

export async function validateRealPolicyPdf(policyPdfId) {
  if (!policyPdfId) {
    throw new Error("Policy PDF ID가 필요합니다.");
  }

  const { data, error } = await supabase.rpc("lifeguard_validate_real_policy_pdf", {
    p_policy_pdf_id: policyPdfId,
  });

  if (error) {
    throw new Error(mapError(error));
  }

  return normalizeRealPolicyPdfValidation(data);
}

export async function loadRealPolicyPdfRegistry(limit = 50) {
  const { data, error } = await supabase
    .from("real_policy_pdf_registry")
    .select(
      "id, policy_source_id, carrier_id, product_id, file_name, file_size, file_type, storage_path, file_version, upload_status, uploaded_by, created_at, carrier:carrier_registry(carrier_name), product:carrier_product_registry(product_name), source:real_policy_knowledge_sources(source_name, source_status)",
    )
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    throw new Error(mapError(error));
  }

  return data ?? [];
}

export async function loadLatestValidationForPdf(policyPdfId) {
  if (!policyPdfId) return null;

  const { data, error } = await supabase
    .from("real_policy_pdf_validation_runs")
    .select(
      "id, policy_pdf_id, validation_status, validation_context, missing_information, error_message, created_at",
    )
    .eq("policy_pdf_id", policyPdfId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(mapError(error));
  }

  return data;
}
