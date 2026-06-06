import { supabase } from "./supabase.js";
import { loadRealPolicyPdfRegistry } from "./realPolicyPdfUploadStorage.js";
import { loadCustomersForGroundingTest } from "./customerGrounding.js";
import {
  loadCarriersForManualKnowledge,
  loadProductsForManualKnowledge,
} from "./manualKnowledgeIngestion.js";

const MISSING_INTEGRATION_HINT =
  "실제 약관 고객 AI 답변 연동이 아직 배포되지 않았습니다. Supabase SQL Editor에서 supabase/scripts/phase14_real_policy_customer_ai_conversation_integration.sql 을 실행해 주세요.";

export const REAL_POLICY_CUSTOMER_AI_MISSING_LABELS = {
  no_query: "검색어 없음",
  query_required: "검색어 필요",
  missing_policy_scope: "약관 범위 없음",
  policy_pdf_not_found: "Policy PDF 없음",
  customer_not_found: "고객 없음",
  grounded_conversation_failed: "Grounded 대화 실패",
  grounded_conversation_insufficient_context: "Grounded 대화 컨텍스트 부족",
  claude_grounding_request_failed: "Claude Grounding 요청 실패",
  claude_execution_prep_failed: "Claude 실행 준비 실패",
  claude_grounding_run_missing: "Claude grounding run 없음",
};

function mapError(error) {
  if (!error?.message) return "실제 약관 고객 AI 답변 준비를 처리하지 못했습니다.";
  const m = error.message;
  if (
    m.includes("lifeguard_prepare_customer_real_policy_ai_conversation") ||
    m.includes("does not exist")
  ) {
    return MISSING_INTEGRATION_HINT;
  }
  if (m === "forbidden") return "관리자 권한이 필요합니다.";
  if (m === "customer_id_required") return "고객을 선택해 주세요.";
  if (m === "conversation_id_required") return "Conversation ID를 입력해 주세요.";
  if (m === "query_required") return "Query를 입력해 주세요.";
  if (m === "customer_not_found") return "고객을 찾을 수 없습니다.";
  if (m === "policy_pdf_not_found") return "Policy PDF를 찾을 수 없습니다.";
  return m;
}

export {
  loadRealPolicyPdfRegistry,
  loadCustomersForGroundingTest,
  loadCarriersForManualKnowledge,
  loadProductsForManualKnowledge,
};

export function normalizeRealPolicyCustomerAiPreparation(data) {
  if (!data || typeof data !== "object") {
    return null;
  }

  const missing = Array.isArray(data.missing_information) ? data.missing_information : [];

  return {
    customerAiConversationRunId: data.customer_ai_conversation_run_id ?? null,
    groundedConversationRunId: data.grounded_conversation_run_id ?? null,
    claudeGroundingRunId: data.claude_grounding_run_id ?? null,
    claudeExecutionRunId: data.claude_execution_run_id ?? null,
    groundingSourceCount: data.grounding_source_count ?? 0,
    claudeGroundingReady: data.claude_grounding_ready ?? false,
    executionStatus: data.execution_status ?? null,
    policyPdfId: data.policy_pdf_id ?? null,
    carrierId: data.carrier_id ?? null,
    productId: data.product_id ?? null,
    fileName: data.file_name ?? null,
    fileVersion: data.file_version ?? null,
    missingInformation: missing,
    createdAt: data.created_at ?? null,
    raw: data,
  };
}

export async function prepareCustomerRealPolicyAiConversation({
  customerId,
  conversationId,
  policyPdfId,
  carrierId,
  productId,
  query,
}) {
  const { data, error } = await supabase.rpc(
    "lifeguard_prepare_customer_real_policy_ai_conversation",
    {
      p_customer_id: customerId,
      p_conversation_id: conversationId,
      p_policy_pdf_id: policyPdfId || null,
      p_carrier_id: carrierId || null,
      p_product_id: productId || null,
      p_query: query,
    }
  );

  if (error) {
    throw new Error(mapError(error));
  }

  return normalizeRealPolicyCustomerAiPreparation(data);
}

export async function loadCustomerAiConversationRun(runId) {
  if (!runId) return null;

  const { data, error } = await supabase
    .from("customer_ai_conversation_runs")
    .select(
      "id, customer_id, conversation_id, query, execution_status, grounded_conversation_run_id, claude_execution_run_id, response_preview, response_status, missing_information, error_message, created_at, completed_at",
    )
    .eq("id", runId)
    .maybeSingle();

  if (error) {
    throw new Error(mapError(error));
  }

  return data;
}
