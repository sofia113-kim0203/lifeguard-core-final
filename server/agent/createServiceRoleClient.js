/**
 * Server-only Supabase service_role client (never expose key to browser).
 */
import { createClient } from "@supabase/supabase-js";

export function createServiceRoleClient(env = process.env) {
  const url = String(env.SUPABASE_URL ?? env.VITE_SUPABASE_URL ?? "").trim();
  const serviceRoleKey = String(
    env.SERVICE_ROLE_KEY ?? env.SUPABASE_SERVICE_ROLE_KEY ?? "",
  ).trim();
  if (!url || !serviceRoleKey) return null;
  return createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
