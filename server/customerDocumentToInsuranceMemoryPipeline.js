/**
 * Document → OCR → structured insurance extract → profile_insurance_policies → customer_memory_facts
 */
import { extractInsuranceFromOcrText, mergeInsuranceExtractions } from "./insuranceDocumentExtractor.js";
import { runClovaOcr, getClovaOcrConfig } from "./clovaOcrClient.js";
import { rebuildCustomerMemoryFoundation, resolveServiceRoleKey, resolveSupabaseUrl } from "./customerMemoryFoundation.js";

export const DOCUMENT_INGEST_WORKER_PATH = "/functions/v1/document-ingest-worker";
export const INSURANCE_POLICY_DOC_CLASSES = new Set(["policy_certificate"]);
export const INSURANCE_POLICY_HINT_TYPES = new Set(["insurance_policy"]);

const CONSENT_TYPES_REQUIRED = [
  "document_storage",
  "document_analysis",
  "insurance_data_processing",
  "memory_retention",
];

function nowIso() {
  return new Date().toISOString();
}

export function isInsurancePolicyDocument(document) {
  if (!document || document.deleted_at) return false;
  if (INSURANCE_POLICY_DOC_CLASSES.has(document.doc_class)) return true;
  if (INSURANCE_POLICY_HINT_TYPES.has(document.customer_hint_type)) return true;
  return document.metadata_json?.category_key === "insurance_policy";
}

export async function resolveSupabaseAnonKey(env = process.env) {
  const fromEnv = String(env.SUPABASE_ANON_KEY ?? env.VITE_SUPABASE_ANON_KEY ?? "").trim();
  if (fromEnv) return fromEnv;

  const accessToken = String(env.SUPABASE_ACCESS_TOKEN ?? "").trim();
  if (!accessToken) return null;

  const supabaseUrl = resolveSupabaseUrl(env);
  const projectRef = supabaseUrl?.match(/https:\/\/([^.]+)\.supabase\.co/)?.[1];
  if (!projectRef) return null;

  const response = await fetch(`https://api.supabase.com/v1/projects/${projectRef}/api-keys`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) return null;
  const keys = await response.json();
  return keys.find((entry) => entry.name === "anon")?.api_key ?? null;
}

export async function resolveCustomerAccessToken(supabase, customerId, env = process.env) {
  const { data: profile, error } = await supabase
    .from("customer_profiles")
    .select("user_id")
    .eq("id", customerId)
    .is("deleted_at", null)
    .maybeSingle();
  if (error || !profile?.user_id) throw new Error("customer_profile_not_found");

  const { data: userData, error: userError } = await supabase.auth.admin.getUserById(profile.user_id);
  if (userError || !userData?.user?.email) throw new Error("customer_user_not_found");

  const anonKey = await resolveSupabaseAnonKey(env);
  if (!anonKey) throw new Error("supabase_anon_key_not_configured");

  const { data: linkData, error: linkError } = await supabase.auth.admin.generateLink({
    type: "magiclink",
    email: userData.user.email,
  });
  if (linkError || !linkData?.properties?.hashed_token) {
    throw new Error(`customer_access_token_failed: ${linkError?.message ?? "no_token"}`);
  }

  const { createClient } = await import("@supabase/supabase-js");
  const userClient = createClient(resolveSupabaseUrl(env), anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: sessionData, error: verifyError } = await userClient.auth.verifyOtp({
    token_hash: linkData.properties.hashed_token,
    type: "magiclink",
  });
  if (verifyError || !sessionData?.session?.access_token) {
    throw new Error(`customer_access_token_failed: ${verifyError?.message ?? "no_session"}`);
  }

  return {
    accessToken: sessionData.session.access_token,
    anonKey,
    userId: profile.user_id,
  };
}

