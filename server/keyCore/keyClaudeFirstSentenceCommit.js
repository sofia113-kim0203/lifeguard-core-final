/**
 * Preview Claude-first — E: sentence-unit commit stream.
 * Committed sentences are never replaced (KEY monopoly / no onReplace).
 * Hard-lite only: enroll / cancel / close-push. Gate body untouched.
 */

const DEFAULT_SAFETY_BUFFER = 8;

/** Soft closer when a later sentence fails hard-lite after some commits. */
export const SENTENCE_COMMIT_ABORT_CLOSER =
  "이 부분은 여기서 잠시 마무리할게요. 이어서 궁금한 점 있으시면 편하게 말씀해 주세요.";

/**
 * Hard-lite for sentence commit — strong enroll / cancel / close only.
 * Avoids explanatory phrases like "가입 시점" (false positive on 특약 Q).
 * Gate body untouched — call-site stream policy only.
 */
export function sentenceHardLiteBlocks(text = "") {
  const t = String(text ?? "");
  if (!t.trim()) return false;
  if (/(?:지금\s*)?가입(?:하세요|하시길|하는\s*게\s*좋|하십|[을를]\s*권)/.test(t)) return true;
  if (/(?:지금\s*)?해지(?:하세요|하시길|하는\s*게\s*좋|하십|[을를]\s*권)/.test(t)) return true;
  if (/(?:최종\s*)?(?:체결|가입\s*확정|설계\s*완료|지금\s*결정)/.test(t)) return true;
  return false;
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
    /^\|.+\|[ \t]*(?:\n|$)/,
    /\n#{1,3}\s+[^\n]+(?:\n|$)/,
    /\n[-*]\s+[^\n]+(?:\n|$)/,
    /\n\d+\.\s+[^\n]+(?:\n|$)/,
    /\n\|.+\|[ \t]*(?:\n|$)/,
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
  let catchUpAppended = false;

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
    /**
     * Append-only catch-up from the final Claude answer.
     * Only the exact suffix after already-committed text is queued.
     * Never replaces or re-emits committed sentences.
     */
    catchUpFinalAnswer(finalAnswer = "") {
      if (aborted) {
        return { aborted: true, appended: false, reason: "already_aborted" };
      }
      const final = String(finalAnswer ?? "");
      if (!final) {
        return { aborted: false, appended: false, reason: "empty_final" };
      }
      if (!final.startsWith(committed)) {
        // Unsafe to invent a suffix — keep committed as-is (no replace).
        return { aborted: false, appended: false, reason: "final_not_prefix_of_committed" };
      }
      if (final.length <= committed.length) {
        pending = "";
        lastSeen = final;
        return { aborted: false, appended: false, reason: "already_complete" };
      }
      const suffix = final.slice(committed.length);
      // Drop any in-flight pending that overlaps the suffix path; rebuild from committed.
      pending = suffix;
      lastSeen = final;
      catchUpAppended = true;
      drain({ flushAll: false });
      return { aborted, appended: true, suffix_len: suffix.length };
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
    didCatchUpAppend() {
      return catchUpAppended;
    },
  };
}
