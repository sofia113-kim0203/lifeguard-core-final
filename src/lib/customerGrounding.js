import { supabase } from "./supabase.js";

const MISSING_GROUNDING_HINT =
  "그라운딩 엔진이 아직 배포되지 않았습니다. Supabase SQL Editor에서 supabase/scripts/phase7_grounding_foundation.sql 을 실행해 주세요.";

function mapError(error) {
  if (!error?.message) return "그라운딩 패킷을 생성하지 못했습니다.";
  const m = error.message;
  if (
    m.includes("lifeguard_build_customer_grounding_packet") ||
    m.includes("customer_grounding_packets") ||
    m.includes("does not exist")
  ) {
    return MISSING_GROUNDING_HINT;
  }
  if (m === "customer_id_required") return "고객을 선택해 주세요.";
  if (m === "question_required") return "질문을 입력해 주세요.";
  if (m === "customer_not_found") return "고객을 찾을 수 없습니다.";
  if (m === "forbidden") return "관리자 권한이 필요합니다.";
  return m;
}

export async function loadCustomersForGroundingTest() {
  const { data, error } = await supabase
    .from("customer_profiles")
    .select("id, display_name, birth_date, gender, status")
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(100);

  if (error) {
    if (error.message?.includes("customer_profiles")) {
      throw new Error("고객 프로필을 불러오지 못했습니다.");
    }
    throw new Error(mapError(error));
  }
  return data ?? [];
}

export async function buildCustomerGroundingPacket({
  customerId,
  question,
  conversationId = null,
  includeRetrieval = true,
}) {
  const { data, error } = await supabase.rpc("lifeguard_build_customer_grounding_packet", {
    p_customer_id: customerId,
    p_question: question.trim(),
    p_conversation_id: conversationId || null,
    p_include_retrieval: includeRetrieval,
  });

  if (error) {
    throw new Error(mapError(error));
  }

  return normalizeGroundingPacket(data);
}

function normalizeGroundingPacket(data) {
  if (!data || typeof data !== "object") {
    return null;
  }

  const missing = Array.isArray(data.missing_information)
    ? data.missing_information
    : data.missing_information ?? [];

  return {
    groundingPacketId: data.grounding_packet_id ?? null,
    question: data.question ?? "",
    customerId: data.customer_id ?? null,
    conversationId: data.conversation_id ?? null,
    generatedAt: data.generated_at ?? null,
    customerContext: data.customer_context ?? {},
    medicalContext: data.medical_context ?? {},
    insuranceContext: data.insurance_context ?? {},
    coverageContext: data.coverage_context ?? {},
    industryLimitContext: data.industry_limit_context ?? {},
    retrievalContext: data.retrieval_context ?? {},
    missingInformation: missing,
    raw: data,
  };
}
