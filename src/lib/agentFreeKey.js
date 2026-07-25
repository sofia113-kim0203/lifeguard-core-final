/**
 * AgentDesk client for POST /api/agent-key-chat (free KEY v1).
 */

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
 * }} args
 */
export function buildAgentFreeKeyPostBody({
  question,
  history = [],
  assignmentId = null,
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
