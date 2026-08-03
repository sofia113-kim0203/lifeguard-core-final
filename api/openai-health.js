/**
 * GET /api/openai-health
 * Direct OpenAI Embeddings API smoke test (no business logic).
 */

import { handleOpenAiHealthCheck } from "../server/openaiHealthCore.js";
import {
  createUserSupabaseClient,
  readCustomerAuthHeader,
  requireAdminAuth,
} from "../server/agent/requireAdminAuth.js";

async function isHealthAuthorized(req) {
  const authHeader = readCustomerAuthHeader(req);
  const bearer = String(authHeader ?? "").replace(/^Bearer\s+/i, "").trim();
  const cronSecret = String(process.env.CRON_SECRET ?? "").trim();
  const serviceRoleKey = String(process.env.SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY ?? "").trim();
  if ((cronSecret && bearer === cronSecret) || (serviceRoleKey && bearer === serviceRoleKey)) return true;
  return (await requireAdminAuth(createUserSupabaseClient(authHeader))).ok === true;
}

/** @param {import('http').IncomingMessage} req @param {import('http').ServerResponse} res */
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.statusCode = 200;
    res.end();
    return;
  }

  if (req.method !== "GET") {
    res.statusCode = 405;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ ok: false, reason: "METHOD_NOT_ALLOWED" }));
    return;
  }

  if (!(await isHealthAuthorized(req))) {
    res.statusCode = 401;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ ok: false, reason: "UNAUTHORIZED" }));
    return;
  }

  try {
    const result = await handleOpenAiHealthCheck();
    res.statusCode = result.status ?? (result.ok ? 200 : 500);
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify(result));
  } catch (error) {
    res.statusCode = 500;
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        ok: false,
        status: 500,
        reason: "SERVER_ERROR",
        error_type: "server_error",
        error_body_preview:
          error instanceof Error ? String(error.message).slice(0, 300) : "openai_health_failed",
      }),
    );
  }
}
