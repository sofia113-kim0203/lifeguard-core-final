export const SHARED_POLICY_VISIBILITY = "shared";
export const SHARED_POLICY_KNOWLEDGE_TYPE = "policy_terms";
export const PROCESSING_STATUSES = ["uploaded", "text_extracted", "chunked", "embedded", "searchable", "failed"];
export const POLICY_PIPELINE_STATUSES = ["uploaded", "queued", "processing", "ready", "failed"];

function requiredString(value, field) {
  const text = String(value ?? "").trim();
  if (!text) throw new Error(`${field}_required`);
  return text;
}

function optionalString(value) {
  const text = String(value ?? "").trim();
  return text || null;
}

function nowIso(now = new Date()) {
  return now instanceof Date ? now.toISOString() : new Date(now).toISOString();
}

export function buildCustomerDocumentMetadata({ customer_id, source_file_name, storage_path, now = new Date() } = {}) {
  return {
    document_scope: "customer_private",
    customer_id: requiredString(customer_id, "customer_id"),
    source_file_name: requiredString(source_file_name, "source_file_name"),
    storage_path: requiredString(storage_path, "storage_path"),
    visibility: "private",
    knowledge_type: "customer_document",
    created_at: nowIso(now),
    updated_at: nowIso(now),
  };
}

export function buildSharedPolicyMetadata({
  carrier_name,
  product_name,
  product_code = null,
  policy_type = "terms",
  version = "unknown",
  effective_date = null,
  source_file_name,
  storage_path,
  processing_status = "uploaded",
  chunk_count = 0,
  embedding_count = 0,
  now = new Date(),
  customer_id = null,
} = {}) {
  if (customer_id != null) throw new Error("shared_policy_must_not_have_customer_id");
  if (!PROCESSING_STATUSES.includes(processing_status)) throw new Error("invalid_processing_status");
  return {
    document_scope: "shared_policy",
    carrier_name: requiredString(carrier_name, "carrier_name"),
    product_name: requiredString(product_name, "product_name"),
    product_code: optionalString(product_code),
    policy_type: requiredString(policy_type, "policy_type"),
    version: requiredString(version, "version"),
    effective_date: optionalString(effective_date),
    source_file_name: requiredString(source_file_name, "source_file_name"),
    storage_path: requiredString(storage_path, "storage_path"),
    visibility: SHARED_POLICY_VISIBILITY,
    knowledge_type: SHARED_POLICY_KNOWLEDGE_TYPE,
    processing_status,
    chunk_count: Number(chunk_count) || 0,
    embedding_count: Number(embedding_count) || 0,
    created_at: nowIso(now),
    updated_at: nowIso(now),
  };
}

export function transitionSharedPolicyStatus(metadata, nextStatus, { chunk_count, embedding_count, now = new Date() } = {}) {
  if (metadata?.document_scope !== "shared_policy") throw new Error("shared_policy_metadata_required");
  if (!PROCESSING_STATUSES.includes(nextStatus)) throw new Error("invalid_processing_status");
  return {
    ...metadata,
    processing_status: nextStatus,
    chunk_count: chunk_count ?? metadata.chunk_count ?? 0,
    embedding_count: embedding_count ?? metadata.embedding_count ?? 0,
    updated_at: nowIso(now),
  };
}

export function assertDocumentScopesDoNotMix(metadata) {
  if (metadata?.document_scope === "customer_private") {
    if (!metadata.customer_id) throw new Error("customer_document_requires_customer_id");
    if (metadata.visibility === SHARED_POLICY_VISIBILITY) throw new Error("customer_document_cannot_be_shared_policy");
    return true;
  }
  if (metadata?.document_scope === "shared_policy") {
    if (metadata.customer_id != null) throw new Error("shared_policy_must_not_have_customer_id");
    if (metadata.visibility !== SHARED_POLICY_VISIBILITY) throw new Error("shared_policy_visibility_required");
    if (metadata.knowledge_type !== SHARED_POLICY_KNOWLEDGE_TYPE) throw new Error("shared_policy_knowledge_type_required");
    return true;
  }
  throw new Error("unknown_document_scope");
}

export function buildHanwhaPolicyMetadata(params = {}) {
  return buildSharedPolicyMetadata({
    carrier_name: "한화",
    policy_type: "terms",
    version: "2604/2605",
    ...params,
  });
}
