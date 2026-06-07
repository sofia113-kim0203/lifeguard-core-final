const RRN_PATTERN = /\d{6}-\d{7}/g;

/** Redact obvious RRN patterns from OCR text before persistence. */
export function sanitizeOcrText(content: string): string {
  return content.replace(RRN_PATTERN, "[REDACTED_RRN]");
}
