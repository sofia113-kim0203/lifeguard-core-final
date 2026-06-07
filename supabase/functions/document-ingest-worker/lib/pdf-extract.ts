import type { ExtractResult } from "./types.ts";

export function runPdfExtractStub(params: {
  storageVerified: boolean;
  originalFilename: string | null;
}): ExtractResult {
  const label = params.originalFilename ?? "document.pdf";

  return {
    content:
      `[Phase22A Step2B stub] route=pdf_stub file=${label} OCR not connected yet.`,
    pageCount: 1,
    storageVerified: params.storageVerified,
    extractionRoute: "pdf_stub",
    ocrProvider: "stub",
  };
}
