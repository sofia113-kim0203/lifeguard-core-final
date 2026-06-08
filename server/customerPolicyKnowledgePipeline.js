import { promoteCustomerDocumentToSharedPolicy } from "./customerDocumentToSharedPolicyPromotion.js";
import { extractRealPolicyPdfText } from "./realPolicyTextExtractor.js";
import { generateRealPolicyChunks } from "./realPolicyChunker.js";
import { invokeRealPolicyEmbeddingWorker } from "./realPolicyEmbeddingGenerator.js";
import { invokeRealPolicyVectorStoreWorker } from "./realPolicyVectorStore.js";
import { inferHanwhaPolicyMetadataFromFilename } from "./hanwhaPolicyMetadataInference.js";

export const POLICY_PIPELINE_STATUSES = ["uploaded", "queued", "processing", "ready", "failed"];
export const POLICY_DOC_CLASSES = new Set(["policy_certificate", "terms"]);
export const POLICY_HINT_TYPES = new Set(["insurance_policy", "terms"]);
export const EXCLUDED_DOC_CLASSES = new Set(["claim", "medical", "other"]);
export const EXCLUDED_HINT_TYPES = new Set(["claim", "medical", "other"]);

const EMBEDDING_BATCH_LIMIT = 200;
const VECTOR_BATCH_LIMIT = 100;
const MAX_EMBEDDING_ROUNDS = 200;
const MAX_VECTOR_ROUNDS = 200;

function nowIso() {
  return new Date().toISOString();
}

export function isPolicyCustomerDocument(document) {
  if (!document || document.deleted_at) return false;
  if (document.mime_type !== "application/pdf") return false;
  if (EXCLUDED_DOC_CLASSES.has(document.doc_class)) return false;
  if (EXCLUDED_HINT_TYPES.has(document.customer_hint_type)) return false;
  return POLICY_DOC_CLASSES.has(document.doc_class) || POLICY_HINT_TYPES.has(document.customer_hint_type);
}

export function getPipelineStatus(document) {
  const status = document?.metadata_json?.policy_knowledge_pipeline?.status;
  return POLICY_PIPELINE_STATUSES.includes(status) ? status : "uploaded";
}

export function inferPolicyMetadataFromCustomerDocument(document) {
  return inferHanwhaPolicyMetadataFromFilename(document.original_filename);
}

async function updateCustomerPipelineStatus(supabase, customerDocumentId, patch) {
  const { data: row, error: readError } = await supabase
    .from("customer_documents")
    .select("metadata_json")
    .eq("id", customerDocumentId)
    .is("deleted_at", null)
    .single();
  if (readError || !row) throw new Error(`customer_document_lookup_failed: ${readError?.message ?? customerDocumentId}`);

  const current = row.metadata_json?.policy_knowledge_pipeline ?? {};
  const nextPipeline = {
    ...current,
    ...patch,
    updated_at: nowIso(),
  };
  const metadataJson = {
    ...(row.metadata_json ?? {}),
    policy_knowledge_pipeline: nextPipeline,
  };

  const { error: updateError } = await supabase
    .from("customer_documents")
    .update({ metadata_json: metadataJson })
    .eq("id", customerDocumentId);
  if (updateError) throw new Error(`pipeline_status_update_failed: ${updateError.message}`);
  return nextPipeline;
}

async function findRegistryByFilename(supabase, filename) {
  const { data, error } = await supabase
    .from("real_policy_pdf_registry")
    .select("id, file_name, storage_path, upload_status")
    .eq("file_name", filename)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`registry_lookup_failed: ${error.message}`);
  return data ?? null;
}

async function findReadyKnowledgeDoc(supabase, policyPdfId) {
  const { data, error } = await supabase
    .from("policy_knowledge_documents")
    .select("id, title, ingest_status, metadata_json")
    .contains("metadata_json", { policy_pdf_id: policyPdfId })
    .eq("ingest_status", "ready")
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`knowledge_doc_lookup_failed: ${error.message}`);
  return data ?? null;
}

async function countChunksByStatus(supabase, policyPdfId, status) {
  const { count, error } = await supabase
    .from("real_policy_chunk_items")
    .select("id", { count: "exact", head: true })
    .eq("policy_pdf_id", policyPdfId)
    .eq("chunk_status", status);
  if (error) throw new Error(`chunk_status_count_failed: ${error.message}`);
  return count ?? 0;
}

