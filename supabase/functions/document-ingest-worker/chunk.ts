import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";

export const PLACEHOLDER_CHUNK_CONTENT =
  "[Phase22A placeholder] OCR worker connected. Real OCR will be added next.";

export async function replacePlaceholderChunks(
  admin: SupabaseClient,
  params: {
    customerId: string;
    documentId: string;
    docTitle: string | null;
    content: string;
  },
): Promise<number> {
  const now = new Date().toISOString();

  await admin
    .from("customer_document_chunks")
    .update({ deleted_at: now, updated_at: now })
    .eq("document_id", params.documentId)
    .eq("customer_id", params.customerId)
    .is("deleted_at", null);

  const { error } = await admin.from("customer_document_chunks").insert({
    customer_id: params.customerId,
    document_id: params.documentId,
    chunk_index: 0,
    content: params.content,
    embedding: null,
    embedding_model: null,
    doc_title: params.docTitle,
    page: 1,
    metadata: {
      phase: "22A-step2A",
      ocr_provider: "placeholder",
    },
  });

  if (error) {
    throw new Error(`chunk_insert_failed: ${error.message}`);
  }

  return 1;
}
