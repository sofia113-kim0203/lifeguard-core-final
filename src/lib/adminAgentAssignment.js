/**
 * Admin agent-assignment UI Hand — options + create/activate/close client.
 * Calls existing POST /api/admin-agent-assignment; no Core changes.
 */

export const ADMIN_ASSIGNMENT_PATH = "/api/admin-agent-assignment";
export const ADMIN_ASSIGNMENT_OPTIONS_PATH = "/api/admin-agent-assignment-options";

export const ADMIN_ASSIGNMENT_ERROR_MESSAGES = {
  UNAUTHORIZED: "관리자 로그인이 필요합니다.",
  FORBIDDEN_ROLE: "관리자 계정만 이용할 수 있습니다.",
  INVALID_ID: "선택한 고객 또는 설계사를 확인해 주세요.",
  CUSTOMER_NOT_FOUND: "고객을 찾을 수 없습니다.",
  AGENT_NOT_FOUND: "설계사를 찾을 수 없습니다.",
  DUPLICATE_ACTIVE: "이 고객에게 이미 활성 배정이 있습니다.",
  INVALID_TRANSITION: "지금 상태에서는 그 작업을 할 수 없습니다.",
  ASSIGNMENT_NOT_FOUND: "배정 정보를 찾을 수 없습니다.",
  UNEXPECTED_FIELD: "요청 형식이 올바르지 않습니다.",
  METHOD_NOT_ALLOWED: "허용되지 않은 요청입니다.",
};

export const ADMIN_ASSIGNMENT_GENERIC_ERROR =
  "배정 요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.";

/**
 * @param {unknown} reason
 */
export function mapAdminAssignmentErrorMessage(reason) {
  const key = String(reason ?? "").trim();
  if (key && Object.prototype.hasOwnProperty.call(ADMIN_ASSIGNMENT_ERROR_MESSAGES, key)) {
    return ADMIN_ASSIGNMENT_ERROR_MESSAGES[key];
  }
  return ADMIN_ASSIGNMENT_GENERIC_ERROR;
}

/**
 * Visible select label — never include id/UUID.
 * @param {{ display_name?: string | null, email?: string | null }} person
 */
export function formatAssignmentOptionLabel(person) {
  const name = String(person?.display_name ?? "").trim() || "이름 없음";
  const email = String(person?.email ?? "").trim();
  return email ? `${name} · ${email}` : name;
}

/**
 * @param {unknown} status
 */
export function assignmentStatusLabelKo(status) {
  const s = String(status ?? "").trim();
  if (s === "pending") return "배정 대기";
  if (s === "active") return "활성 배정";
  if (s === "closed") return "배정 종료";
  return "상태 확인 필요";
}

/**
 * @param {{ customerId?: string, agentUserId?: string, busy?: boolean }} args
 */
export function canCreatePendingAssignment({
  customerId = "",
  agentUserId = "",
  busy = false,
} = {}) {
  if (busy) return false;
  if (!String(customerId ?? "").trim()) return false;
  if (!String(agentUserId ?? "").trim()) return false;
  return true;
}

/**
 * @param {{ assignmentId?: string | null, status?: string | null, busy?: boolean }} args
 */
export function canActivateAssignment({
  assignmentId = null,
  status = null,
  busy = false,
} = {}) {
  if (busy) return false;
  if (!String(assignmentId ?? "").trim()) return false;
  return String(status ?? "").trim() === "pending";
}

/**
 * @param {{ assignmentId?: string | null, status?: string | null, busy?: boolean }} args
 */
export function canCloseAssignment({
  assignmentId = null,
  status = null,
  busy = false,
} = {}) {
  if (busy) return false;
  if (!String(assignmentId ?? "").trim()) return false;
  const s = String(status ?? "").trim();
  return s === "pending" || s === "active";
}

/**
 * @param {{ customerId: string, agentUserId: string, notes?: string }} args
 */
