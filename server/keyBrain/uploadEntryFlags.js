/**
 * KU-1 — KEY Entry flags (Upload path — first KEY Authority Entry).
 *
 * Tom lock: KEY_UPLOAD_ENTRY is not upload-only. It is the first Entry where
 * KEY Authority applies (judgment → Work Order → factory gate). The same
 * structure must extend to chat, photo, voice, hospital, mydata, and beyond
 * without KEY_*_ENTRY env proliferation.
 *
 * shadow: intake trace only · legacy pipeline unchanged.
 * active: unified KEY Authority on upload — intake + key_first_judgment + Work Order.
 */

export const KEY_UPLOAD_ENTRY_MODES = {
  OFF: "off",
  SHADOW: "shadow",
  ACTIVE: "active",
};

export const KEY_UPLOAD_ACTIVE_GATE = "KEY_UPLOAD_ACTIVE";

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

/** Tom A — single KEY upload authority (KU-2a + KU-2b). */
export function isKeyUploadActiveAuthorityEnabled(env = process.env) {
  return isKeyUploadEntryActiveEnabled(env);
}
