/**
 * Lifeguard home chat scroll helpers — pure (no DOM required for unit tests).
 */

export const LIFEGUARD_CHAT_NEAR_BOTTOM_PX = 120;

/**
 * @param {{ scrollTop?: number, scrollHeight?: number, clientHeight?: number } | null} el
 * @param {number} [thresholdPx]
 */
export function isScrollNearBottom(el, thresholdPx = LIFEGUARD_CHAT_NEAR_BOTTOM_PX) {
  if (!el || typeof el !== "object") return true;
  const scrollTop = Number(el.scrollTop);
  const scrollHeight = Number(el.scrollHeight);
  const clientHeight = Number(el.clientHeight);
  if (![scrollTop, scrollHeight, clientHeight].every((n) => Number.isFinite(n))) return true;
  const distanceFromBottom = scrollHeight - scrollTop - clientHeight;
  return distanceFromBottom <= thresholdPx;
}

/**
 * Decide whether message/content growth should auto-follow.
 * restoreForceOnce: first paint after session restore / session switch.
 * stickToBottom: user is (or was) near the bottom.
 */
export function shouldAutoFollowChatScroll({
  restoreForceOnce = false,
  stickToBottom = false,
} = {}) {
  return restoreForceOnce === true || stickToBottom === true;
}

/**
 * Show "최신 답변으로 ↓" when the user has scrolled away from the bottom
 * and new content may be below the read position.
 */
export function shouldShowJumpToLatestAnswer({
  stickToBottom = false,
  nearBottom = false,
} = {}) {
  return stickToBottom !== true && nearBottom !== true;
}

export const LIFEGUARD_CHAT_SCROLL_TOLERANCE_PX = 1;
export const LIFEGUARD_CHAT_GLIDE_MAX_STEP_PX = 6;
export const LIFEGUARD_CHAT_GLIDE_FACTOR = 0.35;

/**
 * @param {{ scrollTop?: number, scrollHeight?: number, clientHeight?: number } | null} el
 * @returns {number | null}
 */
export function readChatMaxScroll(el) {
  if (!el || typeof el !== "object") return null;
  const scrollHeight = Number(el.scrollHeight);
  const clientHeight = Number(el.clientHeight);
  if (![scrollHeight, clientHeight].every((n) => Number.isFinite(n))) return null;
  return Math.max(0, scrollHeight - clientHeight);
}

/**
 * One-frame sticky-follow glide step. Caps line-height jumps (max 6px).
 * @param {number} distance
 * @param {{ maxStepPx?: number, factor?: number, minStepPx?: number }} [opts]
 */
export function computeStickyFollowGlideStep(
  distance,
  {
    maxStepPx = LIFEGUARD_CHAT_GLIDE_MAX_STEP_PX,
    factor = LIFEGUARD_CHAT_GLIDE_FACTOR,
    minStepPx = 1,
  } = {},
) {
  const d = Number(distance);
  if (!Number.isFinite(d) || d <= 0) return 0;
  const maxStep = Number(maxStepPx);
  const minStep = Number(minStepPx);
  const f = Number(factor);
  if (![maxStep, minStep, f].every((n) => Number.isFinite(n))) return 0;
  return Math.min(maxStep, Math.max(minStep, d * f));
}

/**
 * Apply scroll-to-bottom on a scroll container (browser).
 * Skips write when already within tolerance of the bottom.
 * Safe no-op without an element.
 * @param {{ scrollTop?: number, scrollHeight?: number, clientHeight?: number } | null} el
 * @param {{ tolerancePx?: number }} [opts]
 * @returns {boolean} true when scrollTop was written
 */
export function scrollChatContainerToBottom(el, opts = {}) {
  if (!el || typeof el !== "object") return false;
  const tolerancePx = Number(opts.tolerancePx ?? LIFEGUARD_CHAT_SCROLL_TOLERANCE_PX);
  try {
    const scrollHeight = Number(el.scrollHeight);
    const clientHeight = Number(el.clientHeight);
    const scrollTop = Number(el.scrollTop);
    if (![scrollHeight, clientHeight, scrollTop].every((n) => Number.isFinite(n))) return false;
    const maxScroll = Math.max(0, scrollHeight - clientHeight);
    if (Math.abs(scrollTop - maxScroll) <= tolerancePx) return false;
    el.scrollTop = maxScroll;
    return true;
  } catch {
    return false;
  }
}