export function buildCreatePendingBody({ customerId, agentUserId, notes = "" }) {
  const body = {
    action: "create_pending",
    customer_id: String(customerId ?? "").trim(),
    agent_user_id: String(agentUserId ?? "").trim(),
  };
  const note = String(notes ?? "").trim();
  if (note) body.notes = note;
  return body;
}

/**
 * @param {{ assignmentId: string }} args
 */
export function buildActivateBody({ assignmentId }) {
  return {
    action: "activate",
    assignment_id: String(assignmentId ?? "").trim(),
  };
}

/**
 * @param {{ assignmentId: string }} args
 */
export function buildCloseBody({ assignmentId }) {
  return {
    action: "close",
    assignment_id: String(assignmentId ?? "").trim(),
  };
}

/**
 * @param {{
 *   action: "create_pending" | "activate" | "close",
 *   binding_created?: boolean | null,
 *   binding_skipped_no_consent?: boolean | null,
 * }} args
 */
export function mapAssignmentSuccessLines({
  action,
  binding_created = null,
  binding_skipped_no_consent = null,
}) {
  if (action === "create_pending") {
    return ["배정 대기로 등록했습니다."];
  }
  if (action === "activate") {
    const lines = ["활성 배정으로 전환했습니다."];
    if (binding_created === true && binding_skipped_no_consent !== true) {
      lines.push("설계사 상담 준비 권한이 연결되었습니다.");
    } else if (binding_skipped_no_consent === true) {
      lines.push("현재 정보 공유 권한이 없어 설계사 상담 준비는 제한됩니다.");
    }
    return lines;
  }
  if (action === "close") {
    return ["배정을 종료했습니다."];
  }
  return [];
}

/**
 * Detect accidental UUID leak in visible option labels.
 * @param {Array<{ id?: string, display_name?: string, email?: string }>} options
 */
export function optionLabelsHideIds(options) {
  const list = Array.isArray(options) ? options : [];
  for (const row of list) {
    const label = formatAssignmentOptionLabel(row);
    const id = String(row?.id ?? "").trim();
    if (id && label.includes(id)) return false;
  }
  return true;
}

async function authHeaders() {
  const { getCustomerAccessToken } = await import("./customerApiAuth.js");
  const accessToken = await getCustomerAccessToken();
  return {
    Accept: "application/json",
    "Content-Type": "application/json",
    Authorization: `Bearer ${accessToken}`,
  };
}

/**
 * @returns {Promise<{
 *   ok: true,
 *   customers: object[],
 *   agents: object[],
 * } | {
 *   ok: false,
 *   reason: string | null,
 *   error_message: string,
 *   customers: [],
 *   agents: [],
 * }>}
 */
export async function loadAdminAssignmentOptions() {
  const headers = await authHeaders();
  const res = await fetch(ADMIN_ASSIGNMENT_OPTIONS_PATH, {
    method: "GET",
    headers,
  });
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
      error_message: mapAdminAssignmentErrorMessage(json?.reason),
      customers: [],
      agents: [],
    };
  }
  return {
    ok: true,
    customers: Array.isArray(json.customers) ? json.customers : [],
    agents: Array.isArray(json.agents) ? json.agents : [],
  };
}

/**
 * @param {Record<string, unknown>} body
 */
export async function postAdminAssignmentAction(body) {
  const headers = await authHeaders();
  const res = await fetch(ADMIN_ASSIGNMENT_PATH, {
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
  if (!res.ok || json?.ok !== true) {
    return {
      ok: false,
      reason: json?.reason ?? null,
      error_message: mapAdminAssignmentErrorMessage(json?.reason),
      assignment: null,
      binding_created: null,
      binding_skipped_no_consent: null,
    };
  }
  return {
    ok: true,
    reason: null,
    error_message: null,
    assignment: json.assignment ?? null,
    binding_id: json.binding_id ?? null,
    binding_created: json.binding_created ?? null,
    binding_skipped_no_consent: json.binding_skipped_no_consent ?? null,
    binding_revoked_count: json.binding_revoked_count ?? null,
  };
}
