/**
 * Agent free KEY v1 — general insurance + gated assigned-customer turns.
 * Single runOneKeyCoreTurn path; no second Claude / no KEY clone.
 */
import { runOneKeyCoreTurn } from "../keyCore/oneKeyCoreTurn.js";
import { createServiceRoleClient } from "./createServiceRoleClient.js";
import { resolveAgentCustomerKeyAccess } from "./agentKeyBriefingCore.js";

export const AGENT_FREE_KEY_QUESTION_MAX = 2000;
export const AGENT_FREE_KEY_HISTORY_MAX = 40;

/**
 * @param {unknown} questionRaw
 */
export function validateAgentFreeKeyQuestion(questionRaw) {
  const question = String(questionRaw ?? "").trim();
  if (!question || question.length > AGENT_FREE_KEY_QUESTION_MAX) {
    return { ok: false, reason: "INVALID_QUESTION" };
  }
  return { ok: true, question };
}

/**
 * Agent-owned history only — never customer chat rows from DB.
 * @param {unknown} history
 */
export function normalizeAgentFreeKeyHistory(history) {
  const list = Array.isArray(history) ? history : [];
  const out = [];
  for (const turn of list.slice(-AGENT_FREE_KEY_HISTORY_MAX)) {
    const role = turn?.role === "assistant" ? "assistant" : "user";
    const content = String(turn?.content ?? turn?.text ?? turn?.message ?? "").trim();
    if (!content) continue;
    out.push({ role, content, text: content });
  }
  return out;
}

/**
 * Legacy framing helper — NOT used for role enforcement.
 * Role/mode are structured inputs (audience + conversationMode) only.
 * Kept for unit-test compatibility; runAgentFreeKeyTurn passes original question.
 * @param {{
 *   question: string,
 *   mode: 'general' | 'customer_scoped' | 'customer_denied',
 * }} args
 */
export function buildAgentFreeKeyQuestion({ question, mode }) {
  const q = String(question ?? "").trim();
  if (mode === "customer_scoped") {
    return [
      "[설계사 KEY 담당 고객 질문 — 고객 화면·고객 대화에 노출하지 않음]",
      `질문: ${q}`,
    ].join("\n");
  }
  if (mode === "customer_denied") {
    return [
      "[설계사 KEY — 해당 고객 자료 접근 권한 없음]",
      "고객 chart·PII·다른 고객 존재 여부를 추측하거나 노출하지 말 것.",
      "일반 보험 지식으로는 답하되, 이 고객의 계약·차트는 열 수 없다고 자연스럽게 안내하라.",
      `질문: ${q}`,
    ].join("\n");
  }
  return [
    "[설계사 KEY 일반 질문 — 특정 고객 chart·PII·브리핑 재료 없음]",
    `질문: ${q}`,
  ].join("\n");
}

/**
 * @param {{
 *   userSupabase: import("@supabase/supabase-js").SupabaseClient,
 *   agentUserId: string,
 *   question: string,
 *   history?: unknown,
 *   assignmentId?: string | null,
 *   adminSupabase?: import("@supabase/supabase-js").SupabaseClient | null,
 *   env?: NodeJS.ProcessEnv,
 *   runKeyTurn?: typeof runOneKeyCoreTurn,
 *   streamHandlers?: object | null,
 * }} args
 */
export async function runAgentFreeKeyTurn({
  userSupabase,
  agentUserId,
  question: questionRaw,
  history = [],
  assignmentId = null,
  adminSupabase = null,
  env = process.env,
  runKeyTurn = runOneKeyCoreTurn,
  streamHandlers = null,
} = {}) {
  if (!userSupabase || !agentUserId) {
    return { ok: false, reason: "UNAUTHORIZED", status: 401 };
  }

  const validated = validateAgentFreeKeyQuestion(questionRaw);
  if (!validated.ok) {
    return { ok: false, reason: validated.reason, status: 422 };
  }
  const { question } = validated;
  const agentHistory = normalizeAgentFreeKeyHistory(history);
  const assignmentIdClean = String(assignmentId ?? "").trim();

  /** @type {'general' | 'customer_scoped' | 'customer_denied'} */
  let mode = "general";
  /** @type {string | null} */
  let customerId = null;
  /** @type {import("@supabase/supabase-js").SupabaseClient | null} */
  let keySupabase = null;
  /** @type {string | null} */
  let accessReason = null;

  if (assignmentIdClean) {
    const access = await resolveAgentCustomerKeyAccess({
      userSupabase,
      agentUserId,
      assignmentId: assignmentIdClean,
      adminSupabase,
      env,
    });
    if (access.ok) {
      mode = "customer_scoped";
      customerId = access.customerId;
      keySupabase = access.admin;
    } else if (
      access.reason === "NOT_ASSIGNED" ||
      access.reason === "ASSIGNMENT_NOT_ACTIVE" ||
      access.reason === "CONSENT_BINDING_REQUIRED"
    ) {
      mode = "customer_denied";
      accessReason = access.reason;
      keySupabase = adminSupabase ?? createServiceRoleClient(env);
    } else {
      return {
        ok: false,
        reason: access.reason,
        status: access.status ?? 500,
        error_message: access.error_message,
      };
    }
  }

  if (!keySupabase) {
    keySupabase = adminSupabase ?? createServiceRoleClient(env);
  }
  if (!keySupabase) {
    return {
      ok: false,
      reason: "SERVICE_ROLE_NOT_CONFIGURED",
      status: 500,
      error_message: "Service role client unavailable.",
    };
  }

  // Role enforcement is structural (audience + conversationMode), not question prefix.
  // Optional streamHandlers forward to the same single Claude path as customer SSE.
  const keyResult = await runKeyTurn({
    event: "question",
    userSupabase: keySupabase,
    customerId,
    question,
    history: agentHistory,
    sessionId: null,
    authUserId: null,
    attachedDocumentId: null,
    priorAttachFollowUp: false,
    presenceTurn: false,
    audience: "agent",
    conversationMode: mode,
    streamHandlers: streamHandlers || null,
    env,
  });

  if (!keyResult?.ok || !String(keyResult.customerText ?? "").trim()) {
    return {
      ok: false,
      reason: "KEY_TURN_FAILED",
      status: 500,
      error_message: "KEY turn failed.",
    };
  }

  return {
    ok: true,
    status: 200,
    mode,
    access_reason: accessReason,
    customer_context_used: mode === "customer_scoped",
    text: String(keyResult.customerText).trim(),
  };
}
