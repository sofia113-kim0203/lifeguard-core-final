/**
 * Shared KEY stream paint (customer + advisor) — display only.
 * - Server deltas accumulate in order into a source queue.
 * - First grapheme paints immediately (no rAF wait).
 * - Later: exactly one Unicode grapheme per paint frame.
 * - Punctuation breath: comma-family +1 frame; sentence-end/newline +2 frames.
 * - Backlog ≥120 skips breath only; still 1 grapheme/paint. Restore below 60.
 * - Done drains remaining one grapheme at a time — no bulk flush.
 * - Finalize is append-only vs already-painted text:
 *   equal → no-op; continuation → paint suffix only; divergent → keep painted (no rewind).
 * - R1: preferSeal (fail-closed / key_monopoly_failure only) → divergent replaces with seal.
 */

export const STREAM_BACKLOG_SKIP_BREATH = 120;
export const STREAM_BACKLOG_RESTORE_BREATH = 60;

/** Must match server/keyCore/keyCustomerMonopoly.js (client must not import server). */
export const KEY_MONOPOLY_FAILURE_CUSTOMER_TEXT =
  "지금은 여기까지 확인했어요. 잠시 후 다시 말씀해 주시면 KEY가 이어서 볼게요.";

/** True only for the exact monopoly system-failure stub (not normal conversation). */
export function isKeyMonopolyFailureCustomerText(text = "") {
  const t = String(text ?? "").trim();
  if (!t) return false;
  if (t === KEY_MONOPOLY_FAILURE_CUSTOMER_TEXT) return true;
  return (
    /지금은\s*여기까지\s*확인했어요/.test(t) &&
    /잠시\s*후\s*다시\s*말씀해\s*주시면/.test(t)
  );
}

/** R1 — seal beats painted only on fail-closed monopoly failure. */
export function shouldPreferSealOverPainted({
  keyMonopolyFailure = false,
  sealedText = "",
} = {}) {
  return (
    keyMonopolyFailure === true ||
    isKeyMonopolyFailureCustomerText(sealedText)
  );
}

/**
 * Customer HomeChat finalize input (R1).
 * Normal path: append-only / painted wins on non-failure divergent.
 * Failure path: sealed wins.
 */
export function resolveCustomerStreamFinalizeInput({
  paintedNow = "",
  sealedText = "",
  accumulated = "",
  preferSeal = false,
} = {}) {
  const painted = String(paintedNow ?? "");
  const sealed = String(sealedText ?? "");
  if (preferSeal === true && sealed) return sealed;
  if (!painted) return sealed || String(accumulated ?? "");
  if (!sealed) return painted;
  if (sealed === painted || sealed.startsWith(painted)) return sealed;
  return painted;
}

/**
 * R3 — committed turn text for next history / snapshot / DB persist.
 * Server seal (answerText) is SSOT when present; painted-only must not win.
 */
export function resolveCustomerHistoryPersistText({
  sealedText = "",
  displayText = "",
} = {}) {
  const sealed = String(sealedText ?? "");
  if (sealed.trim()) return sealed;
  return String(displayText ?? "");
}

/**
 * R2 — hard stream error: remove this-turn incomplete assistant bubble.
 * Keep on memory-fail-sealed (answer intentional) or successful SSE done.
 */
export function shouldRemoveAssistantBubbleOnStreamError({
  lastAssistant = null,
  turnId = null,
  memoryFailSealed = false,
  sawSuccessfulSseDone = false,
} = {}) {
  if (memoryFailSealed === true) return false;
  if (sawSuccessfulSseDone === true) return false;
  if (!lastAssistant || lastAssistant.role !== "assistant") return false;
  const expectedTurn = String(turnId ?? "").trim();
  if (expectedTurn) {
    const msgTurn = String(lastAssistant.turnId ?? "").trim();
    if (msgTurn && msgTurn !== expectedTurn) return false;
  }
  if (lastAssistant.thinking === true) return true;
  return Boolean(String(lastAssistant.content ?? "").trim());
}

const COMMA_BREATH = new Set([",", "，", ":", "：", ";", "；"]);
const END_BREATH = new Set([".", "。", "?", "？", "!", "！", "\n"]);

/**
 * @param {string} text
 * @returns {string[]}
 */
export function segmentGraphemes(text) {
  const s = String(text ?? "");
  if (!s) return [];
  if (typeof Intl !== "undefined" && typeof Intl.Segmenter === "function") {
    const seg = new Intl.Segmenter("ko", { granularity: "grapheme" });
    return Array.from(seg.segment(s), (part) => part.segment);
  }
  return Array.from(s);
}

