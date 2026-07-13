/** Home chat PDF attach helpers — no storage/supabase imports. */

export const CHAT_PDF_FILE_ACCEPT = ".pdf,application/pdf";

/** True when the file looks like a PDF before calling uploadDocument validation. */
export function isChatPdfFile(file) {
  if (!file) return false;
  const mime = String(file.type ?? "").trim().toLowerCase();
  if (mime === "application/pdf") return true;
  const name = String(file.name ?? "").trim().toLowerCase();
  return name.endsWith(".pdf");
}
