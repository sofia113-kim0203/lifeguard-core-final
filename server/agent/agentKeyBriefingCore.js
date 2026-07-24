/**
 * C2-B — Agent KEY briefing list + create (gates before KEY; no conversation writes).
 */
import { runOneKeyCoreTurn } from "../keyCore/oneKeyCoreTurn.js";
import { createServiceRoleClient } from "./createServiceRoleClient.js";

export const AGENT_BRIEFING_PURPOSE_MAX = 200;
export const AGENT_BRIEFING_QUESTION_MAX = 2000;

const PROFILE_SELECT = "id, display_name";

/**
 * Fixed internal framing — not a customer-facing channel label.
 * @param {string} purpose
 * @param {string} question
 */
export function buildAgentBriefingKeyQuestion(purpose, question) {
  return [
    "[설계사 내부 브리핑 요청 — 고객 화면·고객 대화에 노출하지 않음]",
    `업무 목적: ${purpose}`,
    `질문: ${question}`,
  ].join("\n");
}

export function validatePurposeQuestion(purposeRaw, questionRaw) {
  const purpose = String(purposeRaw ?? "").trim();
  const question = String(questionRaw ?? "").trim();
  if (!purpose || purpose.length > AGENT_BRIEFING_PURPOSE_MAX) {
    return { ok: false, reason: "INVALID_PURPOSE" };
  }
  if (!question || question.length > AGENT_BRIEFING_QUESTION_MAX) {
    return { ok: false, reason: "INVALID_QUESTION" };
  }
  return { ok: true, purpose, question };
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} userSupabase
 * @param {string} customerId
 */
export async function callAgentConsentHelper(userSupabase, customerId) {
  const { data, error } = await userSupabase.rpc(
    "lifeguard_agent_has_active_assignment_consent",
    { p_customer_id: customerId },
  );
  if (error) {
    return { ok: false, reason: "CONSENT_HELPER_FAILED", error_message: error.message };
  }
  return { ok: true, eligible: data === true };
}

/**
 * GET — pending+active assignments for actor; minimal customer fields.
 */
export async function listAgentKeyBriefingAssignments({
  userSupabase,
  agentUserId,
  adminSupabase = null,
  env = process.env,
} = {}) {
  if (!userSupabase || !agentUserId) {
    return { ok: false, reason: "UNAUTHORIZED", status: 401 };
  }

  const { data: rows, error } = await userSupabase
    .from("agent_assignments")
    .select("id, customer_id, agent_user_id, status, assigned_at, created_at, deleted_at")
    .eq("agent_user_id", agentUserId)
    .is("deleted_at", null)
    .in("status", ["pending", "active"])
    .order("created_at", { ascending: false });

  if (error) {
    return {
      ok: false,
      reason: "ASSIGNMENT_LIST_FAILED",
      status: 500,
      error_message: error.message,
    };
  }

  const assignments = rows ?? [];
  const customerIds = [...new Set(assignments.map((r) => r.customer_id).filter(Boolean))];

  /** @type {Map<string, { id: string, display_name: string | null }>} */
  const profileById = new Map();
  if (customerIds.length > 0) {
    const reader = adminSupabase ?? createServiceRoleClient(env) ?? userSupabase;
    const { data: profiles, error: profileError } = await reader
      .from("customer_profiles")
      .select(PROFILE_SELECT)
      .in("id", customerIds)
      .is("deleted_at", null);
    if (!profileError) {
      for (const p of profiles ?? []) {
        profileById.set(p.id, {
          id: p.id,
          display_name: p.display_name ?? null,
        });
      }
    }
  }

  const items = [];
  for (const row of assignments) {
    const consent = await callAgentConsentHelper(userSupabase, row.customer_id);
    const briefingEligible =
      row.status === "active" && consent.ok === true && consent.eligible === true;
    const profile = profileById.get(row.customer_id) ?? {
      id: row.customer_id,
      display_name: null,
    };
    items.push({
      assignment_id: row.id,
      status: row.status,
      assigned_at: row.assigned_at ?? null,
      created_at: row.created_at ?? null,
      briefing_eligible: briefingEligible,
      customer: {
        customer_id: profile.id,
        display_name: profile.display_name,
      },
    });
  }

  return { ok: true, status: 200, items };
}

/**
 * POST — gated KEY briefing + append-only insert.
 * deps injectable for unit tests.
 */
