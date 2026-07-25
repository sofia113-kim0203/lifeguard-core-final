/**
 * Admin agent-assignment engine — create pending / activate / close.
 * C1 binding on activate when live agent_sharing exists; revoke binding on close.
 * Does not touch signup UI, KEY chat consent, or C2 briefing contracts.
 */
import { createServiceRoleClient } from "./createServiceRoleClient.js";

export const ADMIN_ASSIGNMENT_ACTIONS = Object.freeze({
  CREATE_PENDING: "create_pending",
  ACTIVATE: "activate",
  CLOSE: "close",
});

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const CREATE_ALLOWED_KEYS = new Set([
  "action",
  "customer_id",
  "agent_user_id",
  "notes",
]);
const TRANSITION_ALLOWED_KEYS = new Set(["action", "assignment_id"]);

/**
 * @param {unknown} value
 */
export function isUuid(value) {
  return typeof value === "string" && UUID_RE.test(value.trim());
}

/**
 * Reject unknown body keys for the given action.
 * @param {Record<string, unknown>} body
 * @param {string} action
 */
export function assertAdminAssignmentBodyKeys(body, action) {
  const allowed =
    action === ADMIN_ASSIGNMENT_ACTIONS.CREATE_PENDING
      ? CREATE_ALLOWED_KEYS
      : TRANSITION_ALLOWED_KEYS;
  const keys = Object.keys(body ?? {});
  for (const key of keys) {
    if (!allowed.has(key)) {
      return { ok: false, reason: "UNEXPECTED_FIELD", field: key };
    }
  }
  return { ok: true };
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} admin
 * @param {string} customerId
 */
async function loadLiveAgentSharingConsent(admin, customerId) {
  const { data, error } = await admin
    .from("customer_consents")
    .select("id")
    .eq("customer_id", customerId)
    .eq("consent_type", "agent_sharing")
    .eq("granted", true)
    .is("revoked_at", null)
    .order("granted_at", { ascending: false })
    .limit(1);
  if (error) {
    return { ok: false, reason: "CONSENT_LOOKUP_FAILED", error_message: error.message };
  }
  const row = Array.isArray(data) && data.length > 0 ? data[0] : null;
  return { ok: true, consentId: row?.id ?? null };
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} admin
 * @param {string} assignmentId
 */
async function loadLiveBinding(admin, assignmentId) {
  const { data, error } = await admin
    .from("agent_assignment_consents")
    .select("id")
    .eq("assignment_id", assignmentId)
    .is("revoked_at", null)
    .limit(1);
  if (error) {
    return { ok: false, reason: "BINDING_LOOKUP_FAILED", error_message: error.message };
  }
  const row = Array.isArray(data) && data.length > 0 ? data[0] : null;
  return { ok: true, bindingId: row?.id ?? null };
}

/**
 * Ensure exactly one live C1 binding when consent exists; otherwise skip.
 * @param {import("@supabase/supabase-js").SupabaseClient} admin
 * @param {{ assignmentId: string, customerId: string }} args
 */
export async function ensureAssignmentConsentBinding(admin, { assignmentId, customerId }) {
  const existing = await loadLiveBinding(admin, assignmentId);
  if (!existing.ok) return existing;
  if (existing.bindingId) {
    return {
      ok: true,
      binding_id: existing.bindingId,
      binding_created: false,
      binding_skipped_no_consent: false,
    };
  }

  const consent = await loadLiveAgentSharingConsent(admin, customerId);
  if (!consent.ok) return consent;
  if (!consent.consentId) {
    return {
      ok: true,
      binding_id: null,
      binding_created: false,
      binding_skipped_no_consent: true,
    };
  }

  const { data: inserted, error: insertError } = await admin
    .from("agent_assignment_consents")
    .insert({
      assignment_id: assignmentId,
      customer_consent_id: consent.consentId,
    })
    .select("id")
    .maybeSingle();

  if (insertError) {
    // Race: another writer created the live binding — re-read.
    const again = await loadLiveBinding(admin, assignmentId);
    if (again.ok && again.bindingId) {
      return {
        ok: true,
        binding_id: again.bindingId,
        binding_created: false,
        binding_skipped_no_consent: false,
      };
    }
    return {
      ok: false,
      reason: "BINDING_CREATE_FAILED",
      status: 500,
      error_message: insertError.message,
    };
  }

  return {
    ok: true,
    binding_id: inserted?.id ?? null,
    binding_created: true,
    binding_skipped_no_consent: false,
  };
}

/**
 * Revoke all live bindings for an assignment.
 * @param {import("@supabase/supabase-js").SupabaseClient} admin
 * @param {string} assignmentId
 */
