/**
 * Admin-only read model: live pending/active agent assignments.
 * No status transitions. No POST contract changes.
 */
import { createServiceRoleClient } from "./createServiceRoleClient.js";
import { displayNameFromEmail } from "./adminAgentAssignmentOptionsCore.js";

const LIST_LIMIT = 200;

/**
 * @param {{
 *   adminSupabase?: import("@supabase/supabase-js").SupabaseClient | null,
 *   env?: NodeJS.ProcessEnv,
 * }} [args]
 */
export async function loadAdminLiveAgentAssignments({
  adminSupabase = null,
  env = process.env,
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

  const { data: rows, error } = await admin
    .from("agent_assignments")
    .select("id, customer_id, agent_user_id, status, assigned_at, created_at")
    .in("status", ["pending", "active"])
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(LIST_LIMIT);

  if (error) {
    return {
      ok: false,
      reason: "ASSIGNMENT_LIST_FAILED",
      status: 500,
      error_message: error.message,
    };
  }

  const list = Array.isArray(rows) ? rows : [];
  const customerIds = [
    ...new Set(list.map((r) => r.customer_id).filter(Boolean)),
  ];
  const agentIds = [
    ...new Set(list.map((r) => r.agent_user_id).filter(Boolean)),
  ];

  /** @type {Map<string, { display_name: string, email: string | null }>} */
  const customerMap = new Map();
  if (customerIds.length) {
    const { data: profiles, error: profileError } = await admin
      .from("customer_profiles")
      .select("id, display_name, user_id")
      .in("id", customerIds);
    if (profileError) {
      return {
        ok: false,
        reason: "CUSTOMER_LOOKUP_FAILED",
        status: 500,
        error_message: profileError.message,
      };
    }
    const userIds = (profiles || []).map((p) => p.user_id).filter(Boolean);
    /** @type {Map<string, string | null>} */
    const emailByUser = new Map();
    if (userIds.length) {
      const { data: users, error: usersError } = await admin
        .from("users")
        .select("id, email")
        .in("id", userIds);
      if (usersError) {
        return {
          ok: false,
          reason: "CUSTOMER_USER_LOOKUP_FAILED",
          status: 500,
          error_message: usersError.message,
        };
      }
      for (const u of users || []) {
        emailByUser.set(u.id, u.email ?? null);
      }
    }
    for (const p of profiles || []) {
      const email = p.user_id ? emailByUser.get(p.user_id) ?? null : null;
      const name =
        String(p.display_name ?? "").trim() || displayNameFromEmail(email);
      customerMap.set(p.id, { display_name: name, email });
    }
  }

  /** @type {Map<string, { display_name: string, email: string | null }>} */
  const agentMap = new Map();
  if (agentIds.length) {
    const { data: agents, error: agentsError } = await admin
      .from("users")
      .select("id, email, role")
      .in("id", agentIds);
    if (agentsError) {
      return {
        ok: false,
        reason: "AGENT_LOOKUP_FAILED",
        status: 500,
        error_message: agentsError.message,
      };
    }
    for (const a of agents || []) {
      if (a.role !== "agent") continue;
      const email = a.email ? String(a.email).trim() : "";
      agentMap.set(a.id, {
        display_name: displayNameFromEmail(email),
        email: email || null,
      });
    }
  }

  const assignments = [];
  for (const row of list) {
    if (!row?.id || (row.status !== "pending" && row.status !== "active")) {
      continue;
    }
    const customer = customerMap.get(row.customer_id) ?? {
      display_name: "이름 없음",
      email: null,
    };
    const agent = agentMap.get(row.agent_user_id) ?? {
      display_name: "이름 없음",
      email: null,
    };
    assignments.push({
      id: row.id,
      status: row.status,
      customer: {
        id: row.customer_id,
        display_name: customer.display_name,
        email: customer.email,
      },
      agent: {
        id: row.agent_user_id,
        display_name: agent.display_name,
        email: agent.email,
      },
      assigned_at: row.assigned_at ?? null,
      created_at: row.created_at ?? null,
    });
  }

  return {
    ok: true,
    status: 200,
    assignments,
  };
}
