/**
 * Presence opening gate — one attempt per (customerId, sessionId).
 * Flag only. Never stores LIFE THREAD / greeting content.
 */

const SESSION_KEY = "lg.presence.attempted.v1";

function scopeKey(customerId, sessionId) {
  return `${String(customerId ?? "").trim()}::${String(sessionId ?? "").trim() || "_"}`;
}

const memoryStore = {};

function storage() {
  if (typeof localStorage !== "undefined") return localStorage;
  if (typeof sessionStorage !== "undefined") return sessionStorage;
  return {
    getItem(key) {
      return Object.prototype.hasOwnProperty.call(memoryStore, key)
        ? memoryStore[key]
        : null;
    },
    setItem(key, value) {
      memoryStore[key] = String(value);
    },
  };
}

function readMap() {
  try {
    const store = storage();
    if (!store) return {};
    const raw = store.getItem(SESSION_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writeMap(map) {
  try {
    const store = storage();
    if (!store) return;
    store.setItem(SESSION_KEY, JSON.stringify(map ?? {}));
  } catch {
    /* ignore */
  }
}

export function hasPresenceRanThisSession(customerId = null, sessionId = null) {
  const key = scopeKey(customerId, sessionId);
  if (!String(customerId ?? "").trim()) return true;
  const map = readMap();
  return map[key] === true;
}

export function markPresenceRanThisSession(customerId = null, sessionId = null) {
  const cid = String(customerId ?? "").trim();
  if (!cid) return;
  const key = scopeKey(cid, sessionId);
  const map = readMap();
  map[key] = true;
  writeMap(map);
}

export function clearPresenceRanForSession(customerId = null, sessionId = null) {
  const key = scopeKey(customerId, sessionId);
  const map = readMap();
  if (map[key] == null) return;
  delete map[key];
  writeMap(map);
}

/** Sync claim before the Claude call. Second caller loses. */
export function beginPresenceOpeningAttempt(customerId = null, sessionId = null) {
  if (!String(customerId ?? "").trim()) return false;
  if (hasPresenceRanThisSession(customerId, sessionId)) return false;
  markPresenceRanThisSession(customerId, sessionId);
  return true;
}

/** Old thread or already-spoken seat — do not open. */
export function threadBlocksPresenceOpening(messages = []) {
  const rows = Array.isArray(messages) ? messages : [];
  return rows.some((m) => {
    const role = String(m?.role ?? "");
    const text = String(m?.content ?? "").trim();
    if (!text) return false;
    if (role === "user") return true;
    if (role === "assistant" && m?.thinking !== true) return true;
    return false;
  });
}

export function shouldDiscardPresenceOpeningResult({
  aborted = false,
  customerWon = false,
} = {}) {
  return aborted === true || customerWon === true;
}
