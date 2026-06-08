import {
  buildSharedPolicyMetadata,
  assertDocumentScopesDoNotMix,
  transitionSharedPolicyStatus,
} from "./sharedPolicyRegistry.js";

function nowIso(now = new Date()) {
  return now instanceof Date ? now.toISOString() : new Date(now).toISOString();
}

function baseResult(metadata, overrides = {}) {
  return {
    policy_pdf_id: overrides.policy_pdf_id ?? metadata.policy_pdf_id ?? null,
    carrier_name: metadata.carrier_name,
    product_name: metadata.product_name,
    source_file_name: metadata.source_file_name,
    processing_status: metadata.processing_status,
    text_extraction_status: overrides.text_extraction_status ?? "pending",
    chunk_generation_status: overrides.chunk_generation_status ?? "pending",
    embedding_status: overrides.embedding_status ?? "pending",
    vector_storage_status: overrides.vector_storage_status ?? "pending",
    chunk_count: overrides.chunk_count ?? metadata.chunk_count ?? 0,
    embedding_count: overrides.embedding_count ?? metadata.embedding_count ?? 0,
    searchable: overrides.searchable ?? false,
    errors: overrides.errors ?? [],
    generated_at: overrides.generated_at ?? nowIso(),
    metadata,
    extracted_text: overrides.extracted_text ?? null,
    chunks: overrides.chunks ?? [],
    embeddings: overrides.embeddings ?? [],
    vectors: overrides.vectors ?? [],
  };
}

export function registerSharedPolicyPdf(input = {}) {
  const metadata = buildSharedPolicyMetadata({ ...input, processing_status: "uploaded" });
  assertDocumentScopesDoNotMix(metadata);
  return baseResult(metadata, {
    policy_pdf_id: input.policy_pdf_id ?? null,
    text_extraction_status: "pending",
    generated_at: nowIso(input.now),
  });
}

export function extractSharedPolicyText(state, { extractedText, now = new Date() } = {}) {
  if (state?.metadata?.document_scope !== "shared_policy") throw new Error("shared_policy_pipeline_state_required");
  const text = String(extractedText ?? "").trim();
  if (!text) {
    return { ...state, text_extraction_status: "failed", errors: [...state.errors, "extracted_text_required"], generated_at: nowIso(now) };
  }
  const metadata = transitionSharedPolicyStatus(state.metadata, "text_extracted", { now });
  return baseResult(metadata, {
    ...state,
    policy_pdf_id: state.policy_pdf_id,
    text_extraction_status: "completed",
    chunk_generation_status: "pending",
    embedding_status: "pending",
    vector_storage_status: "pending",
    extracted_text: text,
    chunks: state.chunks,
    embeddings: state.embeddings,
    vectors: state.vectors,
    errors: state.errors,
    generated_at: nowIso(now),
  });
}

function splitText(text, maxChars = 500) {
  const paragraphs = String(text ?? "")
    .split(/\n{2,}|(?<=다\.)\s+/)
    .map((part) => part.trim())
    .filter(Boolean);
  const chunks = [];
  for (const paragraph of paragraphs) {
    if (paragraph.length <= maxChars) {
      chunks.push(paragraph);
      continue;
    }
    for (let index = 0; index < paragraph.length; index += maxChars) {
      chunks.push(paragraph.slice(index, index + maxChars));
    }
  }
  return chunks;
}

export function generateSharedPolicyChunks(state, { maxChars = 500, now = new Date() } = {}) {
  if (!state.extracted_text) throw new Error("text_extracted_state_required");
  const chunkTexts = splitText(state.extracted_text, maxChars);
  const chunks = chunkTexts.map((content, index) => ({
    chunk_id: `${state.policy_pdf_id ?? "policy"}-chunk-${index + 1}`,
    chunk_index: index,
    content,
    metadata: {
      carrier_name: state.carrier_name,
      product_name: state.product_name,
      product_code: state.metadata.product_code,
      policy_type: state.metadata.policy_type,
      source_file_name: state.source_file_name,
      visibility: "shared",
      knowledge_type: "policy_terms",
      reusable_for: ["claims_intelligence", "monthly_report", "rebalancing"],
    },
  }));
  const metadata = transitionSharedPolicyStatus(state.metadata, "chunked", { chunk_count: chunks.length, now });
  return baseResult(metadata, {
    ...state,
    policy_pdf_id: state.policy_pdf_id,
    text_extraction_status: state.text_extraction_status,
    chunk_generation_status: "completed",
    embedding_status: "pending",
    vector_storage_status: "pending",
    chunk_count: chunks.length,
    extracted_text: state.extracted_text,
    chunks,
    embeddings: [],
    vectors: [],
    errors: state.errors,
    generated_at: nowIso(now),
  });
}

export async function generateSharedPolicyEmbeddings(state, { openAiApiKey = process.env.OPENAI_API_KEY, embedText, now = new Date() } = {}) {
  if (!state.chunks?.length) throw new Error("chunked_state_required");
  if (!openAiApiKey && !embedText) {
    return {
      ...state,
      embedding_status: "blocked",
      errors: [...state.errors, "embedding_blocked_missing_openai_api_key"],
      generated_at: nowIso(now),
    };
  }
  const embeddings = [];
  for (const chunk of state.chunks) {
    const vector = embedText
      ? await embedText(chunk.content, chunk)
      : null;
    if (!Array.isArray(vector)) throw new Error("embedding_vector_required");
    embeddings.push({ chunk_id: chunk.chunk_id, embedding: vector, model: "mock-or-configured" });
  }
  const metadata = transitionSharedPolicyStatus(state.metadata, "embedded", { embedding_count: embeddings.length, now });
  return baseResult(metadata, {
    ...state,
    policy_pdf_id: state.policy_pdf_id,
    text_extraction_status: state.text_extraction_status,
    chunk_generation_status: state.chunk_generation_status,
    embedding_status: "completed",
    vector_storage_status: "pending",
    chunk_count: state.chunk_count,
    embedding_count: embeddings.length,
    extracted_text: state.extracted_text,
    chunks: state.chunks,
    embeddings,
    vectors: [],
    errors: state.errors,
    generated_at: nowIso(now),
  });
}

export async function storeSharedPolicyVectors(state, { storeVector, now = new Date() } = {}) {
  if (!state.embeddings?.length) throw new Error("embedded_state_required");
  if (!storeVector) throw new Error("vector_store_required");
  const vectors = [];
  for (const embedding of state.embeddings) {
    const stored = await storeVector(embedding, state);
    vectors.push(stored ?? { chunk_id: embedding.chunk_id, stored: true });
  }
  const metadata = transitionSharedPolicyStatus(state.metadata, "searchable", {
    chunk_count: state.chunk_count,
    embedding_count: state.embedding_count,
    now,
  });
  return baseResult(metadata, {
    ...state,
    policy_pdf_id: state.policy_pdf_id,
    text_extraction_status: state.text_extraction_status,
    chunk_generation_status: state.chunk_generation_status,
    embedding_status: state.embedding_status,
    vector_storage_status: "completed",
    chunk_count: state.chunk_count,
    embedding_count: state.embedding_count,
    searchable: true,
    extracted_text: state.extracted_text,
    chunks: state.chunks,
    embeddings: state.embeddings,
    vectors,
    errors: state.errors,
    generated_at: nowIso(now),
  });
}
