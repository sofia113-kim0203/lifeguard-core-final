/**
 * C2-C — AgentDesk client for GET/POST /api/agent-key-briefing.
 * Display helpers only; no KEY/Factory/conversation writes.
 */

export const AGENT_KEY_BRIEFING_PATH = "/api/agent-key-briefing";

export const AGENT_BRIEFING_ERROR_MESSAGES = {
  FORBIDDEN_ROLE: "설계사 계정만 이용할 수 있습니다.",
  NOT_ASSIGNED: "현재 설계사에게 배정된 고객이 아닙니다.",
  ASSIGNMENT_NOT_ACTIVE: "아직 활성화되지 않은 배정입니다.",
  CONSENT_BINDING_REQUIRED: "고객의 정보 공유 동의가 필요합니다.",
};

export const AGENT_BRIEFING_GENERIC_ERROR =
  "브리핑 요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.";

/**
 * @param {unknown} reason
 */
export function mapAgentBriefingErrorMessage(reason) {
  const key = String(reason ?? "").trim();
  if (key && Object.prototype.hasOwnProperty.call(AGENT_BRIEFING_ERROR_MESSAGES, key)) {
    return AGENT_BRIEFING_ERROR_MESSAGES[key];
  }
  return AGENT_BRIEFING_GENERIC_ERROR;
}

/**
 * @param {{ status?: string, briefing_eligible?: boolean } | null | undefined} item
 */
export function assignmentStatusLabel(item) {
  const status = String(item?.status ?? "").trim();
  if (status === "pending") return "배정 승인 대기";
  if (status === "active" && item?.briefing_eligible !== true) {
    return "고객 동의가 필요합니다";
  }
  if (status === "active" && item?.briefing_eligible === true) {
    return "KEY 브리핑 가능";
  }
  return "배정 상태 확인 필요";
}

/**
 * @param {Array<{ assignment_id?: string, briefing_eligible?: boolean }>} items
 */
export function pickInitialAssignment(items) {
  const list = Array.isArray(items) ? items : [];
  if (list.length === 0) return null;
  const eligible = list.find((row) => row?.briefing_eligible === true);
  return eligible ?? list[0] ?? null;
}

/**
 * @param {{
 *   selected?: { assignment_id?: string, briefing_eligible?: boolean } | null,
 *   purpose?: string,
 *   question?: string,
 *   submitting?: boolean,
 * }} args
 */
export function canSubmitAgentBriefing({
  selected = null,
  purpose = "",
  question = "",
  submitting = false,
} = {}) {
  if (submitting) return false;
  if (!selected?.assignment_id) return false;
  if (selected.briefing_eligible !== true) return false;
  if (!String(purpose ?? "").trim()) return false;
  if (!String(question ?? "").trim()) return false;
  return true;
}

/**
 * Exact POST body contract — three fields only.
 * @param {{ assignmentId: string, purpose: string, question: string }} args
 */
export function buildAgentBriefingPostBody({ assignmentId, purpose, question }) {
  return {
    assignment_id: String(assignmentId ?? "").trim(),
    purpose: String(purpose ?? "").trim(),
    question: String(question ?? "").trim(),
  };
}

/**
 * @param {unknown} createdAt
 */
export function formatBriefingCreatedAt(createdAt) {
  const raw = String(createdAt ?? "").trim();
  if (!raw) return "—";
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return "—";
  try {
    return new Intl.DateTimeFormat("ko-KR", {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(d);
  } catch {
    return "—";
  }
}

/**
 * Visible label only — never surface UUID.
 * @param {{ customer?: { display_name?: string | null } } | null | undefined} item
 */
export function customerDisplayLabel(item) {
  const name = String(item?.customer?.display_name ?? "").trim();
  return name || "이름 없는 고객";
}

async function authHeaders() {
  // Dynamic import keeps pure helpers usable in Node unit tests (no Vite env).
  const { getCustomerAccessToken } = await import("./customerApiAuth.js");
  const accessToken = await getCustomerAccessToken();
  return {
    Accept: "application/json",
    "Content-Type": "application/json",
    Authorization: `Bearer ${accessToken}`,
  };
}

/**
 * @returns {Promise<{ ok: true, items: object[] } | { ok: false, reason: string | null, error_message: string }>}
 */
export async function listAgentKeyBriefings() {
  const headers = await authHeaders();
  const res = await fetch(AGENT_KEY_BRIEFING_PATH, { method: "GET", headers });
  let json = null;
  try {
    json = await res.json();
  } catch {
    json = null;
  }
  if (!res.ok || json?.ok !== true) {
    return {
      ok: false,
      reason: json?.reason ?? null,
      error_message: mapAgentBriefingErrorMessage(json?.reason),
    };
  }
  return {
    ok: true,
    items: Array.isArray(json.items) ? json.items : [],
  };
}

/**
 * @param {{ assignmentId: string, purpose: string, question: string }} args
 */
export async function createAgentKeyBriefingRequest({ assignmentId, purpose, question }) {
  const body = buildAgentBriefingPostBody({ assignmentId, purpose, question });
  const keys = Object.keys(body);
  if (keys.length !== 3) {
    return {
      ok: false,
      reason: "INVALID_BODY",
      error_message: AGENT_BRIEFING_GENERIC_ERROR,
      briefing: null,
    };
  }
  const headers = await authHeaders();
  const res = await fetch(AGENT_KEY_BRIEFING_PATH, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  let json = null;
  try {
    json = await res.json();
  } catch {
    json = null;
  }
  if (!res.ok || json?.ok !== true || !json?.briefing) {
    return {
      ok: false,
      reason: json?.reason ?? null,
      error_message: mapAgentBriefingErrorMessage(json?.reason),
      briefing: null,
    };
  }
  return {
    ok: true,
    reason: null,
    error_message: null,
    briefing: json.briefing,
  };
}
