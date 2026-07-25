/**
 * POST /api/admin-key-assignment-chat
 * Admin KEY assignment Hand — understand + confirm card only (no assignment POST).
 */
import { readJsonBody } from "../server/claudeGroundedExecutionCore.js";
import {
  createUserSupabaseClient,
  readCustomerAuthHeader,
  requireAdminAuth,
} from "../server/agent/requireAdminAuth.js";
import { runAdminKeyAssignmentChatTurn } from "../server/keyCore/adminKeyAssignmentHand.js";

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

  const question = String(body?.question ?? "").trim();
  const history = Array.isArray(body?.history) ? body.history : [];
  const result = await runAdminKeyAssignmentChatTurn({ question, history });

  res.statusCode = result.status ?? (result.ok ? 200 : 500);
  res.setHeader("Content-Type", "application/json");
  // Preserve Hand validation reason/text (do not drop identity unresolved/ambiguous).
  res.end(
    JSON.stringify({
      ok: result.ok === true,
      reason: result.reason ?? null,
      text: result.text ?? null,
      card: result.card ?? null,
      // ids stay for client internal card state; UI must not print raw UUID labels
      assignments: Array.isArray(result.assignments)
        ? result.assignments.map((row) => ({
            id: row.id,
            status: row.status,
            customer: {
              id: row.customer?.id,
              display_name: row.customer?.display_name,
              email: row.customer?.email,
            },
            agent: {
              id: row.agent?.id,
              display_name: row.agent?.display_name,
              email: row.agent?.email,
            },
          }))
        : [],
    }),
  );
}
