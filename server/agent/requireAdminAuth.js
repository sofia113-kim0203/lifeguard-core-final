/**
 * Admin JWT gate — admin role only (agent/customer rejected).
 */
import {
  createUserSupabaseClient,
  readCustomerAuthHeader,
} from "../requireCustomerAuth.js";
import { resolveAppUserRole } from "../appRoleGate.js";
import { APP_ROLES } from "../../src/lib/appRouting.js";

export { createUserSupabaseClient, readCustomerAuthHeader };

/**
 * @param {import("@supabase/supabase-js").SupabaseClient | null} userSupabase
 */
export async function requireAdminAuth(userSupabase) {
  const resolved = await resolveAppUserRole(userSupabase);
  if (!resolved.ok) {
    return {
      ok: false,
      reason: resolved.reason ?? "UNAUTHORIZED",
      error_message: "Authentication required.",
    };
  }
  if (resolved.role !== APP_ROLES.ADMIN) {
    return {
      ok: false,
      reason: "FORBIDDEN_ROLE",
      error_message: "Admin role required.",
      role: resolved.role,
    };
  }
  return {
    ok: true,
    user: resolved.user,
    adminUserId: resolved.user.id,
    role: resolved.role,
  };
}
