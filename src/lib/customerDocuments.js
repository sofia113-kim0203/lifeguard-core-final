import { loadCustomerDashboardData } from "./customerDashboard.js";
import { extractPolicyFromReadyDocument } from "./customerDocumentPolicyExtract.js";
import { DOCUMENT_CATEGORIES, resolveLegacyDocClass } from "./documentCategories.js";
import { appendLegacyPipelineContinuedClientTrace, assertKu2bReadyForFactory, requestKeyDocumentIntake } from "./keyDocumentIntake.js";
import { supabase } from "./supabase.js";
import { toCustomerErrorMessage } from "./uiLocale.js";

export { DOCUMENT_CATEGORIES, resolveLegacyDocClass } from "./documentCategories.js";
export {
  filterPoliciesExcludingDeletedSourceDocuments,
  filterPoliciesToActiveSourceDocuments,
  loadActiveSourceDocumentIds,
  loadDeletedSourceDocumentIds,
} from "./policySourceDocumentFilter.js";

export function isPolicyExtractionRetryEligible(document) {
  if (!document || document.ingest_status !== "ready") return false;
  const status = document.metadata_json?.policy_extraction_status ?? null;
  if (!status) return true;
  return status === "extraction_failed" || status === "pending_manual_review";
}

export const STORAGE_BUCKET = "customer-documents";
export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;
export const DOCUMENT_STORAGE_CONSENT_VERSION = "2026-06-07-ko-doc";
export const DOCUMENT_ANALYSIS_CONSENT_VERSION = "2026-06-07-ko-doc-analysis";
export const INSURANCE_DATA_CONSENT_VERSION = "2026-01-01-ko";
export const SIGNED_URL_TTL_SECONDS = 60;

/** Shared accept list for document panel uploads (PDF + images). */
export const DOCUMENT_FILE_ACCEPT =
  ".pdf,.jpg,.jpeg,.png,.heic,.heif,.webp,application/pdf,image/jpeg,image/png,image/heic,image/heif,image/webp";

export {
  CHAT_ATTACH_FILE_ACCEPT,
  CHAT_PDF_FILE_ACCEPT,
  isChatAttachFile,
  isChatPdfFile,
} from "./chatPdfAttach.js";

const CATEGORY_BY_KEY = Object.fromEntries(
  DOCUMENT_CATEGORIES.map((category) => [category.key, category]),
);

const ALLOWED_MIME_TYPES = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/heic",
  "image/heif",
  "image/webp",
]);

const EXTENSION_MIME_MAP = {
  pdf: "application/pdf",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  heic: "image/heic",
  heif: "image/heif",
  webp: "image/webp",
};

const DOCUMENT_LIST_COLUMNS =
  "id, customer_id, storage_path, mime_type, original_filename, doc_class, ingest_status, customer_hint_type, metadata_json, consent_snapshot, created_at, entity_id";

function getCategory(categoryKey) {
  const category = CATEGORY_BY_KEY[categoryKey];
  if (!category) {
    throw new Error("문서 분류를 선택해 주세요.");
  }
  return category;
}

function getFileExtension(filename) {
  const parts = String(filename ?? "").toLowerCase().split(".");
  return parts.length > 1 ? parts.at(-1) : "";
}

