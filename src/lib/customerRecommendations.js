import { assertCustomerApiOk, fetchCustomerApi, rethrowCustomerApiError } from "./customerApiAuth.js";
import { toCustomerErrorMessage } from "./uiLocale.js";

const ROUTE_PATH = "/api/customer-recommendations";

function mapServerError(payload, status) {
  if (payload?.error_message) return payload.error_message;
  if (payload?.reason === "UNAUTHORIZED") return "로그인이 필요합니다.";
  if (payload?.reason === "ANTHROPIC_NOT_CONFIGURED") {
    return "서버에 Claude API 키가 설정되지 않았습니다.";
  }
  if (status === 404) return "보험 추천 API 경로를 찾을 수 없습니다.";
  return "보험 추천을 처리하지 못했습니다.";
}

export async function loadCustomerRecommendations({ skipClaude = false } = {}) {
  const { response, payload } = await fetchCustomerApi(ROUTE_PATH, {
    body: { skip_claude: skipClaude },
  });

  try {
    assertCustomerApiOk({ response, payload }, mapServerError(payload, response.status));
  } catch (error) {
    rethrowCustomerApiError(error, {
      payload,
      response,
      fallbackMessage: mapServerError(payload, response.status),
      mapMessage: (body, status) =>
        toCustomerErrorMessage(
          { message: body?.error_message ?? body?.reason, reason: body?.reason },
          mapServerError(body, status),
        ),
    });
  }

  return {
    customerId: payload.customer_id,
    memoryUsed: payload.memory_used ?? false,
    coverageGapUsed: payload.coverage_gap_used ?? false,
    underwritingUsed: payload.underwriting_used ?? false,
    memoryVersion: payload.memory_version ?? 0,
    memoryFactCount: payload.memory_fact_count ?? 0,
    usedMemorySources: Array.isArray(payload.used_memory_sources) ? payload.used_memory_sources : [],
    structuredMemory: payload.structured_memory ?? null,
    recommendations: Array.isArray(payload.recommendations) ? payload.recommendations : [],
    customerVisibleTop2: Array.isArray(payload.customer_visible_top2) ? payload.customer_visible_top2 : [],
    keepExistingRecommendations: Array.isArray(payload.keep_existing_recommendations)
      ? payload.keep_existing_recommendations
      : [],
    requiredDocuments: Array.isArray(payload.required_documents) ? payload.required_documents : [],
    claudeExplanation: payload.claude_explanation ?? null,
    claudeMeta: payload.claude_meta ?? null,
  };
}

export const RECOMMENDATION_TYPE_LABELS = {
  add_coverage: "보장 추가",
  keep_existing: "유지",
  review_existing: "검토",
  avoid_for_now: "보류",
  prepare_documents: "서류 준비 후 검토",
};

export const PRIORITY_LABELS = {
  high: "높음",
  medium: "보통",
  low: "낮음",
};
