import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import type { ExtractionRoute } from "./lib/types.ts";

export async function replaceDocumentChunks(
  admin: SupabaseClient,
  params: {
    customerId: string;
    documentId: string;
    docTitle: string | null;
    content: string;
    extractionRoute: ExtractionRoute;
  },
): Promise<number> {
  // Hard-delete prior chunks (including soft-deleted rows) so re-ingest can
  // safely reuse chunk_index=0 without violating customer_document_chunks_doc_chunk_uq.
  const { error: deleteError } = await admin
    .from("customer_document_chunks")
    .delete()
    .eq("document_id", params.documentId)
    .eq("customer_id", params.customerId);

  if (deleteError) {
    throw new Error(`chunk_delete_failed: ${deleteError.message}`);
  }

  const { error: insertError } = await admin.from("customer_document_chunks").insert({
    customer_id: params.customerId,
    document_id: params.documentId,
    chunk_index: 0,
    content: params.content,
    embedding: null,
    embedding_model: null,
    doc_title: params.docTitle,
    page: 1,
    metadata: {
      phase: "22A-step2B",
      ocr_provider: "stub",
      extraction_route: params.extractionRoute,
    },
  });

  if (insertError) {
    throw new Error(`chunk_insert_failed: ${insertError.message}`);
  }

  return 1;
}