function buildAsciiStorageFilename(documentId, extension) {
  const safeExtension = String(extension ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
  return safeExtension ? `document-${documentId}.${safeExtension}` : `document-${documentId}`;
}

function buildStoragePath(customerId, documentId, filename) {
  return `${customerId}/${documentId}/${filename}`;
}

function buildConsentSnapshot(consentVersion = DOCUMENT_STORAGE_CONSENT_VERSION) {
  return {
    document_storage: {
      granted: true,
      consent_version: consentVersion,
      granted_at: new Date().toISOString(),
    },
  };
}

async function readFileHeader(file, length = 12) {
  const slice = file.slice(0, length);
  const buffer = await slice.arrayBuffer();
  return new Uint8Array(buffer);
}

function bytesStartWith(bytes, pattern) {
  if (bytes.length < pattern.length) return false;
  return pattern.every((value, index) => bytes[index] === value);
}

function bytesIncludeAscii(bytes, text, searchLength = 32) {
  const ascii = Array.from(bytes.slice(0, searchLength))
    .map((byte) => (byte >= 32 && byte <= 126 ? String.fromCharCode(byte) : " "))
    .join("");
  return ascii.includes(text);
}

async function validateUploadFile(file) {
  if (!file) {
    throw new Error("업로드할 파일을 선택해 주세요.");
  }

  if (file.size > MAX_UPLOAD_BYTES) {
    throw new Error("파일 크기는 20MB 이하여야 합니다.");
  }

  const extension = getFileExtension(file.name);
  const expectedMime = EXTENSION_MIME_MAP[extension];
  if (!expectedMime) {
    throw new Error("PDF, JPG, PNG, HEIC, HEIF, WEBP 파일만 업로드할 수 있습니다.");
  }

  const mimeType = ALLOWED_MIME_TYPES.has(file.type) ? file.type : expectedMime;
  if (!ALLOWED_MIME_TYPES.has(mimeType)) {
    throw new Error("지원하지 않는 파일 형식입니다.");
  }

  const header = await readFileHeader(file);
  const validSignature =
    (mimeType === "application/pdf" && bytesStartWith(header, [0x25, 0x50, 0x44, 0x46])) ||
    (mimeType === "image/jpeg" && bytesStartWith(header, [0xff, 0xd8, 0xff])) ||
    (mimeType === "image/png" &&
      bytesStartWith(header, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) ||
    (mimeType === "image/webp" && bytesIncludeAscii(header, "WEBP")) ||
    ((mimeType === "image/heic" || mimeType === "image/heif") &&
      bytesIncludeAscii(header, "ftyp"));

  if (!validSignature) {
    throw new Error("파일 내용이 선택한 형식과 일치하지 않습니다.");
  }

  return {
    mimeType,
    extension,
    byteSize: file.size,
  };
}

async function ensureCustomerContext(authUser) {
  const dashboard = await loadCustomerDashboardData(authUser);
  if (!dashboard.customerId) {
    throw new Error("고객 프로필을 불러오지 못했습니다.");
  }
  return dashboard;
}

export async function hasDocumentStorageConsent(customerId) {
  const { data, error } = await supabase
    .from("customer_consents")
    .select("consent_type, granted, revoked_at, consent_version")
    .eq("customer_id", customerId)
    .eq("consent_type", "document_storage")
    .eq("granted", true)
    .is("revoked_at", null);

  if (error) {
    throw new Error(toCustomerErrorMessage(error, "문서 보관 동의 상태를 확인하지 못했습니다."));
  }

  return (data ?? []).length > 0;
}

export async function hasDocumentAnalysisConsent(customerId) {
  const { data, error } = await supabase
    .from("customer_consents")
    .select("consent_type, granted, revoked_at")
    .eq("customer_id", customerId)
    .eq("consent_type", "document_analysis")
    .eq("granted", true)
    .is("revoked_at", null);

  if (error) {
    throw new Error(toCustomerErrorMessage(error, "문서 분석 동의 상태를 확인하지 못했습니다."));
  }

  return (data ?? []).length > 0;
}

export async function hasInsuranceDataProcessingConsent(customerId) {
  const { data, error } = await supabase
    .from("customer_consents")
    .select("consent_type, granted, revoked_at")
    .eq("customer_id", customerId)
    .eq("consent_type", "insurance_data_processing")
    .eq("granted", true)
    .is("revoked_at", null);

  if (error) {
    throw new Error(toCustomerErrorMessage(error, "보험정보 처리 동의 상태를 확인하지 못했습니다."));
  }

  return (data ?? []).length > 0;
}

export async function grantInsuranceDataProcessingConsent(customerId) {
  const alreadyGranted = await hasInsuranceDataProcessingConsent(customerId);
  if (alreadyGranted) return { granted: true, grantedAt: null };

  const { error } = await supabase.from("customer_consents").insert({
    customer_id: customerId,
    consent_type: "insurance_data_processing",
    consent_version: INSURANCE_DATA_CONSENT_VERSION,
    granted: true,
    granted_at: new Date().toISOString(),
    source: "document_analysis_bundle",
    purpose: "문서에서 추출한 보험정보 처리 및 맞춤 분석",
    required: true,
  });

  if (error) {
    throw new Error(toCustomerErrorMessage(error, "보험정보 처리 동의를 저장하지 못했습니다."));
  }

  return { granted: true, grantedAt: new Date().toISOString() };
}

export async function grantDocumentAnalysisConsent(authUser) {
  const { customerId } = await ensureCustomerContext(authUser);

  const alreadyGranted = await hasDocumentAnalysisConsent(customerId);
  if (alreadyGranted) {
    await grantInsuranceDataProcessingConsent(customerId);
    return {
      customerId,
      consentVersion: DOCUMENT_ANALYSIS_CONSENT_VERSION,
      grantedAt: null,
    };
  }

  const { data, error } = await supabase.rpc("lifeguard_grant_document_analysis_consent", {
    p_consent_version: DOCUMENT_ANALYSIS_CONSENT_VERSION,
  });

  if (error) {
    throw new Error(toCustomerErrorMessage(error, "문서 분석 동의를 저장하지 못했습니다."));
  }

  await grantInsuranceDataProcessingConsent(customerId);

  return {
    customerId,
    consentVersion: data?.consent_version ?? DOCUMENT_ANALYSIS_CONSENT_VERSION,
    grantedAt: data?.granted_at ?? new Date().toISOString(),
  };
}

async function invokeDocumentIngestWorker(documentId, { workOrderId = null } = {}) {
  const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
  if (sessionError || !sessionData.session?.access_token) {
    throw new Error("로그인이 필요합니다.");
  }

  const baseUrl = import.meta.env.VITE_SUPABASE_URL;
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
  if (!baseUrl || !anonKey) {
    throw new Error("문서 분석 서비스가 설정되지 않았습니다.");
  }

  const payloadBody = { document_id: documentId };
  if (workOrderId) {
    payloadBody.work_order_id = workOrderId;
  }

  const response = await fetch(`${baseUrl}/functions/v1/document-ingest-worker`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${sessionData.session.access_token}`,
      apikey: anonKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payloadBody),
  });

  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok) {
    const message =
      payload?.error_message ??
      payload?.error ??
      payload?.message ??
      `문서 분석 요청이 실패했습니다. (${response.status})`;
    throw new Error(message);
  }

  return payload ?? { ok: true };
}

async function resolveKeyWorkOrderForFactory(documentId, { workOrderId = null, categoryKey = null, uploadSource = "web" } = {}) {
  if (workOrderId) {
    return { workOrderId, intakeResult: null };
  }

  const intakeResult = await requestKeyDocumentIntake(documentId, {
    categoryKey,
    uploadSource,
  });

  return {
    workOrderId: intakeResult?.work_order_id ?? null,
    intakeResult,
  };
}

export async function enqueueDocumentIngest(authUser, documentId, { workOrderId = null, categoryKey = null, uploadSource = "web" } = {}) {
  const { customerId } = await ensureCustomerContext(authUser);
  const trimmedId = String(documentId ?? "").trim();
  if (!trimmedId) {
    throw new Error("문서 ID가 없습니다.");
  }

  const hasAnalysisConsent = await hasDocumentAnalysisConsent(customerId);
  if (!hasAnalysisConsent) {
    const { data: blockedDoc, error: blockError } = await supabase
      .from("customer_documents")
      .update({
        ingest_status: "analysis_blocked_by_consent",
        error_message: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", trimmedId)
      .eq("customer_id", customerId)
      .select(DOCUMENT_LIST_COLUMNS)
      .maybeSingle();

    if (blockError) {
      throw new Error(toCustomerErrorMessage(blockError, "문서 분석 상태를 저장하지 못했습니다."));
    }

    return {
      customerId,
      documentId: trimmedId,
      blocked: true,
      ingestStatus: blockedDoc?.ingest_status ?? "analysis_blocked_by_consent",
      message: "문서 분석 동의가 필요합니다.",
      workerResult: null,
    };
  }

  const { data, error } = await supabase.rpc("lifeguard_request_customer_document_ingest", {
    p_document_id: trimmedId,
  });

  if (error) {
    throw new Error(toCustomerErrorMessage(error, "문서 분석 대기열 등록에 실패했습니다."));
  }

  if (data?.blocked) {
    return {
      customerId,
      documentId: trimmedId,
      blocked: true,
      ingestStatus: data.ingest_status ?? "analysis_blocked_by_consent",
      message: data.message ?? "문서 분석 동의가 필요합니다.",
      workerResult: null,
    };
  }

  const { workOrderId: resolvedWorkOrderId } = await resolveKeyWorkOrderForFactory(trimmedId, {
    workOrderId,
    categoryKey,
    uploadSource,
  });

  const workerResult = await invokeDocumentIngestWorker(trimmedId, {
    workOrderId: resolvedWorkOrderId,
  });

  let policyExtraction = null;
  if (workerResult?.ingest_status === "ready") {
    try {
      policyExtraction = await extractPolicyFromReadyDocument(trimmedId, {
        workOrderId: resolvedWorkOrderId,
      });
    } catch (extractError) {
      policyExtraction = {
        ok: false,
        documentId: trimmedId,
        message:
          extractError instanceof Error
            ? extractError.message
            : "보험정보 추출에 실패했습니다.",
      };
    }
  }

  return {
    customerId,
    documentId: trimmedId,
    blocked: false,
    ingestStatus: workerResult?.ingest_status ?? data?.ingest_status ?? "queued",
    ingestJobId: data?.ingest_job_id ?? null,
    message: data?.message ?? "ingest_queued",
    workerResult,
    policyExtraction,
    workOrderId: resolvedWorkOrderId,
  };
}

export async function grantDocumentStorageConsent(authUser) {
  const { customerId } = await ensureCustomerContext(authUser);

  const alreadyGranted = await hasDocumentStorageConsent(customerId);
  if (alreadyGranted) {
    return {
      customerId,
      consentVersion: DOCUMENT_STORAGE_CONSENT_VERSION,
      grantedAt: null,
    };
  }

  const grantedAt = new Date().toISOString();

  const { error } = await supabase.from("customer_consents").insert({
    customer_id: customerId,
    consent_type: "document_storage",
    consent_version: DOCUMENT_STORAGE_CONSENT_VERSION,
    granted: true,
    granted_at: grantedAt,
    source: "document_upload",
    purpose: "고객 문서 보관",
    required: true,
  });

  if (error) {
    throw new Error(toCustomerErrorMessage(error, "문서 보관 동의를 저장하지 못했습니다."));
  }

  return {
    customerId,
    consentVersion: DOCUMENT_STORAGE_CONSENT_VERSION,
    grantedAt,
  };
}

export async function listDocuments(authUser, { categoryKey = "all" } = {}) {
  const { customerId } = await ensureCustomerContext(authUser);
  const hasConsent = await hasDocumentStorageConsent(customerId);

  let query = supabase
    .from("customer_documents")
    .select(DOCUMENT_LIST_COLUMNS)
    .is("deleted_at", null)
    .order("created_at", { ascending: false });

  if (categoryKey !== "all") {
    const category = getCategory(categoryKey);
    query = query.eq("doc_class", category.docClass);
  }

  const { data, error } = await query;
  if (error) {
    throw new Error(toCustomerErrorMessage(error, "문서 목록을 불러오지 못했습니다."));
  }

  const hasAnalysisConsent = await hasDocumentAnalysisConsent(customerId);

  return {
    customerId,
    hasDocumentStorageConsent: hasConsent,
    hasDocumentAnalysisConsent: hasAnalysisConsent,
    documents: data ?? [],
  };
}

export async function requeuePendingDocumentIngest(authUser) {
  const { customerId } = await ensureCustomerContext(authUser);
  const hasAnalysisConsent = await hasDocumentAnalysisConsent(customerId);
  if (!hasAnalysisConsent) {
    return { customerId, requeued: 0, results: [] };
  }

  const { data: documents, error } = await supabase
    .from("customer_documents")
    .select("id, ingest_status")
    .eq("customer_id", customerId)
    .is("deleted_at", null)
    .in("ingest_status", ["uploaded", "analysis_blocked_by_consent"]);

  if (error) {
    throw new Error(toCustomerErrorMessage(error, "대기 중인 문서를 불러오지 못했습니다."));
  }

  const results = [];
  for (const document of documents ?? []) {
    try {
      const ingest = await enqueueDocumentIngest(authUser, document.id);
      results.push({ documentId: document.id, ingest });
    } catch (ingestError) {
      results.push({
        documentId: document.id,
        ingest: {
          failed: true,
          message:
            ingestError instanceof Error ? ingestError.message : "문서 분석 시작에 실패했습니다.",
        },
      });
    }
  }

  return {
    customerId,
    requeued: results.filter((item) => !item.ingest?.blocked && !item.ingest?.failed).length,
    results,
  };
}

export async function retryPendingPolicyExtractions(authUser) {
  const { customerId, hasDocumentAnalysisConsent, documents } = await listDocuments(authUser);
  if (!hasDocumentAnalysisConsent) {
    return { customerId, retried: 0, results: [] };
  }

  const eligible = (documents ?? []).filter(isPolicyExtractionRetryEligible);
  const results = [];

  for (const document of eligible) {
    try {
      const intake = await requestKeyDocumentIntake(document.id, {
        uploadSource: "retry_policy_extract",
      });
      const policyExtraction = await extractPolicyFromReadyDocument(document.id, {
        workOrderId: intake?.work_order_id ?? null,
      });
      results.push({ documentId: document.id, policyExtraction });
    } catch (extractError) {
      results.push({
        documentId: document.id,
        policyExtraction: {
          ok: false,
          documentId: document.id,
          message:
            extractError instanceof Error
              ? extractError.message
              : "보험정보 추출 재시도에 실패했습니다.",
        },
      });
    }
  }

  return {
    customerId,
    retried: results.filter((item) => item.policyExtraction?.ok).length,
    eligible_count: eligible.length,
    results,
  };
}

export async function uploadDocument(
  authUser,
  { file, categoryKey, deferFactoryUntilClaude = false, entityId = null } = {},
) {
  const category = getCategory(categoryKey);
  const { customerId } = await ensureCustomerContext(authUser);

  const hasConsent = await hasDocumentStorageConsent(customerId);
  if (!hasConsent) {
    throw new Error("문서 보관 동의가 필요합니다.");
  }

  // Optional corporate ownership — column entity_id only (no metadata ownership).
  // Membership is re-checked server-side via entity_memberships under the user JWT.
  const requestedEntityId = String(entityId ?? "").trim() || null;
  let ownedEntityId = null;
  if (requestedEntityId) {
    const authUserId = String(authUser?.id ?? "").trim();
    if (!authUserId) {
      throw new Error("법인 문서 업로드 권한이 확인되지 않았습니다.");
    }
    const { data: membership, error: memError } = await supabase
      .from("entity_memberships")
      .select("entity_id, status")
      .eq("entity_id", requestedEntityId)
      .eq("user_id", authUserId)
      .eq("status", "active")
      .maybeSingle();
    if (memError || !membership?.entity_id) {
      throw new Error("이 법인에 문서를 등록할 권한이 확인되지 않았습니다.");
    }
    const { data: entityRow, error: entityError } = await supabase
      .from("entities")
      .select("id, entity_type, entity_status")
      .eq("id", requestedEntityId)
      .eq("entity_type", "corporate")
      .in("entity_status", ["active", "demo"])
      .maybeSingle();
    if (entityError || !entityRow?.id) {
      throw new Error("법인 정보를 확인하지 못했습니다.");
    }
    // Slice 2 — membership ≠ corporate_documents consent.
    const { data: authorityRow, error: authErr } = await supabase
      .from("entity_authority_consents")
      .select("id, consent_scope, status, revoked_at, expires_at")
      .eq("entity_id", requestedEntityId)
      .eq("holder_user_id", authUserId)
      .eq("consent_scope", "corporate_documents")
      .eq("status", "active")
      .is("subject_user_id", null)
      .maybeSingle();
    const expired =
      authorityRow?.expires_at &&
      Number.isFinite(new Date(authorityRow.expires_at).getTime()) &&
      new Date(authorityRow.expires_at).getTime() <= Date.now();
    if (
      authErr ||
      !authorityRow?.id ||
      authorityRow.revoked_at ||
      expired
    ) {
      throw new Error("이 법인 문서에 대한 동의·위임 권한이 확인되지 않았습니다.");
    }
    ownedEntityId = String(entityRow.id);
  }

  const validated = await validateUploadFile(file);
  const documentId = crypto.randomUUID();
  const storageFilename = buildAsciiStorageFilename(documentId, validated.extension);
  const storagePath = buildStoragePath(customerId, documentId, storageFilename);

  const { error: storageError } = await supabase.storage
    .from(STORAGE_BUCKET)
    .upload(storagePath, file, {
      upsert: false,
      contentType: validated.mimeType,
    });

  if (storageError) {
    throw new Error(toCustomerErrorMessage(storageError, "파일 업로드에 실패했습니다."));
  }

  const consentSnapshot = buildConsentSnapshot();
  const { data, error: insertError } = await supabase
    .from("customer_documents")
    .insert({
      id: documentId,
      customer_id: customerId,
      storage_path: storagePath,
      mime_type: validated.mimeType,
      original_filename: file.name,
      doc_class: resolveLegacyDocClass(category),
      ingest_status: "uploaded",
      customer_hint_type: category.hintType,
      ...(ownedEntityId ? { entity_id: ownedEntityId } : {}),
      metadata_json: {
        byte_size: validated.byteSize,
        upload_source: "web",
        sanitized_filename: storageFilename,
        category_key: category.key,
        ...(ownedEntityId ? { subject_scope: "corporate" } : { subject_scope: "personal" }),
        ...(deferFactoryUntilClaude
          ? {
              factory_deferred_until_claude: true,
              factory_deferred_reason: "homechat_claude_first_reader",
            }
          : {}),
      },
      consent_snapshot: consentSnapshot,
    })
    .select(DOCUMENT_LIST_COLUMNS)
    .single();

  if (insertError) {
    await supabase.storage.from(STORAGE_BUCKET).remove([storagePath]);
    throw new Error(toCustomerErrorMessage(insertError, "문서 정보를 저장하지 못했습니다."));
  }

  // HomeChat: store original only. Intake / Stage3 / OCR / factory wait for Claude-first answer.
  if (deferFactoryUntilClaude) {
    return {
      customerId,
      document: data,
      ingest: null,
      keyIntake: null,
      keyIntakeTrace: null,
      workOrderId: null,
      deferred_factory: true,
    };
  }

  const keyIntakeResult = await requestKeyDocumentIntake(documentId, {
    categoryKey: category.key,
    uploadSource: "web",
  });

  let keyIntakeTrace = keyIntakeResult?.intake_trace ?? null;
  const workOrderId = keyIntakeResult?.work_order_id ?? null;
  const ku2bGate =
    keyIntakeResult?.mode === "active"
      ? assertKu2bReadyForFactory(keyIntakeTrace)
      : { ok: true };

  let ingest = null;
  if (ku2bGate.ok) {
    try {
      ingest = await enqueueDocumentIngest(authUser, documentId, {
        workOrderId,
        categoryKey: category.key,
        uploadSource: "web",
      });
    } catch (ingestError) {
      ingest = {
        blocked: false,
        ingestStatus: data?.ingest_status ?? "uploaded",
        failed: true,
        message: ingestError instanceof Error ? ingestError.message : "문서 분석 시작에 실패했습니다.",
        workerResult: null,
      };
    }
  } else {
    ingest = {
      blocked: false,
      ingestStatus: data?.ingest_status ?? "uploaded",
      failed: true,
      message: "KEY first judgment required before factory enqueue.",
      workerResult: null,
      ku2b_reason: ku2bGate.reason,
    };
  }

  if (keyIntakeTrace) {
    keyIntakeTrace = appendLegacyPipelineContinuedClientTrace(keyIntakeTrace, {
      ingestStarted: ku2bGate.ok,
    });
  }

  return {
    customerId,
    document: data,
    ingest,
    keyIntake: keyIntakeResult,
    keyIntakeTrace,
    workOrderId,
  };
}

export async function downloadDocument(authUser, documentId) {
  const { customerId } = await ensureCustomerContext(authUser);

  const { data: document, error } = await supabase
    .from("customer_documents")
    .select(DOCUMENT_LIST_COLUMNS)
    .eq("id", documentId)
    .is("deleted_at", null)
    .maybeSingle();

  if (error) {
    throw new Error(toCustomerErrorMessage(error, "문서 정보를 불러오지 못했습니다."));
  }

  if (!document || document.customer_id !== customerId) {
    throw new Error("문서를 찾을 수 없습니다.");
  }

  const { data: signed, error: signedError } = await supabase.storage
    .from(STORAGE_BUCKET)
    .createSignedUrl(document.storage_path, SIGNED_URL_TTL_SECONDS);

  if (signedError || !signed?.signedUrl) {
    throw new Error(toCustomerErrorMessage(signedError, "문서 다운로드 URL을 만들지 못했습니다."));
  }

  return {
    signedUrl: signed.signedUrl,
    filename: document.original_filename ?? "document",
    mimeType: document.mime_type ?? "application/octet-stream",
  };
}

/** Structured delete failure codes (partial-failure path). */
export const DOCUMENT_DELETE_REASON = Object.freeze({
  DOCUMENT_SOFT_DELETE_FAILED: "document_soft_delete_failed",
  POLICY_RETIRE_FAILED: "policy_retire_failed",
  CLAIM_SCRUB_FAILED: "claim_scrub_failed",
  STORAGE_REMOVE_FAILED: "storage_remove_failed",
  MEMORY_SCRUB_FAILED: "memory_scrub_failed",
});

export function isStorageRemoveAlreadyGoneError(error = null) {
  const msg = String(error?.message ?? error ?? "").toLowerCase();
  if (!msg) return false;
  return (
    msg.includes("not found") ||
    msg.includes("no such file") ||
    msg.includes("object not found") ||
    msg.includes("404")
  );
}

const SOFT_DELETE_FINALIZE_PATH = "/api/customer-document-soft-delete-finalize";

/**
 * I-6 — post-RPC cleanup via service_role server path (document_id).
 * Customer JWT must not re-SELECT soft-deleted rows to finish storage/claim/memory.
 */
export async function requestSoftDeleteFinalize(documentId, options = {}) {
  const did = String(documentId ?? "").trim();
  if (!did) {
    return {
      success: false,
      reason: DOCUMENT_DELETE_REASON.DOCUMENT_SOFT_DELETE_FAILED,
      documentId: null,
      error_message: "문서를 찾을 수 없습니다.",
    };
  }
  const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
  if (sessionError || !sessionData?.session?.access_token) {
    return {
      success: false,
      reason: DOCUMENT_DELETE_REASON.DOCUMENT_SOFT_DELETE_FAILED,
      documentId: did,
      error_message: "로그인이 필요합니다.",
    };
  }
  const fetchImpl = options.fetchImpl ?? fetch;
  const response = await fetchImpl(SOFT_DELETE_FINALIZE_PATH, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${sessionData.session.access_token}`,
    },
    body: JSON.stringify({ document_id: did }),
  });
  const payload = await response.json().catch(() => ({}));
  return {
    success: payload?.success === true || payload?.ok === true,
    reason: payload?.reason ?? null,
    documentId: payload?.documentId ?? did,
    customerId: payload?.customerId ?? null,
    deletedAt: payload?.deletedAt ?? null,
    soft_delete_ok: payload?.soft_delete_ok ?? null,
    current_insurance_invalidated: payload?.current_insurance_invalidated ?? true,
    clear_active_attachment: payload?.clear_active_attachment ?? true,
    policy_retire: payload?.policy_retire ?? null,
    orphan_policy_retire: payload?.orphan_policy_retire ?? null,
    claim_cases_scrub: payload?.claim_cases_scrub ?? null,
    storage_remove_ok: payload?.storage_remove_ok ?? null,
    retired_policy_ids: payload?.retired_policy_ids ?? null,
    memory_scrub: payload?.memory_scrub ?? null,
    error_message:
      payload?.error_message ??
      (payload?.success === true || payload?.ok === true
        ? null
        : "일부 관련 기록을 정리하지 못했습니다. 다시 시도해 주세요."),
    finalize_via: payload?.finalize_via ?? "service_role_document_id",
  };
}

