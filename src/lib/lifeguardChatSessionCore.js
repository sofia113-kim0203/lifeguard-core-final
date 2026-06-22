/**
 * P5-STATE — pure session helpers (no Supabase import; safe for node unit tests).
 */
export const LIFEGUARD_HOME_CHAT_PHASE = "lifeguard-home-chat";
export const LIFEGUARD_HOME_CHAT_SOURCE = "lifeguard_home_chat";

export function createLifeguardSessionId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `session-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function activeSessionStorageKey(customerId) {
  return `lifeguard_active_session:${customerId}`;
}

export function isLifeguardHomeChatRow(row) {
  const metadata = row?.metadata ?? row?.metadata_json ?? {};
  const sessionId = metadata.session_id;
  if (!sessionId) return false;
  return (
    metadata.phase === LIFEGUARD_HOME_CHAT_PHASE ||
    metadata.source === LIFEGUARD_HOME_CHAT_SOURCE
  );
}

function previewFromMessage(message) {
  const trimmed = String(message ?? "").trim();
  if (!trimmed) return "새 대화";
  return trimmed.length > 28 ? `${trimmed.slice(0, 28)}…` : trimmed;
}

function rowTimestamp(row) {
  const value = row?.createdAt ?? row?.created_at ?? null;
  const parsed = value ? new Date(value).getTime() : 0;
  return Number.isFinite(parsed) ? parsed : 0;
}

export function buildSessionMetadata(sessionId) {
  return {
    phase: LIFEGUARD_HOME_CHAT_PHASE,
    session_id: sessionId,
    source: LIFEGUARD_HOME_CHAT_SOURCE,
  };
}

/** Group lifeguard rows into recent session summaries for the sidebar. */
export function buildRecentSessionsFromRows(rows, { limit = 12 } = {}) {
  const bySession = new Map();

  for (const row of rows ?? []) {
    if (!isLifeguardHomeChatRow(row)) continue;
    const sessionId = String(row.metadata.session_id);
    if (!sessionId) continue;

    let entry = bySession.get(sessionId);
    if (!entry) {
      entry = {
        id: sessionId,
        preview: "새 대화",
        lastAt: 0,
        firstUserAt: Infinity,
      };
      bySession.set(sessionId, entry);
    }

    const timestamp = rowTimestamp(row);
    if (timestamp > entry.lastAt) entry.lastAt = timestamp;

    if (row.role === "user") {
      const text = String(row.message ?? "").trim();
      if (text && timestamp <= entry.firstUserAt) {
        entry.firstUserAt = timestamp;
        entry.preview = previewFromMessage(text);
      }
    }
  }

  return [...bySession.values()]
    .sort((a, b) => b.lastAt - a.lastAt)
    .slice(0, limit)
    .map(({ id, preview }) => ({ id, preview }));
}

/** Map persisted rows to chat UI messages for one session. */
export function mapSessionRowsToChatMessages(rows, sessionId) {
  return (rows ?? [])
    .filter(
      (row) =>
        isLifeguardHomeChatRow(row) &&
        String(row.metadata.session_id) === String(sessionId) &&
        (row.role === "user" || row.role === "assistant"),
    )
    .sort((a, b) => rowTimestamp(a) - rowTimestamp(b))
    .map((row) => ({
      id: row.id,
      role: row.role,
      content: row.message,
    }));
}
