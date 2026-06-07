import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { runImageOcrExtract } from "./lib/image-extract.ts";
import { runPdfExtract } from "./lib/pdf-extract.ts";
import { resolveExtractionRoute } from "./lib/routes.ts";
import type { DocumentRecord, ExtractResult } from "./lib/types.ts";
import { sanitizeOcrText } from "./pii.ts";

const STORAGE_BUCKET = "customer-documents";

export type { DocumentRecord, ExtractResult };

async function downloadStorageObject(
  admin: SupabaseClient,
  storagePath: string,
): Promise<Uint8Array> {
  const { data, error } = await admin.storage
    .from(STORAGE_BUCKET)
    .download(storagePath);

  if (error) {
    throw new Error(`storage_download_failed: ${error.message}`);
  }

  if (!data) {
    throw new Error("storage_download_failed: empty_object");
  }

  return new Uint8Array(await data.arrayBuffer());
}

/** Route-aware CLOVA OCR extraction orchestrator. */
export async function runExtract(
  admin: SupabaseClient,
  document: DocumentRecord,
): Promise<ExtractResult> {
  const extractionRoute = resolveExtractionRoute({
    mimeType: document.mime_type,
    originalFilename: document.original_filename,
  });

  if (!document.storage_path) {
    throw new Error("storage_download_failed: missing_storage_path");
  }

  const fileBytes = await downloadStorageObject(admin, document.storage_path);
  const storageVerified = fileBytes.length > 0;

  const extractParams = {
    fileBytes,
    mimeType: document.mime_type,
    originalFilename: document.original_filename,
    storageVerified,
  };

  const routed = extractionRoute === "pdf_stub"
    ? await runPdfExtract(extractParams)
    : await runImageOcrExtract(extractParams);

  const sanitized = sanitizeOcrText(routed.content).trim();
  if (!sanitized) {
    throw new Error("clova_ocr_empty");
  }

  return {
    ...routed,
    content: sanitized,
  };
}
