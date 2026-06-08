import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { embedText, EMBEDDING_MODEL } from "./lib/embedding.ts";
import type { ExtractionRoute } from "./lib/types.ts";

export type DocumentChunkRecord = {
  id: string;
  content: string;
  chunk_index: number;
};

export async function replaceDocumentChunks(
  admin: SupabaseClient,
  params: {
    customerId: string;
    documentId: string;
    docTitle: string | null;
    content: string;
    extractionRoute: ExtractionRoute;
    ocrConfidenceAvg: number | null;
    workerPhase: string;
  },
): Promise<{ count: number; chunks: DocumentChunkRecord[] }> {
  const { error: deleteError } = await admin
    .from("customer_document_chunks")
    .delete()
    .eq("document_id", params.documentId)
    .eq("customer_id", params.customerId);

  if (deleteError) {
    throw new Error(`chunk_delete_failed: ${deleteError.message}`);
  }

  const { data, error: insertError } = await admin
    .from("customer_document_chunks")
    .insert({
      customer_id: params.customerId,
      document_id: params.documentId,
      chunk_index: 0,
      content: params.content,
      embedding: null,
      embedding_model: null,
      doc_title: params.docTitle,
      page: 1,
      metadata: {
        phase: params.workerPhase,
        ocr_provider: "clova",
        extraction_route: params.extractionRoute,
        ...(params.ocrConfidenceAvg !== null
          ? { ocr_confidence_avg: params.ocrConfidenceAvg }
          : {}),
      },
    })
    .select("id, content, chunk_index")
    .single();

  if (insertError || !data) {
    throw new Error(`chunk_insert_failed: ${insertError?.message ?? "unknown"}`);
  }

  return {
    count: 1,
    chunks: [data as DocumentChunkRecord],
  };
}

export async function applyChunkEmbeddings(
  admin: SupabaseClient,
  params: {
    customerId: string;
    documentId: string;
    chunks: DocumentChunkRecord[];
  },
): Promise<{ embeddingModel: string; embeddedCount: number }> {
  let embeddedCount = 0;

  for (const chunk of params.chunks) {
    const result = await embedText(chunk.content);

    const { error: updateError } = await admin
      .from("customer_document_chunks")
      .update({
        embedding: result.embedding,
        embedding_model: result.model,
      })
      .eq("id", chunk.id)
      .eq("customer_id", params.customerId)
      .eq("document_id", params.documentId);

    if (updateError) {
      throw new Error(`embedding_update_failed: ${updateError.message}`);
    }

    embeddedCount += 1;
  }

  return {
    embeddingModel: EMBEDDING_MODEL,
    embeddedCount,
  };
}
