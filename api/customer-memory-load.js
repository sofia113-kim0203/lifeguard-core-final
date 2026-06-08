/**
 * Phase 26 Step 1A — POST /api/customer-memory-load
 * Customer login → rebuild memory foundation → return snapshot.
 */

import { readJsonBody } from "../server/claudeGroundedExecutionCore.js";
import { createClient } from "@supabase/supabase-js";
import { resolveSupabaseConfig } from "../server/policyTermsQaCore.js";

function createUserSupabaseClient(authHeader) {
  const { url, anonKey } = resolveSupabaseConfig();
  if (!url || !anonKey) return null;
  const token = String(authHeader ?? "").replace(/^Bearer\s+/i, "").trim();
  return createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: token ? { Authorization: `Bearer ${token}` } : {} },
  });
}

/** @param {import('http').IncomingMessage} req @param {import('http').ServerResponse} res */
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") {
    res.statusCode = 200;
    res.end();
    return;
  }

  if (req.method !== "POST") {
    res.statusCode = 405;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ ok: false, reason: "METHOD_NOT_ALLOWED" }));
    return;
  }

  try {
    const authHeader = req.headers?.authorization ?? req.headers?.Authorization ?? "";
    const supabase = createUserSupabaseClient(authHeader);
    if (!supabase) {
      res.statusCode = 500;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ ok: false, reason: "SUPABASE_NOT_CONFIGURED" }));
      return;
    }

    const { data: authData, error: authError } = await supabase.auth.getUser();
    if (authError || !authData?.user) {
      res.statusCode = 401;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ ok: false, reason: "UNAUTHORIZED" }));
      return;
    }

    const { data: profile, error: profileError } = await supabase
      .from("customer_profiles")
      .select("id")
      .eq("user_id", authData.user.id)
      .maybeSingle();
    if (profileError || !profile?.id) {
      res.statusCode = 403;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ ok: false, reason: "CUSTOMER_PROFILE_NOT_FOUND" }));
      return;
    }

    const body = req.body && typeof req.body === "object" ? req.body : await readJsonBody(req);
    const rebuild = body?.rebuild !== false;

    const serviceRoleKey = process.env.SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY ?? null;
    const supabaseUrl = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? null;

    const admin = serviceRoleKey && supabaseUrl
      ? createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } })
      : supabase;

    const { loadCustomerMemoryOnLogin } = await import("../server/customerMemoryFoundation.js");
    const result = await loadCustomerMemoryOnLogin({
      supabase: admin,
      supabaseUrl,
      serviceRoleKey,
      customerId: profile.id,
      rebuild: rebuild && Boolean(serviceRoleKey),
    });

    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ ok: true, ...result }));
  } catch (error) {
    res.statusCode = 500;
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        ok: false,
        reason: "SERVER_ERROR",
        error_message: error instanceof Error ? error.message : "Customer memory load failed.",
      }),
    );
  }
}
