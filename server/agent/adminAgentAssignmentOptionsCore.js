/**
 * Admin-only customer/agent pick lists for assignment UI.
 * Minimal fields only — no phone, consents, charts, or matching logic.
 */
import { createServiceRoleClient } from "./createServiceRoleClient.js";

const LIST_LIMIT = 200;

/**
 * @param {string | null | undefined} email
 */
export function displayNameFromEmail(email) {
  const raw = String(email ?? "").trim();
  if (!raw) return "이름 없음";
  const local = raw.split("@")[0]?.trim();
  return local || "이름 없음";
}

/**
 * @param {{
 *   adminSupabase?: import("@supabase/supabase-js").SupabaseClient | null,
 *   env?: NodeJS.ProcessEnv,
 * }} [args]
 */
export async function loadAdminAgentAssignmentOptions({
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

  const { data: profiles, error: profileError } = await admin
    .from("customer_profiles")
    .select("id, display_name, user_id")
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(LIST_LIMIT);

  if (profileError) {
    return {
      ok: false,
      reason: "CUSTOMER_LIST_FAILED",
      status: 500,
      error_message: profileError.message,
    };
  }

  const profileRows = Array.isArray(profiles) ? profiles : [];
  const userIds = profileRows
    .map((row) => row?.user_id)
    .filter((id) => typeof id === "string" && id.length > 0);

  /** @type {Map<string, { email: string | null, role: string | null }>} */
  const userMap = new Map();
  if (userIds.length > 0) {
    const { data: users, error: usersError } = await admin
      .from("users")
      .select("id, email, role")
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
      if (u?.id) userMap.set(u.id, { email: u.email ?? null, role: u.role ?? null });
    }
  }

  const customers = [];
  for (const row of profileRows) {
    if (!row?.id) continue;
    const linked = row.user_id ? userMap.get(row.user_id) : null;
    if (linked?.role && linked.role !== "customer") continue;
    const email = linked?.email ? String(linked.email).trim() : "";
    const name = String(row.display_name ?? "").trim() || displayNameFromEmail(email);
    customers.push({
      id: row.id,
      display_name: name,
      email: email || null,
    });
  }

  const { data: agentsRaw, error: agentsError } = await admin
    .from("users")
    .select("id, email, role")
    .eq("role", "agent")
    .order("email", { ascending: true })
    .limit(LIST_LIMIT);

  if (agentsError) {
    return {
      ok: false,
      reason: "AGENT_LIST_FAILED",
      status: 500,
      error_message: agentsError.message,
    };
  }

  const agents = [];
  for (const row of agentsRaw || []) {
    if (!row?.id || row.role !== "agent") continue;
    const email = row.email ? String(row.email).trim() : "";
    agents.push({
      id: row.id,
      display_name: displayNameFromEmail(email),
      email: email || null,
    });
  }

  return {
    ok: true,
    status: 200,
    customers,
    agents,
  };
}
