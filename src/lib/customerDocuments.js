import { loadCustomerDashboardData } from "./customerDashboard.js";
import { supabase } from "./supabase.js";
import { toCustomerErrorMessage } from "./uiLocale.js";

export const STORAGE_BUCKET = "customer-documents";
export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;
export const DOCUMENT_STORAGE_CONSENT_VERSION = "2026-06-07-ko-doc";
export const SIGNED_URL_TTL_SECONDS = 60;

export const DOCUMENT_CATEGORIES = [
  {
    key: "insurance_policy",
    label: "보험증권",
    docClass: "policy_certificate",
    hintType: "insurance_policy",
  },
  {
    key: "terms",
    label: "약관",
    docClass: "terms",
    hintType: "terms",
  },
  {
    key: "claim",
    label: "청구서류",
    docClass: "claim",
    hintType: "claim",
  },
  {
    key: "medical",
    label: "의료서류",
    docClass: "medical",
    hintType: "medical",
  },
  {
    key: "other",
    label: "기타문서",
    docClass: "other",
    hintType: "other",
  },
];

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


export const DOCUMENT_ANALYSIS_CONSENT_VERSION = "2026-06-07-ko-doc-analysis";

export async function grantDocumentAnalysisConsent(authUser) {
  const { customerId } = await ensureCustomerContext(authUser);
  const { data, error } = await supabase.rpc("lifeguard_grant_document_analysis_consent", {
    p_consent_version: DOCUMENT_ANALYSIS_CONSENT_VERSION,
  });
  if (error) {
    throw new Error(toCustomerErrorMessage(error, "문서 분석 동의를 저장하지 못했습니다."));
  }
  return {
    customerId,
    consentVersion: DOCUMENT_ANALYSIS_CONSENT_VERSION,
    alreadyGranted: data?.already_granted === true,
    grantedAt: data?.granted_at ?? null,
  };
}

export async function requestDocumentIngest(authUser, documentId) {
  const { customerId } = await ensureCustomerContext(authUser);
  const { data, error } = await supabase.rpc("lifeguard_request_customer_document_ingest", {
    p_document_id: documentId,
  });
  if (error) {
    throw new Error(toCustomerErrorMessage(error, "문서 분석 요청에 실패했습니다."));
  }
  return { customerId, ...data };
}

export async function invokeDocumentIngestWorker(authUser, documentId) {
  const { data: session } = await supabase.auth.getSession();
  const accessToken = session?.session?.access_token;
  if (!accessToken) throw new Error("로그인이 필요합니다.");

  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
  const response = await fetch(`${supabaseUrl}/functions/v1/document-ingest-worker`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      apikey: anonKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ document_id: documentId }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(body?.message || body?.error || "문서 OCR 처리에 실패했습니다.");
  }
  return body;
}

export async function processUploadedInsuranceDocumentMemory(authUser, documentId) {
  const { customerId } = await ensureCustomerContext(authUser);
  await grantDocumentAnalysisConsent(authUser);
  const ingestRequest = await requestDocumentIngest(authUser, documentId);
  if (!ingestRequest.blocked) {
    await invokeDocumentIngestWorker(authUser, documentId);
  }

  const { data: session } = await supabase.auth.getSession();
  const accessToken = session?.session?.access_token;
  if (!accessToken) throw new Error("로그인이 필요합니다.");

  const response = await fetch("/api/customer-document-insurance-memory", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ document_id: documentId }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || !body?.ok) {
    throw new Error(body?.error_message || body?.reason || "보험 메모리 생성에 실패했습니다.");
  }
  return { customerId, ...body };
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

  return {
    customerId,
    hasDocumentStorageConsent: hasConsent,
    documents: data ?? [],
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
      doc_class: category.docClass,
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

  return {
    customerId,
    document: data,
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

export async function softDeleteDocument(authUser, documentId) {
  const { customerId } = await ensureCustomerContext(authUser);

  const { data: document, error: readError } = await supabase
    .from("customer_documents")
    .select("id, customer_id, storage_path")
    .eq("id", documentId)
    .is("deleted_at", null)
    .maybeSingle();

  if (readError) {
    throw new Error(toCustomerErrorMessage(readError, "문서 정보를 불러오지 못했습니다."));
  }

  if (!document || document.customer_id !== customerId) {
    throw new Error("문서를 찾을 수 없습니다.");
  }

  const { data: deletedDocument, error: rpcError } = await supabase.rpc(
    "lifeguard_soft_delete_customer_document",
    { p_document_id: documentId },
  );

  if (rpcError) {
    throw new Error(toCustomerErrorMessage(rpcError, "문서를 삭제하지 못했습니다."));
  }

  if (!deletedDocument) {
    throw new Error("문서를 찾을 수 없습니다.");
  }

  const deletedAt = deletedDocument.deleted_at ?? new Date().toISOString();

  if (document.storage_path) {
    await supabase.storage.from(STORAGE_BUCKET).remove([document.storage_path]);
  }

  return { success: true, documentId, deletedAt };
}
