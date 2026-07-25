/**
 * Admin agent-assignment UI Hand — options + create/activate/close client.
 * Calls existing POST /api/admin-agent-assignment; no Core changes.
 */

export const ADMIN_ASSIGNMENT_PATH = "/api/admin-agent-assignment";
export const ADMIN_ASSIGNMENT_OPTIONS_PATH = "/api/admin-agent-assignment-options";
export const ADMIN_ASSIGNMENTS_LIVE_PATH = "/api/admin-agent-assignments";
export const ADMIN_KEY_ASSIGNMENT_CHAT_PATH = "/api/admin-key-assignment-chat";

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
 * Resolve one options row by exact id. Email+id must both exist on that same row.
 * Notes / Claude prose are never used here.
 * @param {Array<{ id?: string, email?: string|null, display_name?: string|null }>} list
 * @param {unknown} id
 */
export function resolveAdminAssignmentOptionRow(list, id) {
  const want = String(id ?? "").trim();
  if (!want) return null;
  const matches = (Array.isArray(list) ? list : []).filter(
    (row) => String(row?.id ?? "").trim() === want,
  );
  if (matches.length !== 1) return null;
  const row = matches[0];
  const email = String(row?.email ?? "").trim();
  if (!email) return null;
  if (String(row.id).trim() !== want) return null;
  return row;
}

/**
 * @param {unknown} email
 */
export function assignmentEmailLocalPart(email) {
  const e = String(email ?? "").trim().toLowerCase();
  const at = e.indexOf("@");
  if (at < 1) return "";
  return e.slice(0, at);
}

/**
 * Exact local-part token in utterance — not includes/startsWith/endsWith.
 * Boundaries: email-local charset [a-z0-9._%+-] must not continue on either side.
 * @param {unknown} utterance
 * @param {unknown} localPart
 */
export function utteranceHasExactLocalPartToken(utterance, localPart) {
  const local = String(localPart ?? "").trim().toLowerCase();
  if (!local) return false;
  const hay = String(utterance ?? "").toLowerCase();
  if (!hay) return false;
  const escaped = local.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`(^|[^a-z0-9._%+-])${escaped}(?![a-z0-9._%+-])`, "i");
  return re.test(hay);
}

/**
 * Unique full-email hit in utterance against options rows (same-row identity only).
 * @param {Array<{ id?: string, email?: string|null }>} list
 * @param {unknown} utterance
 */
export function findUniqueExactEmailOptionMatch(list, utterance) {
  const hay = String(utterance ?? "").trim().toLowerCase();
  if (!hay) return null;
  const hits = [];
  for (const row of Array.isArray(list) ? list : []) {
    const email = String(row?.email ?? "").trim().toLowerCase();
    const rowId = String(row?.id ?? "").trim();
    if (!email || !rowId) continue;
    if (hay.includes(email)) hits.push(row);
  }
  return hits.length === 1 ? hits[0] : null;
}

/**
 * Unique exact local-part token hit against options rows.
 * @param {Array<{ id?: string, email?: string|null }>} list
 * @param {unknown} utterance
 * @returns {{ ok: true, person: object|null, reason: null } | { ok: false, person: null, reason: 'AMBIGUOUS_LOCAL' }}
 */
export function findUniqueExactLocalPartOptionMatch(list, utterance) {
  const hits = [];
  const seen = new Set();
  for (const row of Array.isArray(list) ? list : []) {
    const rowId = String(row?.id ?? "").trim();
    const email = String(row?.email ?? "").trim();
    const local = assignmentEmailLocalPart(email);
    if (!rowId || !local) continue;
    if (!utteranceHasExactLocalPartToken(utterance, local)) continue;
    if (seen.has(rowId)) continue;
    seen.add(rowId);
    hits.push(row);
  }
  if (hits.length === 1) return { ok: true, person: hits[0], reason: null };
  if (hits.length > 1) return { ok: false, person: null, reason: "AMBIGUOUS_LOCAL" };
  return { ok: true, person: null, reason: null };
}

