import { assertCustomerApiOk, fetchCustomerApi, rethrowCustomerApiError } from "./customerApiAuth.js";
import { toCustomerErrorMessage } from "./uiLocale.js";

const ROUTE_PATH = "/api/customer-analysis-all";

function mapServerError(payload, status) {
  if (payload?.error_message) return payload.error_message;
  if (payload?.reason === "UNAUTHORIZED") return "로그인이 필요합니다.";
  if (status === 404) return "분석 API 경로를 찾을 수 없습니다.";
  return "분석 결과를 불러오지 못했습니다.";
}

/**
 * One-shot fetch of all recommendation panels (coverage_gap, underwriting_risk,
 * recommendation, insurance_design) computed server-side in a single pass.
 * Returns the `analysis` object, or null if the response carried no analysis.
 */
export async function loadAllCustomerAnalysis() {
  const { response, payload } = await fetchCustomerApi(ROUTE_PATH, {
    body: {},
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

  return payload?.analysis ?? null;
}
