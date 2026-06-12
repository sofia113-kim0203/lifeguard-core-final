const PRODUCTION_ORIGIN = "https://lifeguard-core-final.vercel.app";

function isLocalOrPreviewOrigin(origin) {
  if (!origin) return false;
  if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin)) return true;
  return /\.vercel\.app$/i.test(origin) && origin !== PRODUCTION_ORIGIN;
}

/** Password reset email redirect — production always uses lifeguard-core-final.vercel.app. */
export function resolvePasswordResetRedirectUrl() {
  if (typeof window === "undefined") {
    return `${PRODUCTION_ORIGIN}/reset-password`;
  }

  const { origin } = window.location;
  const base = isLocalOrPreviewOrigin(origin) ? origin : PRODUCTION_ORIGIN;
  return `${base}/reset-password`;
}

export function isRecoveryHash() {
  if (typeof window === "undefined") return false;
  return window.location.hash.includes("type=recovery");
}
