/**
 * GET/POST /api/key-my-corporate-entities
 * Membership-scoped corporate list for the unified customer view picker.
 * Hint only — never widens Hand authority.
 */
import { readJsonBody } from "../server/claudeGroundedExecutionCore.js";
import {
  createUserSupabaseClient,
  readCustomerAuthHeader,
  requireCustomerAuth,
} from "../server/requireCustomerAuth.js";
import { listMyCorporateEntities } from "../server/entity/listMyCorporateEntities.js";

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

  if (req.method === "POST") {
    try {
      await readJsonBody(req);
    } catch {
      /* empty body ok */
    }
  }

  const authHeader = readCustomerAuthHeader(req);
  const userSupabase = createUserSupabaseClient(authHeader);
  const auth = await requireCustomerAuth(userSupabase);
  if (!auth.ok) {
    res.statusCode = auth.reason === "UNAUTHORIZED" ? 401 : 403;
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        ok: false,
        reason: auth.reason,
        error_message: auth.error_message,
        entities: [],
      }),
    );
    return;
  }

  const listed = await listMyCorporateEntities(userSupabase, {
    authUserId: auth.user?.id ?? auth.authUserId ?? null,
  });

  res.statusCode = listed.ok ? 200 : 500;
  res.setHeader("Content-Type", "application/json");
  res.end(
    JSON.stringify({
      ok: listed.ok === true,
      reason: listed.reason ?? null,
      entities: Array.isArray(listed.entities) ? listed.entities : [],
      list_status: listed.list_status ?? null,
      note: "membership_list_hint_server_reauthorizes_every_turn",
    }),
  );
}
