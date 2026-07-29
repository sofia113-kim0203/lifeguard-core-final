/**
 * POST /api/admin-agent-assignment
 * Admin-only agent assignment engine (pending / activate / close).
 */
import { readJsonBody } from "../server/claudeGroundedExecutionCore.js";
import {
  createUserSupabaseClient,
  readCustomerAuthHeader,
  requireAdminAuth,
} from "../server/agent/requireAdminAuth.js";
import { runAdminAgentAssignmentAction } from "../server/agent/adminAgentAssignmentCore.js";

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

  let body = {};
  try {
    body = await readJsonBody(req);
  } catch {
    res.statusCode = 400;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ ok: false, reason: "INVALID_JSON" }));
    return;
  }

  const result = await runAdminAgentAssignmentAction({ body });
  res.statusCode = result.status ?? (result.ok ? 200 : 500);
  res.setHeader("Content-Type", "application/json");
  res.end(
    JSON.stringify({
      ok: result.ok === true,
      reason: result.reason ?? null,
      error_message: result.error_message ?? null,
      field: result.field ?? null,
      assignment: result.assignment ?? null,
      binding_id: result.binding_id ?? null,
      binding_created: result.binding_created ?? null,
      binding_skipped_no_consent: result.binding_skipped_no_consent ?? null,
      binding_revoked_count: result.binding_revoked_count ?? null,
    }),
  );
}
