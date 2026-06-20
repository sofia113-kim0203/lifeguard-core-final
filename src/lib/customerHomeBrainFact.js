import {
  assertCustomerApiOk,
  fetchCustomerApi,
  rethrowCustomerApiError,
} from "./customerApiAuth.js";
import { toCustomerErrorMessage } from "./uiLocale.js";

const ROUTE_PATH = "/api/customer-home-brain-fact";

function mapServerError(payload, status) {
  if (payload?.error_message) return payload.error_message;
  if (payload?.reason === "UNAUTHORIZED") return "로그인이 필요합니다.";
  if (status === 404) return "Home Brain API 경로를 찾을 수 없습니다.";
  return "질문에 답변하지 못했습니다.";
}

export async function fetchHomeBrainFact(question) {
  const trimmed = String(question ?? "").trim();
  if (!trimmed) throw new Error("질문을 입력해 주세요.");

  const { response, payload } = await fetchCustomerApi(ROUTE_PATH, {
    body: { question: trimmed },
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
    answerText: payload.answerText ?? "",
    intent: payload.intent ?? null,
    factsUsed: payload.factsUsed ?? null,
  };
}
