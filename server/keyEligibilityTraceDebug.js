/**
 * P11-2F — KEY eligibility trace fingerprints (no heavy imports).
 */
import crypto from "node:crypto";

export function profileIdLast4(profileId = null) {
  const id = profileId == null ? null : String(profileId);
  if (!id) return null;
  return id.length >= 4 ? id.slice(-4) : id;
}

export function profileIdSha256_12(profileId = null) {
  const id = profileId == null ? null : String(profileId);
  if (!id) return null;
  return crypto.createHash("sha256").update(id, "utf8").digest("hex").slice(0, 12);
}

/** Raw profile ids in trace — local/test only, never Preview/Production. */
export function isKeyTraceRawProfileIdsAllowed(env = process.env) {
  if (String(env.KEY_TRACE_DEBUG_PROFILE_IDS ?? "").trim() !== "1") return false;
  const vercelEnv = String(env.VERCEL_ENV ?? "").trim().toLowerCase();
  return vercelEnv !== "production" && vercelEnv !== "preview";
}

export function buildKeyEligibilityDebug({
  customerId = null,
  allowlistProfileIds = null,
  match = null,
  env = process.env,
} = {}) {
  const debug = {
    runtime_profile_id_last4: profileIdLast4(customerId),
    allowlist_entry_last4: allowlistProfileIds
      ? allowlistProfileIds.map((id) => profileIdLast4(id))
      : null,
    match,
  };

  if (isKeyTraceRawProfileIdsAllowed(env)) {
    debug.runtime_profile_id_sha256_12 = profileIdSha256_12(customerId);
    debug.allowlist_entry_sha256_12 = allowlistProfileIds
      ? allowlistProfileIds.map((id) => profileIdSha256_12(id))
      : null;
    debug.runtime_profile_id = customerId == null ? null : String(customerId);
    debug.allowlist_entry_ids = allowlistProfileIds ?? null;
  }

  return debug;
}
