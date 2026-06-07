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
    ocrConfidenceAvg: number | null;
  },
): Promise<number> {
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
      phase: "22A-step2C",
      ocr_provider: "clova",
      extraction_route: params.extractionRoute,
      ...(params.ocrConfidenceAvg !== null
        ? { ocr_confidence_avg: params.ocrConfidenceAvg }
        : {}),
    },
  });

  if (insertError) {
    throw new Error(`chunk_insert_failed: ${insertError.message}`);
  }

  return 1;
}