export async function revokeLiveAssignmentBindings(admin, assignmentId) {
  const now = new Date().toISOString();
  const { data, error } = await admin
    .from("agent_assignment_consents")
    .update({ revoked_at: now })
    .eq("assignment_id", assignmentId)
    .is("revoked_at", null)
    .select("id");
  if (error) {
    return {
      ok: false,
      reason: "BINDING_REVOKE_FAILED",
      status: 500,
      error_message: error.message,
    };
  }
  return { ok: true, revoked_count: Array.isArray(data) ? data.length : 0 };
}

/**
 * @param {{
 *   adminSupabase?: import("@supabase/supabase-js").SupabaseClient | null,
 *   env?: NodeJS.ProcessEnv,
 *   customerId: string,
 *   agentUserId: string,
 *   notes?: string | null,
 * }} args
 */
export async function createPendingAgentAssignment({
  adminSupabase = null,
  env = process.env,
  customerId,
  agentUserId,
  notes = null,
} = {}) {
  const admin = adminSupabase ?? createServiceRoleClient(env);
  if (!admin) {
    return {
      ok: false,
      reason: "SERVICE_ROLE_NOT_CONFIGURED",
      status: 500,
      error_message: "Service role client unavailable.",
    };
  }

  if (!isUuid(customerId) || !isUuid(agentUserId)) {
    return { ok: false, reason: "INVALID_ID", status: 422 };
  }
  const customerIdClean = customerId.trim();
  const agentUserIdClean = agentUserId.trim();

  const { data: customer, error: customerError } = await admin
    .from("customer_profiles")
    .select("id")
    .eq("id", customerIdClean)
    .is("deleted_at", null)
    .maybeSingle();
  if (customerError) {
    return {
      ok: false,
      reason: "CUSTOMER_LOOKUP_FAILED",
      status: 500,
      error_message: customerError.message,
    };
  }
  if (!customer) {
    return { ok: false, reason: "CUSTOMER_NOT_FOUND", status: 404 };
  }

  const { data: agentUser, error: agentError } = await admin
    .from("users")
    .select("id, role")
    .eq("id", agentUserIdClean)
    .maybeSingle();
  if (agentError) {
    return {
      ok: false,
      reason: "AGENT_LOOKUP_FAILED",
      status: 500,
      error_message: agentError.message,
    };
  }
  if (!agentUser) {
    return { ok: false, reason: "AGENT_NOT_FOUND", status: 404 };
  }
  if (agentUser.role !== "agent") {
    return { ok: false, reason: "NOT_AGENT_ROLE", status: 422 };
  }

  const notesClean =
    notes == null || notes === ""
      ? null
      : String(notes).trim().slice(0, 2000) || null;

  const { data: row, error: insertError } = await admin
    .from("agent_assignments")
    .insert({
      customer_id: customerIdClean,
      agent_user_id: agentUserIdClean,
      status: "pending",
      notes: notesClean,
    })
    .select("id, customer_id, agent_user_id, status, assigned_at, created_at, deleted_at")
    .maybeSingle();

  if (insertError) {
    return {
      ok: false,
      reason: "ASSIGNMENT_CREATE_FAILED",
      status: 500,
      error_message: insertError.message,
    };
  }

  return {
    ok: true,
    status: 200,
    assignment: row,
    binding_id: null,
    binding_created: false,
  };
}

/**
 * @param {{
 *   adminSupabase?: import("@supabase/supabase-js").SupabaseClient | null,
 *   env?: NodeJS.ProcessEnv,
 *   assignmentId: string,
 * }} args
 */
