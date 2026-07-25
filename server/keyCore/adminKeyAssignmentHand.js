/**
 * Admin KEY assignment Hand — understand via Claude tool, never execute POST.
 * Deterministic code: candidate match validation, ambiguity, confirm card, body prep.
 * Identity: confirm-card labels + create_pending body ids from the same options rows only.
 */
import { loadAdminAgentAssignmentOptions } from "../agent/adminAgentAssignmentOptionsCore.js";
import { loadAdminLiveAgentAssignments } from "../agent/adminAgentAssignmentReadCore.js";
import {
  assertAdminAssignmentConfirmCardAligned,
  buildAlignedAssignmentBody,
  findUniqueExactEmailOptionMatch,
  formatAssignmentOptionLabel,
  resolveAdminAssignmentOptionRow,
} from "../../src/lib/adminAgentAssignment.js";

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const DEFAULT_MODEL = "claude-sonnet-4-6";

export const ADMIN_ASSIGNMENT_HAND_TOOL = Object.freeze({
  name: "propose_admin_assignment_hand",
  description:
    "Propose an admin agent-assignment Hand action for human confirmation. " +
    "Never claim the action already ran. Use only ids from the provided lists.",
  input_schema: {
    type: "object",
    properties: {
      action: {
        type: "string",
        enum: ["create_pending", "activate", "close", "clarify"],
      },
      customer_id: { type: "string", description: "customer_profiles.id when known" },
      agent_user_id: { type: "string", description: "users.id of role=agent when known" },
      assignment_id: {
        type: "string",
        description: "live pending/active assignment id when activating/closing",
      },
      notes: { type: "string" },
      clarify_question: {
        type: "string",
        description: "Question to ask admin when action is clarify or candidates are ambiguous",
      },
    },
    required: ["action"],
  },
});

/**
 * @param {string} text
 */
