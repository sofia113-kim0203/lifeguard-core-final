/**
 * AgentDesk client for POST /api/agent-key-chat (free KEY v1).
 * Streaming uses the same SSE contract helpers as customer home-brain.
 */

import { consumeHomeBrainFactSse } from "./homeBrainFactSse.js";

export const AGENT_KEY_CHAT_PATH = "/api/agent-key-chat";

export const AGENT_FREE_KEY_GENERIC_ERROR =
  "KEY 요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.";

export const AGENT_FREE_KEY_ERROR_MESSAGES = {
  FORBIDDEN_ROLE: "설계사 계정만 이용할 수 있습니다.",
  INVALID_QUESTION: "질문을 확인해 주세요.",
  CLIENT_IDENTITY_FORBIDDEN: "요청 형식이 올바르지 않습니다.",
};

/**
 * @param {unknown} reason
 */
export function mapAgentFreeKeyErrorMessage(reason) {
  const key = String(reason ?? "").trim();
  if (key && Object.prototype.hasOwnProperty.call(AGENT_FREE_KEY_ERROR_MESSAGES, key)) {
    return AGENT_FREE_KEY_ERROR_MESSAGES[key];
  }
  return AGENT_FREE_KEY_GENERIC_ERROR;
}

/**
 * @param {{
 *   question?: string,
 *   submitting?: boolean,
 * }} args
 */
export function canSubmitAgentFreeKey({ question = "", submitting = false } = {}) {
  if (submitting) return false;
  return Boolean(String(question ?? "").trim());
}

/**
 * @param {{
 *   question: string,
 *   history?: Array<{ role?: string, content?: string }>,
 *   assignmentId?: string | null,
 *   stream?: boolean,
 * }} args
 */
export function buildAgentFreeKeyPostBody({
  question,
  history = [],
  assignmentId = null,
  stream = false,
}) {
  const body = {
    question: String(question ?? "").trim(),
    history: Array.isArray(history)
      ? history.map((t) => ({
          role: t?.role === "assistant" ? "assistant" : "user",
          content: String(t?.content ?? "").trim(),
        })).filter((t) => t.content)
      : [],
  };
  const asg = String(assignmentId ?? "").trim();
  if (asg) body.assignment_id = asg;
  if (stream) body.stream = true;
  return body;
}

/**
 * @param {{
 *   question: string,
 *   history?: Array<{ role?: string, content?: string }>,
 *   assignmentId?: string | null,
 * }} args
 */
export async function postAgentFreeKeyChat({
  question,
  history = [],
  assignmentId = null,
} = {}) {
  const { getCustomerAccessToken } = await import("./customerApiAuth.js");
  const token = await getCustomerAccessToken();
  if (!token) {
    return {
      ok: false,
      reason: "UNAUTHORIZED",
      error_message: "로그인이 필요합니다.",
      text: null,
    };
  }
  const res = await fetch(AGENT_KEY_CHAT_PATH, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(
      buildAgentFreeKeyPostBody({ question, history, assignmentId }),
    ),
  });
  let json = null;
  try {
    json = await res.json();
  } catch {
    json = null;
  }
  if (!res.ok || json?.ok !== true) {
    const reason = json?.reason ?? `HTTP_${res.status}`;
    return {
      ok: false,
      reason,
      error_message: mapAgentFreeKeyErrorMessage(reason),
      text: null,
    };
  }
  return {
    ok: true,
    text: String(json.text ?? "").trim(),
    mode: json.mode ?? null,
    customer_context_used: json.customer_context_used === true,
    access_reason: json.access_reason ?? null,
  };
}

/**
 * SSE path — first delta before done. Reuses customer SSE parser.
 * @param {{
 *   question: string,
 *   history?: Array<{ role?: string, content?: string }>,
 *   assignmentId?: string | null,
 *   onAck?: (text: string) => void,
 *   onDelta?: (text: string) => void,
 *   onTTFT?: (ms: number | null) => void,
 * }} args
 */
export async function postAgentFreeKeyChatStream({
  question,
  history = [],
  assignmentId = null,
  onAck = null,
  onDelta = null,
  onTTFT = null,
} = {}) {
  const { getCustomerAccessToken } = await import("./customerApiAuth.js");
  const token = await getCustomerAccessToken();
  if (!token) {
    return {
      ok: false,
      reason: "UNAUTHORIZED",
      error_message: "로그인이 필요합니다.",
      text: null,
    };
  }

  const res = await fetch(AGENT_KEY_CHAT_PATH, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "text/event-stream",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(
      buildAgentFreeKeyPostBody({
        question,
        history,
        assignmentId,
        stream: true,
      }),
    ),
  });

  const contentType = String(res.headers.get("content-type") ?? "").toLowerCase();
  if (!res.ok && contentType.includes("application/json")) {
    let json = null;
    try {
      json = await res.json();
    } catch {
      json = null;
    }
    const reason = json?.reason ?? `HTTP_${res.status}`;
    return {
      ok: false,
      reason,
      error_message: mapAgentFreeKeyErrorMessage(reason),
      text: null,
    };
  }

  if (!res.ok) {
    return {
      ok: false,
      reason: `HTTP_${res.status}`,
      error_message: AGENT_FREE_KEY_GENERIC_ERROR,
      text: null,
    };
  }

  try {
    const done = await consumeHomeBrainFactSse(res, {
      onAck: typeof onAck === "function" ? onAck : undefined,
      onDelta: typeof onDelta === "function" ? onDelta : undefined,
      onTTFT: typeof onTTFT === "function" ? onTTFT : undefined,
    });
    if (!done || done.ok === false) {
      const reason = done?.reason ?? "KEY_TURN_FAILED";
      return {
        ok: false,
        reason,
        error_message: mapAgentFreeKeyErrorMessage(reason),
        text: null,
      };
    }
    const text = String(done.text ?? done.answerText ?? "").trim();
    if (!text) {
      return {
        ok: false,
        reason: "KEY_TURN_FAILED",
        error_message: AGENT_FREE_KEY_GENERIC_ERROR,
        text: null,
      };
    }
    return {
      ok: true,
      text,
      mode: done.mode ?? null,
      customer_context_used: done.customer_context_used === true,
      access_reason: done.access_reason ?? null,
    };
  } catch (error) {
    const reason = error?.reason ?? "KEY_TURN_FAILED";
    return {
      ok: false,
      reason,
      error_message: mapAgentFreeKeyErrorMessage(reason),
      text: null,
    };
  }
}
