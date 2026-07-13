/**
 * Slice 2 — GET/POST /api/customer-corporate-entities
 * Read-only list of corporate entities the logged-in user can access via membership.
 * Does not trust client role, authorization_verified, or other-user filters.
 */

import { createClient } from "@supabase/supabase-js";
import { resolveSupabaseConfig } from "../server/policyTermsQaCore.js";
import {
  CORPORATE_LIST_FAILED_CUSTOMER_TEXT,
  listMyCorporateEntities,
} from "../server/entity/listMyCorporateEntities.js";

function createUserSupabaseClient(authHeader) {
  const { url, anonKey } = resolveSupabaseConfig();
  if (!url || !anonKey) return null;
  const token = String(authHeader ?? "")
    .replace(/^Bearer\s+/i, "")
    .trim();
  return createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: token ? { Authorization: `Bearer ${token}` } : {} },
  });
}

function sendJson(res, status, payload) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(payload));
}

/** @param {import('http').IncomingMessage} req @param {import('http').ServerResponse} res */
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") {
    res.statusCode = 200;
    res.end();
    return;
  }

  if (req.method !== "GET" && req.method !== "POST") {
    sendJson(res, 405, { ok: false, reason: "METHOD_NOT_ALLOWED" });
    return;
  }

  try {
    const authHeader = req.headers?.authorization ?? req.headers?.Authorization ?? "";
    const supabase = createUserSupabaseClient(authHeader);
    if (!supabase) {
      sendJson(res, 500, {
        ok: false,
        reason: "SUPABASE_NOT_CONFIGURED",
        customer_message: CORPORATE_LIST_FAILED_CUSTOMER_TEXT,
        entities: [],
      });
      return;
    }

    const { data: authData, error: authError } = await supabase.auth.getUser();
    if (authError || !authData?.user?.id) {
      sendJson(res, 401, { ok: false, reason: "UNAUTHORIZED", entities: [] });
      return;
    }

    // Ignore any client-supplied user_id / role / authorization hints entirely.
    const listed = await listMyCorporateEntities(supabase, {
      authUserId: authData.user.id,
    });

    if (!listed.ok) {
      sendJson(res, 200, {
        ok: false,
        reason: listed.reason ?? "LIST_FAILED",
        customer_message: listed.customer_message ?? CORPORATE_LIST_FAILED_CUSTOMER_TEXT,
        entities: [],
        list_status: "error",
      });
      return;
    }

    sendJson(res, 200, {
      ok: true,
      entities: listed.entities,
      list_status: listed.list_status ?? (listed.entities.length > 0 ? "ok" : "empty"),
    });
  } catch (error) {
    sendJson(res, 500, {
      ok: false,
      reason: "SERVER_ERROR",
      customer_message: CORPORATE_LIST_FAILED_CUSTOMER_TEXT,
      entities: [],
      list_status: "error",
      error_message: error instanceof Error ? error.message : "Corporate entity list failed.",
    });
  }
}
