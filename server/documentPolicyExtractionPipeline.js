import { createClient } from "@supabase/supabase-js";
import { extractPolicyFieldsFromOcrText } from "./documentPolicyExtractor.js";

const EXTRACTOR_VERSION = "step4-ocr-policy-v1";

function createServiceClient(env = process.env) {
  const url = String(env.SUPABASE_URL ?? env.VITE_SUPABASE_URL ?? "").trim();
  const serviceRoleKey = String(env.SERVICE_ROLE_KEY ?? env.SUPABASE_SERVICE_ROLE_KEY ?? "").trim();
  if (!url || !serviceRoleKey) return null;
  return createClient(url, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
}

async function loadDocumentChunks(admin, customerId, documentId) {
  const { data, error } = await admin
    .from("customer_document_chunks")
    .select("id, chunk_index, content, metadata")
    .eq("customer_id", customerId)
    .eq("document_id", documentId)
    .is("deleted_at", null)
    .order("chunk_index", { ascending: true });

  if (error) throw new Error(`chunk_load_failed: ${error.message}`);
  return data ?? [];
}

async function hasInsuranceDataConsent(admin, customerId) {
  const { data, error } = await admin.rpc("lifeguard_has_consent", {
    p_customer_id: customerId,
    p_consent_type: "insurance_data_processing",
  });
  if (error) return false;
  return data === true;
}

async function findExistingUploadPolicy(admin, customerId, documentId) {
  const { data, error } = await admin
    .from("profile_insurance_policies")
    .select("id, coverage_summary")
    .eq("customer_id", customerId)
    .eq("source", "upload_extract")
    .is("deleted_at", null);

  if (error) throw new Error(`policy_lookup_failed: ${error.message}`);
  return (data ?? []).find((row) => row.coverage_summary?.source_document_id === documentId) ?? null;
}

async function upsertUploadPolicy(admin, customerId, documentId, extraction) {
  const fields = extraction.fields;
  const coverageSummary = {
    source_document_id: documentId,
    extractor_version: EXTRACTOR_VERSION,
    extraction_confidence: extraction.confidence,
    policyholder: fields.policyholder,
    insured: fields.insured,
    payment_period: fields.payment_period,
    insurance_period: fields.insurance_period,
    coverage_name: fields.coverage_name,
    rider_name: fields.rider_name,
    coverage_amount: fields.coverage_amount,
    coverage_categories: fields.coverage_categories,
    detected_coverages: fields.detected_coverages ?? fields.coverage_categories,
    extracted_at: new Date().toISOString(),
    extraction_json: fields,
  };

  const existing = await findExistingUploadPolicy(admin, customerId, documentId);
  const row = {
    customer_id: customerId,
    insurer_name: fields.insurer_name,
    product_name: fields.product_name,
    policy_type: fields.policy_type,
    monthly_premium: fields.monthly_premium,
    coverage_summary: coverageSummary,
    source: "upload_extract",
    is_active: true,
    updated_at: new Date().toISOString(),
  };

  if (existing?.id) {
    const { data, error } = await admin
      .from("profile_insurance_policies")
      .update(row)
      .eq("id", existing.id)
      .eq("customer_id", customerId)
      .select("id")
      .single();
    if (error) throw new Error(`policy_update_failed: ${error.message}`);
    return { policy_id: data.id, action: "updated" };
  }

  const { data, error } = await admin
    .from("profile_insurance_policies")
    .insert(row)
    .select("id")
    .single();
  if (error) throw new Error(`policy_insert_failed: ${error.message}`);
  return { policy_id: data.id, action: "inserted" };
}

async function invokeMemoryBuilder(env, customerId) {
  const url = String(env.SUPABASE_URL ?? env.VITE_SUPABASE_URL ?? "").trim();
  const serviceRoleKey = String(env.SERVICE_ROLE_KEY ?? env.SUPABASE_SERVICE_ROLE_KEY ?? "").trim();
  if (!url || !serviceRoleKey) {
    return { invoked: false, reason: "service_role_not_configured" };
  }

  const response = await fetch(`${url}/functions/v1/memory-builder-worker`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${serviceRoleKey}`,
      apikey: serviceRoleKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      customer_id: customerId,
      mode: "extract",
      scope: "profile_health_policy",
    }),
  });

  const body = await response.json().catch(() => ({}));
  return {
    invoked: true,
    status: response.status,
    body,
  };
}

async function updateDocumentExtractionMetadata(admin, customerId, documentId, patch) {
  const { data: doc, error: readError } = await admin
    .from("customer_documents")
    .select("metadata_json")
    .eq("id", documentId)
    .eq("customer_id", customerId)
    .maybeSingle();
  if (readError) throw new Error(`document_read_failed: ${readError.message}`);

  const merged = {
    ...(doc?.metadata_json ?? {}),
    ...patch,
  };

  const { error: updateError } = await admin
    .from("customer_documents")
    .update({
      metadata_json: merged,
      updated_at: new Date().toISOString(),
    })
    .eq("id", documentId)
    .eq("customer_id", customerId);
  if (updateError) throw new Error(`document_metadata_update_failed: ${updateError.message}`);
  return merged;
}

export async function runDocumentPolicyExtraction({
  customerId,
  documentId,
  env = process.env,
  invokeMemory = true,
}) {
  const admin = createServiceClient(env);
  if (!admin) throw new Error("supabase_service_role_not_configured");

  const { data: document, error: docError } = await admin
    .from("customer_documents")
    .select("id, customer_id, ingest_status, original_filename, metadata_json")
    .eq("id", documentId)
    .eq("customer_id", customerId)
    .is("deleted_at", null)
    .maybeSingle();

  if (docError) throw new Error(`document_lookup_failed: ${docError.message}`);
  if (!document) throw new Error("document_not_found");
  if (document.ingest_status !== "ready") {
    throw new Error(`document_not_ready:${document.ingest_status}`);
  }

  const chunks = await loadDocumentChunks(admin, customerId, documentId);
  if (!chunks.length) {
    await updateDocumentExtractionMetadata(admin, customerId, documentId, {
      policy_extraction_status: "extraction_failed",
      policy_extraction_error: "chunks_missing",
    });
    return {
      ok: false,
      reason: "chunks_missing",
      chunk_count: 0,
      ocr_text_length: 0,
      extraction: null,
      policy_id: null,
      memory_builder: null,
    };
  }

  const ocrText = chunks.map((chunk) => chunk.content ?? "").join("\n\n").trim();
  const extraction = extractPolicyFieldsFromOcrText(ocrText);

  if (!extraction.success) {
    await updateDocumentExtractionMetadata(admin, customerId, documentId, {
      policy_extraction_status: "extraction_failed",
      policy_extraction_error: "insufficient_policy_fields",
      policy_extraction: extraction,
      policy_extraction_field_count: extraction.field_count,
    });
    return {
      ok: false,
      reason: "insufficient_policy_fields",
      chunk_count: chunks.length,
      ocr_text_length: ocrText.length,
      extraction,
      policy_id: null,
      memory_builder: null,
    };
  }

  const hasConsent = await hasInsuranceDataConsent(admin, customerId);
  if (!hasConsent) {
    await updateDocumentExtractionMetadata(admin, customerId, documentId, {
      policy_extraction_status: "extraction_failed",
      policy_extraction_error: "insurance_data_processing_consent_required",
      policy_extraction: extraction,
    });
    return {
      ok: false,
      reason: "insurance_data_processing_consent_required",
      chunk_count: chunks.length,
      ocr_text_length: ocrText.length,
      extraction,
      policy_id: null,
      memory_builder: null,
    };
  }

  let policyResult;
  try {
    policyResult = await upsertUploadPolicy(admin, customerId, documentId, extraction);
  } catch (persistError) {
    const message = persistError instanceof Error ? persistError.message : "policy_persist_failed";
    await updateDocumentExtractionMetadata(admin, customerId, documentId, {
      policy_extraction_status: "extraction_failed",
      policy_extraction_error: message,
      policy_extraction: extraction,
    });
    return {
      ok: false,
      reason: message,
      chunk_count: chunks.length,
      ocr_text_length: ocrText.length,
      extraction,
      policy_id: null,
      memory_builder: null,
    };
  }
  const metadata = await updateDocumentExtractionMetadata(admin, customerId, documentId, {
    policy_extraction_status: "completed",
    policy_extraction_error: null,
    policy_extraction: extraction,
    profile_policy_id: policyResult.policy_id,
    policy_extraction_action: policyResult.action,
  });

  const memoryBuilder = invokeMemory
    ? await invokeMemoryBuilder(env, customerId)
    : { invoked: false, reason: "skipped" };

  const { count: policyCount } = await admin
    .from("profile_insurance_policies")
    .select("id", { count: "exact", head: true })
    .eq("customer_id", customerId)
    .is("deleted_at", null);

  const { count: memoryFactCount } = await admin
    .from("customer_memory_facts")
    .select("id", { count: "exact", head: true })
    .eq("customer_id", customerId)
    .is("superseded_at", null);

  return {
    ok: true,
    chunk_count: chunks.length,
    ocr_text_length: ocrText.length,
    extraction,
    policy_id: policyResult.policy_id,
    policy_action: policyResult.action,
    profile_insurance_policies_count: policyCount ?? 0,
    customer_memory_facts_count: memoryFactCount ?? 0,
    memory_builder: memoryBuilder,
    metadata_json: metadata,
  };
}
