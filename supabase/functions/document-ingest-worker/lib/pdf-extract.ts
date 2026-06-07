import { runClovaOcr } from "./clova-ocr.ts";
import type { ExtractResult } from "./types.ts";

export async function runPdfExtract(params: {
  fileBytes: Uint8Array;
  mimeType: string | null;
  originalFilename: string | null;
  storageVerified: boolean;
}): Promise<ExtractResult> {
  const ocr = await runClovaOcr({
    fileBytes: params.fileBytes,
    mimeType: params.mimeType ?? "application/pdf",
    originalFilename: params.originalFilename,
  });

  return {
    content: ocr.text,
    pageCount: ocr.pageCount > 0 ? ocr.pageCount : 1,
    storageVerified: params.storageVerified,
    extractionRoute: "pdf_stub",
    ocrProvider: "clova",
    ocrConfidenceAvg: ocr.ocrConfidenceAvg,
  };
}
