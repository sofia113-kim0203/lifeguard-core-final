import { supabase } from "./supabase.js";
import { loadRealPolicyExtractionRuns } from "./realPolicyPdfExtractionPipeline.js";

const MISSING_REAL_POLICY_TEXT_EXTRACTION_HINT =
  "실제 약관 텍스트 추출이 아직 배포되지 않았습니다. Supabase SQL Editor에서 supabase/scripts/phase14_real_policy_text_extraction_execution_foundation.sql 을 실행해 주세요.";

export const REAL_POLICY_TEXT_EXTRACTION_STATUS_LABELS = {
  pending: "대기",
  processing: "처리 중",
  completed: "완료",
  failed: "실패",
};

export const REAL_POLICY_EXTRACTED_TEXT_STATUS_LABELS = {
  extracted: "추출됨",
  reviewed: "검토됨",
  rejected: "반려됨",
};

export const REAL_POLICY_TEXT_EXTRACTION_MISSING_LABELS = {
  extraction_run_not_found: "추출 run 없음",
  extraction_run_not_ready: "추출 run 준비 미완료",
  no_pages_registered: "등록된 페이지 없음",
  no_page_registry_entries: "페이지 레지스트리 없음",
  incomplete_page_registry: "페이지 레지스트리 불완전",
  active_text_extraction_run_exists: "활성 텍스트 추출 run 존재",
  text_extraction_run_not_found: "텍스트 추출 run 없음",
  text_extraction_run_not_active: "텍스트 추출 run 비활성",
  extracted_text_required: "추출 텍스트 필요",
  page_not_registered: "페이지 미등록",
};

function mapError(error) {
  if (!error?.message) return "실제 약관 텍스트 추출을 처리하지 못했습니다.";
  const m = error.message;
  if (
    m.includes("lifeguard_register_real_policy_text_extraction") ||
    m.includes("lifeguard_store_real_policy_extracted_text") ||
    m.includes("real_policy_text_extraction_runs") ||
    m.includes("real_policy_extracted_text_pages") ||
    m.includes("does not exist")
  ) {
    return MISSING_REAL_POLICY_TEXT_EXTRACTION_HINT;
  }
  if (m === "extraction_run_id_required") return "추출 run ID가 필요합니다.";
  if (m === "policy_pdf_id_required") return "Policy PDF ID가 필요합니다.";
  if (m === "extraction_run_not_found") return "추출 run을 찾을 수 없습니다.";
  if (m === "active_text_extraction_run_exists") return "이미 활성 텍스트 추출 run이 있습니다.";
  if (m === "text_extraction_run_id_required") return "텍스트 추출 run ID가 필요합니다.";
  if (m === "text_extraction_run_not_found") return "텍스트 추출 run을 찾을 수 없습니다.";
  if (m === "text_extraction_run_not_active") return "텍스트 추출 run이 활성 상태가 아닙니다.";
  if (m === "page_number_required") return "페이지 번호를 입력해 주세요.";
  if (m === "extracted_text_required") return "추출 텍스트를 입력해 주세요.";
  if (m === "page_not_registered") return "등록되지 않은 페이지입니다.";
  if (m === "forbidden") return "관리자 권한이 필요합니다.";
  return m;
}

export { loadRealPolicyExtractionRuns };

export function normalizeRealPolicyTextExtractionRegistration(data) {
  if (!data || typeof data !== "object") {
    return null;
  }

  const missing = Array.isArray(data.missing_information) ? data.missing_information : [];

  return {
    textExtractionRunId: data.text_extraction_run_id ?? null,
    extractionStatus: data.extraction_status ?? null,
    expectedPageCount: data.expected_page_count ?? 0,
    registeredPageCount: data.registered_page_count ?? 0,
    missingInformation: missing,
    createdAt: data.created_at ?? null,
    raw: data,
  };
}

export function normalizeRealPolicyExtractedTextStorage(data) {
  if (!data || typeof data !== "object") {
    return null;
  }

  const missing = Array.isArray(data.missing_information) ? data.missing_information : [];

  return {
    extractedPageId: data.extracted_page_id ?? null,
    textExtractionRunId: data.text_extraction_run_id ?? null,
    textStatus: data.text_status ?? null,
    pageNumber: data.page_number ?? null,
    extractionStatus: data.extraction_status ?? null,
    extractedPageCount: data.extracted_page_count ?? 0,
    missingInformation: missing,
    storedAt: data.stored_at ?? null,
    raw: data,
  };
}

export async function registerRealPolicyTextExtraction({ extractionRunId, policyPdfId }) {
  const { data, error } = await supabase.rpc("lifeguard_register_real_policy_text_extraction", {
    p_extraction_run_id: extractionRunId,
    p_policy_pdf_id: policyPdfId,
  });

  if (error) {
    throw new Error(mapError(error));
  }

  return normalizeRealPolicyTextExtractionRegistration(data);
}

export async function storeRealPolicyExtractedText({
  textExtractionRunId,
  policyPdfId,
  pageNumber,
  extractedText,
}) {
  const { data, error } = await supabase.rpc("lifeguard_store_real_policy_extracted_text", {
    p_text_extraction_run_id: textExtractionRunId,
    p_policy_pdf_id: policyPdfId,
    p_page_number: pageNumber,
    p_extracted_text: extractedText,
  });

  if (error) {
    throw new Error(mapError(error));
  }

  return normalizeRealPolicyExtractedTextStorage(data);
}

export async function loadRealPolicyTextExtractionRuns(limit = 50) {
  const { data, error } = await supabase
    .from("real_policy_text_extraction_runs")
    .select(
      "id, extraction_run_id, policy_pdf_id, extraction_status, extracted_page_count, extraction_context, missing_information, error_message, created_at, completed_at, pdf:real_policy_pdf_registry(id, file_name, storage_path, carrier:carrier_registry(carrier_name), product:carrier_product_registry(product_name))",
    )
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    throw new Error(mapError(error));
  }

  return data ?? [];
}

export async function loadRealPolicyExtractedTextPages(textExtractionRunId) {
  if (!textExtractionRunId) return [];

  const { data, error } = await supabase
    .from("real_policy_extracted_text_pages")
    .select(
      "id, text_extraction_run_id, policy_pdf_id, page_number, extracted_text, text_status, created_at",
    )
    .eq("text_extraction_run_id", textExtractionRunId)
    .order("page_number", { ascending: true });

  if (error) {
    throw new Error(mapError(error));
  }

  return data ?? [];
}