/**
 * Sticky bottom follow via one cancelable rAF glide loop.
 * Content growth only refreshes the latest maxScroll target; never starts a second loop.
 * At most one scrollTop write per frame; step capped so line wraps do not jump full line height.
 * @param {{
 *   raf?: (cb: FrameRequestCallback) => number,
 *   caf?: (id: number) => void,
 *   shouldFollow?: () => boolean,
 *   tolerancePx?: number,
 *   maxStepPx?: number,
 *   factor?: number,
 * }} [opts]
 */
export function createCoalescedScrollToBottom({
  raf = typeof requestAnimationFrame === "function"
    ? (cb) => requestAnimationFrame(cb)
    : (cb) => setTimeout(() => cb(Date.now()), 16),
  caf = typeof cancelAnimationFrame === "function"
    ? (id) => cancelAnimationFrame(id)
    : (id) => clearTimeout(id),
  shouldFollow = () => true,
  tolerancePx = LIFEGUARD_CHAT_SCROLL_TOLERANCE_PX,
  maxStepPx = LIFEGUARD_CHAT_GLIDE_MAX_STEP_PX,
  factor = LIFEGUARD_CHAT_GLIDE_FACTOR,
} = {}) {
  let rafId = null;
  /** @type {{ scrollTop?: number, scrollHeight?: number, clientHeight?: number } | null} */
  let pendingEl = null;

  const tick = () => {
    rafId = null;
    const el = pendingEl;
    if (!el || typeof shouldFollow !== "function" || !shouldFollow()) {
      pendingEl = null;
      return;
    }
    const maxScroll = readChatMaxScroll(el);
    const scrollTop = Number(el.scrollTop);
    if (maxScroll == null || !Number.isFinite(scrollTop)) {
      pendingEl = null;
      return;
    }
    const distance = maxScroll - scrollTop;
    if (distance <= tolerancePx) {
      if (distance > 0) {
        el.scrollTop = maxScroll;
      }
      pendingEl = null;
      return;
    }
    const step = computeStickyFollowGlideStep(distance, { maxStepPx, factor, minStepPx: 1 });
    const next = Math.min(maxScroll, scrollTop + step);
    el.scrollTop = next;
    if (!shouldFollow()) {
      pendingEl = null;
      return;
    }
    // Keep following the same element; later schedule() calls only refresh pendingEl/target.
    rafId = raf(tick);
  };

  return {
    /** @param {{ scrollTop?: number, scrollHeight?: number, clientHeight?: number } | null} el */
    schedule(el) {
      if (!el || typeof shouldFollow !== "function" || !shouldFollow()) return false;
      pendingEl = el;
      if (rafId != null) return true;
      rafId = raf(tick);
      return true;
    },
    /** Drop active glide / pending follow without writing scrollTop (manual scroll-up). */
    cancel() {
      if (rafId != null) {
        caf(rafId);
        rafId = null;
      }
      pendingEl = null;
    },
    get pending() {
      return rafId != null;
    },
  };
}

/**
 * Client display only — append-only final text vs Claude sealed original.
 * Never shrinks already-shown text when final is a continuation.
 */
export function resolveAppendOnlyAssistantText(shown = "", sealedOrChunk = "") {
  const a = String(shown ?? "");
  const b = String(sealedOrChunk ?? "");
  if (!b) return a;
  if (!a) return b;
  if (a === b) return a;
  if (b.startsWith(a)) return b;
  return b;
}

/**
 * Split Claude original into meaning units for paced append-only reveal.
 * Display-only — join(split(text)) === text. No sentence_hard_lite / rewrite.
 */
export function splitKeyAnswerMeaningUnits(text = "") {
  const raw = String(text ?? "");
  if (!raw) return [];

  const findEnd = (slice) => {
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
      /\n/,
    ];
    let best = -1;
    for (const re of patterns) {
      const m = slice.match(re);
      if (!m || m.index == null) continue;
      const end = m.index + m[0].length;
      if (end > 0 && (best < 0 || end < best)) best = end;
    }
    return best;
  };

  const units = [];
  let rest = raw;
  while (rest) {
    const end = findEnd(rest);
    if (end == null || end <= 0) {
      units.push(rest);
      break;
    }
    let cut = end;
    while (cut < rest.length && /[ \t]/.test(rest[cut])) cut += 1;
    units.push(rest.slice(0, cut));
    rest = rest.slice(cut);
  }
  return units;
}

/** Concatenation identity: join(split(text)) === text */
export function joinKeyAnswerMeaningUnits(units = []) {
  return (Array.isArray(units) ? units : []).join("");
}
