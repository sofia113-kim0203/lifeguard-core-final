/**
 * I-6 — POST /api/customer-document-soft-delete-finalize
 * Customer JWT proves ownership; service_role finishes post-RPC cleanup by document_id.
 * Does not soft-delete (RPC SSOT). Does not re-activate deleted docs/policies.
 */

import { createClient } from "@supabase/supabase-js";
import { readJsonBody } from "../server/claudeGroundedExecutionCore.js";
import { resolveSupabaseConfig } from "../server/policyTermsQaCore.js";
import { finalizeCustomerDocumentSoftDelete } from "../server/documentSoftDeleteFinalize.js";

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
    const userClient = createUserSupabaseClient(authHeader);
    if (!userClient) {
      res.statusCode = 500;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ ok: false, reason: "SUPABASE_NOT_CONFIGURED" }));
      return;
    }

    const { data: authData, error: authError } = await userClient.auth.getUser();
    if (authError || !authData?.user) {
      res.statusCode = 401;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ ok: false, reason: "UNAUTHORIZED" }));
      return;
    }

    const { data: profile, error: profileError } = await userClient
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
    const documentId = String(body?.document_id ?? "").trim();
    if (!documentId) {
      res.statusCode = 400;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ ok: false, reason: "DOCUMENT_ID_REQUIRED" }));
      return;
    }

    const serviceRoleKey =
      process.env.SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY ?? null;
    const supabaseUrl = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? null;
    if (!serviceRoleKey || !supabaseUrl) {
      res.statusCode = 500;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ ok: false, reason: "SERVICE_ROLE_REQUIRED" }));
      return;
    }

    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const result = await finalizeCustomerDocumentSoftDelete({
      admin,
      customerId: profile.id,
      documentId,
    });

    res.statusCode = result.success ? 200 : 409;
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        ok: result.success === true,
        ...result,
      }),
    );
  } catch (err) {
    res.statusCode = 500;
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        ok: false,
        reason: "FINALIZE_EXCEPTION",
        error_message: err instanceof Error ? err.message : String(err),
      }),
    );
  }
}