async function runEmbeddingLoop(supabase, { supabaseUrl, serviceRoleKey, policyPdfId, chunkGenerationRunId }) {
  let offset = 0;
  let totalEmbedded = 0;
  let lastBody = null;

  for (let round = 0; round < MAX_EMBEDDING_ROUNDS; round += 1) {
    const pending = await countChunksByStatus(supabase, policyPdfId, "created");
    if (pending === 0) break;

    const result = await invokeRealPolicyEmbeddingWorker({
      supabaseUrl,
      serviceRoleKey,
      policyPdfId,
      chunkGenerationRunId,
      chunkOffset: offset,
      chunkLimit: EMBEDDING_BATCH_LIMIT,
    });
    lastBody = result.body;
    if (result.status !== 200) {
      throw new Error(`embedding_worker_failed: ${JSON.stringify(result.body)}`);
    }
    totalEmbedded += result.body.embedded_count ?? 0;
    offset = result.body.next_offset ?? offset + EMBEDDING_BATCH_LIMIT;
    if ((result.body.embedded_count ?? 0) === 0 && (result.body.failed_count ?? 0) === 0) break;
  }

  const approved = await countChunksByStatus(supabase, policyPdfId, "approved");
  const pending = await countChunksByStatus(supabase, policyPdfId, "created");
  return { totalEmbedded, approvedCount: approved, pendingCount: pending, lastBody };
}

async function runVectorStoreLoop(supabase, { supabaseUrl, serviceRoleKey, policyPdfId }) {
  let offset = 0;
  let knowledgeDocId = null;
  let totalStored = 0;
  let lastBody = null;

  for (let round = 0; round < MAX_VECTOR_ROUNDS; round += 1) {
    const result = await invokeRealPolicyVectorStoreWorker({
      supabaseUrl,
      serviceRoleKey,
      policyPdfId,
      chunkOffset: offset,
      chunkLimit: VECTOR_BATCH_LIMIT,
      knowledgeDocId,
    });
    lastBody = result.body;
    if (result.status !== 200) {
      throw new Error(`vector_store_worker_failed: ${JSON.stringify(result.body)}`);
    }
    knowledgeDocId = result.body.knowledge_doc_id ?? knowledgeDocId;
    totalStored += result.body.stored_count ?? 0;
    if (result.body.all_done) break;
    offset = result.body.next_offset ?? offset + VECTOR_BATCH_LIMIT;
    if ((result.body.chunks_processed ?? 0) === 0) break;
  }

  const knowledgeDoc = knowledgeDocId
    ? await findReadyKnowledgeDoc(supabase, policyPdfId) ??
      (await supabase
        .from("policy_knowledge_documents")
        .select("id, ingest_status")
        .eq("id", knowledgeDocId)
        .maybeSingle()).data
    : null;

  return { knowledgeDocId, knowledgeDoc, totalStored, lastBody };
}

