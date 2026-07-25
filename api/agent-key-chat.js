/**
 * POST /api/agent-key-chat
 * Agent free KEY — general insurance or gated assigned-customer turns.
 */
import { readJsonBody } from "../server/claudeGroundedExecutionCore.js";
import {
  createUserSupabaseClient,
  readCustomerAuthHeader,
  requireAgentAuth,
} from "../server/agent/requireAgentAuth.js";
import { runAgentFreeKeyTurn } from "../server/agent/agentFreeKeyCore.js";

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
  const userSupabase = createUserSupabaseClient(authHeader);
  const auth = await requireAgentAuth(userSupabase);
  if (!auth.ok) {
    const status = auth.reason === "UNAUTHORIZED" ? 401 : 403;
    res.statusCode = status;
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        ok: false,
        reason: auth.reason,
        error_message: auth.error_message,
      }),
    );
    return;
  }

  let body = {};
  try {
    body = await readJsonBody(req);
  } catch {
    res.statusCode = 400;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ ok: false, reason: "INVALID_JSON" }));
    return;
  }

  if (
    Object.prototype.hasOwnProperty.call(body, "customer_id") ||
    Object.prototype.hasOwnProperty.call(body, "agent_user_id")
  ) {
    res.statusCode = 422;
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        ok: false,
        reason: "CLIENT_IDENTITY_FORBIDDEN",
        error_message: "customer_id and agent_user_id must not be supplied by client.",
      }),
    );
    return;
  }

  const result = await runAgentFreeKeyTurn({
    userSupabase,
    agentUserId: auth.agentUserId,
    question: body.question,
    history: body.history,
    assignmentId: body.assignment_id ?? null,
  });

  res.statusCode = result.status ?? (result.ok ? 200 : 500);
  res.setHeader("Content-Type", "application/json");
  res.end(
    JSON.stringify({
      ok: result.ok === true,
      reason: result.reason ?? null,
      error_message: result.error_message ?? null,
      text: result.ok ? result.text : null,
      mode: result.mode ?? null,
      customer_context_used: result.customer_context_used === true,
      access_reason: result.access_reason ?? null,
    }),
  );
}
