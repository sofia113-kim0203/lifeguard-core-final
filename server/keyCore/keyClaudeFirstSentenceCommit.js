/**
 * Preview Claude-first — E: sentence-unit commit stream.
 * Committed sentences are never replaced (KEY monopoly / no onReplace).
 * Hard-lite only: enroll / cancel / close-push. Gate body untouched.
 */
import { recommendationOrTerminationRisk } from "./keyVoiceGate.js";

const DEFAULT_SAFETY_BUFFER = 8;

/** Soft closer when a later sentence fails hard-lite after some commits. */
export const SENTENCE_COMMIT_ABORT_CLOSER =
  "이 부분은 여기서 잠시 마무리할게요. 이어서 궁금한 점 있으시면 편하게 말씀해 주세요.";

/**
 * Hard-lite for sentence commit — enroll / cancel / close only.
 * Does not treat definitive-verdict-alone as a block (aligns with Monopoly A).
 */
export function sentenceHardLiteBlocks(text = "") {
  const risk = recommendationOrTerminationRisk(text);
  return (
    risk.enrollment_push === true ||
    risk.cancellation_push === true ||
    risk.termination_close_risk === true
  );
}

/**
 * Find end index (exclusive) of the next committable unit in pending text.
 * @returns {number} exclusive end index, or -1 if none ready
 */
export function findNextCommitEnd(
  pending = "",
  { flushAll = false, safetyBufferChars = DEFAULT_SAFETY_BUFFER } = {},
) {
  const src = String(pending ?? "");
  if (!src) return -1;

  const patterns = [
    /^#{1,3}\s+[^\n]+(?:\n|$)/,
    /^[-*]\s+[^\n]+(?:\n|$)/,
    /^\d+\.\s+[^\n]+(?:\n|$)/,
    /\n#{1,3}\s+[^\n]+(?:\n|$)/,
    /\n[-*]\s+[^\n]+(?:\n|$)/,
    /\n\d+\.\s+[^\n]+(?:\n|$)/,
    /\n---+\n/,
    /\n\n/,
    /[.!?。…](?:["”']?)(?=\s|$|\n)/,
  ];

  let best = -1;
  for (const re of patterns) {
    const global = new RegExp(re.source, re.flags.includes("g") ? re.flags : `${re.flags}g`);
    const m = global.exec(src);
    if (m && typeof m.index === "number") {
      const end = m.index + m[0].length;
      if (best < 0 || end < best) best = end;
    }
  }

  if (best < 0) {
    if (flushAll && src.trim()) return src.length;
    return -1;
  }

  if (!flushAll) {
    const rest = src.slice(best);
    if (rest.trim().length > 0 && rest.length < safetyBufferChars) {
      return -1;
    }
  }

  return best;
}

/**
 * @param {{ onCommit?: (sentence: string) => void, safetyBufferChars?: number }} [opts]
 */
export function createSentenceCommitStream({
  onCommit = null,
  safetyBufferChars = DEFAULT_SAFETY_BUFFER,
} = {}) {
  let pending = "";
  let committed = "";
  let lastSeen = "";
  let aborted = false;
  let abortReason = null;

  function commitSlice(slice) {
    if (!slice) return;
    committed += slice;
    onCommit?.(slice);
  }

  function drain({ flushAll = false } = {}) {
    if (aborted) return;
    while (true) {
      const end = findNextCommitEnd(pending, { flushAll, safetyBufferChars });
      if (end < 0) break;
      const slice = pending.slice(0, end);
      const rest = pending.slice(end);
      if (sentenceHardLiteBlocks(slice)) {
        aborted = true;
        abortReason = "sentence_hard_lite";
        pending = "";
        return;
      }
      pending = rest;
      commitSlice(slice);
    }
    if (flushAll && pending) {
      if (sentenceHardLiteBlocks(pending)) {
        aborted = true;
        abortReason = "sentence_hard_lite";
        pending = "";
        return;
      }
      commitSlice(pending);
      pending = "";
    }
  }

  return {
    pushAnswerText(fullText = "") {
      if (aborted) return { aborted: true };
      const next = String(fullText ?? "");
      if (next.length <= lastSeen.length) return { aborted: false };
      pending += next.slice(lastSeen.length);
      lastSeen = next;
      drain({ flushAll: false });
      return { aborted };
    },
    flush() {
      if (aborted) return { aborted: true };
      drain({ flushAll: true });
      return { aborted };
    },
    getCommitted() {
      return committed;
    },
    getPending() {
      return pending;
    },
    isAborted() {
      return aborted;
    },
    getAbortReason() {
      return abortReason;
    },
  };
}
