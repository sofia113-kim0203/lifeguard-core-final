export const DEFAULT_HANWHA_POLICY_DOCUMENT_ID = "7a897bce-c8dd-4ca9-b6bb-1d17945c6002";

export const DEFAULT_HANWHA_POLICY_METADATA = {
  carrier_name: "한화손해보험",
  carrier_type: "non_life_insurance",
  product_name: "한화 더 경증 간편건강보험Ⅱ",
  product_code: "3ten55_se_2_2604_03_1",
  product_type: "health_insurance",
  underwriting_program: "Simplified",
  policy_type: "약관",
  version: "무배당2604",
  effective_date: "2026-04-01",
  source_file_name: "3ten55_se_2(2604)_03_1.pdf",
  visibility: "shared",
  knowledge_type: "policy_terms",
};

function requireValue(value, name) {
  const text = String(value ?? "").trim();
  if (!text) throw new Error(`${name}_required`);
  return text;
}

async function maybeSingle(query, label) {
  const { data, error } = await query.maybeSingle();
  if (error) throw new Error(`${label}: ${error.message}`);
  return data ?? null;
}

async function ensureCarrier(supabase, metadata) {
  const carrierName = requireValue(metadata.carrier_name, "carrier_name");
  const existing = await maybeSingle(
    supabase.from("carrier_registry").select("id, carrier_name, carrier_type, is_active").eq("carrier_name", carrierName),
    "carrier_lookup_failed",
  );
  if (existing) {
    if (!existing.is_active) {
      const { error } = await supabase.from("carrier_registry").update({ is_active: true }).eq("id", existing.id);
      if (error) throw new Error(`carrier_activate_failed: ${error.message}`);
    }
    return { ...existing, reused: true };
  }
  const { data, error } = await supabase
    .from("carrier_registry")
    .insert({ carrier_name: carrierName, carrier_type: metadata.carrier_type ?? "non_life_insurance", is_active: true })
    .select("id, carrier_name, carrier_type, is_active")
    .single();
  if (error) throw new Error(`carrier_insert_failed: ${error.message}`);
  return { ...data, reused: false };
}

async function ensureProduct(supabase, carrier, metadata) {
  const productName = requireValue(metadata.product_name, "product_name");
  const underwritingProgram = metadata.underwriting_program ?? "Standard";
  const existing = await maybeSingle(
    supabase
      .from("carrier_product_registry")
      .select("id, carrier_id, product_name, product_type, underwriting_program, is_active, metadata_json")
      .eq("carrier_id", carrier.id)
      .eq("product_name", productName)
      .eq("underwriting_program", underwritingProgram),
    "product_lookup_failed",
  );
  const metadataJson = {
    ...(existing?.metadata_json ?? {}),
    product_code: metadata.product_code,
    policy_type: metadata.policy_type,
    source: "customer_document_promotion",
  };
  if (existing) {
    const { error } = await supabase
      .from("carrier_product_registry")
      .update({ is_active: true, metadata_json: metadataJson })
      .eq("id", existing.id);
    if (error) throw new Error(`product_update_failed: ${error.message}`);
    return { ...existing, metadata_json: metadataJson, reused: true };
  }
  const { data, error } = await supabase
    .from("carrier_product_registry")
    .insert({
      carrier_id: carrier.id,
      product_name: productName,
      product_type: metadata.product_type ?? null,
      underwriting_program: underwritingProgram,
      is_active: true,
      metadata_json: metadataJson,
    })
    .select("id, carrier_id, product_name, product_type, underwriting_program, is_active, metadata_json")
    .single();
  if (error) throw new Error(`product_insert_failed: ${error.message}`);
  return { ...data, reused: false };
}

async function ensurePolicySource(supabase, carrier, product, metadata, targetPath) {
  const sourceVersion = requireValue(metadata.version, "version");
  const existing = await maybeSingle(
    supabase
      .from("real_policy_knowledge_sources")
      .select("id, carrier_id, product_id, source_name, source_type, source_file_reference, source_version, source_status, source_notes")
      .eq("carrier_id", carrier.id)
      .eq("product_id", product.id)
      .eq("source_file_reference", targetPath)
      .eq("source_version", sourceVersion),
    "policy_source_lookup_failed",
  );
  if (existing) return { ...existing, reused: true };
  const { data, error } = await supabase
    .from("real_policy_knowledge_sources")
    .insert({
      carrier_id: carrier.id,
      product_id: product.id,
      source_name: `${metadata.carrier_name} ${metadata.product_name} ${metadata.version}`,
      source_type: "policy_terms",
      source_file_reference: targetPath,
      source_version: sourceVersion,
      source_status: "registered",
      source_notes: `Promoted from customer document ${metadata.source_file_name}`,
    })
    .select("id, carrier_id, product_id, source_name, source_type, source_file_reference, source_version, source_status, source_notes")
    .single();
  if (error) throw new Error(`policy_source_insert_failed: ${error.message}`);
  return { ...data, reused: false };
}

