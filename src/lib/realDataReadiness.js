import { supabase } from "./supabase.js";

const MISSING_READINESS_HINT =
  "실데이터 준비상태 점검이 아직 배포되지 않았습니다. Supabase SQL Editor에서 supabase/scripts/phase11_real_data_readiness_foundation.sql 을 실행해 주세요.";

export const REAL_DATA_READINESS_MISSING_LABELS = {
  no_customer_profile: "고객 프로필 없음",
  incomplete_customer_profile: "고객 프로필 불완전",
  no_medical_data: "의료 데이터 없음",
  partial_medical_data: "의료 데이터 부분",
  no_policy_data: "보험 계약 데이터 없음",
  partial_policy_data: "보험 계약 데이터 부분",
  no_documents: "업로드 문서 없음",
  partial_documents: "준비 완료 문서 없음",
  no_ocr_results: "OCR 결과 없음",
  partial_ocr_results: "OCR 추출 미완료",
  no_carrier_registry: "보험사 레지스트리 없음",
  no_product_registry: "상품 레지스트리 없음",
  no_carrier_knowledge: "보험사 지식 없음",
  no_recommendation_output: "고객 추천 출력 없음",
  no_agent_output: "설계사 출력 없음",
  no_admin_review: "관리자 검토 없음",
};

export const REAL_DATA_READINESS_CHECK_LABELS = {
  customer_profile: "고객 프로필",
  customer_medical_data: "고객 의료 데이터",
  customer_policy_data: "고객 보험 계약",
  customer_document_upload: "고객 문서 업로드",
  ocr_result: "OCR 결과",
  carrier_registry: "보험사 레지스트리",
  product_registry: "상품 레지스트리",
  carrier_knowledge: "보험사 지식",
  recommendation_output: "고객 추천 출력",
  agent_output: "설계사 출력",
  admin_review: "관리자 검토",
};

function mapError(error) {
  if (!error?.message) return "실데이터 준비상태를 확인하지 못했습니다.";
  const m = error.message;
  if (
    m.includes("lifeguard_check_real_data_readiness") ||
    m.includes("lifeguard_real_data_readiness_runs") ||
    m.includes("lifeguard_real_data_readiness_checks") ||
    m.includes("does not exist")
  ) {
    return MISSING_READINESS_HINT;
  }
  if (m === "customer_id_required") return "고객을 선택해 주세요.";
  if (m === "forbidden") return "관리자 권한이 필요합니다.";
  return m;
}

export function normalizeRealDataReadiness(data) {
  if (!data || typeof data !== "object") {
    return null;
  }

  const missing = Array.isArray(data.missing_information)
    ? data.missing_information
    : [];

  const checks = Array.isArray(data.checks) ? data.checks : [];

  const readyChecks = checks.filter((c) => c.check_status === "ready");
  const missingChecks = checks.filter((c) => c.check_status === "missing");

  return {
    readinessRunId: data.readiness_run_id ?? null,
    customerId: data.customer_id ?? null,
    createdAt: data.created_at ?? null,
    readinessStatus: data.readiness_status ?? null,
    readinessContext: data.readiness_context ?? {},
    checks,
    readyChecks,
    missingChecks,
    missingInformation: missing,
    raw: data,
  };
}

export async function checkRealDataReadiness({ customerId }) {
  const { data, error } = await supabase.rpc("lifeguard_check_real_data_readiness", {
    p_customer_id: customerId,
  });

  if (error) {
    throw new Error(mapError(error));
  }

  return normalizeRealDataReadiness(data);
}
