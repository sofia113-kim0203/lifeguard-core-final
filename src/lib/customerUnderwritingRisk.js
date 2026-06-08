import { supabase } from "./supabase.js";
import { toCustomerErrorMessage } from "./uiLocale.js";

const ROUTE_PATH = "/api/customer-underwriting-risk";

function mapServerError(payload, status) {
  if (payload?.error_message) return payload.error_message;
  if (payload?.reason === "UNAUTHORIZED") return "로그인이 필요합니다.";
  if (payload?.reason === "ANTHROPIC_NOT_CONFIGURED") {
    return "서버에 Claude API 키가 설정되지 않았습니다.";
  }
  if (status === 404) return "인수 위험 분석 API 경로를 찾을 수 없습니다.";
  return "인수 위험 분석을 처리하지 못했습니다.";
}

export async function analyzeCustomerUnderwritingRisk({ skipClaude = false } = {}) {
  const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
  if (sessionError || !sessionData?.session?.access_token) {
    throw new Error("로그인이 필요합니다.");
  }

  const response = await fetch(ROUTE_PATH, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${sessionData.session.access_token}`,
    },
    body: JSON.stringify({ skip_claude: skipClaude }),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload?.ok) {
    throw new Error(
      toCustomerErrorMessage(
        { message: payload?.error_message ?? payload?.reason },
        mapServerError(payload, response.status),
      ),
    );
  }

  return {
    customerId: payload.customer_id,
    memoryUsed: payload.memory_used ?? false,
    coverageGapUsed: payload.coverage_gap_used ?? false,
    memoryVersion: payload.memory_version ?? 0,
    memoryFactCount: payload.memory_fact_count ?? 0,
    usedMemorySources: Array.isArray(payload.used_memory_sources) ? payload.used_memory_sources : [],
    structuredMemory: payload.structured_memory ?? null,
    coverageGapResult: payload.coverage_gap_result ?? null,
    underwritingResult: payload.underwriting_result ?? null,
    requiredDocuments: Array.isArray(payload.required_documents) ? payload.required_documents : [],
    claudeExplanation: payload.claude_explanation ?? null,
    claudeMeta: payload.claude_meta ?? null,
  };
}

export const UNDERWRITING_STATUS_LABELS = {
  likely_standard: "표준 가능",
  likely_surcharge: "할증 가능",
  likely_exclusion: "부담보 가능",
  likely_additional_review: "추가심사",
  likely_decline: "거절 위험",
  unknown: "정보 부족",
};

export const RISK_LEVEL_LABELS = {
  critical: "매우 높음",
  high: "높음",
  medium: "보통",
  low: "낮음",
};
