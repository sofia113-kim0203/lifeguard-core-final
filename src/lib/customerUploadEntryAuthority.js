/**
 * Client-safe mirror of the server KEY_UPLOAD_ENTRY switch.
 * Vite exposes only VITE_* values to customer code; deployment must mirror the
 * server switch as VITE_KEY_UPLOAD_ENTRY. Unknown keeps the established safe
 * default (active), while explicit off/shadow fail before any Storage mutation.
 */
export function getCustomerUploadEntryMode(env = import.meta.env) {
  const raw = String(env?.VITE_KEY_UPLOAD_ENTRY ?? env?.KEY_UPLOAD_ENTRY ?? "")
    .trim()
    .toLowerCase();
  if (raw === "off" || raw === "0") return "off";
  if (raw === "shadow") return "shadow";
  return "active";
}

export function assertCustomerUploadEntryAuthority(env = import.meta.env) {
  const mode = getCustomerUploadEntryMode(env);
  if (mode !== "active") {
    throw new Error("현재 문서 업로드는 KEY 확인 후에만 진행할 수 있습니다.");
  }
  return mode;
}
