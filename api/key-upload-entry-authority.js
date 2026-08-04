/**
 * Customer upload preflight. This is intentionally before Storage: the server
 * owns KEY_UPLOAD_ENTRY, so off/shadow cannot be bypassed by an absent Vite flag.
 */
import {
  createUserSupabaseClient,
  readCustomerAuthHeader,
  requireCustomerAuth,
} from "../server/requireCustomerAuth.js";
import { getKeyUploadEntryMode, KEY_UPLOAD_ENTRY_MODES } from "../server/keyBrain/uploadEntryFlags.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.statusCode = 405;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ ok: false, reason: "METHOD_NOT_ALLOWED" }));
    return;
  }

  const supabase = createUserSupabaseClient(readCustomerAuthHeader(req));
  const auth = await requireCustomerAuth(supabase);
  if (!auth.ok) {
    res.statusCode = auth.reason === "UNAUTHORIZED" ? 401 : 403;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ ok: false, reason: auth.reason }));
    return;
  }

  const mode = getKeyUploadEntryMode(process.env);
  const active = mode === KEY_UPLOAD_ENTRY_MODES.ACTIVE;
  res.statusCode = active ? 200 : 409;
  res.setHeader("Content-Type", "application/json");
  res.end(
    JSON.stringify({
      ok: active,
      mode,
      reason: active ? null : "key_upload_entry_not_active",
    }),
  );
}