/**
 * Utterance identity against options: full email exact, else unique exact local-part.
 * @param {Array<{ id?: string, email?: string|null }>} list
 * @param {unknown} utterance
 * @returns {{
 *   ok: true,
 *   person: object|null,
 *   via: 'email'|'local'|null,
 *   reason: null,
 * } | {
 *   ok: false,
 *   person: null,
 *   via: null,
 *   reason: 'AMBIGUOUS_LOCAL',
 * }}
 */
export function findUniqueUtteranceOptionIdentity(list, utterance) {
  const byEmail = findUniqueExactEmailOptionMatch(list, utterance);
  if (byEmail) {
    return { ok: true, person: byEmail, via: "email", reason: null };
  }
  const byLocal = findUniqueExactLocalPartOptionMatch(list, utterance);
  if (!byLocal.ok) {
    return { ok: false, person: null, via: null, reason: byLocal.reason };
  }
  if (byLocal.person) {
    return { ok: true, person: byLocal.person, via: "local", reason: null };
  }
  return { ok: true, person: null, via: null, reason: null };
}

/**
 * Confirm-card customer/agent must be the same options rows as POST body ids.
 * Label must be recomputed from those rows (never notes / KEY prose).
 * @param {Record<string, unknown>|null|undefined} card
 * @param {object[]} customers
 * @param {object[]} agents
 */
export function assertAdminAssignmentConfirmCardAligned(card, customers, agents) {
  if (!card || typeof card !== "object") {
    return { ok: false, reason: "NO_CARD" };
  }
  const action = String(card.action ?? "").trim();
  if (!["create_pending", "activate", "close"].includes(action)) {
    return { ok: false, reason: "INVALID_ACTION" };
  }
  const customer = resolveAdminAssignmentOptionRow(customers, card.customer_id);
  const agent = resolveAdminAssignmentOptionRow(agents, card.agent_user_id);
  if (!customer || !agent) {
    return { ok: false, reason: "IDENTITY_MISMATCH" };
  }
  const customerLabel = formatAssignmentOptionLabel(customer);
  const agentLabel = formatAssignmentOptionLabel(agent);
  if (String(card.customer_label ?? "") !== customerLabel) {
    return { ok: false, reason: "CUSTOMER_LABEL_MISMATCH" };
  }
  if (String(card.agent_label ?? "") !== agentLabel) {
    return { ok: false, reason: "AGENT_LABEL_MISMATCH" };
  }
  if (!customerLabel.includes(String(customer.email).trim())) {
    return { ok: false, reason: "CUSTOMER_EMAIL_MISMATCH" };
  }
  if (!agentLabel.includes(String(agent.email).trim())) {
    return { ok: false, reason: "AGENT_EMAIL_MISMATCH" };
  }
  if (String(card.customer_id).trim() !== String(customer.id).trim()) {
    return { ok: false, reason: "CUSTOMER_ID_MISMATCH" };
  }
  if (String(card.agent_user_id).trim() !== String(agent.id).trim()) {
    return { ok: false, reason: "AGENT_ID_MISMATCH" };
  }
  return { ok: true, reason: null, action, customer, agent };
}

/**
 * Build POST body only from options-aligned confirm card. Mismatch → null (POST 0).
 * @param {Record<string, unknown>|null|undefined} card
 * @param {object[]} customers
 * @param {object[]} agents
 */
export function buildAlignedAssignmentBody(card, customers, agents) {
  const aligned = assertAdminAssignmentConfirmCardAligned(card, customers, agents);
  if (!aligned.ok) return null;
  if (aligned.action === "create_pending") {
    return buildCreatePendingBody({
      customerId: aligned.customer.id,
      agentUserId: aligned.agent.id,
      notes: String(card?.notes ?? ""),
    });
  }
  const assignmentId = String(card?.assignment_id ?? "").trim();
  if (!assignmentId) return null;
  if (aligned.action === "activate") {
    return buildActivateBody({ assignmentId });
  }
  if (aligned.action === "close") {
    return buildCloseBody({ assignmentId });
  }
  return null;
}

