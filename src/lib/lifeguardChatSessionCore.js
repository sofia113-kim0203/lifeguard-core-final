/**
 * P5-STATE / P5-CONTINUITY-01 Phase A — pure session helpers (no Supabase import).
 */
export const LIFEGUARD_HOME_CHAT_PHASE = "lifeguard-home-chat";
export const LIFEGUARD_HOME_CHAT_SOURCE = "lifeguard_home_chat";

export function createLifeguardSessionId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `session-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/** localStorage key for active lifeguard session pointer (cross-tab Day 3 restore). */
export function activeSessionStorageKey(customerId) {
  return `lifeguard_active_session:${customerId}`;
}

export function readActiveSessionId(customerId) {
  if (typeof window === "undefined" || !customerId) return null;
  try {
    return window.localStorage.getItem(activeSessionStorageKey(customerId));
  } catch {
    return null;
  }
}

export function writeActiveSessionId(customerId, sessionId) {
  if (typeof window === "undefined" || !customerId || !sessionId) return;
  try {
    window.localStorage.setItem(activeSessionStorageKey(customerId), sessionId);
  } catch {
    // ignore quota / privacy errors
  }
}

export function resolveActiveLifeguardSessionId({ recentSessions = [], storedId = null } = {}) {
  const ids = new Set((recentSessions ?? []).map((entry) => String(entry.id)));
  if (storedId && ids.has(String(storedId))) return String(storedId);
  if (recentSessions.length > 0) return String(recentSessions[0].id);
  return createLifeguardSessionId();
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

function rowMetadata(row) {
  return row?.metadata ?? row?.metadata_json ?? {};
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

/** P5 Phase A-2 — restore order when async persist inverts timestamps. */
const KEY_PRESENCE_SOURCE_ORDER = {
  document_upload: 0,
  key_initiative: 1,
};

function compareSessionMessageRows(a, b) {
  const ta = rowTimestamp(a);
  const tb = rowTimestamp(b);
  const ma = rowMetadata(a);
  const mb = rowMetadata(b);
  const aKey = ma.key_presence === true;
  const bKey = mb.key_presence === true;
  if (aKey && bKey) {
    const oa = KEY_PRESENCE_SOURCE_ORDER[ma.key_presence_source] ?? 9;
    const ob = KEY_PRESENCE_SOURCE_ORDER[mb.key_presence_source] ?? 9;
    if (oa !== ob) return oa - ob;
  }
  return ta - tb;
}

export function buildSessionMetadata(sessionId) {
  return {
    phase: LIFEGUARD_HOME_CHAT_PHASE,
    session_id: sessionId,
    source: LIFEGUARD_HOME_CHAT_SOURCE,
  };
}

export function buildKeyPresenceMetadata(
  sessionId,
  { keyPresenceSource, anchorDocumentId = null, anchorJobId = null } = {},
) {
  const metadata = {
    ...buildSessionMetadata(sessionId),
    key_presence: true,
    key_presence_source: keyPresenceSource,
  };
  if (anchorDocumentId) metadata.anchor_document_id = anchorDocumentId;
  if (anchorJobId) metadata.anchor_job_id = anchorJobId;
  return metadata;
}

/** Group lifeguard rows into recent session summaries for the sidebar. */
export function buildRecentSessionsFromRows(rows, { limit = 12 } = {}) {
  const bySession = new Map();

  for (const row of rows ?? []) {
    if (!isLifeguardHomeChatRow(row)) continue;
    const metadata = rowMetadata(row);
    const sessionId = String(metadata.session_id);
    if (!sessionId) continue;

    let entry = bySession.get(sessionId);
    if (!entry) {
      entry = {
        id: sessionId,
        preview: "새 대화",
        lastAt: 0,
        firstUserAt: Infinity,
        firstKeyPresenceAt: Infinity,
        firstDocumentUploadAt: Infinity,
        documentUploadPreview: null,
      };
      bySession.set(sessionId, entry);
    }

    const timestamp = rowTimestamp(row);
    if (timestamp > entry.lastAt) entry.lastAt = timestamp;

    if (row.role === "user") {
      const text = String(row.message ?? "").trim();
      if (text && timestamp <= entry.firstUserAt) {
        entry.firstUserAt = timestamp;
        if (!entry.documentUploadPreview) {
          entry.preview = previewFromMessage(text);
        }
      }
    }

    if (row.role === "assistant" && metadata.key_presence === true) {
      const text = String(row.message ?? "").trim();
      if (!text) continue;

      if (metadata.key_presence_source === "document_upload" && timestamp <= entry.firstDocumentUploadAt) {
        entry.firstDocumentUploadAt = timestamp;
        entry.documentUploadPreview = previewFromMessage(text);
        entry.preview = entry.documentUploadPreview;
      } else if (timestamp <= entry.firstKeyPresenceAt && entry.firstUserAt === Infinity && !entry.documentUploadPreview) {
        entry.firstKeyPresenceAt = timestamp;
        entry.preview = previewFromMessage(text);
      }
    }
  }

  return [...bySession.values()]
    .sort((a, b) => b.lastAt - a.lastAt)
    .slice(0, limit)
    .map(({ id, preview, documentUploadPreview }) => ({
      id,
      preview: documentUploadPreview ?? preview,
    }));
}

/** Map persisted rows to chat UI messages for one session. */
export function mapSessionRowsToChatMessages(rows, sessionId) {
  return (rows ?? [])
    .filter(
      (row) =>
        isLifeguardHomeChatRow(row) &&
        String(rowMetadata(row).session_id) === String(sessionId) &&
        (row.role === "user" || row.role === "assistant"),
    )
    .sort(compareSessionMessageRows)
    .map((row) => {
      const metadata = rowMetadata(row);
      const message = {
        id: row.id,
        role: row.role,
        content: row.message,
      };
      if (metadata.key_presence === true) {
        message.keyPresence = true;
        message.keyPresenceSource = metadata.key_presence_source ?? null;
      }
      return message;
    });
}
