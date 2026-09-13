/**
 * Preview-only Hand proof: contract identity → SHA → PDF open.
 * Production returns 404. No customer DB write. No PDF text.
 */
import { readJsonBody } from "../server/claudeGroundedExecutionCore.js";
import {
  createUserSupabaseClient,
  readCustomerAuthHeader,
  requireCustomerAuth,
} from "../server/requireCustomerAuth.js";
import { proveOfficialOriginalOpen } from "../server/keyCore/keyOfficialEvidenceAdapter.js";

function send(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(body));
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, x-vercel-protection-bypass");

  if (req.method === "OPTIONS") {
    res.statusCode = 200;
    res.end();
    return;
  }
  if (process.env.VERCEL_ENV === "production") {
    send(res, 404, { ok: false, reason: "NOT_FOUND" });
    return;
  }
  if (req.method !== "POST") {
    send(res, 405, { ok: false, reason: "METHOD_NOT_ALLOWED" });
    return;
  }

  const auth = await requireCustomerAuth(createUserSupabaseClient(readCustomerAuthHeader(req)));
  if (!auth.ok) {
    send(res, auth.reason === "UNAUTHORIZED" ? 401 : 403, { ok: false, reason: auth.reason });
    return;
  }

  try {
    const body = req.body && typeof req.body === "object" ? req.body : await readJsonBody(req);
    const result = await proveOfficialOriginalOpen({
      insurer: body?.insurer,
      product_name: body?.product_name,
      date: body?.date || "",
      product_code: body?.product_code || "",
      document_kind: body?.document_kind || "",
      official_distinguisher: body?.official_distinguisher || "",
    });
    send(res, 200, result);
  } catch {
    send(res, 500, { ok: false, reason: "SERVER_ERROR" });
  }
}