/**
 * Panel create_pending: ids must resolve to the same options rows (email+id).
 * @param {{
 *   customerId?: string,
 *   agentUserId?: string,
 *   notes?: string,
 *   customers?: object[],
 *   agents?: object[],
 * }} args
 */
export function buildAlignedCreatePendingFromOptionIds({
  customerId = "",
  agentUserId = "",
  notes = "",
  customers = [],
  agents = [],
} = {}) {
  const customer = resolveAdminAssignmentOptionRow(customers, customerId);
  const agent = resolveAdminAssignmentOptionRow(agents, agentUserId);
  if (!customer || !agent) return null;
  return buildCreatePendingBody({
    customerId: customer.id,
    agentUserId: agent.id,
    notes,
  });
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
 * Close button / confirm label — pending cancel vs active end.
 * @param {unknown} status
 */
export function assignmentCloseActionLabel(status) {
  return String(status ?? "").trim() === "pending" ? "배정 취소" : "배정 종료";
}

/**
 * @param {{
 *   action: "create_pending" | "activate" | "close",
 *   binding_created?: boolean | null,
 *   binding_skipped_no_consent?: boolean | null,
 *   source_status?: string | null,
 * }} args
 */
export function mapAssignmentSuccessLines({
  action,
  binding_created = null,
  binding_skipped_no_consent = null,
  source_status = null,
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
    if (String(source_status ?? "").trim() === "pending") {
      return ["배정 대기를 취소했습니다."];
    }
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

/**
 * Live pending/active assignments for rehydrate after refresh/new chat.
 */
export async function loadAdminLiveAssignments() {
  const headers = await authHeaders();
  const res = await fetch(ADMIN_ASSIGNMENTS_LIVE_PATH, {
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
      assignments: [],
    };
  }
  return {
    ok: true,
    assignments: Array.isArray(json.assignments) ? json.assignments : [],
  };
}

/**
 * KEY Hand turn — proposal card only; does not mutate assignments.
 * @param {{ question: string, history?: Array<{ role?: string, content?: string }> }} args
 */
export async function postAdminKeyAssignmentChat({ question, history = [] }) {
  const headers = await authHeaders();
  const res = await fetch(ADMIN_KEY_ASSIGNMENT_CHAT_PATH, {
    method: "POST",
    headers,
    body: JSON.stringify({
      question: String(question ?? "").trim(),
      history: Array.isArray(history) ? history : [],
    }),
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
      text: json?.text ?? mapAdminAssignmentErrorMessage(json?.reason),
      card: null,
      assignments: [],
    };
  }
  return {
    ok: true,
    reason: null,
    error_message: null,
    text: String(json.text ?? "").trim(),
    card: json.card ?? null,
    assignments: Array.isArray(json.assignments) ? json.assignments : [],
  };
}

/**
 * Pick one live row for panel rehydrate (pending preferred, else active).
 * Ambiguous multi-row without filter → null (do not auto-pick).
 * @param {object[]} assignments
 * @param {{ customerId?: string }} [args]
 */
export function pickRehydratableLiveAssignment(assignments, { customerId = "" } = {}) {
  let list = Array.isArray(assignments) ? assignments : [];
  if (customerId) {
    list = list.filter((row) => row?.customer?.id === customerId);
  }
  if (list.length === 0) return null;
  if (list.length > 1 && !customerId) return null;
  const pending = list.filter((row) => row.status === "pending");
  if (pending.length === 1) return pending[0];
  if (pending.length > 1) return null;
  const active = list.filter((row) => row.status === "active");
  if (active.length === 1) return active[0];
  return null;
}
