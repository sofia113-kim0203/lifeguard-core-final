import { supabase } from "./supabase.js";

const MISSING_POLICY_TEXT_EXTRACTION_HINT =
  "약관 텍스트 추출이 아직 배포되지 않았습니다. Supabase SQL Editor에서 supabase/scripts/phase12_policy_text_extraction_foundation.sql 을 실행해 주세요.";

export const POLICY_TEXT_EXTRACTION_STATUS_LABELS = {
  pending: "대기",
  queued: "대기열",
  processing: "처리 중",
  extracted: "추출 완료",
  failed: "실패",
};

export const POLICY_TEXT_EXTRACTION_PAGE_STATUS_LABELS = {
  pending: "대기",
  extracted: "추출 완료",
  failed: "실패",
  skipped: "건너뜀",
};

export const POLICY_TEXT_EXTRACTION_MISSING_LABELS = {
  pdf_ingestion_run_not_found: "PDF 적재 run 없음",
  invalid_pdf_ingestion_status: "PDF 적재 상태가 추출 등록 가능하지 않음",
  text_extraction_run_not_found: "텍스트 추출 run 없음",
  extracted_text_required: "추출 텍스트 필요",
  page_number_required: "페이지 번호 필요",
};

function mapError(error) {
  if (!error?.message) return "약관 텍스트 추출을 처리하지 못했습니다.";
  const m = error.message;
  if (
    m.includes("lifeguard_register_policy_text_extraction") ||
    m.includes("lifeguard_store_policy_extracted_text") ||
    m.includes("policy_text_extraction_runs") ||
    m.includes("policy_text_extraction_pages") ||
    m.includes("does not exist")
  ) {
    return MISSING_POLICY_TEXT_EXTRACTION_HINT;
  }
  if (m === "pdf_ingestion_run_id_required") return "PDF 적재 run ID가 필요합니다.";
  if (m === "text_extraction_run_id_required") return "텍스트 추출 run ID가 필요합니다.";
  if (m === "pdf_ingestion_run_not_found") return "PDF 적재 run을 찾을 수 없습니다.";
  if (m === "text_extraction_run_not_found") return "텍스트 추출 run을 찾을 수 없습니다.";
  if (m === "invalid_pdf_ingestion_status") return "현재 PDF 상태에서는 추출을 등록할 수 없습니다.";
  if (m === "extracted_text_required") return "추출 텍스트를 입력해 주세요.";
  if (m === "page_number_required") return "페이지 번호를 입력해 주세요.";
  if (m === "forbidden") return "관리자 권한이 필요합니다.";
  return m;
}

export function normalizePolicyTextExtractionRegistration(data) {
  if (!data || typeof data !== "object") {
    return null;
  }

  const missing = Array.isArray(data.missing_information)
    ? data.missing_information
    : [];

  return {
    textExtractionRunId: data.text_extraction_run_id ?? null,
    extractionStatus: data.extraction_status ?? null,
    missingInformation: missing,
    extractionContext: data.extraction_context ?? {},
    createdAt: data.created_at ?? null,
    raw: data,
  };
}

export function normalizePolicyExtractedTextStore(data) {
  if (!data || typeof data !== "object") {
    return null;
  }

  const missing = Array.isArray(data.missing_information)
    ? data.missing_information
    : [];

  return {
    textExtractionPageId: data.text_extraction_page_id ?? null,
    textExtractionRunId: data.text_extraction_run_id ?? null,
    pageStatus: data.page_status ?? null,
    pageNumber: data.page_number ?? null,
    extractionStatus: data.extraction_status ?? null,
    pageCount: data.page_count ?? 0,
    missingInformation: missing,
    storedAt: data.stored_at ?? null,
    raw: data,
  };
}

export async function registerPolicyTextExtraction(pdfIngestionRunId) {
  const { data, error } = await supabase.rpc("lifeguard_register_policy_text_extraction", {
    p_pdf_ingestion_run_id: pdfIngestionRunId,
  });

  if (error) {
    throw new Error(mapError(error));
  }

  return normalizePolicyTextExtractionRegistration(data);
}

export async function storePolicyExtractedText({
  textExtractionRunId,
  pageNumber,
  extractedText,
  extractionConfidence,
}) {
  const { data, error } = await supabase.rpc("lifeguard_store_policy_extracted_text", {
    p_text_extraction_run_id: textExtractionRunId,
    p_page_number: pageNumber,
    p_extracted_text: extractedText,
    p_extraction_confidence: extractionConfidence ?? null,
  });

  if (error) {
    throw new Error(mapError(error));
  }

  return normalizePolicyExtractedTextStore(data);
}

export async function loadPolicyTextExtractionRun(runId) {
  if (!runId) return null;

  const { data, error } = await supabase
    .from("policy_text_extraction_runs")
    .select(
      "id, pdf_ingestion_run_id, carrier_id, product_id, extraction_status, extraction_context, extracted_text_reference, missing_information, error_message, created_at, completed_at, carrier:carrier_registry(carrier_name), product:carrier_product_registry(product_name), pdf_run:policy_pdf_ingestion_runs(original_filename, storage_path, ingestion_status)"
    )
    .eq("id", runId)
    .maybeSingle();

  if (error) {
    throw new Error(mapError(error));
  }

  return data;
}

export async function loadPolicyTextExtractionPages(runId) {
  if (!runId) return [];

  const { data, error } = await supabase
    .from("policy_text_extraction_pages")
    .select(
      "id, text_extraction_run_id, page_number, page_status, extracted_text, extraction_confidence, error_message, created_at"
    )
    .eq("text_extraction_run_id", runId)
    .order("page_number", { ascending: true });

  if (error) {
    throw new Error(mapError(error));
  }

  return data ?? [];
}

export async function loadPdfIngestionRunsForExtraction(limit = 50) {
  const { data, error } = await supabase
    .from("policy_pdf_ingestion_runs")
    .select(
      "id, carrier_id, product_id, original_filename, storage_path, ingestion_status, created_at, carrier:carrier_registry(carrier_name), product:carrier_product_registry(product_name)"
    )
    .in("ingestion_status", ["queued_for_text_extraction", "registered", "uploaded", "extracted"])
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    throw new Error(mapError(error));
  }

  return data ?? [];
}