function normalizeHay(text) {
  return String(text ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

/**
 * Score person rows against utterance. Deterministic; not an intent router.
 * @param {Array<{ id: string, display_name?: string|null, email?: string|null }>} people
 * @param {string} utterance
 */
export function rankPeopleAgainstUtterance(people, utterance) {
  const hay = normalizeHay(utterance);
  if (!hay) return [];
  const scored = [];
  for (const person of people || []) {
    if (!person?.id) continue;
    const name = normalizeHay(person.display_name);
    const email = normalizeHay(person.email);
    const local = email.includes("@") ? email.split("@")[0] : email;
    let score = 0;
    if (email && hay.includes(email)) score += 100;
    if (local && local.length >= 3 && hay.includes(local)) score += 80;
    if (name && name.length >= 2 && hay.includes(name)) score += 70;
    if (score > 0) scored.push({ person, score });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored;
}

/**
 * @param {Array<{ person: object, score: number }>} ranked
 */
export function uniqueTopMatch(ranked) {
  if (!Array.isArray(ranked) || ranked.length === 0) return { ok: false, reason: "NONE" };
  const top = ranked[0];
  const tied = ranked.filter((r) => r.score === top.score);
  if (tied.length !== 1) return { ok: false, reason: "AMBIGUOUS", candidates: tied };
  return { ok: true, person: top.person };
}

/**
 * @param {Array<object>} assignments
 * @param {{ customerId?: string|null, assignmentId?: string|null, status?: string|null }} args
 */
export function pickLiveAssignment(assignments, { customerId = null, assignmentId = null, status = null } = {}) {
  const list = Array.isArray(assignments) ? assignments : [];
  if (assignmentId) {
    const hit = list.filter((a) => a.id === assignmentId);
    if (hit.length === 1) return { ok: true, assignment: hit[0] };
    if (hit.length > 1) return { ok: false, reason: "AMBIGUOUS" };
    return { ok: false, reason: "NOT_FOUND" };
  }
  let filtered = list;
  if (customerId) filtered = filtered.filter((a) => a.customer?.id === customerId);
  if (status) filtered = filtered.filter((a) => a.status === status);
  if (filtered.length === 1) return { ok: true, assignment: filtered[0] };
  if (filtered.length === 0) return { ok: false, reason: "NOT_FOUND" };
  return { ok: false, reason: "AMBIGUOUS", assignments: filtered };
}

/**
 * Validate Claude tool proposal against option/live lists. No POST.
 * Identity from options rows only — never notes or Claude prose.
 * @param {{
 *   proposal: Record<string, unknown>,
 *   customers: object[],
 *   agents: object[],
 *   assignments: object[],
 *   utterance?: string,
 * }} args
 */
export function validateAdminAssignmentProposal({
  proposal,
  customers,
  agents,
  assignments,
  utterance = "",
}) {
  const action = String(proposal?.action ?? "").trim();
  if (!["create_pending", "activate", "close", "clarify"].includes(action)) {
    return {
      ok: false,
      reason: "INVALID_ACTION",
      text: "요청을 이해하지 못했습니다. 배정·활성화·종료 중 무엇을 도와드릴까요?",
      card: null,
    };
  }

  if (action === "clarify") {
    const q = String(proposal?.clarify_question ?? "").trim();
    return {
      ok: true,
      reason: null,
      text: q || "고객과 설계사를 조금 더 구체적으로 말씀해 주세요.",
      card: null,
    };
  }

  if (action === "create_pending") {
    const customerId = String(proposal?.customer_id ?? "").trim();
    const agentUserId = String(proposal?.agent_user_id ?? "").trim();
    // notes must not identify targets — resolve by options id+email only
    const customer = resolveAdminAssignmentOptionRow(customers, customerId);
    const agent = resolveAdminAssignmentOptionRow(agents, agentUserId);
    if (!customer || !agent) {
      return {
        ok: true,
        reason: null,
        text: "고객과 설계사를 목록에서 특정하지 못했습니다. 이름이나 이메일을 다시 알려 주세요.",
        card: null,
      };
    }
    const utteranceCustomer = findUniqueExactEmailOptionMatch(customers, utterance);
    const utteranceAgent = findUniqueExactEmailOptionMatch(agents, utterance);
    if (utteranceCustomer && utteranceCustomer.id !== customer.id) {
      return {
        ok: true,
        reason: "CUSTOMER_IDENTITY_MISMATCH",
        text: "고객 식별이 목록과 일치하지 않습니다. 이메일로 다시 지정해 주세요.",
        card: null,
      };
    }
    if (utteranceAgent && utteranceAgent.id !== agent.id) {
      return {
        ok: true,
        reason: "AGENT_IDENTITY_MISMATCH",
        text: "설계사 식별이 목록과 일치하지 않습니다. 이메일로 다시 지정해 주세요.",
        card: null,
      };
    }
    const liveForCustomer = (assignments || []).filter(
      (a) => a.customer?.id === customer.id && (a.status === "pending" || a.status === "active"),
    );
    if (liveForCustomer.length > 0) {
      return {
        ok: true,
        reason: null,
        text: "이 고객에게 이미 진행 중인 배정이 있습니다. 활성화하거나 종료할까요?",
        card: null,
      };
    }
    const notes = String(proposal?.notes ?? "").trim();
    return {
      ok: true,
      reason: null,
      text: "아래 내용으로 배정 대기를 등록할까요?",
      card: {
        kind: "admin_assignment_confirm",
        action: "create_pending",
        customer_id: customer.id,
        agent_user_id: agent.id,
        assignment_id: null,
        notes: notes || null,
        customer_label: formatAssignmentOptionLabel(customer),
        agent_label: formatAssignmentOptionLabel(agent),
        status_label: "미배정",
        primary_label: "배정 대기로 등록",
        secondary_label: "취소",
      },
    };
  }

  // activate / close — require resolvable live assignment + options-aligned parties
  const assignmentId = String(proposal?.assignment_id ?? "").trim() || null;
  const customerId = String(proposal?.customer_id ?? "").trim() || null;
  const wantStatus = action === "activate" ? "pending" : null;
  const picked = pickLiveAssignment(assignments, {
    assignmentId,
    customerId,
    status: wantStatus,
  });
  if (!picked.ok) {
    if (action === "activate") {
      return {
        ok: true,
        reason: null,
        text:
          picked.reason === "AMBIGUOUS"
            ? "대기 배정이 여러 건입니다. 고객을 지정해 주세요."
            : "활성화할 대기 배정을 찾지 못했습니다. 먼저 배정 대기를 등록할까요?",
        card: null,
      };
    }
    return {
      ok: true,
      reason: null,
      text:
        picked.reason === "AMBIGUOUS"
          ? "종료할 배정이 여러 건입니다. 고객을 지정해 주세요."
          : "종료할 진행 중 배정을 찾지 못했습니다.",
      card: null,
    };
  }
  const assignment = picked.assignment;
  if (action === "activate" && assignment.status !== "pending") {
    return {
      ok: true,
      reason: null,
      text: "이미 활성 배정이거나 대기 상태가 아닙니다.",
      card: null,
    };
  }
  if (action === "close" && assignment.status !== "pending" && assignment.status !== "active") {
    return {
      ok: true,
      reason: null,
      text: "종료할 수 있는 배정 상태가 아닙니다.",
      card: null,
    };
  }

  const customer = resolveAdminAssignmentOptionRow(customers, assignment.customer?.id);
  const agent = resolveAdminAssignmentOptionRow(agents, assignment.agent?.id);
  if (!customer || !agent) {
    return {
      ok: true,
      reason: "IDENTITY_MISMATCH",
      text: "배정 대상이 목록과 일치하지 않습니다. 고객·설계사를 다시 확인해 주세요.",
      card: null,
    };
  }

  const closeLabel =
    assignment.status === "pending" ? "배정 취소" : "배정 종료";
  return {
    ok: true,
    reason: null,
    text:
      action === "activate"
        ? "아래 배정을 활성 배정으로 전환할까요?"
        : assignment.status === "pending"
          ? "아래 배정 대기를 취소할까요?"
          : "아래 배정을 종료할까요?",
    card: {
      kind: "admin_assignment_confirm",
      action,
      customer_id: customer.id,
      agent_user_id: agent.id,
      assignment_id: assignment.id,
      notes: null,
      customer_label: formatAssignmentOptionLabel(customer),
      agent_label: formatAssignmentOptionLabel(agent),
      status_label: assignment.status === "pending" ? "배정 대기" : "활성 배정",
      source_status: assignment.status,
      primary_label: action === "activate" ? "활성화" : closeLabel,
      secondary_label: "취소",
    },
  };
}

/**
 * Build POST body only after human confirm + options identity lock.
 * Mismatch → null (caller must POST 0 times).
 * @param {Record<string, unknown>|null|undefined} card
 * @param {{ customers: object[], agents: object[] }} catalogs
 */
export function buildConfirmedAssignmentBody(card, catalogs) {
  if (!catalogs || !Array.isArray(catalogs.customers) || !Array.isArray(catalogs.agents)) {
    return null;
  }
  return buildAlignedAssignmentBody(card, catalogs.customers, catalogs.agents);
}

function extractToolInput(content) {
  const blocks = Array.isArray(content) ? content : [];
  for (const block of blocks) {
    if (block?.type === "tool_use" && block.name === ADMIN_ASSIGNMENT_HAND_TOOL.name) {
      return block.input && typeof block.input === "object" ? block.input : null;
    }
  }
  return null;
}

function extractText(content) {
  const blocks = Array.isArray(content) ? content : [];
  const parts = [];
  for (const block of blocks) {
    if (block?.type === "text" && typeof block.text === "string") {
      parts.push(block.text);
    }
  }
  return parts.join("\n").trim();
}

/**
 * @param {{
 *   question: string,
 *   history?: Array<{ role?: string, content?: string }>,
 *   customers: object[],
 *   agents: object[],
 *   assignments: object[],
 *   env?: NodeJS.ProcessEnv,
 *   fetchImpl?: typeof fetch,
 * }} args
 */
export async function understandAdminAssignmentWithKey({
  question,
  history = [],
  customers,
  agents,
  assignments,
  env = process.env,
  fetchImpl = fetch,
}) {
  const apiKey = String(env.ANTHROPIC_API_KEY ?? "").trim();
  if (!apiKey) {
    return {
      ok: false,
      reason: "ANTHROPIC_NOT_CONFIGURED",
      text: "지금은 배정 상담을 준비하지 못했습니다. 잠시 후 다시 시도해 주세요.",
      card: null,
    };
  }

  const catalog = {
    customers: (customers || []).map((c) => ({
      id: c.id,
      display_name: c.display_name,
      email: c.email,
    })),
    agents: (agents || []).map((a) => ({
      id: a.id,
      display_name: a.display_name,
      email: a.email,
    })),
    live_assignments: (assignments || []).map((row) => ({
      id: row.id,
      status: row.status,
      customer_id: row.customer?.id,
      customer_display_name: row.customer?.display_name,
      customer_email: row.customer?.email,
      agent_user_id: row.agent?.id,
      agent_display_name: row.agent?.display_name,
      agent_email: row.agent?.email,
    })),
  };

  const system =
    "You are KEY for LIFEGUARD, speaking with an administrator about agent assignment. " +
    "Understand the admin's request, then call propose_admin_assignment_hand when you can propose " +
    "create_pending, activate, close, or clarify. " +
    "Do not invent ids. Use only catalog ids. Do not claim any assignment already ran. " +
    "Korean short replies only. No UUID in customer-facing sentences.";

  const messages = [];
  for (const turn of history || []) {
    const role = turn?.role === "assistant" ? "assistant" : "user";
    const content = String(turn?.content ?? "").trim();
    if (!content) continue;
    messages.push({ role, content });
  }
  messages.push({
    role: "user",
    content:
      `관리자 요청:\n${String(question ?? "").trim()}\n\n` +
      `카탈로그(JSON):\n${JSON.stringify(catalog)}`,
  });

  const model = String(env.ANTHROPIC_MODEL ?? env.CLAUDE_MODEL ?? DEFAULT_MODEL).trim();
  const res = await fetchImpl(ANTHROPIC_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      max_tokens: 1024,
      system,
      tools: [ADMIN_ASSIGNMENT_HAND_TOOL],
      tool_choice: { type: "auto" },
      messages,
    }),
  });

  if (!res.ok) {
    return {
      ok: false,
      reason: `ANTHROPIC_HTTP_${res.status}`,
      text: "요청을 이해하지 못했습니다. 잠시 후 다시 말씀해 주세요.",
      card: null,
    };
  }

  const json = await res.json();
  const toolInput = extractToolInput(json?.content);
  const prose = extractText(json?.content);

  if (!toolInput) {
    return {
      ok: true,
      reason: null,
      text: prose || "어떤 고객의 설계사 배정을 도와드릴까요?",
      card: null,
    };
  }

  const validated = validateAdminAssignmentProposal({
    proposal: toolInput,
    customers,
    agents,
    assignments,
    utterance: question,
  });
  if (validated.card) {
    const aligned = assertAdminAssignmentConfirmCardAligned(
      validated.card,
      customers,
      agents,
    );
    if (!aligned.ok) {
      return {
        ok: true,
        reason: aligned.reason,
        text: "고객·설계사 식별이 목록과 일치하지 않습니다. 이메일로 다시 지정해 주세요.",
        card: null,
      };
    }
    return {
      ok: true,
      reason: null,
      text: prose || validated.text,
      card: validated.card,
    };
  }
  return {
    ok: true,
    reason: null,
    text: prose || validated.text,
    card: null,
  };
}

