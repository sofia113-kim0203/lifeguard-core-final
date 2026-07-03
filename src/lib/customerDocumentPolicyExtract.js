import { assertCustomerApiOk, fetchCustomerApi, rethrowCustomerApiError } from "./customerApiAuth.js";
import { toCustomerErrorMessage } from "./uiLocale.js";

const ROUTE_PATH = "/api/customer-document-policy-extract";

function mapServerError(payload, status) {
  if (payload?.error_message) return payload.error_message;
  if (payload?.reason === "UNAUTHORIZED") return "로그인이 필요합니다.";
  if (payload?.reason === "document_not_ready") return "문서 OCR 분석이 아직 완료되지 않았습니다.";
  if (payload?.reason === "work_order_required") return "KEY Work Order 없이 공장을 실행할 수 없습니다.";
  if (payload?.reason === "chunks_missing") return "OCR chunk가 없어 보험정보를 추출할 수 없습니다.";
  if (payload?.reason === "insufficient_policy_fields") {
    if (payload?.status === "pending_manual_review") {
      return "문서 OCR은 완료되었으나 보험정보가 부족해 관리자 검토가 필요합니다.";
    }
    return "문서 OCR은 완료되었으나 보험정보 추출에 필요한 항목이 부족합니다.";
  }
  if (status === 404) return "보험정보 추출 API 경로를 찾을 수 없습니다.";
  return "보험정보 추출을 처리하지 못했습니다.";
}

export async function extractPolicyFromReadyDocument(documentId, { invokeMemory = true, workOrderId = null } = {}) {
  const trimmedId = String(documentId ?? "").trim();
  if (!trimmedId) throw new Error("문서 ID가 없습니다.");

  const body = {
    document_id: trimmedId,
    invoke_memory: invokeMemory,
  };
  if (workOrderId) {
    body.work_order_id = workOrderId;
  }

  const { response, payload } = await fetchCustomerApi(ROUTE_PATH, {
    body,
  });

  try {
    assertCustomerApiOk({ response, payload }, mapServerError(payload, response.status));
  } catch (error) {
    const failedPayload = error?.payload ?? payload;
    if (response.status === 422 && failedPayload?.extraction) {
      return {
        ok: false,
        documentId: trimmedId,
        reason: failedPayload.reason ?? "extraction_failed",
        status: failedPayload.status ?? "extraction_failed",
        extraction: failedPayload.extraction,
        chunkCount: failedPayload.chunk_count ?? 0,
        ocrTextLength: failedPayload.ocr_text_length ?? 0,
        policyId: null,
        policyIds: failedPayload.policy_ids ?? [],
        policyCount: failedPayload.policy_count ?? 0,
        profileInsurancePoliciesCount: failedPayload.profile_insurance_policies_count ?? 0,
        customerMemoryFactsCount: failedPayload.customer_memory_facts_count ?? 0,
        message: mapServerError(failedPayload, response.status),
      };
    }

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
    ok: true,
    documentId: trimmedId,
    reason: null,
    extraction: payload.extraction ?? null,
    chunkCount: payload.chunk_count ?? 0,
    ocrTextLength: payload.ocr_text_length ?? 0,
    policyId: payload.policy_id ?? payload.policy_ids?.[0] ?? null,
    policyIds: payload.policy_ids ?? (payload.policy_id ? [payload.policy_id] : []),
    policyCount: payload.policy_count ?? payload.policy_ids?.length ?? (payload.policy_id ? 1 : 0),
    policyAction: payload.policy_action ?? null,
    policyActions: payload.policy_actions ?? null,
    profileInsurancePoliciesCount: payload.profile_insurance_policies_count ?? 0,
    customerMemoryFactsCount: payload.customer_memory_facts_count ?? 0,
    memoryBuilder: payload.memory_builder ?? null,
    message: "보험정보 추출이 완료되었습니다.",
  };
}
