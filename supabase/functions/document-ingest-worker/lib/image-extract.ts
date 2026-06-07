import type { ExtractResult } from "./types.ts";

export function runImageOcrExtractStub(params: {
  storageVerified: boolean;
  originalFilename: string | null;
}): ExtractResult {
  const label = params.originalFilename ?? "document.image";

  return {
    content:
      `[Phase22A Step2B stub] route=image_ocr_stub file=${label} OCR not connected yet.`,
    pageCount: 1,
    storageVerified: params.storageVerified,
    extractionRoute: "image_ocr_stub",
    ocrProvider: "stub",
  };
}
