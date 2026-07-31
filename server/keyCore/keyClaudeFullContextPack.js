/**
 * Claude-Full v1.1 — conversation context pack (D2).
 * Recent turns as originals; older turns summarized; retain past originals when referenced.
 * Document evidence reuses existing Upload/OCR/RAG chunk assets (no new parser).
 * Numbers/status only in metrics — no reasoning text stored here.
 */

import { normalizeDocumentEvidence } from "./keyClaudeFullEmit.js";

const DEFAULT_RECENT_TURN_COUNT = 12;
const OLDER_SUMMARY_MAX_CHARS = 1800;
const RETAINED_ORIGINAL_MAX = 6;

function turnText(turn = null) {
  return String(turn?.text ?? turn?.content ?? turn?.message ?? "").trim();
}

function mapTurn(turn = null) {
  return {
    role: turn?.role === "assistant" ? "assistant" : "user",
    text: turnText(turn),
  };
}

function normalizeFilenameKey(name = "") {
  return String(name ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

/** Filenames from HomeChat "(첨부: …)" markers only — not whole-thread filename guessing. */
export function extractAttachMarkerFilenamesFromTurnText(text = "") {
  const out = [];
  const s = String(text ?? "");
  for (const match of s.matchAll(/\(첨부:\s*([^)]+)\)/g)) {
    const name = String(match[1] ?? "").trim();
    if (!name || name === "파일") continue;
    if (!out.includes(name)) out.push(name);
  }
  return out;
}

/** Customer asks to restate a soft-deleted document — history must not re-supply its facts. */
export function isDeletedDocumentRecheckQuestion(question = "") {
  const q = String(question ?? "");
  if (!/삭제\s*한|삭제한|삭제된|지운|지웠/.test(q)) return false;
  return /문서|파일|사진|첨부|증권|보험/.test(q);
}

/** KEY/document identity readout that must not survive after source soft-delete. */
export function isDocumentIdentityReadoutText(text = "") {
  const t = String(text ?? "");
  if (!t.trim()) return false;
  if (/계약자\s*\/?\s*피보험자|피보험자\s*[:：]|계약자\s*[:：]/.test(t) && /보험사/.test(t)) {
    return true;
  }
  if (/보험사\s*[:：]/.test(t) && /상품명\s*[:：]/.test(t)) return true;
  return false;
}

/**
 * Seed this turn's explicit attach into the active set so loader miss/[] cannot
 * treat a live document_id as inactive. Does not re-open deleted-doc history.
 */
export function mergeCurrentTurnDocumentIntoActiveDocuments(
  activeDocuments = null,
  currentTurnDocument = null,
) {
  const base = Array.isArray(activeDocuments) ? [...activeDocuments] : [];
  if (!currentTurnDocument || typeof currentTurnDocument !== "object") return base;
  const id = String(
    currentTurnDocument.document_id ?? currentTurnDocument.id ?? "",
  ).trim();
  const filename = String(
    currentTurnDocument.original_filename ?? currentTurnDocument.filename ?? "",
  ).trim();
  if (!id && !filename) return base;
  const already = base.some((doc) => {
    if (typeof doc === "string") {
      return filename && normalizeFilenameKey(doc) === normalizeFilenameKey(filename);
    }
    const docId = String(doc?.document_id ?? doc?.id ?? "").trim();
    const docName = normalizeFilenameKey(doc?.original_filename ?? doc?.filename ?? "");
    if (id && docId && docId === id) return true;
    if (filename && docName && docName === normalizeFilenameKey(filename)) return true;
    return false;
  });
  if (already) return base;
  base.push({
    id: id || null,
    original_filename: filename || null,
  });
  return base;
}

/**
 * Drop history turns derived from soft-deleted / inactive source documents so they
 * cannot re-enter Claude conversation pack (recent / older summary / retained).
 *
 * activeDocuments (fail-closed):
 *   - null/undefined → loader miss / unknown active set; treat as [] (never fail-open)
 *   - [] → no proven active docs; suppress from first inactive attach onward
 *   - [{ id, original_filename }] → suppress while conversation is on an inactive attach
 *
 * options.currentTurnDocument: explicit this-turn attach — always merged as active
 *   (loader miss must not scrub the live document_id / filename segment).
 * options.forceScrubAttachSegments: treat every attach as inactive (deleted-doc recheck).
 * options.scrubIdentityReadouts: also drop assistant identity readouts (attach-marker miss).
 * Does not delete UI chat.
 */
export function filterHistoryExcludingInactiveDocumentAttachments(
  history = [],
  activeDocuments = null,
  options = {},
) {
  const forceScrub = options?.forceScrubAttachSegments === true;
  const scrubReadouts = options?.scrubIdentityReadouts === true;
  const rows = Array.isArray(history) ? history : [];
  const activeKeys = new Set();
  const activeIds = new Set();
  // null loader result ≡ empty active set (fail-closed). Never pass history through unfiltered.
  // Current-turn explicit document_id is still seeded as active (unless forceScrub).
  const mergedActive = forceScrub
    ? []
    : mergeCurrentTurnDocumentIntoActiveDocuments(
        activeDocuments,
        options?.currentTurnDocument ?? null,
      );
  if (!forceScrub) {
    for (const doc of mergedActive) {
      if (typeof doc === "string") {
        const key = normalizeFilenameKey(doc);
        if (key) activeKeys.add(key);
        continue;
      }
      const key = normalizeFilenameKey(doc?.original_filename ?? doc?.filename ?? "");
      if (key) activeKeys.add(key);
      const id = String(doc?.document_id ?? doc?.id ?? "").trim();
      if (id) activeIds.add(id);
    }
  }

  // forceScrub (deleted-doc recheck): sticky suppress from inactive attach onward.
  // Normal path: skip only the inactive attach-marker / foreign document_id turn —
  // never chain-delete subsequent customer/Claude dialogue (scopeOnly continuity).
  let stickySuppress = false;
  const kept = [];
  for (const turn of rows) {
    const text = turnText(turn);
    const names = extractAttachMarkerFilenamesFromTurnText(text);
    let skipThisTurn = false;
    if (names.length > 0) {
      const inactive =
        forceScrub || names.some((n) => !activeKeys.has(normalizeFilenameKey(n)));
      if (forceScrub) {
        stickySuppress = inactive;
      } else {
        skipThisTurn = inactive;
        stickySuppress = false;
      }
    }
    const turnDocId = String(turn?.document_id ?? turn?.source_document_id ?? "").trim();
    if (turnDocId) {
      const inactiveDoc = forceScrub || !activeIds.has(turnDocId);
      if (forceScrub) {
        stickySuppress = inactiveDoc;
      } else if (inactiveDoc) {
        skipThisTurn = true;
      }
    }
    if (stickySuppress || skipThisTurn) continue;
    if (scrubReadouts && turn?.role === "assistant" && isDocumentIdentityReadoutText(text)) {
      continue;
    }
    kept.push(turn);
  }
  return kept;
}

function summarizeOlderTurns(older = []) {
  if (!Array.isArray(older) || older.length === 0) return null;
  const parts = [];
  let used = 0;
  for (const t of older) {
    const role = t.role === "assistant" ? "KEY" : "고객";
    const text = String(t.text ?? "").replace(/\s+/g, " ").trim();
    if (!text) continue;
    const slice = text.length > 160 ? `${text.slice(0, 157)}…` : text;
    const line = `${role}: ${slice}`;
    if (used + line.length + 1 > OLDER_SUMMARY_MAX_CHARS) break;
    parts.push(line);
    used += line.length + 1;
  }
  if (parts.length === 0) return null;
  return {
    turn_count: older.length,
    summarized_turn_count: parts.length,
    summary_text: parts.join("\n"),
  };
}

/** Lightweight lexical anchors from the current question for past-original retention. */
function extractReferenceTokens(question = "") {
  const q = String(question ?? "").trim();
  if (!q) return [];
  const tokens = [];
  for (const m of q.match(/[가-힣]{2,}|[A-Za-z0-9]{2,}/g) ?? []) {
    if (m.length >= 2) tokens.push(m);
  }
  return [...new Set(tokens)].slice(0, 24);
}

function selectRetainedPastOriginals(older = [], question = "") {
  const tokens = extractReferenceTokens(question);
  if (!tokens.length || !older.length) return [];
  const retained = [];
  for (const t of older) {
    const text = String(t.text ?? "");
    if (!text) continue;
    if (tokens.some((tok) => text.includes(tok))) {
      retained.push(t);
      if (retained.length >= RETAINED_ORIGINAL_MAX) break;
    }
  }
  return retained;
}

/**
 * @param {{
 *   history?: Array,
 *   previousAnswerSummary?: string,
 *   recentTurnCount?: number,
 *   question?: string,
 *   documentEvidence?: Array,
 *   relatedPastOriginals?: Array,
 * }} opts
 */
export function buildClaudeFullContextPack({
  history = [],
  previousAnswerSummary = "",
  recentTurnCount = DEFAULT_RECENT_TURN_COUNT,
  question = "",
  documentEvidence = null,
  relatedPastOriginals = null,
  activeDocuments = null,
  /** Explicit this-turn attach — preserved even when activeDocuments loader returns null/[]. */
  currentTurnDocument = null,
  /** When true (deleted-doc recheck, no current attach), scrub all attach-derived turns. */
  forceScrubAttachSegments = false,
  scrubIdentityReadouts = false,
} = {}) {
  const started = Date.now();
  const historyForPack = filterHistoryExcludingInactiveDocumentAttachments(
    history,
    activeDocuments,
    { forceScrubAttachSegments, scrubIdentityReadouts, currentTurnDocument },
  );
  const mapped = (Array.isArray(historyForPack) ? historyForPack : [])
    .map(mapTurn)
    .filter((t) => t.text);
  const n = Math.max(1, Number(recentTurnCount) || DEFAULT_RECENT_TURN_COUNT);
  const recent = mapped.length <= n ? mapped : mapped.slice(-n);
  const older = mapped.length <= n ? [] : mapped.slice(0, mapped.length - n);
  const older_conversation_summary = summarizeOlderTurns(older);
  const retained_past_originals = selectRetainedPastOriginals(older, question);
  const previous_answer_summary = String(previousAnswerSummary ?? "").trim() || null;
  const document_evidence = normalizeDocumentEvidence(
    Array.isArray(documentEvidence) ? documentEvidence : [],
  );
  const related_past_originals = Array.isArray(relatedPastOriginals)
    ? relatedPastOriginals
        .map((item) => {
          if (typeof item === "string") {
            const text = item.trim();
            return text ? { text } : null;
          }
          if (item && typeof item === "object") {
            const text = String(item.text ?? item.content ?? item.excerpt ?? "").trim();
            if (!text) return null;
            return {
              text,
              source: item.source ?? null,
              ref: item.ref ?? null,
            };
          }
          return null;
        })
        .filter(Boolean)
    : [];

  const pack = {
    recent_conversation_originals: recent,
    recent_conversation_count: recent.length,
    older_conversation_summary,
    retained_past_originals,
    retained_past_original_count: retained_past_originals.length,
    previous_answer_summary,
    related_past_originals,
    related_past_original_count: related_past_originals.length,
    document_evidence,
    document_evidence_count: document_evidence.length,
    // Full mapped history for SSOT callers — Claude-Full payload should not duplicate-attach this
    // when recent + older summary + retained already cover the thread.
    conversation_history_full: mapped,
    conversation_history_full_count: mapped.length,
  };

  return {
    pack,
    context_pack_ms: Math.max(0, Date.now() - started),
  };
}

export {
  DEFAULT_RECENT_TURN_COUNT,
  OLDER_SUMMARY_MAX_CHARS,
  RETAINED_ORIGINAL_MAX,
};