/**
 * Wrong-upload forget path (reconstruction model).
 * RPC SSOT soft-deletes the row; I-6 finalize completes policy/claim/storage/memory
 * via service_role by document_id (no customer JWT re-SELECT of soft-deleted rows).
 *
 * @param {object} [options] test injection: supabase, ensureCustomerContext, finalizeSoftDelete
 */
export async function softDeleteDocument(authUser, documentId, options = {}) {
  const client = options.supabase ?? supabase;
  const ensureCtx = options.ensureCustomerContext ?? ensureCustomerContext;
  const finalizeSoftDelete =
    options.finalizeSoftDelete ??
    ((did) => requestSoftDeleteFinalize(did, { fetchImpl: options.fetchImpl }));

  const { customerId } = await ensureCtx(authUser);
  const did = String(documentId ?? "").trim();
  if (!did) {
    return {
      success: false,
      reason: DOCUMENT_DELETE_REASON.DOCUMENT_SOFT_DELETE_FAILED,
      documentId: null,
      customerId,
      current_insurance_invalidated: false,
      clear_active_attachment: false,
      error_message: "문서를 찾을 수 없습니다.",
    };
  }

  // Active-row probe only. Soft-deleted rows are hidden by RLS — retry must not depend on this.
  const { data: document, error: readError } = await client
    .from("customer_documents")
    .select("id, customer_id, storage_path, deleted_at")
    .eq("id", did)
    .maybeSingle();

  if (readError) {
    return {
      success: false,
      reason: DOCUMENT_DELETE_REASON.DOCUMENT_SOFT_DELETE_FAILED,
      documentId: did,
      customerId,
      current_insurance_invalidated: false,
      clear_active_attachment: false,
      error_message: toCustomerErrorMessage(readError, "문서 정보를 불러오지 못했습니다."),
    };
  }

  let softDeleteOk = false;
  let deletedAt = null;

  if (document && document.customer_id === customerId && !document.deleted_at) {
    const { data: deletedDocument, error: rpcError } = await client.rpc(
      "lifeguard_soft_delete_customer_document",
      { p_document_id: did },
    );
    if (rpcError) {
      return {
        success: false,
        reason: DOCUMENT_DELETE_REASON.DOCUMENT_SOFT_DELETE_FAILED,
        documentId: did,
        customerId,
        current_insurance_invalidated: false,
        clear_active_attachment: false,
        error_message: toCustomerErrorMessage(rpcError, "문서를 삭제하지 못했습니다."),
      };
    }
    if (!deletedDocument) {
      return {
        success: false,
        reason: DOCUMENT_DELETE_REASON.DOCUMENT_SOFT_DELETE_FAILED,
        documentId: did,
        customerId,
        current_insurance_invalidated: false,
        clear_active_attachment: false,
        error_message: "문서를 찾을 수 없습니다.",
      };
    }
    deletedAt = deletedDocument.deleted_at ?? new Date().toISOString();
    softDeleteOk = true;
  } else if (document && document.customer_id === customerId && document.deleted_at) {
    // Rare: RLS still visible soft-deleted row.
    deletedAt = document.deleted_at;
    softDeleteOk = true;
  } else if (!document) {
    // I-6: soft-deleted rows are invisible to customer JWT. Finalize by document_id.
    softDeleteOk = true;
  } else {
    return {
      success: false,
      reason: DOCUMENT_DELETE_REASON.DOCUMENT_SOFT_DELETE_FAILED,
      documentId: did,
      customerId,
      current_insurance_invalidated: false,
      clear_active_attachment: false,
      error_message: "문서를 찾을 수 없습니다.",
    };
  }

  const finalized = await finalizeSoftDelete(did);
  const reason = finalized?.reason ?? null;
  const mappedReason =
    reason === "policy_retire_failed"
      ? DOCUMENT_DELETE_REASON.POLICY_RETIRE_FAILED
      : reason === "claim_scrub_failed"
        ? DOCUMENT_DELETE_REASON.CLAIM_SCRUB_FAILED
        : reason === "storage_remove_failed"
          ? DOCUMENT_DELETE_REASON.STORAGE_REMOVE_FAILED
          : reason === "memory_scrub_failed"
            ? DOCUMENT_DELETE_REASON.MEMORY_SCRUB_FAILED
            : reason === "document_not_found" || reason === "ownership_mismatch"
              ? DOCUMENT_DELETE_REASON.DOCUMENT_SOFT_DELETE_FAILED
              : reason === "document_not_soft_deleted"
                ? DOCUMENT_DELETE_REASON.DOCUMENT_SOFT_DELETE_FAILED
                : finalized?.success
                  ? null
                  : reason || DOCUMENT_DELETE_REASON.DOCUMENT_SOFT_DELETE_FAILED;

  return {
    success: finalized?.success === true,
    reason: mappedReason,
    documentId: did,
    customerId: finalized?.customerId ?? customerId,
    deletedAt: finalized?.deletedAt ?? deletedAt,
    soft_delete_ok: softDeleteOk || finalized?.soft_delete_ok === true,
    current_insurance_invalidated:
      finalized?.current_insurance_invalidated ?? softDeleteOk,
    clear_active_attachment: finalized?.clear_active_attachment ?? softDeleteOk,
    policy_retire: finalized?.policy_retire ?? null,
    orphan_policy_retire: finalized?.orphan_policy_retire ?? null,
    claim_cases_scrub: finalized?.claim_cases_scrub ?? null,
    storage_remove_ok: finalized?.storage_remove_ok ?? null,
    retired_policy_ids: finalized?.retired_policy_ids ?? null,
    memory_scrub: finalized?.memory_scrub ?? null,
    finalize_via: finalized?.finalize_via ?? "service_role_document_id",
    error_message:
      finalized?.success === true
        ? null
        : finalized?.error_message ??
          "일부 관련 기록을 정리하지 못했습니다. 다시 시도해 주세요.",
  };
}

