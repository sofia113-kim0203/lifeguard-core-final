/**
 * Advisor KEY one-grapheme stream paint.
 * - Server deltas accumulate in order into a source buffer.
 * - First grapheme paints immediately.
 * - Later: exactly one Unicode grapheme per animation frame.
 * - After server done, remaining graphemes continue one-by-one (no bulk flush).
 * - Final painted text equals server final text. No rewrite.
 */

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
  // Code-point fallback (better than charAt for emoji; may split some ZWJ sequences).
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
  /** @type {((text: string) => void) | null} */
  let resolveDrain = null;

  function paintedText() {
    return sourceGraphemes.slice(0, paintedCount).join("");
  }

  function exactSource() {
    return sourceGraphemes.join("");
  }

  function syncSourceGraphemes() {
    sourceGraphemes = segmentGraphemes(source);
    if (paintedCount > sourceGraphemes.length) {
      paintedCount = sourceGraphemes.length;
    }
  }

  function cancelScheduled() {
    if (rafId == null) return;
    caf(rafId);
    rafId = null;
  }

  function maybeResolveDrain() {
    if (!sealed || cancelled) return;
    if (paintedCount < sourceGraphemes.length) return;
    const done = exactSource();
    const resolve = resolveDrain;
    resolveDrain = null;
    resolve?.(done);
  }

  /** Advance exactly one grapheme. @returns {boolean} more remain */
  function advanceOne() {
    if (cancelled) return false;
    if (paintedCount >= sourceGraphemes.length) return false;
    const first = paintedCount === 0;
    paintedCount += 1;
    onPaint(paintedText(), { first });
    return paintedCount < sourceGraphemes.length;
  }

  function schedule() {
    if (rafId != null || cancelled) return;
    if (paintedCount >= sourceGraphemes.length) {
      maybeResolveDrain();
      return;
    }
    rafId = raf(() => {
      rafId = null;
      if (cancelled) return;
      const more = advanceOne();
      if (more) schedule();
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
        // First grapheme: never wait for rAF.
        cancelScheduled();
        const more = advanceOne();
        if (more) schedule();
        return source;
      }
      schedule();
      return source;
    },

    /**
     * Seal with server final text; drain remaining one grapheme per frame.
     * Never bulk-flushes remaining characters.
     * @param {unknown} serverText
     * @returns {Promise<string>}
     */
    finalize(serverText) {
      if (cancelled) return Promise.resolve(paintedText());

      const sealedText = String(serverText ?? "");
      const next = sealedText.length > 0 ? sealedText : source;
      const prevPainted = segmentGraphemes(paintedText());
      source = next;
      syncSourceGraphemes();
      paintedCount = commonGraphemePrefixCount(prevPainted, sourceGraphemes);
      if (paintedCount < prevPainted.length) {
        // Prefix shortened due to rare mismatch — repaint common prefix only.
        onPaint(paintedText(), { first: false });
      }
      sealed = true;

      const finalExact = exactSource();
      if (paintedCount >= sourceGraphemes.length) {
        onPaint(finalExact, { first: false });
        return Promise.resolve(finalExact);
      }

      return new Promise((resolve) => {
        resolveDrain = resolve;
        schedule();
      });
    },

    /** Stop animation; leave currently painted text (error path). */
    cancel() {
      cancelled = true;
      sealed = true;
      cancelScheduled();
      const text = paintedText();
      const resolve = resolveDrain;
      resolveDrain = null;
      resolve?.(text);
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
