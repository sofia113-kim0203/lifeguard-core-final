/**
 * KU-1 — Upload KEY Entry feature flags.
 * shadow: intake trace only · legacy pipeline unchanged.
 */

export const KEY_UPLOAD_ENTRY_MODES = {
  OFF: "off",
  SHADOW: "shadow",
  ACTIVE: "active",
};

export function getKeyUploadEntryMode(env = process.env) {
  const raw = String(env.KEY_UPLOAD_ENTRY ?? "").trim().toLowerCase();
  if (raw === "shadow") return KEY_UPLOAD_ENTRY_MODES.SHADOW;
  if (raw === "active" || raw === "1") return KEY_UPLOAD_ENTRY_MODES.ACTIVE;
  return KEY_UPLOAD_ENTRY_MODES.OFF;
}

export function isKeyUploadEntryShadowEnabled(env = process.env) {
  return getKeyUploadEntryMode(env) === KEY_UPLOAD_ENTRY_MODES.SHADOW;
}

export function isKeyUploadEntryActiveEnabled(env = process.env) {
  return getKeyUploadEntryMode(env) === KEY_UPLOAD_ENTRY_MODES.ACTIVE;
}
