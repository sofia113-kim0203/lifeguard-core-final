/**
 * KU-2b — KEY first judgment trace (before factory enqueue).
 * shadow: trace step only · active: Phase A/B bisection enforced on client SSOT.
 */

export const KEY_UPLOAD_JUDGMENT_MODES = {
  OFF: "off",
  SHADOW: "shadow",
  ACTIVE: "active",
};

export function getKeyUploadJudgmentMode(env = process.env) {
  const raw = String(env.KEY_UPLOAD_JUDGMENT ?? "").trim().toLowerCase();
  if (raw === "shadow") return KEY_UPLOAD_JUDGMENT_MODES.SHADOW;
  if (raw === "active" || raw === "1") return KEY_UPLOAD_JUDGMENT_MODES.ACTIVE;
  return KEY_UPLOAD_JUDGMENT_MODES.OFF;
}

export function isKeyUploadJudgmentShadowEnabled(env = process.env) {
  return getKeyUploadJudgmentMode(env) === KEY_UPLOAD_JUDGMENT_MODES.SHADOW;
}

export function isKeyUploadJudgmentActiveEnabled(env = process.env) {
  return getKeyUploadJudgmentMode(env) === KEY_UPLOAD_JUDGMENT_MODES.ACTIVE;
}

export function isKeyUploadJudgmentEnabled(env = process.env) {
  const mode = getKeyUploadJudgmentMode(env);
  return mode === KEY_UPLOAD_JUDGMENT_MODES.SHADOW || mode === KEY_UPLOAD_JUDGMENT_MODES.ACTIVE;
}