export function claimCaseReferencesSourceDocument(row, documentId) {
  const did = String(documentId ?? "").trim();
  if (!did || !row || typeof row !== "object") return false;
  const medical =
    row.medical_event && typeof row.medical_event === "object" ? row.medical_event : {};
  if (String(medical.source_document_id ?? "").trim() === did) return true;
  if (String(row.source_document_id ?? "").trim() === did) return true;
  const key = String(row.claim_case_key ?? "").trim();
  if (key.startsWith(`doc:${did}:`)) return true;
  return false;
}

/**
 * Belt-and-suspenders after RPC soft-delete: retire KEY-confirmed / extract policy rows
 * linked by coverage_summary.source_document_id so left rail cannot keep deleted-doc facts.
 * Idempotent. softDeleteDocument treats ok !== true as POLICY_RETIRE_FAILED (not success).
 */
export async function retirePoliciesForSourceDocument(customerId, documentId, client = supabase) {
  const cid = String(customerId ?? "").trim();
  const did = String(documentId ?? "").trim();
  if (!cid || !did) {
    return { ok: false, attempted: false, retired: 0, reason: "missing_ids" };
  }
  return retirePoliciesForSourceDocumentIds(cid, [did], client, "source_document_deleted");
}

/**
 * Retire active prior_facts whose source_document_id is not among active documents.
 * RLS blocks SELECT of soft-deleted docs — so orphan = has source_document_id AND
 * that id is absent from the active (deleted_at IS NULL) document list.
 */
