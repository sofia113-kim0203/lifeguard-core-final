import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { PLACEHOLDER_CHUNK_CONTENT } from "./chunk.ts";

const STORAGE_BUCKET = "customer-documents";

export type DocumentRecord = {
  id: string;
  customer_id: string;
  storage_path: string;
  mime_type: string | null;
  original_filename: string | null;
  ingest_status: string;
  ingest_job_id: string | null;
  consent_snapshot: Record<string, unknown> | null;
  metadata_json: Record<string, unknown> | null;
};

export type PlaceholderExtractResult = {
  content: string;
  pageCount: number;
  storageVerified: boolean;
};

/** Skeleton: verify storage object exists; no real OCR. */
export async function runPlaceholderExtract(
  admin: SupabaseClient,
  document: DocumentRecord,
): Promise<PlaceholderExtractResult> {
  let storageVerified = false;

  if (document.storage_path) {
    const { data, error } = await admin.storage
      .from(STORAGE_BUCKET)
      .download(document.storage_path);

    storageVerified = !error && data !== null;
    if (error) {
      throw new Error(`storage_download_failed: ${error.message}`);
    }
  }

  return {
    content: PLACEHOLDER_CHUNK_CONTENT,
    pageCount: 1,
    storageVerified,
  };
}
