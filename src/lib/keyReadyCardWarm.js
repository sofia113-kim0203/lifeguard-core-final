/**
 * Triangle v2.2 T2/T2.1 — READY CARD warm + opaque handoff token (page/session only).
 * Never stores plaintext card. Never localStorage. Never calls Claude.
 */

import { fetchCustomerApi } from "./customerApiAuth.js";

const ROUTE_PATH = "/api/key-ready-card-warm";
const SESSION_KEY = "lg.rc.ht.v1";

/** @type {{ token: string, customerId: string, sessionId: string|null, expiresAt: string|null }|null} */
let memoryHandoff = null;

function scopeKey(customerId, sessionId) {
  return `${String(customerId ?? "").trim()}::${String(sessionId ?? "").trim() || "_"}`;
}

function readSessionHandoff() {
  try {
    if (typeof sessionStorage === "undefined") return null;
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.token || !parsed?.customerId) return null;
    return {
      token: String(parsed.token),
      customerId: String(parsed.customerId),
      sessionId: parsed.sessionId != null ? String(parsed.sessionId) : null,
      expiresAt: parsed.expiresAt != null ? String(parsed.expiresAt) : null,
    };
  } catch {
    return null;
  }
}

function writeSessionHandoff(entry) {
  try {
    if (typeof sessionStorage === "undefined") return;
    if (!entry?.token) {
      sessionStorage.removeItem(SESSION_KEY);
      return;
    }
    sessionStorage.setItem(
      SESSION_KEY,
      JSON.stringify({
        token: entry.token,
        customerId: entry.customerId,
        sessionId: entry.sessionId ?? null,
        expiresAt: entry.expiresAt ?? null,
      }),
    );
  } catch {
    /* ignore quota / private mode */
  }
}

export function clearReadyCardHandoffToken() {
  memoryHandoff = null;
  writeSessionHandoff(null);
}

/**
 * Remember opaque handoff token for current customer/session only.
 * Invalidates on customer or session change.
 */
export function rememberReadyCardHandoffToken({
  token = null,
  customerId = null,
  sessionId = null,
  expiresAt = null,
} = {}) {
  const t = String(token ?? "").trim();
  const cid = String(customerId ?? "").trim();
  if (!t || !cid) {
    clearReadyCardHandoffToken();
    return;
  }
  memoryHandoff = {
    token: t,
    customerId: cid,
    sessionId: sessionId != null ? String(sessionId).trim() || null : null,
    expiresAt: expiresAt != null ? String(expiresAt) : null,
  };
  writeSessionHandoff(memoryHandoff);
}

/** Return token if scope matches and not past expires_at. */
export function getReadyCardHandoffToken({ customerId = null, sessionId = null } = {}) {
  const cid = String(customerId ?? "").trim();
  if (!cid) return null;
  const entry = memoryHandoff?.token ? memoryHandoff : readSessionHandoff();
  if (!entry?.token) return null;
  if (String(entry.customerId) !== cid) {
    clearReadyCardHandoffToken();
    return null;
  }
  const wantSid = String(sessionId ?? "").trim();
  const haveSid = String(entry.sessionId ?? "").trim();
  // Session changed → drop (GO: session change invalidates).
  if (wantSid && haveSid && wantSid !== haveSid) {
    clearReadyCardHandoffToken();
    return null;
  }
  if (entry.expiresAt) {
    const exp = Date.parse(entry.expiresAt);
    if (Number.isFinite(exp) && exp <= Date.now()) {
      clearReadyCardHandoffToken();
      return null;
    }
  }
  memoryHandoff = entry;
  return entry.token;
}

/**
 * @param {{ sessionId?: string|null, customerId?: string|null }} [options]
 */
export async function warmKeyReadyCard({ sessionId = null, customerId = null } = {}) {
  try {
    const { payload } = await fetchCustomerApi(ROUTE_PATH, {
      body: {
        session_id: sessionId ? String(sessionId).trim() : null,
      },
    });
    const token = payload?.ready_card_handoff_token
      ? String(payload.ready_card_handoff_token).trim()
      : "";
    if (
      payload?.ok === true &&
      payload?.materials_connected === true &&
      token &&
      customerId
    ) {
      rememberReadyCardHandoffToken({
        token,
        customerId,
        sessionId,
        expiresAt: payload.ready_card_handoff_expires_at ?? null,
      });
    }
    return {
      ok: payload?.ok === true,
      status: payload?.status ?? "miss",
      prepared_at: payload?.prepared_at ?? null,
      card_version: payload?.card_version ?? null,
      ready_card_build_ms:
        typeof payload?.ready_card_build_ms === "number" ? payload.ready_card_build_ms : null,
      claude_called: payload?.claude_called === true,
      handoff_token_present: Boolean(token),
      handoff_token_bytes:
        typeof payload?.handoff_token_bytes === "number" ? payload.handoff_token_bytes : null,
      handoff_reason: payload?.handoff_reason ?? null,
    };
  } catch {
    return { ok: false, status: "miss", ready_card_build_ms: null, claude_called: false };
  }
}

/** Silent warm — never throw into chat UI. */
export function warmKeyReadyCardFireAndForget({
  sessionId = null,
  customerId = null,
} = {}) {
  void warmKeyReadyCard({ sessionId, customerId }).catch(() => {});
}

export function readyCardHandoffScopeKeyForTests(customerId, sessionId) {
  return scopeKey(customerId, sessionId);
}