export async function retireOrphanSourceDeletedPoliciesForCustomer(customerId, client = supabase) {
  const cid = String(customerId ?? "").trim();
  if (!cid) {
    return { ok: false, attempted: false, retired: 0, reason: "missing_ids" };
  }
  try {
    const { data: activeDocs, error: docsError } = await client
      .from("customer_documents")
      .select("id")
      .eq("customer_id", cid)
      .is("deleted_at", null);
    if (docsError) {
      return { ok: false, attempted: true, retired: 0, error: docsError.message };
    }
    const activeIds = new Set(
      (Array.isArray(activeDocs) ? activeDocs : [])
        .map((row) => String(row?.id ?? "").trim())
        .filter(Boolean),
    );

    const { data: rows, error: selectError } = await client
      .from("profile_insurance_policies")
      .select("id, coverage_summary, is_active")
      .eq("customer_id", cid)
      .is("deleted_at", null);
    if (selectError) {
      return { ok: false, attempted: true, retired: 0, error: selectError.message };
    }

    const orphanIds = (Array.isArray(rows) ? rows : [])
      .filter((row) => {
        if (row?.is_active === false) return false;
        const summary =
          row?.coverage_summary && typeof row.coverage_summary === "object"
            ? row.coverage_summary
            : {};
        if (String(summary.retired_reason ?? "").trim()) return false;
        const sourceId = String(summary.source_document_id ?? "").trim();
        if (!sourceId) return false;
        return !activeIds.has(sourceId);
      })
      .map((row) => String(row.id));

    if (orphanIds.length === 0) {
      return {
        ok: true,
        attempted: true,
        retired: 0,
        retired_policy_ids: [],
        reason: "no_orphan_source_policies",
      };
    }

    return retirePoliciesForSourceDocumentIds(
      cid,
      (Array.isArray(rows) ? rows : [])
        .filter((row) => orphanIds.includes(String(row.id)))
        .map((row) => String(row.coverage_summary?.source_document_id ?? "").trim())
        .filter(Boolean),
      client,
      "source_document_deleted_backfill",
    );
  } catch (err) {
    return {
      ok: false,
      attempted: true,
      retired: 0,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

async function retirePoliciesForSourceDocumentIds(
  customerId,
  documentIds,
  client = supabase,
  retiredReason = "source_document_deleted",
) {
  const cid = String(customerId ?? "").trim();
  const idSet = new Set(
    (Array.isArray(documentIds) ? documentIds : [])
      .map((id) => String(id ?? "").trim())
      .filter(Boolean),
  );
  if (!cid || idSet.size === 0) {
    return { ok: false, attempted: false, retired: 0, reason: "missing_ids" };
  }
  try {
    const { data: rows, error: selectError } = await client
      .from("profile_insurance_policies")
      .select("id, coverage_summary, is_active")
      .eq("customer_id", cid)
      .is("deleted_at", null);

    if (selectError) {
      return { ok: false, attempted: true, retired: 0, error: selectError.message };
    }

    const matches = (Array.isArray(rows) ? rows : []).filter((row) => {
      if (row?.is_active === false) return false;
      const summary =
        row?.coverage_summary && typeof row.coverage_summary === "object"
          ? row.coverage_summary
          : {};
      if (String(summary.retired_reason ?? "").trim()) return false;
      return idSet.has(String(summary.source_document_id ?? "").trim());
    });

    if (matches.length === 0) {
      return {
        ok: true,
        attempted: true,
        retired: 0,
        retired_policy_ids: [],
        reason: "no_active_source_policies",
      };
    }

    const retiredAt = new Date().toISOString();
    let retired = 0;
    const retiredPolicyIds = [];
    const errors = [];
    for (const row of matches) {
      const summary =
        row.coverage_summary && typeof row.coverage_summary === "object"
          ? row.coverage_summary
          : {};
      const { error: updateError } = await client
        .from("profile_insurance_policies")
        .update({
          is_active: false,
          coverage_summary: {
            ...summary,
            retired_at: retiredAt,
            retired_reason: retiredReason,
          },
          updated_at: retiredAt,
        })
        .eq("id", row.id)
        .eq("customer_id", cid);
      if (updateError) {
        errors.push({ policy_id: row.id, message: updateError.message });
        continue;
      }
      retired += 1;
      retiredPolicyIds.push(String(row.id));
    }

    return {
      ok: errors.length === 0,
      attempted: true,
      retired,
      retired_policy_ids: retiredPolicyIds,
      match_count: matches.length,
      errors,
    };
  } catch (err) {
    return {
      ok: false,
      attempted: true,
      retired: 0,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

async function scrubProfileClaimCasesForDeletedDocument(customerId, documentId, client = supabase) {
  const did = String(documentId ?? "").trim();
  if (!customerId || !did) {
    return { ok: false, attempted: false, removed: 0, reason: "missing_ids" };
  }
  try {
    const { data: row, error: selectError } = await client
      .from("profile_health")
      .select("customer_id, details_json")
      .eq("customer_id", customerId)
      .maybeSingle();
    if (selectError) {
      return { ok: false, attempted: true, removed: 0, error: selectError.message };
    }
    if (!row?.customer_id) {
      // Idempotent: nothing to scrub.
      return { ok: true, attempted: true, removed: 0, reason: "no_profile_health_row" };
    }
    const details =
      row.details_json && typeof row.details_json === "object" ? row.details_json : {};
    const existing = Array.isArray(details.key_active_claim_cases)
      ? details.key_active_claim_cases
      : [];
    const next = existing.filter((c) => !claimCaseReferencesSourceDocument(c, did));
    const removed = Math.max(0, existing.length - next.length);
    if (removed === 0) {
      // Idempotent: already clean.
      return { ok: true, attempted: true, removed: 0, case_count: existing.length };
    }
    const { error: updateError } = await client
      .from("profile_health")
      .update({
        details_json: { ...details, key_active_claim_cases: next },
        updated_at: new Date().toISOString(),
      })
      .eq("customer_id", customerId);
    if (updateError) {
      return { ok: false, attempted: true, removed: 0, error: updateError.message };
    }
    return { ok: true, attempted: true, removed, case_count: next.length };
  } catch (err) {
    return {
      ok: false,
      attempted: true,
      removed: 0,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
