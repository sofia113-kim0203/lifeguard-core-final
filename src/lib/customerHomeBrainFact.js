import {
  assertCustomerApiOk,
  fetchCustomerApi,
  getCustomerAccessToken,
  rethrowCustomerApiError,
} from "./customerApiAuth.js";
import { parseHomeBrainFactSseBlock } from "./homeBrainFactSse.js";
import { buildHomeBrainFactRequestBody } from "./homeBrainFactRequestBody.js";
import { buildPersistableTurnTraceSummary } from "./lifeguardChatSessionCore.js";
import { toCustomerErrorMessage } from "./uiLocale.js";

const ROUTE_PATH = "/api/customer-home-brain-fact";

export { buildHomeBrainFactRequestBody } from "./homeBrainFactRequestBody.js";

function resolveVisualBlocksFromPayload(payload = {}) {
  if (Array.isArray(payload.visual_blocks) && payload.visual_blocks.length > 0) {
    return payload.visual_blocks;
  }
  if (Array.isArray(payload.visualBlocks) && payload.visualBlocks.length > 0) {
    return payload.visualBlocks;
  }

  const speakStep = payload.one_key_core_trace?.steps?.find((row) => row.step === "speak");
  const speakPayload = speakStep?.payload ?? {};
  if (Array.isArray(speakPayload.visual_blocks) && speakPayload.visual_blocks.length > 0) {
    return speakPayload.visual_blocks;
  }

  const composeTrace = speakPayload.key_compose_trace ?? {};
  if (Array.isArray(composeTrace.visual_blocks) && composeTrace.visual_blocks.length > 0) {
    return composeTrace.visual_blocks;
  }

  const voiceTrace = composeTrace.key_voice_trace ?? {};
  if (Array.isArray(voiceTrace.visual_blocks) && voiceTrace.visual_blocks.length > 0) {
    return voiceTrace.visual_blocks;
  }

  return [];
}

function resolveVisualBlocksGateFromPayload(payload = {}, visualBlocks = []) {
  const gateRaw =
    payload.visual_blocks_gate ??
    payload.visualBlocksGate ??
    payload.one_key_core_trace?.steps?.find((row) => row.step === "speak")?.payload
      ?.key_compose_trace?.key_voice_trace?.visual_blocks_gate ??
    null;

  if (!gateRaw || typeof gateRaw !== "object") return null;

  return {
    ...gateRaw,
    rendered_count:
      typeof gateRaw.rendered_count === "number" ? gateRaw.rendered_count : visualBlocks.length,
  };
}

function applyHomeBrainFactSseEvent(parsed, handlers, assignFinal) {
  if (!parsed) return;

  if (parsed.event === "ack") handlers.onAck?.(parsed.data?.text ?? "");
  if (parsed.event === "delta") handlers.onDelta?.(parsed.data?.text ?? "");
  if (parsed.event === "ttft") handlers.onTTFT?.(parsed.data?.ttft_ms ?? null);
  if (parsed.event === "replace") handlers.onReplace?.(parsed.data?.text ?? "");
  if (parsed.event === "error") {
    const error = new Error(parsed.data?.error_message ?? parsed.data?.reason ?? "Streaming failed.");
    error.reason = parsed.data?.reason ?? null;
    throw error;
  }
  if (parsed.event === "done") {
    assignFinal(parsed.data);
    handlers.onDone?.(parsed.data);
  }
}

function drainHomeBrainFactSseBuffer(buffer, handlers, assignFinal) {
  let nextBuffer = buffer;
  let splitAt = nextBuffer.indexOf("\n\n");
  while (splitAt >= 0) {
    const block = nextBuffer.slice(0, splitAt);
    nextBuffer = nextBuffer.slice(splitAt + 2);
    splitAt = nextBuffer.indexOf("\n\n");
    applyHomeBrainFactSseEvent(parseHomeBrainFactSseBlock(block), handlers, assignFinal);
  }
  return nextBuffer;
}

/** Flush-safe SSE consumer — preserves final `done` chunk when stream closes mid-block. */
async function consumeHomeBrainFactSseForClient(response, handlers = {}) {
  if (!response.body) {
    throw new Error("Streaming response body unavailable.");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let finalPayload = null;
  const assignFinal = (data) => {
    finalPayload = data;
  };

  while (true) {
    const { done, value } = await reader.read();
    if (value) {
      buffer += decoder.decode(value, { stream: !done });
      buffer = drainHomeBrainFactSseBuffer(buffer, handlers, assignFinal);
    }
    if (done) break;
  }

  buffer += decoder.decode();
  if (buffer.trim()) {
    drainHomeBrainFactSseBuffer(`${buffer}\n\n`, handlers, assignFinal);
  }

  return finalPayload;
}

export function mapHomeBrainFactPayload(payload) {
  const visualBlocks = resolveVisualBlocksFromPayload(payload);
  const turnTrace = buildPersistableTurnTraceSummary(payload);
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
    responseLatencyMs: turnTrace.response_latency_ms ?? payload.response_latency_ms ?? null,
    ttftMs: payload.sales_director_trace?.latency?.ttft_ms ?? null,
    composeMode: turnTrace.compose_mode,
    oneKeyCoreTraceSummary: turnTrace.one_key_core_trace_summary,
    visualBlocks,
    visualBlocksGate: resolveVisualBlocksGateFromPayload(payload, visualBlocks),
    keyMonopolyFailure: payload.key_monopoly_failure === true,
    failureReason: payload.failure_reason ?? null,
  };
}

function mapServerError(payload, status) {
  if (payload?.error_message) return payload.error_message;
  if (payload?.reason === "UNAUTHORIZED") return "로그인이 필요합니다.";
  if (status === 404) return "Home Brain API 경로를 찾을 수 없습니다.";
  return "질문에 답변하지 못했습니다.";
}

export async function fetchHomeBrainFactStream(question, history = [], handlers = {}, options = {}) {
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
      ...buildHomeBrainFactRequestBody(trimmed, history, options),
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

  const payload = await consumeHomeBrainFactSseForClient(response, handlers);
  if (!payload?.ok) {
    throw new Error(mapServerError(payload, response.status));
  }

  return mapHomeBrainFactPayload(payload);
}

export async function fetchHomeBrainFact(question, history = [], options = {}) {
  const trimmed = String(question ?? "").trim();
  if (!trimmed) throw new Error("질문을 입력해 주세요.");

  const { response, payload } = await fetchCustomerApi(ROUTE_PATH, {
    body: buildHomeBrainFactRequestBody(trimmed, history, options),
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
