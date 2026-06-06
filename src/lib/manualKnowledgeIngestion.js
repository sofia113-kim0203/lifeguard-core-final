import { supabase } from "./supabase.js";

const MISSING_MANUAL_KNOWLEDGE_HINT =
  "수작업 지식 등록이 아직 배포되지 않았습니다. Supabase SQL Editor에서 supabase/scripts/phase11_manual_knowledge_ingestion_foundation.sql 을 실행해 주세요.";

export const MANUAL_KNOWLEDGE_ENTRY_TYPE_LABELS = {
  policy_terms: "약관",
  product_brochure: "상품 안내서",
  underwriting_manual: "인수지침",
  simplified_issue_guide: "간편심사 가이드",
  medical_underwriting_guide: "의료 인수 가이드",
  occupation_guide: "직업 가이드",
  smoking_guide: "흡연 가이드",
  claim_guide: "보험금 청구 가이드",
  claim_case: "보험금 사례",
  internal_reference: "내부 참고자료",
};

export const MANUAL_KNOWLEDGE_MISSING_LABELS = {
  no_carrier_registry: "보험사 레지스트리 없음",
  no_product_registry: "상품 레지스트리 없음",
  carrier_not_found: "보험사를 찾을 수 없음",
  product_not_found: "상품을 찾을 수 없음",
  duplicate_source_reference: "중복 출처 참조",
};

function mapError(error) {
  if (!error?.message) return "수작업 지식 등록을 처리하지 못했습니다.";
  const m = error.message;
  if (
    m.includes("lifeguard_register_manual_knowledge_entry") ||
    m.includes("manual_knowledge_ingestion_runs") ||
    m.includes("manual_knowledge_entries") ||
    m.includes("does not exist")
  ) {
    return MISSING_MANUAL_KNOWLEDGE_HINT;
  }
  if (m === "carrier_id_required") return "보험사를 선택해 주세요.";
  if (m === "entry_type_required" || m === "invalid_entry_type") return "지식 유형을 선택해 주세요.";
  if (m === "title_required") return "제목을 입력해 주세요.";
  if (m === "content_required") return "내용을 입력해 주세요.";
  if (m === "source_reference_required") return "출처를 입력해 주세요.";
  if (m === "carrier_not_found" || m === "no_carrier_registry") return "보험사를 찾을 수 없습니다.";
  if (m === "product_not_found" || m === "no_product_registry") return "상품을 찾을 수 없습니다.";
  if (m === "duplicate_source_reference") return "동일 출처 참조가 이미 등록되어 있습니다.";
  if (m === "forbidden") return "관리자 권한이 필요합니다.";
  return m;
}

export async function loadCarriersForManualKnowledge() {
  const { data, error } = await supabase
    .from("carrier_registry")
    .select("id, carrier_name, carrier_type, is_active")
    .eq("is_active", true)
    .order("carrier_name", { ascending: true })
    .limit(200);

  if (error) {
    if (error.message?.includes("carrier_registry")) {
      throw new Error("보험사 목록을 불러오지 못했습니다.");
    }
    throw new Error(mapError(error));
  }
  return data ?? [];
}

export async function loadProductsForManualKnowledge(carrierId) {
  if (!carrierId) return [];
  const { data, error } = await supabase
    .from("carrier_product_registry")
    .select("id, product_name, product_type, underwriting_program, is_active")
    .eq("carrier_id", carrierId)
    .eq("is_active", true)
    .order("product_name", { ascending: true })
    .limit(200);

  if (error) {
    if (error.message?.includes("carrier_product_registry")) {
      throw new Error("상품 목록을 불러오지 못했습니다.");
    }
    throw new Error(mapError(error));
  }
  return data ?? [];
}

export function normalizeManualKnowledgeRegistration(data) {
  if (!data || typeof data !== "object") {
    return null;
  }

  const missing = Array.isArray(data.missing_information)
    ? data.missing_information
    : [];

  return {
    manualEntryId: data.manual_entry_id ?? null,
    manualIngestionRunId: data.manual_ingestion_run_id ?? null,
    ingestionStatus: data.ingestion_status ?? null,
    entryStatus: data.entry_status ?? null,
    ingestionContext: data.ingestion_context ?? {},
    missingInformation: missing,
    createdAt: data.created_at ?? null,
    raw: data,
  };
}

export async function registerManualKnowledgeEntry({
  carrierId,
  productId,
  entryType,
  title,
  contentText,
  sourceReference,
  effectiveDate,
  expirationDate,
}) {
  const { data, error } = await supabase.rpc("lifeguard_register_manual_knowledge_entry", {
    p_carrier_id: carrierId,
    p_product_id: productId || null,
    p_entry_type: entryType,
    p_title: title.trim(),
    p_content_text: contentText.trim(),
    p_source_reference: sourceReference.trim(),
    p_effective_date: effectiveDate || null,
    p_expiration_date: expirationDate || null,
  });

  if (error) {
    throw new Error(mapError(error));
  }

  return normalizeManualKnowledgeRegistration(data);
}
