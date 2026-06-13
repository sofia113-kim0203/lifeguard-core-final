import { createClient } from "@supabase/supabase-js";
import {
  buildOcrSnippet,
  extractPoliciesFromOcrText,
  isPolicyExtractionRetryEligible,
} from "./documentPolicyExtractor.js";
import {
  buildPolicyRowFromCandidate,
  buildUploadExtractKey,
  planRetiredPolicyIds,
  resolveExistingPolicyForCandidate,
} from "./documentPolicyUploadPersist.js";
import {
  CUSTOMER_DOCUMENT_SELECT_FIELDS,
  runShadowPolicyValidationSafe,
  updateDocumentMetadataWithShadow,
} from "./policyExtractionShadow.js";

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

async function loadUploadExtractPoliciesForDocument(admin, customerId, documentId) {
  const { data, error } = await admin
    .from("profile_insurance_policies")
    .select("id, coverage_summary, is_active")
    .eq("customer_id", customerId)
    .eq("source", "upload_extract")
    .is("deleted_at", null);

  if (error) throw new Error(`policy_lookup_failed: ${error.message}`);
  return (data ?? []).filter((row) => row.coverage_summary?.source_document_id === documentId);
}

async function retireUploadExtractPolicies(admin, customerId, policyIds) {
  const retired = [];
  for (const policyId of policyIds) {
    const { data: existing, error: readError } = await admin
      .from("profile_insurance_policies")
      .select("id, coverage_summary")
      .eq("id", policyId)
      .eq("customer_id", customerId)
      .maybeSingle();
    if (readError) throw new Error(`policy_retire_read_failed: ${readError.message}`);
    if (!existing) continue;

    const coverageSummary = {
      ...(existing.coverage_summary ?? {}),
      retired_at: new Date().toISOString(),
      retired_reason: "superseded_by_reextract",
    };

    const { error } = await admin
      .from("profile_insurance_policies")
      .update({
        is_active: false,
        coverage_summary: coverageSummary,
        updated_at: new Date().toISOString(),
      })
      .eq("id", policyId)
      .eq("customer_id", customerId);
    if (error) throw new Error(`policy_retire_failed: ${error.message}`);
    retired.push(policyId);
  }
  return retired;
}

