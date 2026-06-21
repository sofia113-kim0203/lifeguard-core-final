/**
 * P3.5 — Server-side app role resolution + path gate.
 */
import {
  canAccessPath,
  getRedirectPathForRole,
  normalizeAppPath,
} from "../src/lib/appRouting.js";

export { canAccessPath, getRedirectPathForRole, normalizeAppPath };

export async function resolveAppUserRole(userSupabase) {
  if (!userSupabase) {
    return { ok: false, reason: "UNAUTHORIZED" };
  }
  const { data: authData, error: authError } = await userSupabase.auth.getUser();
  if (authError || !authData?.user?.id) {
    return { ok: false, reason: "UNAUTHORIZED" };
  }
  const { data: row, error: roleError } = await userSupabase
    .from("users")
    .select("role")
    .eq("id", authData.user.id)
    .maybeSingle();
  if (roleError) {
    return { ok: false, reason: "ROLE_LOOKUP_FAILED" };
  }
  return {
    ok: true,
    user: authData.user,
    role: row?.role ?? "customer",
  };
}

export async function evaluateAppRouteGate({ userSupabase, pathname = "/" } = {}) {
  const resolved = await resolveAppUserRole(userSupabase);
  if (!resolved.ok) {
    return { ok: false, reason: resolved.reason, allowed: false, redirect: "/" };
  }
  const path = normalizeAppPath(pathname);
  const allowed = canAccessPath(path, resolved.role);
  return {
    ok: true,
    role: resolved.role,
    path,
    allowed,
    redirect: allowed ? path : getRedirectPathForRole(path, resolved.role),
  };
}
