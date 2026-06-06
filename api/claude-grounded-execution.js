/**
 * Phase 12-3 — POST /api/claude-grounded-execution (server-side grounded Claude execution).
 * Env: ANTHROPIC_API_KEY, SUPABASE_URL/VITE_SUPABASE_URL, SUPABASE_ANON_KEY/VITE_SUPABASE_ANON_KEY
 */

import {
  handleClaudeGroundedExecutionReadiness,
  handleClaudeGroundedExecutionRequest,
  parseClaudeGroundedExecutionBody,
  readJsonBody,
} from "../server/claudeGroundedExecutionCore.js";

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
    const parsed = parseClaudeGroundedExecutionBody(body);
    if (!parsed) {
      res.statusCode = 400;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ ok: false, reason: "INVALID_BODY" }));
      return;
    }

    const authHeader = req.headers?.authorization ?? req.headers?.Authorization ?? null;
    const result =
      parsed.mode === "readiness"
        ? await handleClaudeGroundedExecutionReadiness({
            claudeExecutionRunId: parsed.claudeExecutionRunId,
            authHeader,
          })
        : await handleClaudeGroundedExecutionRequest({
            claudeExecutionRunId: parsed.claudeExecutionRunId,
            authHeader,
          });

    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify(result));
  } catch {
    res.statusCode = 500;
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        ok: false,
        reason: "SERVER_ERROR",
        error_message: "Claude grounded execution failed on the server.",
      }),
    );
  }
}
