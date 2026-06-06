import { supabase } from "./supabase.js";
import { loadRealPolicyPdfRegistry } from "./realPolicyPdfUploadStorage.js";

const MISSING_REAL_POLICY_EXTRACTION_HINT =
  "실제 약관 추출 파이프라인이 아직 배포되지 않았습니다. Supabase SQL Editor에서 supabase/scripts/phase14_real_policy_pdf_extraction_pipeline_foundation.sql 을 실행해 주세요.";

export const REAL_POLICY_EXTRACTION_STATUS_LABELS = {
  pending: "대기",
  queued: "대기열",
  processing: "처리 중",
  completed: "완료",
  failed: "실패",
};

export const REAL_POLICY_PAGE_STATUS_LABELS = {
  registered: "등록됨",
  queued: "대기열",
  processed: "처리됨",
  failed: "실패",
};

export const REAL_POLICY_EXTRACTION_MISSING_LABELS = {
  policy_pdf_not_found: "Policy PDF 없음",
  pdf_not_validated: "PDF 검증 미완료",
  validation_not_passed: "검증 통과 없음",
  active_extraction_run_exists: "활성 추출 run 존재",
  extraction_run_not_found: "추출 run 없음",
  extraction_run_not_active: "추출 run 비활성",
  page_number_exceeds_count: "페이지 번호 초과",
  duplicate_page_number: "중복 페이지 번호",
};

function mapError(error) {
  if (!error?.message) return "실제 약관 추출 파이프라인을 처리하지 못했습니다.";
  const m = error.message;
  if (
    m.includes("lifeguard_register_real_policy_extraction") ||
    m.includes("lifeguard_register_real_policy_page") ||
    m.includes("real_policy_pdf_extraction_runs") ||
    m.includes("real_policy_pdf_page_registry") ||
    m.includes("does not exist")
  ) {
    return MISSING_REAL_POLICY_EXTRACTION_HINT;
  }
  if (m === "policy_pdf_id_required") return "Policy PDF를 선택해 주세요.";
  if (m === "page_count_required") return "페이지 수를 입력해 주세요.";
  if (m === "policy_pdf_not_found") return "Policy PDF를 찾을 수 없습니다.";
  if (m === "active_extraction_run_exists") return "이미 활성 추출 run이 있습니다.";
  if (m === "extraction_run_id_required") return "추출 run ID가 필요합니다.";
  if (m === "page_number_required") return "페이지 번호를 입력해 주세요.";
  if (m === "page_reference_required") return "페이지 참조를 입력해 주세요.";
  if (m === "extraction_run_not_found") return "추출 run을 찾을 수 없습니다.";
  if (m === "extraction_run_not_active") return "추출 run이 활성 상태가 아닙니다.";
  if (m === "page_number_exceeds_count") return "페이지 번호가 등록된 페이지 수를 초과합니다.";
  if (m === "duplicate_page_number") return "동일 페이지 번호가 이미 등록되어 있습니다.";
  if (m === "forbidden") return "관리자 권한이 필요합니다.";
  return m;
}

export { loadRealPolicyPdfRegistry };

export function normalizeRealPolicyExtractionRegistration(data) {
  if (!data || typeof data !== "object") {
    return null;
  }

  const missing = Array.isArray(data.missing_information) ? data.missing_information : [];

  return {
    extractionRunId: data.extraction_run_id ?? null,
    extractionStatus: data.extraction_status ?? null,
    pageCount: data.page_count ?? 0,
    missingInformation: missing,
    createdAt: data.created_at ?? null,
    raw: data,
  };
}

export function normalizeRealPolicyPageRegistration(data) {
  if (!data || typeof data !== "object") {
    return null;
  }

  const missing = Array.isArray(data.missing_information) ? data.missing_information : [];

  return {
    pageRegistryId: data.page_registry_id ?? null,
    pageStatus: data.page_status ?? null,
    pageNumber: data.page_number ?? null,
    extractionRunId: data.extraction_run_id ?? null,
    registeredPageCount: data.registered_page_count ?? 0,
    extractionStatus: data.extraction_status ?? null,
    missingInformation: missing,
    createdAt: data.created_at ?? null,
    raw: data,
  };
}

export async function registerRealPolicyExtraction({ policyPdfId, pageCount }) {
  const { data, error } = await supabase.rpc("lifeguard_register_real_policy_extraction", {
    p_policy_pdf_id: policyPdfId,
    p_page_count: pageCount,
  });

  if (error) {
    throw new Error(mapError(error));
  }

  return normalizeRealPolicyExtractionRegistration(data);
}

export async function registerRealPolicyPage({
  extractionRunId,
  policyPdfId,
  pageNumber,
  pageReference,
}) {
  const { data, error } = await supabase.rpc("lifeguard_register_real_policy_page", {
    p_extraction_run_id: extractionRunId,
    p_policy_pdf_id: policyPdfId,
    p_page_number: pageNumber,
    p_page_reference: pageReference,
  });

  if (error) {
    throw new Error(mapError(error));
  }

  return normalizeRealPolicyPageRegistration(data);
}

export async function loadRealPolicyExtractionRuns(limit = 50) {
  const { data, error } = await supabase
    .from("real_policy_pdf_extraction_runs")
    .select(
      "id, policy_pdf_id, extraction_status, page_count, extraction_context, missing_information, error_message, created_at, completed_at, pdf:real_policy_pdf_registry(id, file_name, storage_path, upload_status, carrier_id, product_id, carrier:carrier_registry(carrier_name), product:carrier_product_registry(product_name))",
    )
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    throw new Error(mapError(error));
  }

  return data ?? [];
}

export async function loadRealPolicyPageRegistry(extractionRunId) {
  if (!extractionRunId) return [];

  const { data, error } = await supabase
    .from("real_policy_pdf_page_registry")
    .select(
      "id, extraction_run_id, policy_pdf_id, page_number, page_status, page_reference, created_at",
    )
    .eq("extraction_run_id", extractionRunId)
    .order("page_number", { ascending: true });

  if (error) {
    throw new Error(mapError(error));
  }

  return data ?? [];
}