/**
 * @param {string[]} painted
 * @param {string[]} target
 */
export function commonGraphemePrefixCount(painted, target) {
  const n = Math.min(painted.length, target.length);
  let i = 0;
  while (i < n && painted[i] === target[i]) i += 1;
  return i;
}

/**
 * Extra idle frames after painting this grapheme (0 when breath skipped).
 * @param {string} grapheme
 * @param {boolean} skipBreath
 */
export function punctuationBreathFrames(grapheme, skipBreath = false) {
  if (skipBreath) return 0;
  const g = String(grapheme ?? "");
  if (COMMA_BREATH.has(g)) return 1;
  if (END_BREATH.has(g)) return 2;
  return 0;
}

/**
 * @param {{
 *   onPaint: (text: string, meta: { first: boolean }) => void,
 *   raf?: (cb: FrameRequestCallback) => number,
 *   caf?: (id: number) => void,
 * }} args
 */
export function createAgentStreamPaintController({
  onPaint,
  raf = typeof requestAnimationFrame === "function"
    ? (cb) => requestAnimationFrame(cb)
    : (cb) => setTimeout(() => cb(Date.now()), 16),
  caf = typeof cancelAnimationFrame === "function"
    ? (id) => cancelAnimationFrame(id)
    : (id) => clearTimeout(id),
} = {}) {
  if (typeof onPaint !== "function") {
    throw new Error("onPaint required");
  }

  let source = "";
  /** @type {string[]} */
  let sourceGraphemes = [];
  let paintedCount = 0;
  let rafId = null;
  let sealed = false;
  let cancelled = false;
  let skipBreath = false;
  let idleFramesLeft = 0;
  /** @type {((text: string) => void) | null} */
  let resolveDrain = null;
  /** @type {((err: Error) => void) | null} */
  let rejectDrain = null;

  function paintedText() {
    return sourceGraphemes.slice(0, paintedCount).join("");
  }

  function exactSource() {
    return sourceGraphemes.join("");
  }

  function backlogCount() {
    return Math.max(0, sourceGraphemes.length - paintedCount);
  }

  function syncBreathGate() {
    const n = backlogCount();
    if (n >= STREAM_BACKLOG_SKIP_BREATH) skipBreath = true;
    else if (n < STREAM_BACKLOG_RESTORE_BREATH) skipBreath = false;
  }

  function syncSourceGraphemes() {
    sourceGraphemes = segmentGraphemes(source);
    if (paintedCount > sourceGraphemes.length) {
      paintedCount = sourceGraphemes.length;
    }
    syncBreathGate();
  }

  function cancelScheduled() {
    if (rafId == null) return;
    caf(rafId);
    rafId = null;
  }

  function settleDrain(ok, value) {
    const resolve = resolveDrain;
    const reject = rejectDrain;
    resolveDrain = null;
    rejectDrain = null;
    if (ok) resolve?.(value);
    else reject?.(value instanceof Error ? value : new Error(String(value)));
  }

  function maybeResolveDrain() {
    if (!sealed || cancelled) return;
    if (paintedCount < sourceGraphemes.length) return;
    const done = exactSource();
    if (done !== source) {
      settleDrain(false, new Error("stream paint final text mismatch"));
      return;
    }
    settleDrain(true, done);
  }

  /** Advance exactly one grapheme. @returns {boolean} more remain */
  function advanceOne() {
    if (cancelled) return false;
    if (paintedCount >= sourceGraphemes.length) return false;
    const first = paintedCount === 0;
    syncBreathGate();
    const skip = skipBreath;
    const g = sourceGraphemes[paintedCount];
    paintedCount += 1;
    onPaint(paintedText(), { first });
    idleFramesLeft = punctuationBreathFrames(g, skip);
    syncBreathGate();
    return paintedCount < sourceGraphemes.length;
  }

  function schedule() {
    if (rafId != null || cancelled) return;
    if (paintedCount >= sourceGraphemes.length && idleFramesLeft <= 0) {
      maybeResolveDrain();
      return;
    }
    rafId = raf(() => {
      rafId = null;
      if (cancelled) return;
      if (idleFramesLeft > 0) {
        idleFramesLeft -= 1;
        schedule();
        return;
      }
      if (paintedCount >= sourceGraphemes.length) {
        maybeResolveDrain();
        return;
      }
      const more = advanceOne();
      if (more || idleFramesLeft > 0) schedule();
      else maybeResolveDrain();
    });
  }

  return {
    /** @param {unknown} chunk */
    append(chunk) {
      if (sealed || cancelled) return source;
      const piece = String(chunk ?? "");
      if (!piece) return source;
      source += piece;
      syncSourceGraphemes();
      if (paintedCount === 0) {
        cancelScheduled();
        const more = advanceOne();
        if (more || idleFramesLeft > 0) schedule();
        return source;
      }
      schedule();
      return source;
    },

    /**
     * Append-only seal vs already-painted customer text.
     * - No paint yet → adopt serverText and drain one grapheme per frame.
     * - Equal → no-op (keep display).
     * - Continuation → append suffix only (never rewind).
     * - Divergent → keep painted / stream backlog; never shorter onPaint / replace.
     * - R1 preferSeal → divergent (or any non-equal) replaces display with seal immediately.
     * Never bulk-flushes remaining characters (except preferSeal hard replace).
     * @param {unknown} serverText
     * @param {{ preferSeal?: boolean }} [opts]
     * @returns {Promise<string>} painted text the customer sees
     */
    finalize(serverText, opts = {}) {
      if (cancelled) return Promise.resolve(paintedText());

      const sealedText = String(serverText ?? "");
      const currentlyPainted = paintedText();
      const preferSeal = opts?.preferSeal === true;

      const beginDrain = () => {
        const finalExact = exactSource();
        if (finalExact !== source) {
          return Promise.reject(new Error("stream paint final text mismatch"));
        }
        if (paintedCount >= sourceGraphemes.length && idleFramesLeft <= 0) {
          // Already fully painted — no extra onPaint (avoids duplicate / empty paints).
          return Promise.resolve(paintedText());
        }
        return new Promise((resolve, reject) => {
          resolveDrain = resolve;
          rejectDrain = reject;
          schedule();
        });
      };

      // R1 — fail-closed: seal replaces painted (rewind allowed only here).
      if (
        preferSeal &&
        sealedText &&
        sealedText !== currentlyPainted &&
        !sealedText.startsWith(currentlyPainted)
      ) {
        cancelScheduled();
        source = sealedText;
        syncSourceGraphemes();
        paintedCount = sourceGraphemes.length;
        idleFramesLeft = 0;
        sealed = true;
        onPaint(sealedText, { first: currentlyPainted.length === 0 });
        return Promise.resolve(sealedText);
      }

      // 1) Nothing painted yet — show server final (or any prior accumulated source).
      if (paintedCount === 0) {
        const next = sealedText.length > 0 ? sealedText : source;
        source = next;
        syncSourceGraphemes();
        sealed = true;
        if (!source) {
          return Promise.resolve("");
        }
        // First grapheme immediate (same as append) — never leave an empty bubble.
        cancelScheduled();
        const more = advanceOne();
        if (!more && idleFramesLeft <= 0) {
          return Promise.resolve(paintedText());
        }
        return beginDrain();
      }

      // 2) Identical to display — no-op.
      if (sealedText === currentlyPainted) {
        sealed = true;
        source = currentlyPainted;
        syncSourceGraphemes();
        paintedCount = sourceGraphemes.length;
        idleFramesLeft = 0;
        cancelScheduled();
        return Promise.resolve(currentlyPainted);
      }

      // 3) Continuation of display — append suffix only.
      if (sealedText.startsWith(currentlyPainted)) {
        source = sealedText;
        syncSourceGraphemes();
        // paintedCount unchanged — never rewind.
        sealed = true;
        return beginDrain();
      }

      // 4) Divergent sealed — keep customer-visible text; never rewind/replace.
      sealed = true;
      if (source.startsWith(currentlyPainted) && source.length > currentlyPainted.length) {
        // Finish any already-received stream backlog (append-only).
        syncSourceGraphemes();
        return beginDrain();
      }
      source = currentlyPainted;
      syncSourceGraphemes();
      paintedCount = sourceGraphemes.length;
      idleFramesLeft = 0;
      cancelScheduled();
      return Promise.resolve(currentlyPainted);
    },

    /** Stop animation; leave currently painted text (error path). */
    cancel() {
      cancelled = true;
      sealed = true;
      cancelScheduled();
      idleFramesLeft = 0;
      const text = paintedText();
      settleDrain(true, text);
      return text;
    },

    getAccumulated() {
      return source;
    },

    getPainted() {
      return paintedText();
    },

    hasPainted() {
      return paintedCount > 0;
    },
  };
}
