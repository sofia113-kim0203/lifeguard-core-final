/**
 * Phase 25 Step 1I — shared policy knowledge RAG retrieval (server-side).
 * Single search path: policy_knowledge_chunks via match_policy_knowledge_chunks RPC.
 * Ready gate enforced in RPC (ingest_status = ready).
 */

import {
  createQueryEmbedding,
  DEFAULT_RAG_THRESHOLD,
  DEFAULT_RAG_TOP_K,
  EMBEDDING_MODEL,
} from "./documentRagContext.js";

export const DEFAULT_POLICY_PDF_ID = "526e2e06-1729-4f95-9bda-0b410b604de2";
export const POLICY_RAG_MATCH_RPC = "match_policy_knowledge_chunks";

export function mapPolicyKnowledgeChunks(rows) {
  const list = Array.isArray(rows) ? rows : [];
  return list.map((row) => ({
    id: row.id,
    document_id: row.document_id,
    knowledge_document_id: row.knowledge_document_id ?? row.document_id,
    document_title: row.document_title ?? null,
    document_type: row.document_type ?? null,
    policy_pdf_id: row.policy_pdf_id ?? null,
    carrier_id: row.carrier_id ?? null,
    product_id: row.product_id ?? null,
    chunk_order: row.chunk_order ?? null,
    chunk_text: row.chunk_text ?? "",
    embedding_model: row.embedding_model ?? null,
    similarity: typeof row.similarity === "number" ? row.similarity : null,
  }));
}

export function formatPolicyKnowledgeContextForPrompt(chunks) {
  if (!chunks?.length) {
    return "[No policy knowledge context retrieved]";
  }
  return chunks
    .map((chunk, index) => {
      const label = `[P${index + 1}]`;
      const title = chunk.document_title ? ` title="${chunk.document_title}"` : "";
      const order = chunk.chunk_order != null ? ` order=${chunk.chunk_order}` : "";
      return `${label}${title}${order}\n${chunk.chunk_text}`;
    })
    .join("\n\n");
}

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 */
export async function retrievePolicyKnowledgeChunks(
  supabase,
  {
    queryEmbedding,
    knowledgeDocumentId = null,
    policyPdfId = null,
    carrierId = null,
    productId = null,
    topK = DEFAULT_RAG_TOP_K,
    threshold = DEFAULT_RAG_THRESHOLD,
  },
) {
  if (!queryEmbedding) {
    throw new Error("query_embedding_required");
  }

  const { data, error } = await supabase.rpc(POLICY_RAG_MATCH_RPC, {
    p_query_embedding: queryEmbedding,
    p_knowledge_document_id: knowledgeDocumentId || null,
    p_policy_pdf_id: policyPdfId || null,
    p_carrier_id: carrierId || null,
    p_product_id: productId || null,
    p_match_threshold: threshold,
    p_match_count: topK,
  });

  if (error) {
    throw new Error(`policy_rag_retrieval_failed: ${error.message}`);
  }

  return mapPolicyKnowledgeChunks(data);
}

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 */
export async function searchPolicyKnowledgeByQuery(
  supabase,
  {
    query,
    apiKey,
    knowledgeDocumentId = null,
    policyPdfId = DEFAULT_POLICY_PDF_ID,
    carrierId = null,
    productId = null,
    topK = DEFAULT_RAG_TOP_K,
    threshold = DEFAULT_RAG_THRESHOLD,
    fetchImpl = fetch,
  },
) {
  const trimmed = String(query ?? "").trim();
  if (!trimmed) {
    throw new Error("query_required");
  }
  if (!apiKey) {
    throw new Error("openai_api_not_configured");
  }

  const embedded = await createQueryEmbedding(trimmed, { apiKey, fetchImpl });
  const chunks = await retrievePolicyKnowledgeChunks(supabase, {
    queryEmbedding: embedded.embedding,
    knowledgeDocumentId,
    policyPdfId,
    carrierId,
    productId,
    topK,
    threshold,
  });

  return {
    query: trimmed,
    embedding_model: embedded.model ?? EMBEDDING_MODEL,
    result_count: chunks.length,
    chunks,
    context_preview: formatPolicyKnowledgeContextForPrompt(chunks.slice(0, 3)),
  };
}
