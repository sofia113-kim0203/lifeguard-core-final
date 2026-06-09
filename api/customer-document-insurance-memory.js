/**
 * POST /api/customer-document-insurance-memory
 * Uploaded insurance document → OCR → structured extract → profile_insurance_policies → memory rebuild
 */

import { readJsonBody } from "../server/claudeGroundedExecutionCore.js";
import { createClient } from "@supabase/supabase-js";

function resolveServiceRoleKey() {
  return (
    process.env.SERVICE_ROLE_KEY?.trim() ||
    process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ||
    null
  );
}

function resolveSupabaseUrl() {
  return process.env.SUPABASE_URL?.trim() || process.env.VITE_SUPABASE_URL?.trim() || null;
}

function createUserSupabaseClient(authHeader) {
  const url = resolveSupabaseUrl();
  const anonKey =
    process.env.SUPABASE_ANON_KEY?.trim() || process.env.VITE_SUPABASE_ANON_KEY?.trim() || null;
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

  const serviceRoleKey = resolveServiceRoleKey();
  const supabaseUrl = resolveSupabaseUrl();
  if (!serviceRoleKey || !supabaseUrl) {
    res.statusCode = 500;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ ok: false, reason: "WORKER_NOT_CONFIGURED" }));
    return;
  }

  try {
    const authHeader = req.headers?.authorization ?? req.headers?.Authorization ?? "";
    const token = String(authHeader).replace(/^Bearer\s+/i, "").trim();
    const isServiceRole = token && token === serviceRoleKey;

    const body = req.body && typeof req.body === "object" ? req.body : await readJsonBody(req);
    const documentId = String(body?.document_id ?? body?.documentId ?? "").trim() || null;
    const customerIdInput = String(body?.customer_id ?? body?.customerId ?? "").trim() || null;
    const processAll = body?.process_all === true || body?.processAll === true;

    const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });

    let customerId = customerIdInput;
    let customerAccessToken = null;
    let anonKey =
      process.env.SUPABASE_ANON_KEY?.trim() || process.env.VITE_SUPABASE_ANON_KEY?.trim() || null;

    if (!isServiceRole) {
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

      customerId = profile.id;
      customerAccessToken = token;
    }

    const {
      processCustomerDocumentToInsuranceMemory,
      runCustomerInsuranceMemoryPipeline,
    } = await import("../server/customerDocumentToInsuranceMemoryPipeline.js");

    let result;
    if (processAll && customerId) {
      result = await runCustomerInsuranceMemoryPipeline({
        supabase: admin,
        supabaseUrl,
        serviceRoleKey,
        customerId,
        documentIds: body?.document_ids ?? body?.documentIds ?? null,
      });
    } else if (documentId) {
      result = await processCustomerDocumentToInsuranceMemory({
        supabase: admin,
        supabaseUrl,
        serviceRoleKey,
        documentId,
        customerAccessToken,
        anonKey,
      });
      if (!customerId) customerId = result.customer_id;
    } else {
      res.statusCode = 400;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ ok: false, reason: "DOCUMENT_ID_OR_PROCESS_ALL_REQUIRED" }));
      return;
    }

    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ ok: true, customer_id: customerId, ...result }));
  } catch (error) {
    res.statusCode = 500;
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        ok: false,
        reason: "SERVER_ERROR",
        error_message: error instanceof Error ? error.message : "Insurance memory pipeline failed.",
      }),
    );
  }
}