async function persistExtractedPolicies(admin, customerId, documentId, multiExtraction) {
  const candidates = multiExtraction.policies ?? [];
  const existingRows = await loadUploadExtractPoliciesForDocument(admin, customerId, documentId);
  const actions = [];
  const activeKeys = [];

  for (const candidate of candidates) {
    const row = buildPolicyRowFromCandidate(customerId, documentId, candidate);
    const { row: existing, upload_extract_key: uploadExtractKey } = resolveExistingPolicyForCandidate(
      existingRows,
      documentId,
      candidate,
      candidates.length,
    );
    activeKeys.push(uploadExtractKey);

    if (existing?.id) {
      const { data, error } = await admin
        .from("profile_insurance_policies")
        .update(row)
        .eq("id", existing.id)
        .eq("customer_id", customerId)
        .select("id")
        .single();
      if (error) throw new Error(`policy_update_failed: ${error.message}`);
      actions.push({
        policy_id: data.id,
        action: "updated",
        upload_extract_key: uploadExtractKey,
        block_index: candidate.block_index ?? null,
      });
      continue;
    }

    const { data, error } = await admin
      .from("profile_insurance_policies")
      .insert(row)
      .select("id")
      .single();
    if (error) throw new Error(`policy_insert_failed: ${error.message}`);
    actions.push({
      policy_id: data.id,
      action: "inserted",
      upload_extract_key: uploadExtractKey,
      block_index: candidate.block_index ?? null,
    });
  }

  const retireIds = planRetiredPolicyIds(existingRows, documentId, activeKeys);
  const retiredPolicyIds = await retireUploadExtractPolicies(admin, customerId, retireIds);

  return {
    policy_ids: actions.map((entry) => entry.policy_id),
    policy_count: actions.length,
    policy_actions: actions,
    retired_policy_ids: retiredPolicyIds,
  };
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

function getStoredPolicyIds(metadata = {}) {
  if (Array.isArray(metadata.profile_policy_ids) && metadata.profile_policy_ids.length) {
    return metadata.profile_policy_ids;
  }
  if (metadata.profile_policy_id) return [metadata.profile_policy_id];
  return [];
}

async function markPendingManualReview(admin, customerId, documentId, multiExtraction, ocrText, shadowState = null) {
  const basePatch = {
    policy_extraction_status: "pending_manual_review",
    policy_extraction_error: "insufficient_policy_fields",
    policy_extraction: multiExtraction,
    policy_extraction_count: multiExtraction.policy_count ?? 0,
    policy_extraction_field_count: multiExtraction.policies?.[0]?.field_count ?? 0,
    policy_extraction_missing_fields:
      multiExtraction.policies?.[0]?.missing_fields ?? multiExtraction.review_blocks?.[0]?.missing_fields ?? [],
    policy_extraction_review_blocks: multiExtraction.review_blocks ?? [],
    policy_extraction_ocr_snippet: buildOcrSnippet(ocrText),
    policy_extraction_requires_admin_review: true,
    profile_policy_ids: [],
    profile_policy_id: null,
  };
  return updateDocumentMetadataWithShadow(
    admin,
    updateDocumentExtractionMetadata,
    customerId,
    documentId,
    basePatch,
    shadowState,
    null,
  );
}

export async function runDocumentPolicyExtraction({
  customerId,
  documentId,
  env = process.env,
  invokeMemory = true,
  forceRetry = false,
}) {
  const admin = createServiceClient(env);
  if (!admin) throw new Error("supabase_service_role_not_configured");

  const { data: document, error: docError } = await admin
    .from("customer_documents")
    .select(CUSTOMER_DOCUMENT_SELECT_FIELDS)
    .eq("id", documentId)
    .eq("customer_id", customerId)
    .is("deleted_at", null)
    .maybeSingle();

  if (docError) throw new Error(`document_lookup_failed: ${docError.message}`);
  if (!document) throw new Error("document_not_found");
  if (document.ingest_status !== "ready") {
    throw new Error(`document_not_ready:${document.ingest_status}`);
  }

  const metadata = document.metadata_json ?? {};
  const existingStatus = metadata.policy_extraction_status ?? null;
  const existingPolicyIds = getStoredPolicyIds(metadata);

  if (!forceRetry && existingStatus === "completed" && existingPolicyIds.length > 0) {
    const existingRows = await loadUploadExtractPoliciesForDocument(admin, customerId, documentId);
    if (existingRows.some((row) => row.is_active !== false)) {
      return {
        ok: true,
        skipped: true,
        reason: "already_completed",
        chunk_count: null,
        ocr_text_length: null,
        extraction: metadata.policy_extraction ?? null,
        policy_id: existingPolicyIds[0] ?? null,
        policy_ids: existingPolicyIds,
        policy_count: metadata.policy_extraction_count ?? existingPolicyIds.length,
        memory_builder: { invoked: false, reason: "skipped_completed" },
      };
    }
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
      policy_ids: [],
      policy_count: 0,
      memory_builder: null,
    };
  }

  const ocrText = chunks.map((chunk) => chunk.content ?? "").join("\n\n").trim();
  const multiExtraction = extractPoliciesFromOcrText(ocrText);
  const shadowState = runShadowPolicyValidationSafe({
    ocrText,
    multiExtraction,
    document,
  });

  if (!multiExtraction.success) {
    const reviewMetadata = await markPendingManualReview(
      admin,
      customerId,
      documentId,
      multiExtraction,
      ocrText,
      shadowState,
    );
    return {
      ok: false,
      reason: "insufficient_policy_fields",
      status: "pending_manual_review",
      chunk_count: chunks.length,
      ocr_text_length: ocrText.length,
      extraction: multiExtraction,
      policy_id: null,
      policy_ids: [],
      policy_count: 0,
      memory_builder: null,
      metadata_json: reviewMetadata,
    };
  }

  const hasConsent = await hasInsuranceDataConsent(admin, customerId);
  if (!hasConsent) {
    await updateDocumentMetadataWithShadow(
      admin,
      updateDocumentExtractionMetadata,
      customerId,
      documentId,
      {
        policy_extraction_status: "extraction_failed",
        policy_extraction_error: "insurance_data_processing_consent_required",
        policy_extraction: multiExtraction,
      },
      shadowState,
      null,
    );
    return {
      ok: false,
      reason: "insurance_data_processing_consent_required",
      chunk_count: chunks.length,
      ocr_text_length: ocrText.length,
      extraction: multiExtraction,
      policy_id: null,
      policy_ids: [],
      policy_count: 0,
      memory_builder: null,
    };
  }

  let persistResult;
  try {
    persistResult = await persistExtractedPolicies(admin, customerId, documentId, multiExtraction);
  } catch (persistError) {
    const message = persistError instanceof Error ? persistError.message : "policy_persist_failed";
    await updateDocumentMetadataWithShadow(
      admin,
      updateDocumentExtractionMetadata,
      customerId,
      documentId,
      {
        policy_extraction_status: "extraction_failed",
        policy_extraction_error: message,
        policy_extraction: multiExtraction,
      },
      shadowState,
      null,
    );
    return {
      ok: false,
      reason: message,
      chunk_count: chunks.length,
      ocr_text_length: ocrText.length,
      extraction: multiExtraction,
      policy_id: null,
      policy_ids: [],
      policy_count: 0,
      memory_builder: null,
    };
  }

  const updatedMetadata = await updateDocumentMetadataWithShadow(
    admin,
    updateDocumentExtractionMetadata,
    customerId,
    documentId,
    {
      policy_extraction_status: "completed",
      policy_extraction_error: null,
      policy_extraction: multiExtraction,
      policy_extraction_count: persistResult.policy_count,
      policy_extraction_field_count: multiExtraction.policies?.[0]?.field_count ?? 0,
      policy_extraction_tier: multiExtraction.policies?.[0]?.tier ?? "full",
      policy_extraction_missing_fields: [],
      policy_extraction_review_blocks: multiExtraction.review_blocks ?? [],
      policy_extraction_ocr_snippet: null,
      policy_extraction_requires_admin_review: (multiExtraction.review_blocks ?? []).length > 0,
      profile_policy_ids: persistResult.policy_ids,
      profile_policy_id: persistResult.policy_ids[0] ?? null,
      policy_extraction_action: persistResult.policy_actions.map((entry) => entry.action).join(","),
      policy_extraction_retired_policy_ids: persistResult.retired_policy_ids,
    },
    shadowState,
    persistResult,
  );

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
    extraction: multiExtraction,
    policy_id: persistResult.policy_ids[0] ?? null,
    policy_ids: persistResult.policy_ids,
    policy_count: persistResult.policy_count,
    policy_actions: persistResult.policy_actions,
    retired_policy_ids: persistResult.retired_policy_ids,
    profile_insurance_policies_count: policyCount ?? 0,
    customer_memory_facts_count: memoryFactCount ?? 0,
    memory_builder: memoryBuilder,
    metadata_json: updatedMetadata,
  };
}

export { isPolicyExtractionRetryEligible, buildUploadExtractKey };
