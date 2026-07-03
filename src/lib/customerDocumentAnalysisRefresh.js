import { assertCustomerApiOk, fetchCustomerApi, rethrowCustomerApiError } from "./customerApiAuth.js";
import { toCustomerErrorMessage } from "./uiLocale.js";

const ROUTE_PATH = "/api/customer-document-analysis-refresh";

function mapServerError(payload, status) {
  if (payload?.error_message) return payload.error_message;
  if (payload?.reason === "UNAUTHORIZED") return "로그인이 필요합니다.";
  if (payload?.reason === "work_order_required") return "KEY Work Order 없이 공장을 실행할 수 없습니다.";
  if (payload?.reason === "panel_results_incomplete") return "일부 분석 결과가 아직 준비되지 않았습니다.";
  if (status === 404) return "분석 갱신 API 경로를 찾을 수 없습니다.";
  return "문서 기반 분석 갱신을 처리하지 못했습니다.";
}

export async function triggerDocumentAnalysisRefresh(documentId, { workOrderId = null } = {}) {
  const trimmedId = String(documentId ?? "").trim();

  const body = trimmedId ? { document_id: trimmedId } : {};
  if (workOrderId) {
    body.work_order_id = workOrderId;
  }

  const { response, payload } = await fetchCustomerApi(ROUTE_PATH, {
    body,
  });

  try {
    assertCustomerApiOk({ response, payload }, mapServerError(payload, response.status));
  } catch (error) {
    if (response.status === 422 && payload?.analysis_job) {
      return {
        ok: false,
        analysisJob: payload.analysis_job,
        analysisJobId: payload.analysis_job_id ?? payload.analysis_job?.id ?? null,
        memorySync: payload.memory_sync ?? null,
        panelStages: payload.panel_stages ?? null,
        errorMessage: mapServerError(payload, response.status),
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
    analysisJob: payload.analysis_job ?? null,
    analysisJobId: payload.analysis_job_id ?? payload.analysis_job?.id ?? null,
    memorySync: payload.memory_sync ?? null,
    panelStages: payload.panel_stages ?? null,
    errorMessage: null,
  };
}
