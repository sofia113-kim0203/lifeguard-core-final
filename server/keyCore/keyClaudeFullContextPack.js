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
} = {}) {
  const started = Date.now();
  const mapped = (Array.isArray(history) ? history : []).map(mapTurn).filter((t) => t.text);
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
