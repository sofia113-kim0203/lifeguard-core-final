import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { runImageOcrExtractStub } from "./lib/image-extract.ts";
import { runPdfExtractStub } from "./lib/pdf-extract.ts";
import { resolveExtractionRoute } from "./lib/routes.ts";
import type { DocumentRecord, ExtractResult } from "./lib/types.ts";
import { applyPiiStub } from "./pii.ts";

const STORAGE_BUCKET = "customer-documents";

export type { DocumentRecord, ExtractResult };

async function verifyStorageObject(
  admin: SupabaseClient,
  storagePath: string,
): Promise<boolean> {
  const { data, error } = await admin.storage
    .from(STORAGE_BUCKET)
    .download(storagePath);

  if (error) {
    throw new Error(`storage_download_failed: ${error.message}`);
  }

  return data !== null;
}

/** Route-aware extraction orchestrator. Stubs only — no paid OCR connected. */
export async function runExtract(
  admin: SupabaseClient,
  document: DocumentRecord,
): Promise<ExtractResult> {
  const extractionRoute = resolveExtractionRoute({
    mimeType: document.mime_type,
    originalFilename: document.original_filename,
  });

  let storageVerified = false;
  if (document.storage_path) {
    storageVerified = await verifyStorageObject(admin, document.storage_path);
  }

  const stubParams = {
    storageVerified,
    originalFilename: document.original_filename,
  };

  const routed =
    extractionRoute === "pdf_stub"
      ? runPdfExtractStub(stubParams)
      : runImageOcrExtractStub(stubParams);

  return {
    ...routed,
    content: applyPiiStub(routed.content),
  };
}