export async function activateAgentAssignment({
  adminSupabase = null,
  env = process.env,
  assignmentId,
} = {}) {
  const admin = adminSupabase ?? createServiceRoleClient(env);
  if (!admin) {
    return {
      ok: false,
      reason: "SERVICE_ROLE_NOT_CONFIGURED",
      status: 500,
      error_message: "Service role client unavailable.",
    };
  }
  if (!isUuid(assignmentId)) {
    return { ok: false, reason: "INVALID_ID", status: 422 };
  }
  const assignmentIdClean = assignmentId.trim();

  const { data: assignment, error: lookupError } = await admin
    .from("agent_assignments")
    .select("id, customer_id, agent_user_id, status, assigned_at, created_at, deleted_at")
    .eq("id", assignmentIdClean)
    .maybeSingle();
  if (lookupError) {
    return {
      ok: false,
      reason: "ASSIGNMENT_LOOKUP_FAILED",
      status: 500,
      error_message: lookupError.message,
    };
  }
  if (!assignment) {
    return { ok: false, reason: "ASSIGNMENT_NOT_FOUND", status: 404 };
  }
  if (assignment.deleted_at != null) {
    return { ok: false, reason: "ASSIGNMENT_DELETED", status: 403 };
  }
  if (assignment.status === "closed") {
    return { ok: false, reason: "INVALID_TRANSITION", status: 403 };
  }
  if (assignment.status !== "pending" && assignment.status !== "active") {
    return { ok: false, reason: "INVALID_TRANSITION", status: 403 };
  }

  if (assignment.status === "pending") {
    const { data: otherActive, error: activeError } = await admin
      .from("agent_assignments")
      .select("id")
      .eq("customer_id", assignment.customer_id)
      .eq("status", "active")
      .is("deleted_at", null)
      .neq("id", assignmentIdClean)
      .limit(1);
    if (activeError) {
      return {
        ok: false,
        reason: "ACTIVE_LOOKUP_FAILED",
        status: 500,
        error_message: activeError.message,
      };
    }
    if (Array.isArray(otherActive) && otherActive.length > 0) {
      return { ok: false, reason: "DUPLICATE_ACTIVE", status: 409 };
    }

    const assignedAt = assignment.assigned_at ?? new Date().toISOString();
    const { data: updated, error: updateError } = await admin
      .from("agent_assignments")
      .update({ status: "active", assigned_at: assignedAt })
      .eq("id", assignmentIdClean)
      .eq("status", "pending")
      .is("deleted_at", null)
      .select("id, customer_id, agent_user_id, status, assigned_at, created_at, deleted_at")
      .maybeSingle();

    if (updateError) {
      if (
        String(updateError.message ?? "").includes(
          "agent_assignments_one_active_per_customer_uq",
        ) ||
        updateError.code === "23505"
      ) {
        return { ok: false, reason: "DUPLICATE_ACTIVE", status: 409 };
      }
      return {
        ok: false,
        reason: "ASSIGNMENT_ACTIVATE_FAILED",
        status: 500,
        error_message: updateError.message,
      };
    }
    if (!updated) {
      return { ok: false, reason: "INVALID_TRANSITION", status: 409 };
    }
    assignment.status = updated.status;
    assignment.assigned_at = updated.assigned_at;
  }

  const binding = await ensureAssignmentConsentBinding(admin, {
    assignmentId: assignment.id,
    customerId: assignment.customer_id,
  });
  if (!binding.ok) {
    return { ...binding, status: binding.status ?? 500 };
  }

  return {
    ok: true,
    status: 200,
    assignment: {
      id: assignment.id,
      customer_id: assignment.customer_id,
      agent_user_id: assignment.agent_user_id,
      status: "active",
      assigned_at: assignment.assigned_at,
      created_at: assignment.created_at,
      deleted_at: assignment.deleted_at,
    },
    binding_id: binding.binding_id,
    binding_created: binding.binding_created === true,
    binding_skipped_no_consent: binding.binding_skipped_no_consent === true,
  };
}

/**
 * @param {{
 *   adminSupabase?: import("@supabase/supabase-js").SupabaseClient | null,
 *   env?: NodeJS.ProcessEnv,
 *   assignmentId: string,
 * }} args
 */
