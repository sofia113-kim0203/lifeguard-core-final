/**
 * KeyNowActionCard visibility — hide empty/waiting cards so KEY chat stays first.
 * pending === true (or missing real CTA) → do not render.
 */
export function shouldShowKeyNowActionCard(action) {
  if (!action || typeof action !== "object") return false;
  if (action.pending === true) return false;
  const title = String(action.title || "").trim();
  const cta = String(action.ctaLabel || action.submitText || "").trim();
  return Boolean(title && cta);
}
