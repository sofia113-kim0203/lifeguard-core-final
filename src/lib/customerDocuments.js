import { loadCustomerDashboardData } from "./customerDashboard.js";
import { extractPolicyFromReadyDocument } from "./customerDocumentPolicyExtract.js";
import { DOCUMENT_CATEGORIES, resolveLegacyDocClass } from "./documentCategories.js";
import { appendLegacyPipelineContinuedClientTrace, assertKu2bReadyForFactory, requestKeyDocumentIntake } from "./keyDocumentIntake.js";
import { supabase } from "./supabase.js";
import { toCustomerErrorMessage } from "./uiLocale.js";

export { DOCUMENT_CATEGORIES, resolveLegacyDocClass } from "./documentCategories.js";

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
  "id, customer_id, storage_path, mime_type, original_filename, doc_class, ingest_status, customer_hint_type, metadata_json, consent_snapshot, created_at";

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

export async function uploadDocument(authUser, { file, categoryKey }) {
  const category = getCategory(categoryKey);
  const { customerId } = await ensureCustomerContext(authUser);

  const hasConsent = await hasDocumentStorageConsent(customerId);
  if (!hasConsent) {
    throw new Error("문서 보관 동의가 필요합니다.");
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
      metadata_json: {
        byte_size: validated.byteSize,
        upload_source: "web",
        sanitized_filename: storageFilename,
        category_key: category.key,
      },
      consent_snapshot: consentSnapshot,
    })
    .select(DOCUMENT_LIST_COLUMNS)
    .single();

  if (insertError) {
    await supabase.storage.from(STORAGE_BUCKET).remove([storagePath]);
    throw new Error(toCustomerErrorMessage(insertError, "문서 정보를 저장하지 못했습니다."));
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
  CLAIM_SCRUB_FAILED: "claim_scrub_failed",
  STORAGE_REMOVE_FAILED: "storage_remove_failed",
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

/**
 * Wrong-upload forget path (reconstruction model).
 * After RPC soft-delete succeeds, the document is immediately out of KEY/current-insurance
 * lookup (deleted_at / retired policies). Final success requires claim scrub OK.
 * Storage remove may fail independently — retry is idempotent; active attach is not restored.
 *
 * @param {object} [options] test injection: supabase, ensureCustomerContext, storageRemove
 */
export async function softDeleteDocument(authUser, documentId, options = {}) {
  const client = options.supabase ?? supabase;
  const ensureCtx = options.ensureCustomerContext ?? ensureCustomerContext;
  const storageRemove =
    options.storageRemove ??
    (async (storagePath) => {
      const { error } = await client.storage.from(STORAGE_BUCKET).remove([storagePath]);
      if (error && !isStorageRemoveAlreadyGoneError(error)) {
        return { ok: false, error };
      }
      return { ok: true, already_gone: Boolean(error) };
    });

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

  // Include already soft-deleted rows so retry can finish scrub/storage idempotently.
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

  if (!document || document.customer_id !== customerId) {
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

  let deletedAt = document.deleted_at ?? null;
  let softDeleteOk = Boolean(deletedAt);

  if (!softDeleteOk) {
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
  }

  // From this point the document is excluded from KEY / search / current insurance.
  const currentInsuranceInvalidated = true;
  // Never re-attach a soft-deleted document_id on partial failure.
  const clearActiveAttachment = true;

  const claimCasesScrub = await scrubProfileClaimCasesForDeletedDocument(customerId, did, client);
  if (!claimCasesScrub.ok) {
    return {
      success: false,
      reason: DOCUMENT_DELETE_REASON.CLAIM_SCRUB_FAILED,
      documentId: did,
      customerId,
      deletedAt,
      current_insurance_invalidated: currentInsuranceInvalidated,
      clear_active_attachment: clearActiveAttachment,
      soft_delete_ok: softDeleteOk,
      claim_cases_scrub: claimCasesScrub,
      storage_remove_ok: null,
      error_message: "일부 관련 기록을 정리하지 못했습니다. 다시 시도해 주세요.",
    };
  }

  let storageRemoveOk = true;
  if (document.storage_path) {
    const storageResult = await storageRemove(document.storage_path);
    storageRemoveOk = storageResult?.ok === true;
    if (!storageRemoveOk) {
      return {
        success: false,
        reason: DOCUMENT_DELETE_REASON.STORAGE_REMOVE_FAILED,
        documentId: did,
        customerId,
        deletedAt,
        current_insurance_invalidated: currentInsuranceInvalidated,
        clear_active_attachment: clearActiveAttachment,
        soft_delete_ok: softDeleteOk,
        claim_cases_scrub: claimCasesScrub,
        storage_remove_ok: false,
        error_message:
          "파일 정보는 제외되었습니다. 원본 정리에 실패해 다시 시도해 주세요.",
      };
    }
  }

  return {
    success: true,
    reason: null,
    documentId: did,
    customerId,
    deletedAt,
    current_insurance_invalidated: currentInsuranceInvalidated,
    clear_active_attachment: clearActiveAttachment,
    soft_delete_ok: softDeleteOk,
    claim_cases_scrub: claimCasesScrub,
    storage_remove_ok: storageRemoveOk,
    error_message: null,
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
