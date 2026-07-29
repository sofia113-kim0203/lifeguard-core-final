/**
 * GET/POST /api/agent-key-briefing
 * Agent-only KEY briefing list + create (C2-B).
 */
import { readJsonBody } from "../server/claudeGroundedExecutionCore.js";
import {
  createUserSupabaseClient,
  readCustomerAuthHeader,
  requireAgentAuth,
} from "../server/agent/requireAgentAuth.js";
import {
  createAgentKeyBriefing,
  listAgentKeyBriefingAssignments,
} from "../server/agent/agentKeyBriefingCore.js";

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

  if (req.method === "GET") {
    const listed = await listAgentKeyBriefingAssignments({
      userSupabase,
      agentUserId: auth.agentUserId,
    });
    res.statusCode = listed.status ?? (listed.ok ? 200 : 500);
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        ok: listed.ok === true,
        reason: listed.reason ?? null,
        error_message: listed.error_message ?? null,
        items: Array.isArray(listed.items) ? listed.items : [],
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

  const created = await createAgentKeyBriefing({
    userSupabase,
    agentUserId: auth.agentUserId,
    assignmentId: body.assignment_id,
    purpose: body.purpose,
    question: body.question,
  });

  res.statusCode = created.status ?? (created.ok ? 200 : 500);
  res.setHeader("Content-Type", "application/json");
  res.end(
    JSON.stringify({
      ok: created.ok === true,
      reason: created.reason ?? null,
      error_message: created.error_message ?? null,
      briefing: created.briefing ?? null,
    }),
  );
}
