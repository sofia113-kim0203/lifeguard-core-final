/**
 * Advisor KEY natural stream paint (display only).
 * - Server deltas accumulate in order into a source buffer.
 * - First short bundle paints immediately.
 * - Later: short 어절 bundles (≈2–5), with punctuation/newline boundaries.
 * - Backlog catches up in short bundles — no bulk flush of a large remainder.
 * - Done drains remaining short buffer then seals to exact server text.
 * - No rewrite, no fake typing, no one-grapheme mode.
 */

export const AGENT_STREAM_MIN_EOJEOL = 2;
export const AGENT_STREAM_MAX_EOJEOL = 5;
export const AGENT_STREAM_SOFT_CHARS = 28;
export const AGENT_STREAM_MAX_WAIT_MS = 40;
export const AGENT_STREAM_SMALL_REMAINING = 48;

const BOUNDARY_CHAR = /[,.!?;:…，。？！\n]/;

/**
 * @param {string} text
 * @returns {RegExpMatchArray[]}
 */
export function matchEojeol(text) {
  const s = String(text ?? "");
  if (!s) return [];
  return Array.from(s.matchAll(/\S+/g));
}

/**
 * Take the next short natural batch from unpainted pending text.
 * Identity: repeated take + join reconstructs pending (when force drains residue).
 *
 * @param {string} pending
 * @param {{
 *   minEojeol?: number,
 *   maxEojeol?: number,
 *   softChars?: number,
 *   force?: boolean,
 * }} [opts]
 * @returns {string}
 */
export function takeNaturalStreamBatch(pending, opts = {}) {
  const s = String(pending ?? "");
  if (!s) return "";

  const minEojeol = Number(opts.minEojeol ?? AGENT_STREAM_MIN_EOJEOL);
  const maxEojeol = Number(opts.maxEojeol ?? AGENT_STREAM_MAX_EOJEOL);
  const softChars = Number(opts.softChars ?? AGENT_STREAM_SOFT_CHARS);
  const force = opts.force === true;

  const scanLimit = Math.min(s.length, Math.max(softChars * 3, 96));
  for (let i = 0; i < scanLimit; i += 1) {
    if (!BOUNDARY_CHAR.test(s[i])) continue;
    let end = i + 1;
    while (end < s.length && /[ \t]/.test(s[end])) end += 1;
    // Boundary flushes immediately (even a short lead-in).
    return s.slice(0, end);
  }

  const matches = matchEojeol(s);
  if (matches.length >= minEojeol) {
    const take = Math.min(maxEojeol, matches.length);
    const last = matches[take - 1];
    let end = last.index + last[0].length;
    while (end < s.length && /[ \t]/.test(s[end])) end += 1;
    return s.slice(0, end);
  }

  // Incomplete bundle / max-wait / soft-char — still cap so backlog cannot dump whole residue.
  if (force || s.length >= softChars) {
    if (matches.length >= 1) {
      const take = Math.min(maxEojeol, matches.length);
      const last = matches[take - 1];
      let end = last.index + last[0].length;
      while (end < s.length && /[ \t]/.test(s[end])) end += 1;
      return s.slice(0, end);
    }
    return s.slice(0, Math.min(s.length, softChars));
  }
  return "";
}

