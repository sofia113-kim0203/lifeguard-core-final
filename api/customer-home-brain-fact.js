/**
 * P2-A — POST /api/customer-home-brain-fact
 * JWT/RLS read-only home brain fact answers. No service-role, no writes, no LLM.
 */

import { readJsonBody } from "../server/claudeGroundedExecutionCore.js";
import {
  createUserSupabaseClient,
  readCustomerAuthHeader,
  requireCustomerAuth,
} from "../server/requireCustomerAuth.js";
import { handleHomeBrainFactRequest } from "../server/homeBrainFactCore.js";

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
    const body = req.body && typeof req.body === "object" ? req.body : await readJsonBody(req);
    const question = String(body?.question ?? "").trim();

    const authHeader = readCustomerAuthHeader(req);
    const userSupabase = createUserSupabaseClient(authHeader);
    const resolved = await requireCustomerAuth(userSupabase);

    if (!resolved.ok && resolved.reason === "SUPABASE_NOT_CONFIGURED") {
      res.statusCode = 500;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify(resolved));
      return;
    }
    if (!resolved.ok) {
      res.statusCode = resolved.reason === "UNAUTHORIZED" ? 401 : 403;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify(resolved));
      return;
    }

    const result = await handleHomeBrainFactRequest({
      userSupabase,
      customerId: resolved.customerId,
      question,
    });

    if (!result.ok) {
      res.statusCode = result.reason === "INVALID_BODY" ? 400 : 500;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify(result));
      return;
    }

    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify(result));
  } catch (error) {
    res.statusCode = 500;
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        ok: false,
        reason: "SERVER_ERROR",
        error_message: error instanceof Error ? error.message : "Home brain fact lookup failed.",
      }),
    );
  }
}
