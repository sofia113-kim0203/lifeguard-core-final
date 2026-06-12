import { assertCustomerApiOk, fetchCustomerApi, rethrowCustomerApiError } from "./customerApiAuth.js";
import { toCustomerErrorMessage } from "./uiLocale.js";

const ROUTE_PATH = "/api/customer-coverage-gap";

function mapServerError(payload, status) {
  if (payload?.error_message) return payload.error_message;
  if (payload?.reason === "UNAUTHORIZED") return "로그인이 필요합니다.";
  if (payload?.reason === "ANTHROPIC_NOT_CONFIGURED") {
    return "서버에 Claude API 키가 설정되지 않았습니다.";
  }
  if (status === 404) return "보장 공백 분석 API 경로를 찾을 수 없습니다.";
  return "보장 공백 분석을 처리하지 못했습니다.";
}

export async function analyzeCustomerCoverageGap({ skipClaude = false } = {}) {
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
    memoryVersion: payload.memory_version ?? 0,
    memoryFactCount: payload.memory_fact_count ?? 0,
    usedMemorySources: Array.isArray(payload.used_memory_sources) ? payload.used_memory_sources : [],
    structuredMemory: payload.structured_memory ?? null,
    coverageGapResult: payload.coverage_gap_result ?? null,
    claudeExplanation: payload.claude_explanation ?? null,
    claudeMeta: payload.claude_meta ?? null,
  };
}

export const GAP_LEVEL_LABELS = {
  critical: "매우 높음",
  high: "높음",
  medium: "보통",
  low: "낮음",
  sufficient: "충분",
};

export const OVERALL_RISK_LABELS = {
  high: "높음",
  medium: "보통",
  low: "낮음",
};
