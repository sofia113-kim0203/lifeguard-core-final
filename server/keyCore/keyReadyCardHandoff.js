/**
 * Triangle v2.2 T2.1 — opaque READY CARD handoff token (AES-256-GCM).
 * Sealed with existing server-only SERVICE_ROLE_KEY. No new env invented.
 * Client receives opaque string only — never plaintext card JSON.
 */

import { createHash, createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/** Keep in sync with keyReadyCardBuild.READY_CARD_VERSION (no circular import). */
export const READY_CARD_HANDOFF_CARD_VERSION = "triangle-ready-card-v2.2";
export const READY_CARD_HANDOFF_TTL_MS = 180_000;
export const READY_CARD_HANDOFF_TOKEN_PREFIX = "rch1.";

/** @returns {{ ok: true, secret: string, source: string } | { ok: false, reason: string }} */
export function resolveReadyCardHandoffSecret(env = process.env) {
  const serviceRole = String(
    env.SERVICE_ROLE_KEY ?? env.SUPABASE_SERVICE_ROLE_KEY ?? "",
  ).trim();
  if (serviceRole.length >= 32) {
    return { ok: true, secret: serviceRole, source: "SERVICE_ROLE_KEY" };
  }
  return { ok: false, reason: "READY_CARD_HANDOFF_SECRET_REQUIRED" };
}

function deriveAesKey(secret) {
  return createHash("sha256")
    .update(`lg-ready-card-handoff-v1|${secret}`, "utf8")
    .digest();
}

function b64url(buf) {
  return Buffer.from(buf)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function fromB64url(text) {
  const s = String(text ?? "").replace(/-/g, "+").replace(/_/g, "/");
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  return Buffer.from(s + pad, "base64");
}

/** Minimal materials for Claude-first reuse — still encrypted inside token. */
export function buildHandoffCardPayload(card = null, { authUserId = null } = {}) {
  if (!card || typeof card !== "object") return null;
  if (card.materials_connected !== true) return null;
  if (card.status === "miss") return null;
  const cid = String(card.customer_id ?? "").trim();
  if (!cid) return null;
  const prepared_at = String(card.prepared_at ?? "").trim() || new Date().toISOString();
  const preparedMs = Date.parse(prepared_at) || Date.now();
  const expires_at = new Date(preparedMs + READY_CARD_HANDOFF_TTL_MS).toISOString();
  return {
    v: 1,
    customer_id: cid,
    auth_user_id: authUserId ? String(authUserId).trim() : null,
    session_id: card.session_id != null ? String(card.session_id).trim() || null : null,
    card_version: String(card.card_version ?? READY_CARD_HANDOFF_CARD_VERSION),
    prepared_at,
    expires_at,
    materials_connected: true,
    status: card.status === "stale" ? "stale" : "normal",
    // Encrypted only — never returned plaintext to client.
    card: {
      card_version: card.card_version ?? READY_CARD_HANDOFF_CARD_VERSION,
      prepared_at,
      status: card.status === "stale" ? "stale" : "normal",
      materials_connected: true,
      freshness: card.freshness ?? null,
      profile_brief: card.profile_brief ?? null,
      insurance_card: card.insurance_card ?? null,
      active_goal: card.active_goal ?? null,
      important_history: card.important_history ?? null,
      document_status: card.document_status ?? null,
      // T8.1 — explicit allowlist; do not drop insurer_source when present on card.
      insurer_source:
        card.insurer_source && typeof card.insurer_source === "object"
          ? {
              status: String(card.insurer_source.status ?? "unconnected").trim() || "unconnected",
              as_of:
                card.insurer_source.as_of != null && String(card.insurer_source.as_of).trim()
                  ? String(card.insurer_source.as_of).trim()
                  : null,
              note:
                typeof card.insurer_source.note === "string" && card.insurer_source.note.trim()
                  ? card.insurer_source.note.trim().slice(0, 400)
                  : "원수사 공식 데이터가 연결되지 않았습니다.",
            }
          : {
              status: "unconnected",
              as_of: null,
              note: "원수사 공식 데이터가 연결되지 않았습니다.",
            },
      corporate: card.corporate ?? null,
      unknowns: Array.isArray(card.unknowns) ? card.unknowns.slice(0, 24) : [],
      customer_id: cid,
      session_id: card.session_id ?? null,
      build_ms: typeof card.build_ms === "number" ? card.build_ms : null,
      built_from_memory_version:
        card.built_from_memory_version == null
          ? 0
          : Number(card.built_from_memory_version) || 0,
      recent_document_memory:
        card.recent_document_memory && typeof card.recent_document_memory === "object"
          ? card.recent_document_memory
          : null,
    },
    built_from_memory_version:
      card.built_from_memory_version == null
        ? 0
        : Number(card.built_from_memory_version) || 0,
  };
}

/**
 * @returns {{ ok: true, token: string, expires_at: string, token_bytes: number }
 *   | { ok: false, reason: string }}
 */
export function sealReadyCardHandoff(card, { authUserId = null, env = process.env } = {}) {
  const secretRes = resolveReadyCardHandoffSecret(env);
  if (!secretRes.ok) {
    return { ok: false, reason: secretRes.reason };
  }
  const payload = buildHandoffCardPayload(card, { authUserId });
  if (!payload) {
    return { ok: false, reason: "handoff_empty_or_unconnected" };
  }
  try {
    const key = deriveAesKey(secretRes.secret);
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    const plain = Buffer.from(JSON.stringify(payload), "utf8");
    const enc = Buffer.concat([cipher.update(plain), cipher.final()]);
    const tag = cipher.getAuthTag();
    const token = `${READY_CARD_HANDOFF_TOKEN_PREFIX}${b64url(
      Buffer.concat([iv, tag, enc]),
    )}`;
    return {
      ok: true,
      token,
      expires_at: payload.expires_at,
      token_bytes: Buffer.byteLength(token, "utf8"),
      prepared_at: payload.prepared_at,
      card_version: payload.card_version,
    };
  } catch {
    return { ok: false, reason: "handoff_seal_failed" };
  }
}

/**
 * Validate + open. Never trust client JSON — only sealed token.
 * @returns {{ ok: true, card: object, meta: object, validation_ms: number }
 *   | { ok: false, reason: string, validation_ms: number }}
 */
export function openReadyCardHandoff(token, {
  customerId = null,
  authUserId = null,
  sessionId = null,
  env = process.env,
  now = Date.now(),
} = {}) {
  const started = Date.now();
  const validation_ms = () => Math.max(0, Date.now() - started);
  const raw = String(token ?? "").trim();
  if (!raw) {
    return { ok: false, reason: "handoff_missing", validation_ms: validation_ms() };
  }
  if (!raw.startsWith(READY_CARD_HANDOFF_TOKEN_PREFIX)) {
    return { ok: false, reason: "handoff_prefix_invalid", validation_ms: validation_ms() };
  }

  const secretRes = resolveReadyCardHandoffSecret(env);
  if (!secretRes.ok) {
    return { ok: false, reason: secretRes.reason, validation_ms: validation_ms() };
  }

  let payload = null;
  try {
    const packed = fromB64url(raw.slice(READY_CARD_HANDOFF_TOKEN_PREFIX.length));
    if (packed.length < 12 + 16 + 1) {
      return { ok: false, reason: "handoff_tampered", validation_ms: validation_ms() };
    }
    const iv = packed.subarray(0, 12);
    const tag = packed.subarray(12, 28);
    const enc = packed.subarray(28);
    const key = deriveAesKey(secretRes.secret);
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(tag);
    const plain = Buffer.concat([decipher.update(enc), decipher.final()]);
    payload = JSON.parse(plain.toString("utf8"));
  } catch {
    return { ok: false, reason: "handoff_tampered", validation_ms: validation_ms() };
  }

  if (!payload || typeof payload !== "object" || payload.v !== 1) {
    return { ok: false, reason: "handoff_payload_invalid", validation_ms: validation_ms() };
  }

  const wantCid = String(customerId ?? "").trim();
  const tokenCid = String(payload.customer_id ?? "").trim();
  if (!wantCid || !tokenCid || wantCid !== tokenCid) {
    return { ok: false, reason: "handoff_customer_mismatch", validation_ms: validation_ms() };
  }

  const wantAuth = String(authUserId ?? "").trim();
  const tokenAuth = String(payload.auth_user_id ?? "").trim();
  if (wantAuth && tokenAuth && wantAuth !== tokenAuth) {
    return { ok: false, reason: "handoff_auth_user_mismatch", validation_ms: validation_ms() };
  }

  const expiresMs = Date.parse(String(payload.expires_at ?? ""));
  if (!Number.isFinite(expiresMs) || expiresMs <= now) {
    return { ok: false, reason: "handoff_expired", validation_ms: validation_ms() };
  }

  if (payload.materials_connected !== true) {
    return { ok: false, reason: "handoff_unconnected", validation_ms: validation_ms() };
  }

  const status = String(payload.status ?? "").trim();
  if (status !== "normal" && status !== "stale") {
    return { ok: false, reason: "handoff_status_blocked", validation_ms: validation_ms() };
  }

  if (String(payload.card_version ?? "") !== READY_CARD_HANDOFF_CARD_VERSION) {
    return { ok: false, reason: "handoff_card_version_mismatch", validation_ms: validation_ms() };
  }

  const card = payload.card && typeof payload.card === "object" ? payload.card : null;
  if (!card || card.materials_connected !== true) {
    return { ok: false, reason: "handoff_empty_card", validation_ms: validation_ms() };
  }
  if (String(card.customer_id ?? "").trim() !== wantCid) {
    return { ok: false, reason: "handoff_card_customer_mismatch", validation_ms: validation_ms() };
  }

  // Session scope: if both sides set, must match (login-wide token has null session).
  const wantSid = String(sessionId ?? "").trim();
  const tokenSid = String(payload.session_id ?? "").trim();
  if (wantSid && tokenSid && wantSid !== tokenSid) {
    return { ok: false, reason: "handoff_session_mismatch", validation_ms: validation_ms() };
  }

  const builtFromMemoryVersion =
    payload.built_from_memory_version == null && card.built_from_memory_version == null
      ? 0
      : Number(payload.built_from_memory_version ?? card.built_from_memory_version) || 0;

  return {
    ok: true,
    card: {
      ...card,
      customer_id: wantCid,
      status,
      materials_connected: true,
      prepared_at: payload.prepared_at,
      build_ms: 0,
      built_from_memory_version: builtFromMemoryVersion,
    },
    meta: {
      source: "login_handoff",
      prepared_at: payload.prepared_at,
      expires_at: payload.expires_at,
      status,
      card_version: payload.card_version,
      built_from_memory_version: builtFromMemoryVersion,
    },
    validation_ms: validation_ms(),
  };
}