export async function closeAgentAssignment({
  adminSupabase = null,
  env = process.env,
  assignmentId,
} = {}) {
  const admin = adminSupabase ?? createServiceRoleClient(env);
  if (!admin) {
    return {
      ok: false,
      reason: "SERVICE_ROLE_NOT_CONFIGURED",
      status: 500,
      error_message: "Service role client unavailable.",
    };
  }
  if (!isUuid(assignmentId)) {
    return { ok: false, reason: "INVALID_ID", status: 422 };
  }
  const assignmentIdClean = assignmentId.trim();

  const { data: assignment, error: lookupError } = await admin
    .from("agent_assignments")
    .select("id, customer_id, agent_user_id, status, assigned_at, created_at, deleted_at")
    .eq("id", assignmentIdClean)
    .maybeSingle();
  if (lookupError) {
    return {
      ok: false,
      reason: "ASSIGNMENT_LOOKUP_FAILED",
      status: 500,
      error_message: lookupError.message,
    };
  }
  if (!assignment) {
    return { ok: false, reason: "ASSIGNMENT_NOT_FOUND", status: 404 };
  }
  if (assignment.deleted_at != null) {
    return { ok: false, reason: "ASSIGNMENT_DELETED", status: 403 };
  }
  if (
    assignment.status !== "pending" &&
    assignment.status !== "active" &&
    assignment.status !== "closed"
  ) {
    return { ok: false, reason: "INVALID_TRANSITION", status: 403 };
  }

  // pending → closed: cancel wait only. No activate, no assigned_at, no C1 create, no briefing.
  if (assignment.status === "pending") {
    const { data: updated, error: updateError } = await admin
      .from("agent_assignments")
      .update({ status: "closed" })
      .eq("id", assignmentIdClean)
      .eq("status", "pending")
      .is("deleted_at", null)
      .select("id, customer_id, agent_user_id, status, assigned_at, created_at, deleted_at")
      .maybeSingle();
    if (updateError) {
      return {
        ok: false,
        reason: "ASSIGNMENT_CLOSE_FAILED",
        status: 500,
        error_message: updateError.message,
      };
    }
    if (!updated) {
      return { ok: false, reason: "INVALID_TRANSITION", status: 409 };
    }
    assignment.status = updated.status;
    assignment.assigned_at = updated.assigned_at;

    const revokedPending = await revokeLiveAssignmentBindings(admin, assignmentIdClean);
    if (!revokedPending.ok) return revokedPending;

    return {
      ok: true,
      status: 200,
      assignment: {
        id: assignment.id,
        customer_id: assignment.customer_id,
        agent_user_id: assignment.agent_user_id,
        status: "closed",
        assigned_at: assignment.assigned_at,
        created_at: assignment.created_at,
        deleted_at: assignment.deleted_at,
      },
      binding_revoked_count: revokedPending.revoked_count,
      binding_created: false,
      binding_skipped_no_consent: false,
    };
  }

  // active → closed (existing contract): revoke live C1 bindings.
  if (assignment.status === "active") {
    const { data: updated, error: updateError } = await admin
      .from("agent_assignments")
      .update({ status: "closed" })
      .eq("id", assignmentIdClean)
      .eq("status", "active")
      .is("deleted_at", null)
      .select("id, customer_id, agent_user_id, status, assigned_at, created_at, deleted_at")
      .maybeSingle();
    if (updateError) {
      return {
        ok: false,
        reason: "ASSIGNMENT_CLOSE_FAILED",
        status: 500,
        error_message: updateError.message,
      };
    }
    if (!updated) {
      return { ok: false, reason: "INVALID_TRANSITION", status: 409 };
    }
    assignment.status = updated.status;
  }

  const revoked = await revokeLiveAssignmentBindings(admin, assignmentIdClean);
  if (!revoked.ok) return revoked;

  return {
    ok: true,
    status: 200,
    assignment: {
      id: assignment.id,
      customer_id: assignment.customer_id,
      agent_user_id: assignment.agent_user_id,
      status: "closed",
      assigned_at: assignment.assigned_at,
      created_at: assignment.created_at,
      deleted_at: assignment.deleted_at,
    },
    binding_revoked_count: revoked.revoked_count,
  };
}

/**
 * @param {{
 *   adminSupabase?: import("@supabase/supabase-js").SupabaseClient | null,
 *   env?: NodeJS.ProcessEnv,
 *   body: Record<string, unknown>,
 * }} args
 */
export async function runAdminAgentAssignmentAction({
  adminSupabase = null,
  env = process.env,
  body = {},
} = {}) {
  const action = String(body?.action ?? "").trim();
  if (
    action !== ADMIN_ASSIGNMENT_ACTIONS.CREATE_PENDING &&
    action !== ADMIN_ASSIGNMENT_ACTIONS.ACTIVATE &&
    action !== ADMIN_ASSIGNMENT_ACTIONS.CLOSE
  ) {
    return { ok: false, reason: "INVALID_ACTION", status: 422 };
  }

  const keys = assertAdminAssignmentBodyKeys(body, action);
  if (!keys.ok) {
    return { ok: false, reason: keys.reason, status: 422, field: keys.field };
  }

  if (action === ADMIN_ASSIGNMENT_ACTIONS.CREATE_PENDING) {
    return createPendingAgentAssignment({
      adminSupabase,
      env,
      customerId: String(body.customer_id ?? ""),
      agentUserId: String(body.agent_user_id ?? ""),
      notes: body.notes ?? null,
    });
  }
  if (action === ADMIN_ASSIGNMENT_ACTIONS.ACTIVATE) {
    return activateAgentAssignment({
      adminSupabase,
      env,
      assignmentId: String(body.assignment_id ?? ""),
    });
  }
  return closeAgentAssignment({
    adminSupabase,
    env,
    assignmentId: String(body.assignment_id ?? ""),
  });
}