export async function ensurePipelineConsents(supabase, customerId) {
  const granted = [];
  for (const consentType of CONSENT_TYPES_REQUIRED) {
    const { data: hasConsent } = await supabase.rpc("lifeguard_has_consent", {
      p_customer_id: customerId,
      p_consent_type: consentType,
    });
    if (hasConsent === true) {
      granted.push(consentType);
      continue;
    }

    const version =
      consentType === "document_analysis"
        ? "2026-06-07-ko-doc-analysis"
        : "2026-06-07-ko-doc";

    const { error } = await supabase.from("customer_consents").insert({
      customer_id: customerId,
      consent_type: consentType,
      consent_version: version,
      granted: true,
      granted_at: nowIso(),
      source: "insurance_memory_pipeline",
      purpose: "문서 기반 보험 메모리 생성",
      required: true,
    });
    if (error && !String(error.message).includes("duplicate")) {
      throw new Error(`consent_grant_failed:${consentType}: ${error.message}`);
    }
    granted.push(consentType);
  }
  return granted;
}

async function loadDocumentRow(supabase, documentId) {
  const { data, error } = await supabase
    .from("customer_documents")
    .select(
      "id, customer_id, storage_path, mime_type, original_filename, doc_class, customer_hint_type, ingest_status, metadata_json, deleted_at",
    )
    .eq("id", documentId)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) throw new Error(`document_lookup_failed: ${error.message}`);
  if (!data) throw new Error("document_not_found");
  return data;
}

async function downloadDocumentBytes(supabase, document) {
  const { data, error } = await supabase.storage
    .from("customer-documents")
    .download(document.storage_path);
  if (error || !data) throw new Error(`document_download_failed: ${error?.message ?? "no_blob"}`);
  return Buffer.from(await data.arrayBuffer());
}

async function loadDocumentOcrText(supabase, documentId) {
  const { data, error } = await supabase
    .from("customer_document_chunks")
    .select("content, chunk_index")
    .eq("document_id", documentId)
    .is("deleted_at", null)
    .order("chunk_index", { ascending: true });
  if (error) throw new Error(`chunk_lookup_failed: ${error.message}`);
  const text = (data ?? []).map((row) => row.content).join("\n").trim();
  return text;
}

