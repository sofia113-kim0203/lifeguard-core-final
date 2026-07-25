/**
 * Advisor KEY stream paint — accumulate every delta; batch UI via rAF.
 * First delta paints immediately. Done flushes then seals server final text.
 * No fake typing, no reorder, no rewrite of KEY text.
 */

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

  let accumulated = "";
  let painted = "";
  let rafId = null;
  let firstPainted = false;
  let closed = false;

  function paintNow(text) {
    painted = text;
    const first = !firstPainted;
    firstPainted = true;
    onPaint(text, { first });
  }

  function cancelScheduled() {
    if (rafId == null) return;
    caf(rafId);
    rafId = null;
  }

  function schedule() {
    if (rafId != null || closed) return;
    rafId = raf(() => {
      rafId = null;
      if (closed) return;
      if (accumulated !== painted) paintNow(accumulated);
    });
  }

  return {
    /** @param {unknown} chunk */
    append(chunk) {
      if (closed) return accumulated;
      const piece = String(chunk ?? "");
      if (!piece) return accumulated;
      accumulated += piece;
      if (!firstPainted) {
        // First delta: never delay.
        cancelScheduled();
        paintNow(accumulated);
        return accumulated;
      }
      schedule();
      return accumulated;
    },

    flush() {
      cancelScheduled();
      if (accumulated !== painted) paintNow(accumulated);
      return accumulated;
    },

    /**
     * Seal with server final text (exact). Falls back to accumulated if empty.
     * @param {unknown} serverText
     */
    finalize(serverText) {
      closed = true;
      cancelScheduled();
      const sealed = String(serverText ?? "");
      const finalText = sealed.length > 0 ? sealed : accumulated;
      accumulated = finalText;
      if (finalText !== painted || !firstPainted) {
        paintNow(finalText);
      }
      return finalText;
    },

    getAccumulated() {
      return accumulated;
    },

    getPainted() {
      return painted;
    },

    hasPainted() {
      return firstPainted;
    },
  };
}
