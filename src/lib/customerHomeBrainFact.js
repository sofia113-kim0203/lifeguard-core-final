import {
  assertCustomerApiOk,
  fetchCustomerApi,
  getCustomerAccessToken,
  rethrowCustomerApiError,
} from "./customerApiAuth.js";
import { consumeHomeBrainFactSse } from "./homeBrainFactSse.js";
import { toCustomerErrorMessage } from "./uiLocale.js";

const ROUTE_PATH = "/api/customer-home-brain-fact";

export function mapHomeBrainFactPayload(payload) {
  return {
    answerText: payload.answerText ?? "",
    intent: payload.intent ?? null,
    homeRoute: payload.tom_internal_route ?? payload.home_route ?? null,
    toolUsed: payload.tool_used ?? null,
    factsUsed: payload.factsUsed ?? null,
    responseSource: payload.response_source ?? null,
    selectedRoute: payload.selected_route ?? null,
    loadedContext: payload.loaded_context ?? null,
    factoryCalled: payload.factory_called ?? [],
    guardResult: payload.guard_result ?? null,
    contextSnapshotId: payload.context_snapshot_id ?? null,
    reconciliationWarning: payload.reconciliation_warning ?? null,
    salesDirectorLoop: payload.sales_director_loop === true,
    salesDirectorMode: payload.sales_director_mode ?? null,
    loadedContextContradictions: payload.loaded_context_contradictions ?? null,
    salesDirectorTrace: payload.sales_director_trace ?? null,
    salesDirectorFactoryAudit: payload.sales_director_factory_audit ?? null,
    answerEvidence: payload.answer_evidence ?? [],
    factoryHypothesis: payload.factory_hypothesis ?? null,
    factoryPrimaryDisconnect: payload.factory_primary_disconnect ?? null,
    salesDirectorJudgmentAudit: payload.sales_director_judgment_audit ?? null,
    responseLatencyMs: payload.response_latency_ms ?? null,
    ttftMs: payload.sales_director_trace?.latency?.ttft_ms ?? null,
    visualBlocks: payload.visual_blocks ?? [],
    visualBlocksGate: payload.visual_blocks_gate ?? null,
  };
}

function mapServerError(payload, status) {
  if (payload?.error_message) return payload.error_message;
  if (payload?.reason === "UNAUTHORIZED") return "로그인이 필요합니다.";
  if (status === 404) return "Home Brain API 경로를 찾을 수 없습니다.";
  return "질문에 답변하지 못했습니다.";
}

export async function fetchHomeBrainFactStream(question, history = [], handlers = {}) {
  const trimmed = String(question ?? "").trim();
  if (!trimmed) throw new Error("질문을 입력해 주세요.");

  const accessToken = await getCustomerAccessToken();
  const response = await fetch(ROUTE_PATH, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "text/event-stream",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      question: trimmed,
      history: Array.isArray(history) ? history : [],
      stream: true,
    }),
  });

  if (!response.ok && response.headers.get("content-type")?.includes("application/json")) {
    const payload = await response.json().catch(() => ({}));
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
  }

  if (!response.ok) {
    throw new Error(mapServerError(null, response.status));
  }

  const payload = await consumeHomeBrainFactSse(response, handlers);
  if (!payload?.ok) {
    throw new Error(mapServerError(payload, response.status));
  }

  return mapHomeBrainFactPayload(payload);
}

export async function fetchHomeBrainFact(question, history = []) {
  const trimmed = String(question ?? "").trim();
  if (!trimmed) throw new Error("질문을 입력해 주세요.");

  const { response, payload } = await fetchCustomerApi(ROUTE_PATH, {
    body: {
      question: trimmed,
      history: Array.isArray(history) ? history : [],
    },
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

  return mapHomeBrainFactPayload(payload);
}
