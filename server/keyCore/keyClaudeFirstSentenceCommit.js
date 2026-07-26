/**
 * Preview Claude-first — E: sentence-unit commit stream.
 * Committed sentences are never replaced (KEY monopoly / no onReplace).
 * Slice 8: hard-lite word abort removed from the normal customer path —
 * stream is transmission stability only. Real enroll/cancel pressure uses hard-only.
 * Completeness: emit only sentence/block boundaries; never EOF-flush incomplete tails;
 * catch-up appends only complete sealed continuation.
 */

const DEFAULT_SAFETY_BUFFER = 8;

/** Sentence / block boundary at end of text. */
export function endsWithSentenceBoundary(text = "") {
  const src = String(text ?? "");
  if (!src) return false;
  return /(?:[.!?。…]["”']?)\s*$/.test(src) || /\n\s*$/.test(src);
}

/**
 * Split into emit-safe prefix + held trailing fragment.
 * Kept for diagnostics / tests — stream emit uses sentence boundaries.
 */
export function splitEmitSafeAndHeld(text = "") {
  const src = String(text ?? "");
  if (!src) return { emit: "", hold: "" };
  if (endsWithSentenceBoundary(src) || /\s$/.test(src)) {
    return { emit: src, hold: "" };
  }
  const m = src.match(/^(.*?)(\S+)$/s);
  if (!m) return { emit: src, hold: "" };
  return { emit: m[1], hold: m[2] };
}

/**
 * Keep text through the last committable sentence/block boundary.
 * Incomplete trailing fragments (e.g. "…뭔지 바") are dropped.
 */
export function trimToLastCompleteSentence(text = "") {
  const src = String(text ?? "");
  if (!src) return "";
  if (endsWithSentenceBoundary(src)) return src;
  let pending = src;
  let out = "";
  while (true) {
    const end = findNextCommitEnd(pending, {
      flushAll: false,
      safetyBufferChars: 0,
    });
    if (end < 0) break;
    out += pending.slice(0, end);
    pending = pending.slice(end);
  }
  return out;
}

/**
 * Customer-facing complete answer from Claude final text.
 * - max_tokens → last complete sentence only (may be empty if none).
 * - Has complete sentence(s) + incomplete trailing fragment → drop the fragment.
 * - Whole answer without sentence punctuation (common Korean) → keep as-is.
 */
export function resolveCompleteAnswerText(text = "", { stopReason = null } = {}) {
  const src = String(text ?? "");
  if (!src) return "";
  const reason = String(stopReason ?? "").trim();
  const trimmed = trimToLastCompleteSentence(src);
  if (reason === "max_tokens") {
    return trimmed;
  }
  if (
    trimmed &&
    trimmed.length < src.replace(/\s+$/u, "").length &&
    !endsWithSentenceBoundary(src)
  ) {
    return trimmed;
  }
  return src;
}

/**
 * Customer stream — emit sentence/block boundaries only; hold incomplete tails.
 * onCommit(slice) → { keep: true } | { keep: false, abort: true, reason?: string }
 */
export function createImmediateAnswerDeltaStream({
  onCommit = null,
  safetyBufferChars = 0,
} = {}) {
  let committed = "";
  let pending = "";
  let lastSeen = "";
  let catchUpAppended = false;
  let aborted = false;
  let abortReason = null;
  let droppedPendingLen = 0;

  function commitSlice(slice) {
    if (!slice || aborted) return;
    const decision = onCommit?.(slice) ?? { keep: true };
    if (decision?.abort === true) {
      aborted = true;
      abortReason = decision.reason ?? "aborted";
      return;
    }
    if (decision?.keep === false) return;
    committed += slice;
  }

  function drainCompleteUnits() {
    while (true) {
      const end = findNextCommitEnd(pending, {
        flushAll: false,
        safetyBufferChars,
      });
      if (end < 0) break;
      const slice = pending.slice(0, end);
      pending = pending.slice(end);
      commitSlice(slice);
    }
  }

  return {
    pushAnswerText(fullText = "") {
      if (aborted) return { aborted: true };
      const next = String(fullText ?? "");
      if (next.length <= lastSeen.length) return { aborted: false };
      const chunk = next.slice(lastSeen.length);
      lastSeen = next;
      if (chunk) {
        pending += chunk;
        drainCompleteUnits();
      }
      return { aborted };
    },
    /**
     * Append-only catch-up from sealed/complete final.
     * Drops held incomplete pending; never flushes mid-word/sentence tails.
     * Appends only when resolved complete final starts with committed.
     */
    catchUpFinalAnswer(finalAnswer = "", { stopReason = null } = {}) {
      if (aborted) return { aborted: true, appended: false, reason: "already_aborted" };
      if (pending) {
        droppedPendingLen += pending.length;
        pending = "";
      }
      const raw = String(finalAnswer ?? "");
      if (!raw) {
        return { aborted: false, appended: false, reason: "empty_final" };
      }
      if (committed && !raw.startsWith(committed)) {
        return { aborted: false, appended: false, reason: "final_not_prefix_of_committed" };
      }
      const complete = resolveCompleteAnswerText(raw, { stopReason });
      const target =
        complete && (!committed || complete.startsWith(committed))
          ? complete
          : "";
      if (!target) {
        return {
          aborted: false,
          appended: false,
          reason: committed ? "no_complete_continuation" : "no_complete_sentence",
        };
      }
      if (target.length <= committed.length) {
        lastSeen = raw.length > lastSeen.length ? raw : lastSeen;
        return { aborted: false, appended: false, reason: "already_complete" };
      }
      const suffix = target.slice(committed.length);
      lastSeen = raw.length > lastSeen.length ? raw : target;
      catchUpAppended = true;
      // Complete suffix may include multiple sentences — commit as one append-only block.
      commitSlice(suffix);
      return { aborted, appended: !aborted, suffix_len: suffix.length };
    },
    /** Drop held incomplete pending — do not flush mid-word/sentence fragments. */
    flush() {
      if (pending) {
        droppedPendingLen += pending.length;
        pending = "";
      }
      return { aborted, dropped_pending_len: droppedPendingLen };
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
    getDroppedPendingLen() {
      return droppedPendingLen;
    },
  };
}

/** @deprecated Slice 8 — closer unused; kept for import compatibility. */
export const SENTENCE_COMMIT_ABORT_CLOSER =
  "이 부분은 여기서 잠시 마무리할게요. 이어서 궁금한 점 있으시면 편하게 말씀해 주세요.";

/**
 * Diagnostic only — Slice 8 does not abort the sentence stream on these matches.
 * Real CLOSED enroll/cancel pressure is handled by hardOnlySafetyCheck.
 */
export function sentenceHardLiteBlocks(text = "") {
  const t = String(text ?? "");
  if (!t.trim()) return false;
  if (/(?:지금\s*)?가입(?:하세요|하시길|하는\s*게\s*좋|하십|[을를]\s*권)/.test(t)) return true;
  if (/(?:지금\s*)?해지(?:하세요|하시길|하는\s*게\s*좋|하십|[을를]\s*권)/.test(t)) return true;
  if (/(?:최종\s*)?(?:체결|가입\s*확정|설계\s*완료|지금\s*결정(?:하세요|해\s*주세요|이\s*필요))/.test(t)) {
    return true;
  }
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
  let catchUpAppended = false;

  function commitSlice(slice) {
    if (!slice) return;
    committed += slice;
    onCommit?.(slice);
  }

  function drain({ flushAll = false } = {}) {
    while (true) {
      const end = findNextCommitEnd(pending, { flushAll, safetyBufferChars });
      if (end < 0) break;
      const slice = pending.slice(0, end);
      pending = pending.slice(end);
      commitSlice(slice);
    }
    if (flushAll && pending) {
      commitSlice(pending);
      pending = "";
    }
  }

  return {
    pushAnswerText(fullText = "") {
      const next = String(fullText ?? "");
      if (next.length <= lastSeen.length) return { aborted: false };
      pending += next.slice(lastSeen.length);
      lastSeen = next;
      drain({ flushAll: false });
      return { aborted: false };
    },
    /**
     * Append-only catch-up from the final Claude answer.
     * Only the exact suffix after already-committed text is queued.
     * Never replaces or re-emits committed sentences.
     */
    catchUpFinalAnswer(finalAnswer = "") {
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
      return { aborted: false, appended: true, suffix_len: suffix.length };
    },
    flush() {
      drain({ flushAll: true });
      return { aborted: false };
    },
    getCommitted() {
      return committed;
    },
    getPending() {
      return pending;
    },
    isAborted() {
      return false;
    },
    getAbortReason() {
      return null;
    },
    didCatchUpAppend() {
      return catchUpAppended;
    },
  };
}
