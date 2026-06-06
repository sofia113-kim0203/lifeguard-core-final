import { supabase } from "./supabase.js";
import {
  loadCarriersForManualKnowledge,
  loadProductsForManualKnowledge,
} from "./manualKnowledgeIngestion.js";

const MISSING_CLAUDE_GROUNDING_HINT =
  "Claude Grounding 준비가 아직 배포되지 않았습니다. Supabase SQL Editor에서 supabase/scripts/phase11_claude_grounding_integration_foundation.sql 을 실행해 주세요.";

export const CLAUDE_GROUNDING_STATUS_LABELS = {
  pending: "대기",
  ready_for_claude: "Claude 준비 완료",
  completed: "완료",
  failed: "실패",
  insufficient_context: "컨텍스트 부족",
};

export const CLAUDE_GROUNDING_MISSING_LABELS = {
  customer_not_found: "고객을 찾을 수 없음",
  no_query: "검색어 없음",
  carrier_not_found: "보험사를 찾을 수 없음",
  product_not_found: "상품을 찾을 수 없음",
  insufficient_context: "컨텍스트 부족",
  no_sources_found: "소스 없음",
  claude_grounding_run_not_found: "Claude grounding run 없음",
  response_context_empty: "응답 컨텍스트 없음",
};

function mapError(error) {
  if (!error?.message) return "Claude Grounding을 처리하지 못했습니다.";
  const m = error.message;
  if (
    m.includes("lifeguard_prepare_claude_grounding_request") ||
    m.includes("lifeguard_store_claude_grounded_response") ||
    m.includes("claude_grounding_runs") ||
    m.includes("claude_grounding_sources") ||
    m.includes("does not exist")
  ) {
    return MISSING_CLAUDE_GROUNDING_HINT;
  }
  if (m === "customer_id_required") return "Customer ID를 입력해 주세요.";
  if (m === "customer_not_found") return "고객을 찾을 수 없습니다.";
  if (m === "claude_grounding_run_id_required") return "Claude grounding run ID가 필요합니다.";
  if (m === "claude_grounding_run_not_found") return "Claude grounding run을 찾을 수 없습니다.";
  if (m === "forbidden") return "관리자 권한이 필요합니다.";
  return m;
}

export { loadCarriersForManualKnowledge, loadProductsForManualKnowledge };

export function normalizeClaudeGroundingRequest(data) {
  if (!data || typeof data !== "object") {
    return null;
  }

  const missing = Array.isArray(data.missing_information)
    ? data.missing_information
    : [];

  return {
    claudeGroundingRunId: data.claude_grounding_run_id ?? null,
    groundingContextRunId: data.grounding_context_run_id ?? null,
    requestContext: data.request_context ?? {},
    sourceCount: data.source_count ?? 0,
    responseStatus: data.response_status ?? null,
    missingInformation: missing,
    createdAt: data.created_at ?? null,
    raw: data,
  };
}

export function normalizeClaudeGroundedResponse(data) {
  if (!data || typeof data !== "object") {
    return null;
  }

  const missing = Array.isArray(data.missing_information)
    ? data.missing_information
    : [];

  return {
    claudeGroundingRunId: data.claude_grounding_run_id ?? null,
    responseStatus: data.response_status ?? null,
    responseContext: data.response_context ?? {},
    missingInformation: missing,
    storedAt: data.stored_at ?? null,
    raw: data,
  };
}

export async function prepareClaudeGroundingRequest({
  customerId,
  query,
  carrierId,
  productId,
}) {
  const { data, error } = await supabase.rpc("lifeguard_prepare_claude_grounding_request", {
    p_customer_id: customerId,
    p_query: query ?? "",
    p_carrier_id: carrierId || null,
    p_product_id: productId || null,
  });

  if (error) {
    throw new Error(mapError(error));
  }

  return normalizeClaudeGroundingRequest(data);
}

export async function storeClaudeGroundedResponse({
  claudeGroundingRunId,
  responseContext,
}) {
  const { data, error } = await supabase.rpc("lifeguard_store_claude_grounded_response", {
    p_claude_grounding_run_id: claudeGroundingRunId,
    p_response_context: responseContext ?? {},
  });

  if (error) {
    throw new Error(mapError(error));
  }

  return normalizeClaudeGroundedResponse(data);
}
