/**
 * GET /api/admin-agent-assignment-options
 * Admin-only customer/agent pick lists for assignment UI.
 */
import {
  createUserSupabaseClient,
  readCustomerAuthHeader,
  requireAdminAuth,
} from "../server/agent/requireAdminAuth.js";
import { loadAdminAgentAssignmentOptions } from "../server/agent/adminAgentAssignmentOptionsCore.js";

/** @param {import('http').IncomingMessage} req @param {import('http').ServerResponse} res */
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

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

  const authHeader = readCustomerAuthHeader(req);
  const userSupabase = createUserSupabaseClient(authHeader);
  const auth = await requireAdminAuth(userSupabase);
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

  const result = await loadAdminAgentAssignmentOptions();
  res.statusCode = result.status ?? (result.ok ? 200 : 500);
  res.setHeader("Content-Type", "application/json");
  res.end(
    JSON.stringify({
      ok: result.ok === true,
      reason: result.reason ?? null,
      error_message: result.error_message ?? null,
      customers: result.ok ? result.customers : [],
      agents: result.ok ? result.agents : [],
    }),
  );
}
