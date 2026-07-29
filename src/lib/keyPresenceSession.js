/**
 * Triangle T6 — session-scoped Presence gate (browser only).
 * One Presence attempt per customer+session; never stores LIFE THREAD content.
 */

const SESSION_KEY = "lg.presence.ran.v1";

function scopeKey(customerId, sessionId) {
  return `${String(customerId ?? "").trim()}::${String(sessionId ?? "").trim() || "_"}`;
}

function readMap() {
  try {
    if (typeof sessionStorage === "undefined") return {};
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writeMap(map) {
  try {
    if (typeof sessionStorage === "undefined") return;
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(map ?? {}));
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
