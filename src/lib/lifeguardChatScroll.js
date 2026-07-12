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