export async function invokeDocumentIngestWorker({
  supabaseUrl,
  accessToken,
  anonKey,
  documentId,
} = {}) {
  const response = await fetch(`${supabaseUrl}${DOCUMENT_INGEST_WORKER_PATH}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      apikey: anonKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ document_id: documentId }),
  });
  const body = await response.json().catch(() => ({}));
  return { status: response.status, body };
}

async function ensureDocumentIngested({
  supabase,
  document,
  supabaseUrl,
  accessToken,
  anonKey,
} = {}) {
  if (document.ingest_status === "ready") {
    const text = await loadDocumentOcrText(supabase, document.id);
    if (text) return { ingest_status: "ready", ocr_text: text, reused: true };
  }

  if (["uploaded", "failed", "analysis_blocked_by_consent", "pending"].includes(document.ingest_status)) {
    const { error: queueError } = await supabase
      .from("customer_documents")
      .update({
        ingest_status: "queued",
        ingest_job_id: crypto.randomUUID(),
        error_message: null,
        updated_at: nowIso(),
      })
      .eq("id", document.id);
    if (queueError) throw new Error(`document_queue_failed: ${queueError.message}`);
  }

  if (!accessToken || !anonKey) {
    throw new Error("customer_access_token_required_for_ingest");
  }

  const ingestResult = await invokeDocumentIngestWorker({
    supabaseUrl,
    accessToken,
    anonKey,
    documentId: document.id,
  });

  if (ingestResult.status !== 200) {
    throw new Error(
      `document_ingest_worker_failed: ${ingestResult.status} ${JSON.stringify(ingestResult.body)}`,
    );
  }

  const ocrText = await loadDocumentOcrText(supabase, document.id);
  if (!ocrText) throw new Error("document_ocr_text_empty");
  return { ingest_status: "ready", ocr_text: ocrText, reused: false, worker: ingestResult.body };
}

async function runLocalOcrIfNeeded({ document, fileBytes, env = process.env } = {}) {
  if (!getClovaOcrConfig(env)) return null;
  const parsed = await runClovaOcr({
    fileBytes,
    mimeType: document.mime_type,
    originalFilename: document.original_filename,
    env,
  });
  return parsed.text;
}

export async function saveStructuredExtractMetadata(supabase, documentId, structuredExtract) {
  const { data: row, error: readError } = await supabase
    .from("customer_documents")
    .select("metadata_json")
    .eq("id", documentId)
    .single();
  if (readError) throw new Error(`document_metadata_read_failed: ${readError.message}`);

  const metadataJson = {
    ...(row.metadata_json ?? {}),
    structured_extract: structuredExtract,
    insurance_memory_pipeline: {
      status: "extracted",
      extracted_at: nowIso(),
      policy_count: structuredExtract.policy_count ?? 0,
    },
  };

  const { error: updateError } = await supabase
    .from("customer_documents")
    .update({ metadata_json: metadataJson, updated_at: nowIso() })
    .eq("id", documentId);
  if (updateError) throw new Error(`document_metadata_update_failed: ${updateError.message}`);
  return metadataJson;
}

function buildPolicyRow(customerId, documentId, policy, structuredExtract) {
  return {
    customer_id: customerId,
    insurer_name: policy.insurer_name,
    product_name: policy.product_name,
    policy_type: policy.policy_type,
    monthly_premium: policy.monthly_premium,
    coverage_summary: {
      ...(policy.coverage_summary ?? {}),
      source_document_id: documentId,
      extraction_confidence: structuredExtract.extraction_confidence,
      coverage_categories: policy.coverage_categories ?? [],
    },
    source: "upload_extract",
    is_active: true,
    updated_at: nowIso(),
  };
}

export async function upsertExtractedPolicies({
  supabase,
  customerId,
  documentId,
  structuredExtract,
} = {}) {
  const upserted = [];
  for (const policy of structuredExtract.policies ?? []) {
    const { data: existing, error: lookupError } = await supabase
      .from("profile_insurance_policies")
      .select("id")
      .eq("customer_id", customerId)
      .eq("insurer_name", policy.insurer_name)
      .eq("product_name", policy.product_name)
      .eq("source", "upload_extract")
      .is("deleted_at", null)
      .maybeSingle();
    if (lookupError) throw new Error(`policy_lookup_failed: ${lookupError.message}`);

    const row = buildPolicyRow(customerId, documentId, policy, structuredExtract);
    if (existing?.id) {
      const { data, error } = await supabase
        .from("profile_insurance_policies")
        .update(row)
        .eq("id", existing.id)
        .select("id, insurer_name, product_name, monthly_premium, source")
        .single();
      if (error) throw new Error(`policy_update_failed: ${error.message}`);
      upserted.push({ action: "updated", policy: data });
    } else {
      const { data, error } = await supabase
        .from("profile_insurance_policies")
        .insert(row)
        .select("id, insurer_name, product_name, monthly_premium, source")
        .single();
      if (error) throw new Error(`policy_insert_failed: ${error.message}`);
      upserted.push({ action: "inserted", policy: data });
    }
  }
  return upserted;
}

export async function processCustomerDocumentToInsuranceMemory({
  supabase,
  supabaseUrl = null,
  serviceRoleKey = null,
  documentId,
  customerAccessToken = null,
  anonKey = null,
  skipMemoryRebuild = false,
  env = process.env,
} = {}) {
  if (!supabase) throw new Error("supabase_required");
  if (!documentId) throw new Error("document_id_required");

  const sbUrl = supabaseUrl ?? resolveSupabaseUrl(env);
  const roleKey = serviceRoleKey ?? resolveServiceRoleKey(env);
  const document = await loadDocumentRow(supabase, documentId);

  if (!isInsurancePolicyDocument(document)) {
    return {
      document_id: documentId,
      skipped: true,
      reason: "not_insurance_policy_document",
    };
  }

  const customerId = document.customer_id;
  const consents = await ensurePipelineConsents(supabase, customerId);

  let accessToken = customerAccessToken;
  let resolvedAnonKey = anonKey;
  if (!accessToken || !resolvedAnonKey) {
    const session = await resolveCustomerAccessToken(supabase, customerId, env);
    accessToken = session.accessToken;
    resolvedAnonKey = session.anonKey;
  }

  let ocrText = await loadDocumentOcrText(supabase, documentId);
  let ingestSummary = null;

  if (!ocrText) {
    try {
      ingestSummary = await ensureDocumentIngested({
        supabase,
        document,
        supabaseUrl: sbUrl,
        accessToken,
        anonKey: resolvedAnonKey,
      });
      ocrText = ingestSummary.ocr_text;
    } catch (ingestError) {
      const fileBytes = await downloadDocumentBytes(supabase, document);
      const localText = await runLocalOcrIfNeeded({ document, fileBytes, env });
      if (!localText) throw ingestError;
      ocrText = localText;
      ingestSummary = { ingest_status: "local_ocr", ocr_text: localText, reused: false };
    }
  } else {
    ingestSummary = { ingest_status: document.ingest_status, reused: true };
  }

  const structuredExtract = extractInsuranceFromOcrText(ocrText, {
    documentType: document.doc_class,
    filename: document.original_filename,
  });

  if (structuredExtract.policy_count === 0) {
    return {
      document_id: documentId,
      customer_id: customerId,
      consents,
      ingest: ingestSummary,
      structured_extract: structuredExtract,
      policies_upserted: [],
      memory_rebuild: null,
      error: "no_insurance_policies_extracted",
    };
  }

  await saveStructuredExtractMetadata(supabase, documentId, structuredExtract);
  const policiesUpserted = await upsertExtractedPolicies({
    supabase,
    customerId,
    documentId,
    structuredExtract,
  });

  let memoryRebuild = null;
  if (!skipMemoryRebuild && roleKey && sbUrl) {
    memoryRebuild = await rebuildCustomerMemoryFoundation({
      supabase,
      supabaseUrl: sbUrl,
      serviceRoleKey: roleKey,
      customerId,
      includeConversation: true,
    });
  }

  return {
    document_id: documentId,
    customer_id: customerId,
    consents,
    ingest: ingestSummary,
    structured_extract: structuredExtract,
    policies_upserted: policiesUpserted,
    memory_rebuild: memoryRebuild
      ? {
          memory_version: memoryRebuild.snapshot?.memory_version,
          fact_count: memoryRebuild.snapshot?.fact_count,
          insurance_facts: (memoryRebuild.snapshot?.facts ?? []).filter((f) => f.fact_type === "insurance"),
        }
      : null,
  };
}

export async function runCustomerInsuranceMemoryPipeline({
  supabase,
  supabaseUrl = null,
  serviceRoleKey = null,
  customerId,
  documentIds = null,
  env = process.env,
} = {}) {
  if (!supabase) throw new Error("supabase_required");
  if (!customerId) throw new Error("customer_id_required");

  let query = supabase
    .from("customer_documents")
    .select("id, doc_class, customer_hint_type, metadata_json, ingest_status, original_filename")
    .eq("customer_id", customerId)
    .is("deleted_at", null)
    .order("created_at", { ascending: true });

  if (documentIds?.length) {
    query = query.in("id", documentIds);
  }

  const { data: documents, error } = await query;
  if (error) throw new Error(`documents_lookup_failed: ${error.message}`);

  const insuranceDocs = (documents ?? []).filter(isInsurancePolicyDocument);
  const results = [];
  const extractions = [];

  for (const doc of insuranceDocs) {
    const result = await processCustomerDocumentToInsuranceMemory({
      supabase,
      supabaseUrl,
      serviceRoleKey,
      documentId: doc.id,
      skipMemoryRebuild: true,
      env,
    });
    results.push(result);
    if (result.structured_extract?.policy_count > 0) extractions.push(result.structured_extract);
  }

  const merged = mergeInsuranceExtractions(extractions);
  const sbUrl = supabaseUrl ?? resolveSupabaseUrl(env);
  const roleKey = serviceRoleKey ?? resolveServiceRoleKey(env);

  let memoryRebuild = null;
  if (roleKey && sbUrl && merged.policy_count > 0) {
    memoryRebuild = await rebuildCustomerMemoryFoundation({
      supabase,
      supabaseUrl: sbUrl,
      serviceRoleKey: roleKey,
      customerId,
      includeConversation: true,
    });
  }

  return {
    customer_id: customerId,
    documents_processed: results.length,
    document_results: results,
    merged_extraction: merged,
    memory_rebuild: memoryRebuild
      ? {
          memory_version: memoryRebuild.snapshot?.memory_version,
          fact_count: memoryRebuild.snapshot?.fact_count,
          insurance_facts: (memoryRebuild.snapshot?.facts ?? []).filter((f) => f.fact_type === "insurance"),
        }
      : null,
  };
}
