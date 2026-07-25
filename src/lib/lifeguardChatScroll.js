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

/**
 * Apply scroll-to-bottom on a scroll container (browser).
 * Safe no-op without an element.
 */
export function scrollChatContainerToBottom(el) {
  if (!el || typeof el !== "object") return false;
  try {
    const height = Number(el.scrollHeight);
    if (!Number.isFinite(height)) return false;
    el.scrollTop = height;
    return true;
  } catch {
    return false;
  }
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
