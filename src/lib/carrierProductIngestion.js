import { supabase } from "./supabase.js";

const MISSING_INGESTION_HINT =
  "보험사/상품 데이터 적재 준비가 아직 배포되지 않았습니다. Supabase SQL Editor에서 supabase/scripts/phase11_carrier_product_ingestion_readiness.sql 을 실행해 주세요.";

export const CARRIER_PRODUCT_INGESTION_MISSING_LABELS = {
  no_carrier_registry: "보험사 레지스트리 없음",
  no_product_registry: "상품 레지스트리 없음",
  no_carrier_knowledge: "보험사 지식 라이브러리 없음",
  no_source_knowledge_match: "소스 지식 매칭 없음",
  missing_carrier_link: "보험사 연결 누락",
  missing_product_link: "상품 연결 누락",
};

function mapError(error) {
  if (!error?.message) return "적재 준비를 처리하지 못했습니다.";
  const m = error.message;
  if (
    m.includes("lifeguard_prepare_carrier_product_ingestion") ||
    m.includes("carrier_data_ingestion_runs") ||
    m.includes("carrier_product_ingestion_items") ||
    m.includes("does not exist")
  ) {
    return MISSING_INGESTION_HINT;
  }
  if (m === "source_name_required") return "소스 이름을 입력해 주세요.";
  if (m === "source_reference_required") return "소스 참조를 입력해 주세요.";
  if (m === "forbidden") return "관리자 권한이 필요합니다.";
  return m;
}

export function normalizeCarrierProductIngestion(data) {
  if (!data || typeof data !== "object") {
    return null;
  }

  const missing = Array.isArray(data.missing_information)
    ? data.missing_information
    : [];

  return {
    ingestionRunId: data.ingestion_run_id ?? null,
    sourceName: data.source_name ?? "",
    sourceReference: data.source_reference ?? "",
    createdAt: data.created_at ?? null,
    ingestionStatus: data.ingestion_status ?? null,
    carrierCount: data.carrier_count ?? 0,
    productCount: data.product_count ?? 0,
    ingestionContext: data.ingestion_context ?? {},
    missingInformation: missing,
    raw: data,
  };
}

export async function prepareCarrierProductIngestion({ sourceName, sourceReference }) {
  const { data, error } = await supabase.rpc("lifeguard_prepare_carrier_product_ingestion", {
    p_source_name: sourceName.trim(),
    p_source_reference: sourceReference.trim(),
  });

  if (error) {
    throw new Error(mapError(error));
  }

  return normalizeCarrierProductIngestion(data);
}
