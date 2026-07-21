/**
 * Triangle v2.2 T2 — In-process TTL store for READY CARD (lookup card, not a truth DB).
 * Keyed by customer_id (+ optional session_id). Serverless: per-instance only.
 */

export const READY_CARD_CACHE_TTL_MS = 120_000;
/** Keep entry past TTL so question turn can reuse as stale while background refresh runs. */
export const READY_CARD_STALE_GRACE_MS = 600_000;

const cache = new Map();

export function readyCardCacheKey(customerId, sessionId = null) {
  const cid = String(customerId ?? "").trim();
  if (!cid) return null;
  const sid = String(sessionId ?? "").trim() || "_";
  return `${cid}:${sid}`;
}

/**
 * @returns {{ card: object, status: "normal"|"stale"|"miss", age_ms: number|null, key: string|null }}
 */
export function readReadyCardCache(customerId, sessionId = null) {
  const key = readyCardCacheKey(customerId, sessionId);
  if (!key) {
    return { card: null, status: "miss", age_ms: null, key: null };
  }
  const entry = cache.get(key);
  if (!entry?.card) {
    // Session-scoped miss → try customer-wide warm (login without session).
    if (String(sessionId ?? "").trim()) {
      return readReadyCardCache(customerId, null);
    }
    return { card: null, status: "miss", age_ms: null, key };
  }
  // Enforce customer_id scope — never return another customer's card.
  const cardCid = String(entry.card.customer_id ?? "").trim();
  const wantCid = String(customerId ?? "").trim();
  if (!cardCid || cardCid !== wantCid) {
    cache.delete(key);
    return { card: null, status: "miss", age_ms: null, key };
  }
  const now = Date.now();
  const age_ms = Math.max(0, now - (Number(entry.preparedAtMs) || now));
  if (entry.expiresAt > now) {
    return { card: entry.card, status: "normal", age_ms, key };
  }
  if (entry.staleUntil > now) {
    return { card: entry.card, status: "stale", age_ms, key };
  }
  cache.delete(key);
  return { card: null, status: "miss", age_ms: null, key };
}

export function writeReadyCardCache(customerId, sessionId, card) {
  const key = readyCardCacheKey(customerId, sessionId);
  if (!key || !card || typeof card !== "object") return false;
  const cid = String(customerId ?? "").trim();
  if (!cid || String(card.customer_id ?? "").trim() !== cid) return false;
  const preparedAtMs = Date.parse(String(card.prepared_at ?? "")) || Date.now();
  cache.set(key, {
    card,
    preparedAtMs,
    expiresAt: Date.now() + READY_CARD_CACHE_TTL_MS,
    staleUntil: Date.now() + READY_CARD_STALE_GRACE_MS,
  });
  return true;
}

/**
 * Drop all cached READY CARD slots for a customer after LIFE THREAD write/status change.
 * Next resolve must re-attach active life_threads from SSOT (handoff overlay included).
 */
export function invalidateReadyCardCacheForCustomer(customerId = null) {
  clearReadyCardCache(customerId, null);
}

export function clearReadyCardCache(customerId = null, sessionId = null) {
  if (!customerId) {
    cache.clear();
    return;
  }
  const cid = String(customerId).trim();
  if (sessionId != null && String(sessionId).trim()) {
    cache.delete(readyCardCacheKey(cid, sessionId));
    return;
  }
  for (const key of [...cache.keys()]) {
    if (key.startsWith(`${cid}:`)) cache.delete(key);
  }
}

/** Test helper — inspect raw size only. */
export function readyCardCacheSizeForTests() {
  return cache.size;
}