export async function processCustomerPolicyDocument({
  supabase,
  supabaseUrl,
  serviceRoleKey,
  customerDocumentId,
  metadata = null,
  dryRun = false,
} = {}) {
  if (!supabase) throw new Error("supabase_required");
  if (!supabaseUrl || !serviceRoleKey) throw new Error("supabaseUrl_and_serviceRoleKey_required");
  if (!customerDocumentId) throw new Error("customer_document_id_required");

  const { data: document, error: docError } = await supabase
    .from("customer_documents")
    .select("id, customer_id, storage_path, mime_type, original_filename, doc_class, customer_hint_type, metadata_json, ingest_status, deleted_at")
    .eq("id", customerDocumentId)
    .is("deleted_at", null)
    .single();
  if (docError || !document) throw new Error(`customer_document_not_found: ${docError?.message ?? customerDocumentId}`);

  if (!isPolicyCustomerDocument(document)) {
    return {
      customer_document_id: customerDocumentId,
      skipped: true,
      reason: "not_policy_document_type",
      document,
    };
  }

  const currentStatus = getPipelineStatus(document);
  if (currentStatus === "ready") {
    return {
      customer_document_id: customerDocumentId,
      skipped: true,
      reason: "already_ready",
      pipeline_status: currentStatus,
      document,
    };
  }

  const existingRegistry = await findRegistryByFilename(supabase, document.original_filename);
  const existingKnowledge = existingRegistry
    ? await findReadyKnowledgeDoc(supabase, existingRegistry.id)
    : null;

  if (existingRegistry && existingKnowledge) {
    const pipeline = await updateCustomerPipelineStatus(supabase, customerDocumentId, {
      status: "ready",
      stage: "complete",
      policy_pdf_id: existingRegistry.id,
      knowledge_document_id: existingKnowledge.id,
      reused: true,
      error: null,
    });
    return {
      customer_document_id: customerDocumentId,
      skipped: false,
      reused: true,
      pipeline_status: pipeline.status,
      policy_pdf_id: existingRegistry.id,
      knowledge_document_id: existingKnowledge.id,
      document,
    };
  }

  if (dryRun) {
    return {
      customer_document_id: customerDocumentId,
      dry_run: true,
      would_process: true,
      document,
      inferred_metadata: metadata ?? inferPolicyMetadataFromCustomerDocument(document),
    };
  }

  await updateCustomerPipelineStatus(supabase, customerDocumentId, {
    status: "queued",
    stage: "queued",
    error: null,
  });

  try {
    await updateCustomerPipelineStatus(supabase, customerDocumentId, {
      status: "processing",
      stage: "promotion",
    });

    const resolvedMetadata = metadata ?? inferPolicyMetadataFromCustomerDocument(document);
    const promotion = await promoteCustomerDocumentToSharedPolicy({
      supabase,
      customerDocumentId,
      metadata: resolvedMetadata,
    });
    const policyPdfId = promotion.policy_pdf.id;

    await updateCustomerPipelineStatus(supabase, customerDocumentId, {
      status: "processing",
      stage: "text_extraction",
      policy_pdf_id: policyPdfId,
    });

    const extraction = await extractRealPolicyPdfText({ supabase, policyPdfId });
    const textExtractionRunId = extraction.text_extraction_run.id;

    await updateCustomerPipelineStatus(supabase, customerDocumentId, {
      status: "processing",
      stage: "chunk_generation",
      policy_pdf_id: policyPdfId,
      text_extraction_run_id: textExtractionRunId,
    });

    const chunking = await generateRealPolicyChunks({
      supabase,
      policyPdfId,
      textExtractionRunId,
    });
    const chunkGenerationRunId = chunking.chunk_generation_run.id;

    await updateCustomerPipelineStatus(supabase, customerDocumentId, {
      status: "processing",
      stage: "embedding",
      policy_pdf_id: policyPdfId,
      chunk_generation_run_id: chunkGenerationRunId,
    });

    const embedding = await runEmbeddingLoop(supabase, {
      supabaseUrl,
      serviceRoleKey,
      policyPdfId,
      chunkGenerationRunId,
    });
    if (embedding.pendingCount > 0) {
      throw new Error(`embedding_incomplete: pending=${embedding.pendingCount}`);
    }

    await updateCustomerPipelineStatus(supabase, customerDocumentId, {
      status: "processing",
      stage: "vector_storage",
      policy_pdf_id: policyPdfId,
    });

    const vectorStore = await runVectorStoreLoop(supabase, {
      supabaseUrl,
      serviceRoleKey,
      policyPdfId,
    });

    const knowledgeDoc = vectorStore.knowledgeDoc;
    if (!knowledgeDoc || knowledgeDoc.ingest_status !== "ready") {
      throw new Error(`knowledge_doc_not_ready: ${vectorStore.knowledgeDocId ?? "missing"}`);
    }

    const pipeline = await updateCustomerPipelineStatus(supabase, customerDocumentId, {
      status: "ready",
      stage: "complete",
      policy_pdf_id: policyPdfId,
      knowledge_document_id: knowledgeDoc.id,
      chunk_count: chunking.chunk_count,
      embedded_count: embedding.approvedCount,
      vector_count: vectorStore.totalStored,
      error: null,
    });

    return {
      customer_document_id: customerDocumentId,
      skipped: false,
      reused: false,
      pipeline_status: pipeline.status,
      policy_pdf_id: policyPdfId,
      knowledge_document_id: knowledgeDoc.id,
      promotion,
      extraction,
      chunking,
      embedding,
      vectorStore,
      document,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const pipeline = await updateCustomerPipelineStatus(supabase, customerDocumentId, {
      status: "failed",
      stage: "failed",
      error: message,
    });
    return {
      customer_document_id: customerDocumentId,
      skipped: false,
      failed: true,
      pipeline_status: pipeline.status,
      error_message: message,
      document,
    };
  }
}

export async function runCustomerPolicyKnowledgeAutoPipeline({
  supabase,
  supabaseUrl,
  serviceRoleKey,
  customerDocumentIds = null,
  filenames = null,
  limit = 50,
  dryRun = false,
} = {}) {
  if (!supabase) throw new Error("supabase_required");

  let query = supabase
    .from("customer_documents")
    .select("id, original_filename, doc_class, customer_hint_type, mime_type, metadata_json, deleted_at")
    .is("deleted_at", null)
    .eq("mime_type", "application/pdf")
    .order("created_at", { ascending: true });

  if (customerDocumentIds?.length) {
    query = query.in("id", customerDocumentIds);
  }
  if (filenames?.length) {
    query = query.in("original_filename", filenames);
  }

  const { data: documents, error } = await query.limit(limit);
  if (error) throw new Error(`customer_documents_lookup_failed: ${error.message}`);

  const eligible = (documents ?? []).filter(isPolicyCustomerDocument);
  const results = [];

  for (const document of eligible) {
    const status = getPipelineStatus(document);
    if (status === "ready") {
      results.push({
        customer_document_id: document.id,
        original_filename: document.original_filename,
        skipped: true,
        reason: "already_ready",
        pipeline_status: status,
      });
      continue;
    }

    const result = await processCustomerPolicyDocument({
      supabase,
      supabaseUrl,
      serviceRoleKey,
      customerDocumentId: document.id,
      dryRun,
    });
    results.push({
      original_filename: document.original_filename,
      ...result,
    });
  }

  const summary = {
    scanned: documents?.length ?? 0,
    eligible: eligible.length,
    processed: results.filter((row) => !row.skipped && !row.failed).length,
    skipped: results.filter((row) => row.skipped).length,
    failed: results.filter((row) => row.failed).length,
    ready: results.filter((row) => row.pipeline_status === "ready").length,
  };

  return { summary, results };
}
