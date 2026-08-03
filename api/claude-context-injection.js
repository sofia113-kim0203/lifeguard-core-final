/**
 * Phase 22D Step 4 — POST /api/claude-context-injection
 * Server-side RAG retrieval + Claude context injection foundation.
 */

import {
  handleClaudeContextInjectionRequest,
  parseClaudeContextInjectionBody,
} from "../server/claudeContextInjectionCore.js";
import { readJsonBody } from "../server/claudeGroundedExecutionCore.js";
import {
  createUserSupabaseClient,
  readCustomerAuthHeader,
  requireAdminAuth,
} from "../server/agent/requireAdminAuth.js";

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

  const authHeader = readCustomerAuthHeader(req);
  const auth = await requireAdminAuth(createUserSupabaseClient(authHeader));
  if (!auth.ok) {
    res.statusCode = auth.reason === "UNAUTHORIZED" ? 401 : 403;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ ok: false, reason: auth.reason }));
    return;
  }

  try {
    const body = req.body && typeof req.body === "object" ? req.body : await readJsonBody(req);
    const parsed = parseClaudeContextInjectionBody(body);
    if (!parsed) {
      res.statusCode = 400;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ ok: false, reason: "INVALID_BODY" }));
      return;
    }

    const result = await handleClaudeContextInjectionRequest({
      question: parsed.question,
      mode: parsed.mode,
      authHeader,
    });

    res.statusCode = result.ok ? 200 : result.reason === "UNAUTHORIZED" ? 401 : 500;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify(result));
  } catch (error) {
    res.statusCode = 500;
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        ok: false,
        reason: "SERVER_ERROR",
        error_message: error instanceof Error ? error.message : "Claude context injection failed.",
      }),
    );
  }
}
