/**
 * Phase 22D Step 4 — customer document RAG retrieval helper (server-side).
 */

export const EMBEDDING_MODEL = "text-embedding-3-small";
export const EMBEDDING_DIMENSIONS = 1536;
export const DEFAULT_RAG_TOP_K = 5;
export const DEFAULT_RAG_THRESHOLD = 0.3;

const OPENAI_EMBEDDINGS_URL = "https://api.openai.com/v1/embeddings";

export function resolveOpenAiApiKey(env = process.env) {
  return String(env.OPENAI_API_KEY ?? "").trim() || null;
}

function formatEmbeddingForRpc(values) {
  return `[${values.join(",")}]`;
}

/**
 * @param {string} text
 * @param {{ apiKey: string, fetchImpl?: typeof fetch }}
 */
export async function createQueryEmbedding(text, { apiKey, fetchImpl = fetch }) {
  const input = String(text ?? "").trim();
  if (!input) {
    throw new Error("query_embedding_empty");
  }
  if (!apiKey) {
    throw new Error("openai_api_not_configured");
  }

  const response = await fetchImpl(OPENAI_EMBEDDINGS_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: EMBEDDING_MODEL,
      input,
      dimensions: EMBEDDING_DIMENSIONS,
    }),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = payload?.error?.message ?? `http_${response.status}`;
    throw new Error(`query_embedding_failed: ${message}`);
  }

  const vector = payload?.data?.[0]?.embedding;
  if (!Array.isArray(vector) || vector.length !== EMBEDDING_DIMENSIONS) {
    throw new Error("query_embedding_invalid_dimensions");
  }

  return {
    model: EMBEDDING_MODEL,
    embedding: formatEmbeddingForRpc(vector),
    dimensions: EMBEDDING_DIMENSIONS,
  };
}

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {{
 *   customerId: string,
 *   queryEmbedding: string,
 *   topK?: number,
 *   threshold?: number,
 * }}
 */
export async function retrieveCustomerDocumentChunks(
  supabase,
  { customerId, queryEmbedding, topK = DEFAULT_RAG_TOP_K, threshold = DEFAULT_RAG_THRESHOLD },
) {
  if (!customerId) {
    throw new Error("customer_id_required");
  }

  const { data, error } = await supabase.rpc("match_customer_document_chunks", {
    p_customer_id: customerId,
    p_query_embedding: queryEmbedding,
    p_match_threshold: threshold,
    p_match_count: topK,
  });

  if (error) {
    throw new Error(`rag_retrieval_failed: ${error.message}`);
  }

  const rows = Array.isArray(data) ? data : [];
  if (rows.length === 0) {
    return [];
  }

  const chunkIds = rows.map((row) => row.id).filter(Boolean);
  const { data: indexRows, error: indexError } = await supabase
    .from("customer_document_chunks")
    .select("id, chunk_index")
    .in("id", chunkIds);

  if (indexError) {
    throw new Error(`chunk_index_lookup_failed: ${indexError.message}`);
  }

  const indexById = Object.fromEntries((indexRows ?? []).map((row) => [row.id, row.chunk_index]));

  return rows.map((row) => ({
    id: row.id,
    document_id: row.document_id,
    doc_title: row.doc_title ?? null,
    section: row.section ?? null,
    page: row.page ?? null,
    content: row.content ?? "",
    similarity: typeof row.similarity === "number" ? row.similarity : null,
    chunk_index: indexById[row.id] ?? null,
  }));
}

/**
 * @param {Array<{
 *   id: string,
 *   document_id: string,
 *   doc_title: string|null,
 *   chunk_index: number|null,
 *   page: number|null,
 *   similarity: number|null,
 *   content: string,
 * }>} chunks
 */
export function formatDocumentContextForPrompt(chunks) {
  if (!chunks?.length) {
    return "(no customer document context retrieved)";
  }

  return chunks
    .map((chunk, index) => {
      const label = `D${index + 1}`;
      const title = chunk.doc_title ?? "untitled";
      const page = chunk.page != null ? `page=${chunk.page}` : "page=unknown";
      const chunkIndex = chunk.chunk_index != null ? `chunk_index=${chunk.chunk_index}` : "chunk_index=unknown";
      const similarity =
        chunk.similarity != null ? `similarity=${chunk.similarity.toFixed(4)}` : "similarity=unknown";
      const content = String(chunk.content ?? "").trim();
      return [
        `[${label}] document_id=${chunk.document_id}`,
        `title=${title}`,
        chunkIndex,
        page,
        similarity,
        `content:`,
        content,
      ].join("\n");
    })
    .join("\n\n");
}

/**
 * @param {ReturnType<typeof retrieveCustomerDocumentChunks> extends Promise<infer T> ? T : never} chunks
 */
export function mapChunksToUsedSources(chunks) {
  return (chunks ?? []).map((chunk) => ({
    chunk_id: chunk.id,
    document_id: chunk.document_id,
    doc_title: chunk.doc_title,
    chunk_index: chunk.chunk_index,
    page: chunk.page,
    similarity: chunk.similarity,
    content_preview: String(chunk.content ?? "").slice(0, 200),
  }));
}

export function hasQueryTermOverlap(question, content) {
  const normalizedQuestion = String(question ?? "")
    .replace(/[?？!！.,。\s]/g, "")
    .trim();
  const haystack = String(content ?? "");
  if (!normalizedQuestion || !haystack) return false;

  if (haystack.includes(normalizedQuestion)) return true;

  const parts = normalizedQuestion.match(/[\u3131-\uD79DA-Za-z0-9]{2,}/g) ?? [];
  return parts.some((part) => part.length >= 2 && haystack.includes(part));
}

export function evaluateContextSufficiency(
  chunks,
  { threshold = DEFAULT_RAG_THRESHOLD, question = "" } = {},
) {
  if (!chunks?.length) {
    return { contextUsed: false, insufficientContext: true };
  }

  const topChunk = chunks[0];
  const topSimilarity = topChunk?.similarity;
  if (typeof topSimilarity === "number" && topSimilarity < threshold) {
    return { contextUsed: false, insufficientContext: true };
  }

  const overlap = hasQueryTermOverlap(question, topChunk?.content);
  if (question && typeof topSimilarity === "number" && topSimilarity < 0.52 && !overlap) {
    return { contextUsed: false, insufficientContext: true };
  }

  return { contextUsed: true, insufficientContext: false };
}
