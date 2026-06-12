/**
 * Shared customer JWT auth helpers for /api/* server handlers.
 */

import { createClient } from "@supabase/supabase-js";
import { resolveSupabaseConfig } from "./claudeGroundedExecutionCore.js";

export function readCustomerAuthHeader(req) {
  return req?.headers?.authorization ?? req?.headers?.Authorization ?? null;
}

export function createUserSupabaseClient(authHeader, env = process.env) {
  const { url, anonKey } = resolveSupabaseConfig(env);
  if (!url || !anonKey) return null;

  const token = String(authHeader ?? "").replace(/^Bearer\s+/i, "").trim();
  return createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: token ? { Authorization: `Bearer ${token}` } : {} },
  });
}

export async function requireCustomerAuth(supabase) {
  if (!supabase) {
    return { ok: false, reason: "SUPABASE_NOT_CONFIGURED", error_message: "Supabase is not configured." };
  }

  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError || !authData?.user) {
    return { ok: false, reason: "UNAUTHORIZED", error_message: "Authentication required." };
  }

  const { data: profile, error: profileError } = await supabase
    .from("customer_profiles")
    .select("id")
    .eq("user_id", authData.user.id)
    .maybeSingle();

  if (profileError || !profile?.id) {
    return {
      ok: false,
      reason: "CUSTOMER_PROFILE_NOT_FOUND",
      error_message: "Customer profile not found.",
    };
  }

  return {
    ok: true,
    user: authData.user,
    customerId: profile.id,
  };
}