export async function createAgentKeyBriefing({
  userSupabase,
  agentUserId,
  assignmentId,
  purpose: purposeRaw,
  question: questionRaw,
  adminSupabase = null,
  env = process.env,
  runKeyTurn = runOneKeyCoreTurn,
  conversationWriteProbe = null,
} = {}) {
  if (!userSupabase || !agentUserId) {
    return { ok: false, reason: "UNAUTHORIZED", status: 401 };
  }

  const assignmentIdClean = String(assignmentId ?? "").trim();
  if (!assignmentIdClean) {
    return { ok: false, reason: "ASSIGNMENT_ID_REQUIRED", status: 422 };
  }

  const validated = validatePurposeQuestion(purposeRaw, questionRaw);
  if (!validated.ok) {
    return { ok: false, reason: validated.reason, status: 422 };
  }
  const { purpose, question } = validated;

  const admin = adminSupabase ?? createServiceRoleClient(env);
  if (!admin) {
    return {
      ok: false,
      reason: "SERVICE_ROLE_NOT_CONFIGURED",
      status: 500,
      error_message: "Service role client unavailable.",
    };
  }

  const { data: assignment, error: assignmentError } = await admin
    .from("agent_assignments")
    .select("id, customer_id, agent_user_id, status, deleted_at")
    .eq("id", assignmentIdClean)
    .maybeSingle();

  if (assignmentError) {
    return {
      ok: false,
      reason: "ASSIGNMENT_LOOKUP_FAILED",
      status: 500,
      error_message: assignmentError.message,
    };
  }
  if (!assignment) {
    return { ok: false, reason: "NOT_ASSIGNED", status: 403 };
  }
  if (assignment.agent_user_id !== agentUserId) {
    return { ok: false, reason: "NOT_ASSIGNED", status: 403 };
  }
  if (assignment.deleted_at != null) {
    return { ok: false, reason: "NOT_ASSIGNED", status: 403 };
  }
  if (assignment.status !== "active") {
    return { ok: false, reason: "ASSIGNMENT_NOT_ACTIVE", status: 403 };
  }

  const consent = await callAgentConsentHelper(userSupabase, assignment.customer_id);
  if (!consent.ok) {
    return {
      ok: false,
      reason: consent.reason,
      status: 500,
      error_message: consent.error_message,
    };
  }
  if (!consent.eligible) {
    return { ok: false, reason: "CONSENT_BINDING_REQUIRED", status: 403 };
  }

  const { data: bindings, error: bindingError } = await admin
    .from("agent_assignment_consents")
    .select("id")
    .eq("assignment_id", assignment.id)
    .is("revoked_at", null);

  if (bindingError) {
    return {
      ok: false,
      reason: "BINDING_LOOKUP_FAILED",
      status: 500,
      error_message: bindingError.message,
    };
  }
  if (!bindings || bindings.length !== 1) {
    return { ok: false, reason: "CONSENT_BINDING_REQUIRED", status: 403 };
  }
  const assignmentConsentId = bindings[0].id;

  const framedQuestion = buildAgentBriefingKeyQuestion(purpose, question);

  if (typeof conversationWriteProbe === "function") {
    conversationWriteProbe("pre_key");
  }

  const keyResult = await runKeyTurn({
    event: "question",
    userSupabase: admin,
    customerId: assignment.customer_id,
    question: framedQuestion,
    history: [],
    sessionId: null,
    authUserId: null,
    attachedDocumentId: null,
    priorAttachFollowUp: false,
    presenceTurn: false,
    env,
  });

  if (typeof conversationWriteProbe === "function") {
    conversationWriteProbe("post_key");
  }

  if (!keyResult?.ok || !String(keyResult.customerText ?? "").trim()) {
    return {
      ok: false,
      reason: "KEY_TURN_FAILED",
      status: 500,
      error_message: "KEY briefing turn failed.",
    };
  }

  const briefingText = String(keyResult.customerText).trim();
  const keyTraceId =
    keyResult.contextSnapshot?.context_snapshot_id != null
      ? String(keyResult.contextSnapshot.context_snapshot_id)
      : null;

  const insertRow = {
    assignment_id: assignment.id,
    assignment_consent_id: assignmentConsentId,
    agent_user_id: agentUserId,
    customer_id: assignment.customer_id,
    purpose,
    question,
    briefing_text: briefingText,
    key_event: "question",
    ...(keyTraceId ? { key_trace_id: keyTraceId } : {}),
  };

  const { data: saved, error: insertError } = await admin
    .from("agent_key_briefings")
    .insert(insertRow)
    .select("id, created_at")
    .maybeSingle();

  if (insertError || !saved?.id) {
    return {
      ok: false,
      reason: "BRIEFING_INSERT_FAILED",
      status: 500,
      error_message: insertError?.message ?? "insert_failed",
    };
  }

  return {
    ok: true,
    status: 200,
    briefing: {
      id: saved.id,
      assignment_id: assignment.id,
      customer_id: assignment.customer_id,
      purpose,
      question,
      briefing_text: briefingText,
      key_event: "question",
      key_trace_id: keyTraceId,
      created_at: saved.created_at,
    },
    key_calls: 1,
    inserts: 1,
  };
}
