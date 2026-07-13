/** Home chat attach helpers — PDF + JPEG/PNG; no storage/supabase imports. */

/** PC + mobile shared file input accept (no capture= — same path on both). */
export const CHAT_ATTACH_FILE_ACCEPT =
  ".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png";

/** @deprecated Use CHAT_ATTACH_FILE_ACCEPT — kept as alias for existing imports. */
export const CHAT_PDF_FILE_ACCEPT = CHAT_ATTACH_FILE_ACCEPT;

function fileExtension(name) {
  const parts = String(name ?? "")
    .trim()
    .toLowerCase()
    .split(".");
  return parts.length > 1 ? parts.at(-1) : "";
}

/** True when the file is PDF before upload validation. */
export function isChatPdfFile(file) {
  if (!file) return false;
  const mime = String(file.type ?? "").trim().toLowerCase();
  if (mime === "application/pdf") return true;
  return fileExtension(file.name) === "pdf";
}

/** True when chat may attach this file (PDF / JPEG / PNG). */
export function isChatAttachFile(file) {
  if (!file) return false;
  const mime = String(file.type ?? "").trim().toLowerCase();
  if (mime === "application/pdf" || mime === "image/jpeg" || mime === "image/png") {
    return true;
  }
  // Some browsers leave type empty — fall back to extension (jpg normalized at upload).
  const ext = fileExtension(file.name);
  return ext === "pdf" || ext === "jpg" || ext === "jpeg" || ext === "png";
}