/**
 * Full admin turn: load catalogs → KEY understand → confirm card (no POST).
 */
export async function runAdminKeyAssignmentChatTurn({
  question,
  history = [],
  adminSupabase = null,
  env = process.env,
  fetchImpl = fetch,
} = {}) {
  const q = String(question ?? "").trim();
  if (!q) {
    return {
      ok: false,
      reason: "QUESTION_REQUIRED",
      status: 422,
      text: "무엇을 도와드릴까요?",
      card: null,
      assignments: [],
    };
  }

  const [options, live] = await Promise.all([
    loadAdminAgentAssignmentOptions({ adminSupabase, env }),
    loadAdminLiveAgentAssignments({ adminSupabase, env }),
  ]);
  if (!options.ok) {
    return {
      ok: false,
      reason: options.reason,
      status: options.status ?? 500,
      text: "고객·설계사 목록을 불러오지 못했습니다.",
      card: null,
      assignments: [],
    };
  }
  if (!live.ok) {
    return {
      ok: false,
      reason: live.reason,
      status: live.status ?? 500,
      text: "현재 배정 상태를 불러오지 못했습니다.",
      card: null,
      assignments: [],
    };
  }

  const understood = await understandAdminAssignmentWithKey({
    question: q,
    history,
    customers: options.customers,
    agents: options.agents,
    assignments: live.assignments,
    env,
    fetchImpl,
  });

  return {
    ok: understood.ok !== false,
    reason: understood.reason ?? null,
    status: understood.ok === false ? 500 : 200,
    text: understood.text,
    card: understood.card,
    assignments: live.assignments,
  };
}