async function ensurePolicyPdf(supabase, policySource, carrier, product, metadata, targetPath, fileSize, fileType) {
  const existing = await maybeSingle(
    supabase
      .from("real_policy_pdf_registry")
      .select("id, policy_source_id, carrier_id, product_id, file_name, file_size, file_type, storage_path, file_version, upload_status")
      .eq("carrier_id", carrier.id)
      .eq("product_id", product.id)
      .eq("storage_path", targetPath)
      .eq("file_version", metadata.version),
    "policy_pdf_lookup_failed",
  );
  if (existing) return { ...existing, reused: true };
  const { data, error } = await supabase
    .from("real_policy_pdf_registry")
    .insert({
      policy_source_id: policySource.id,
      carrier_id: carrier.id,
      product_id: product.id,
      file_name: metadata.source_file_name,
      file_size: fileSize,
      file_type: fileType || "application/pdf",
      storage_path: targetPath,
      file_version: metadata.version,
      upload_status: "uploaded",
    })
    .select("id, policy_source_id, carrier_id, product_id, file_name, file_size, file_type, storage_path, file_version, upload_status")
    .single();
  if (error) throw new Error(`policy_pdf_insert_failed: ${error.message}`);
  return { ...data, reused: false };
}


async function ensurePolicyBucket(supabase) {
  const { data: buckets, error: listError } = await supabase.storage.listBuckets();
  if (listError) throw new Error(`storage_bucket_list_failed: ${listError.message}`);
  if ((buckets ?? []).some((bucket) => bucket.name === "policy-pdfs" || bucket.id === "policy-pdfs")) {
    return { created: false, reused: true };
  }
  const { error: createError } = await supabase.storage.createBucket("policy-pdfs", { public: false });
  if (createError) throw new Error(`policy_bucket_create_failed: ${createError.message}`);
  return { created: true, reused: false };
}

async function copyStorageObject(supabase, sourcePath, targetPath, contentType = "application/pdf") {
  const { data: existing } = await supabase.storage.from("policy-pdfs").list(targetPath.split("/").slice(0, -1).join("/"), { limit: 100 });
  const targetName = targetPath.split("/").at(-1);
  const exists = (existing ?? []).some((item) => item.name === targetName);
  if (exists) return { copied: false, reused: true };

  const { data: downloaded, error: downloadError } = await supabase.storage.from("customer-documents").download(sourcePath);
  if (downloadError || !downloaded) throw new Error(`customer_storage_download_failed: ${downloadError?.message ?? "no_blob"}`);
  const arrayBuffer = await downloaded.arrayBuffer();
  const { error: uploadError } = await supabase.storage.from("policy-pdfs").upload(targetPath, new Uint8Array(arrayBuffer), {
    contentType,
    upsert: false,
  });
  if (uploadError) throw new Error(`policy_storage_upload_failed: ${uploadError.message}`);
  return { copied: true, reused: false, bytes: arrayBuffer.byteLength };
}

export async function promoteCustomerDocumentToSharedPolicy({
  supabase,
  customerDocumentId = DEFAULT_HANWHA_POLICY_DOCUMENT_ID,
  metadata = DEFAULT_HANWHA_POLICY_METADATA,
} = {}) {
  if (!supabase) throw new Error("supabase_required");
  const { data: document, error: docError } = await supabase
    .from("customer_documents")
    .select("id, customer_id, storage_path, mime_type, original_filename, metadata_json, ingest_status, deleted_at")
    .eq("id", customerDocumentId)
    .is("deleted_at", null)
    .single();
  if (docError || !document) throw new Error(`customer_document_not_found: ${docError?.message ?? customerDocumentId}`);
  if (document.mime_type !== "application/pdf") throw new Error("customer_document_must_be_pdf");

  const targetPath = `hanwha/${metadata.product_code}/${metadata.source_file_name}`;
  const bucket = await ensurePolicyBucket(supabase);
  const storage = await copyStorageObject(supabase, document.storage_path, targetPath, document.mime_type);
  const carrier = await ensureCarrier(supabase, metadata);
  const product = await ensureProduct(supabase, carrier, metadata);
  const policySource = await ensurePolicySource(supabase, carrier, product, metadata, targetPath);
  const policyPdf = await ensurePolicyPdf(
    supabase,
    policySource,
    carrier,
    product,
    metadata,
    targetPath,
    document.metadata_json?.byte_size ?? storage.bytes ?? null,
    document.mime_type,
  );

  const { count: customerStillExists } = await supabase
    .from("customer_documents")
    .select("id", { count: "exact", head: true })
    .eq("id", customerDocumentId)
    .is("deleted_at", null);

  return {
    source_customer_document: document,
    target_storage_path: targetPath,
    bucket,
    storage,
    carrier,
    product,
    policy_source: policySource,
    policy_pdf: policyPdf,
    shared_policy_metadata: {
      ...metadata,
      storage_path: targetPath,
      visibility: "shared",
      knowledge_type: "policy_terms",
      processing_status: policyPdf.upload_status,
      customer_id: null,
    },
    original_customer_document_preserved: customerStillExists === 1,
  };
}
