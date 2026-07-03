/**
 * KB-0 — KEY Brain shadow feature flags.
 * Default OFF — zero overhead when disabled.
 */

export function isKeyBrainShadowEnabled(env = process.env) {
  const raw =
    env.KEY_BRAIN_SHADOW ??
    env.KEY_JUDGMENT_LAYER_SHADOW ??
    "";
  return String(raw).trim() === "1";
}

export function isKeyBrainShadowLogEnabled(env = process.env) {
  const raw = env.KEY_BRAIN_SHADOW_LOG ?? env.KEY_JUDGMENT_SHADOW_LOG ?? "";
  return String(raw).trim() === "1";
}