/**
 * @param {{
 *   onPaint: (text: string, meta: { first: boolean }) => void,
 *   raf?: (cb: FrameRequestCallback) => number,
 *   caf?: (id: number) => void,
 *   scheduleWait?: (cb: () => void, ms: number) => unknown,
 *   cancelWait?: (id: unknown) => void,
 *   maxWaitMs?: number,
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
  scheduleWait = (cb, ms) => setTimeout(cb, ms),
  cancelWait = (id) => clearTimeout(id),
  maxWaitMs = AGENT_STREAM_MAX_WAIT_MS,
} = {}) {
  if (typeof onPaint !== "function") {
    throw new Error("onPaint required");
  }

  let source = "";
  let painted = "";
  let rafId = null;
  let waitId = null;
  let sealed = false;
  let cancelled = false;
  let firstPainted = false;
  /** @type {((text: string) => void) | null} */
  let resolveDrain = null;

  function cancelScheduled() {
    if (rafId != null) {
      caf(rafId);
      rafId = null;
    }
    if (waitId != null) {
      cancelWait(waitId);
      waitId = null;
    }
  }

  function paintNow(text) {
    painted = text;
    const first = !firstPainted;
    firstPainted = true;
    onPaint(text, { first });
  }

  function maybeResolveDrain() {
    if (!sealed || cancelled) return;
    if (painted !== source) return;
    const resolve = resolveDrain;
    resolveDrain = null;
    resolve?.(source);
  }

  /**
   * Paint at most one short batch from backlog.
   * @param {boolean} force
   * @returns {boolean} more remain
   */
  function advanceBatch(force) {
    if (cancelled) return false;
    const pending = source.slice(painted.length);
    if (!pending) {
      maybeResolveDrain();
      return false;
    }

    // Done path: tiny remainder may flush as one small buffer (not whole-answer dump).
    if (
      sealed &&
      pending.length <= AGENT_STREAM_SMALL_REMAINING &&
      (force || pending.length > 0)
    ) {
      paintNow(source);
      maybeResolveDrain();
      return false;
    }

    const batch = takeNaturalStreamBatch(pending, {
      minEojeol: firstPainted ? AGENT_STREAM_MIN_EOJEOL : 1,
      maxEojeol: firstPainted ? AGENT_STREAM_MAX_EOJEOL : 3,
      force: force || sealed,
    });
    if (!batch) return painted.length < source.length;

    paintNow(painted + batch);
    return painted.length < source.length;
  }

  function armMaxWait() {
    if (waitId != null || sealed || cancelled) return;
    if (painted.length >= source.length) return;
    waitId = scheduleWait(() => {
      waitId = null;
      if (cancelled || sealed) return;
      const more = advanceBatch(true);
      if (more) schedule();
    }, maxWaitMs);
  }

  function schedule() {
    if (rafId != null || cancelled) return;
    if (painted.length >= source.length) {
      maybeResolveDrain();
      return;
    }
    rafId = raf(() => {
      rafId = null;
      if (cancelled) return;
      const pending = source.slice(painted.length);
      if (!pending) {
        maybeResolveDrain();
        return;
      }
      const batch = takeNaturalStreamBatch(pending, {
        minEojeol: AGENT_STREAM_MIN_EOJEOL,
        maxEojeol: AGENT_STREAM_MAX_EOJEOL,
        force: sealed,
      });
      if (!batch) {
        if (!sealed) armMaxWait();
        else {
          // Sealed but batch empty (shouldn't) — force small progress.
          advanceBatch(true);
          if (painted.length < source.length) schedule();
          else maybeResolveDrain();
        }
        return;
      }
      if (waitId != null) {
        cancelWait(waitId);
        waitId = null;
      }
      paintNow(painted + batch);
      if (painted.length < source.length) schedule();
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

      if (!firstPainted) {
        cancelScheduled();
        // First short bundle immediately (never wait for rAF / max-wait).
        const more = advanceBatch(true);
        if (more) schedule();
        return source;
      }

      schedule();
      return source;
    },

    /**
     * Seal with server final text; drain remaining in short bundles.
     * Never bulk-flushes a large remainder in one paint.
     * @param {unknown} serverText
     * @returns {Promise<string>}
     */
    finalize(serverText) {
      if (cancelled) return Promise.resolve(painted);

      const sealedText = String(serverText ?? "");
      source = sealedText.length > 0 ? sealedText : source;
      sealed = true;
      cancelScheduled();

      if (painted === source) {
        if (!firstPainted && source) paintNow(source);
        else if (firstPainted) onPaint(source, { first: false });
        return Promise.resolve(source);
      }

      // Keep painted prefix when it still matches; otherwise resync to common prefix length 0..n via full replace only if mismatch.
      if (painted && !source.startsWith(painted)) {
        // Rare server/client mismatch — jump to exact final (identity over partial wrong text).
        paintNow(source);
        return Promise.resolve(source);
      }

      return new Promise((resolve) => {
        resolveDrain = resolve;
        const more = advanceBatch(false);
        if (painted === source) {
          resolveDrain = null;
          resolve(source);
          return;
        }
        if (more || painted.length < source.length) schedule();
        else {
          advanceBatch(true);
          if (painted === source) {
            resolveDrain = null;
            resolve(source);
          } else schedule();
        }
      });
    },

    /** Stop animation; leave currently painted text (error path). */
    cancel() {
      cancelled = true;
      sealed = true;
      cancelScheduled();
      const text = painted;
      const resolve = resolveDrain;
      resolveDrain = null;
      resolve?.(text);
      return text;
    },

    getAccumulated() {
      return source;
    },

    getPainted() {
      return painted;
    },

    hasPainted() {
      return firstPainted;
    },
  };
}
