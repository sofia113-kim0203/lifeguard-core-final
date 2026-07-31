/**
 * Claude-Full / Claude-first document-direct — ownership + original PDF/image attach
 * (no KEY pre-summary / no OCR substitute).
 * Bytes/base64/signed URLs must never enter DB trace/metadata/logs.
 */

import { createHash } from "crypto";

export const CUSTOMER_DOCUMENTS_BUCKET = "customer-documents";
export const CLAUDE_FULL_PDF_MAX_BYTES = 20 * 1024 * 1024; // align with upload cap
/** Full Anthropic Messages request body safety cap (PDF + context + tools/schema). */
export const CLAUDE_FULL_REQUEST_MAX_BYTES = 30 * 1024 * 1024;
/** Vault recall: max unique content hashes attached in one Claude turn (no silent drop). */
export const CLAUDE_FIRST_VAULT_MAX_UNIQUE_ATTACH = 6;
/** Vault recall: decoded-byte budget for originals in one turn. */
export const CLAUDE_FIRST_VAULT_ATTACH_BYTE_BUDGET = 22 * 1024 * 1024;
export const CLAUDE_FULL_PDF_MEDIA_TYPE = "application/pdf";
export const CLAUDE_FULL_JPEG_MEDIA_TYPE = "image/jpeg";
export const CLAUDE_FULL_PNG_MEDIA_TYPE = "image/png";

/** insurance_policy series — HomeChat + coverage analysis originals only. */
export const INSURANCE_POLICY_SERIES_HINT_TYPES = Object.freeze([
  "insurance_policy",
  "coverage_analysis_sheet",
]);
export const INSURANCE_POLICY_SERIES_DOC_CLASSES = Object.freeze([
  "policy_certificate",
  "coverage_analysis_sheet",
]);
export const INSURANCE_POLICY_SERIES_CATEGORY_KEYS = Object.freeze([
  "insurance_policy",
  "coverage_analysis_sheet",
]);

export function contentSha256Hex(buf) {
  if (!Buffer.isBuffer(buf) || buf.length === 0) return null;
  return createHash("sha256").update(buf).digest("hex");
}

export function isInsurancePolicySeriesDocument(doc = null) {
  if (!doc || typeof doc !== "object") return false;
  const hint = String(doc.customer_hint_type ?? "").trim();
  const docClass = String(doc.doc_class ?? "").trim();
  const categoryKey = String(doc.metadata_json?.category_key ?? "").trim();
  if (INSURANCE_POLICY_SERIES_HINT_TYPES.includes(hint)) return true;
  if (INSURANCE_POLICY_SERIES_DOC_CLASSES.includes(docClass)) return true;
  if (INSURANCE_POLICY_SERIES_CATEGORY_KEYS.includes(categoryKey)) return true;
  return false;
}

/**
 * Vault multi-recall fetch order: PDFs first, then images.
 * Prevents newest-image-only caps from crowding out processable policy PDFs
 * (Anthropic "Could not process image" monopoly path).
 */
export function orderDocumentsPdfFirstForVaultRecall(documents = []) {
  const rows = Array.isArray(documents) ? documents : [];
  const pdfs = [];
  const images = [];
  const other = [];
  for (const doc of rows) {
    const mime = normalizeClaudeDirectAttachMediaType(doc?.mime_type);
    if (mime === CLAUDE_FULL_PDF_MEDIA_TYPE) pdfs.push(doc);
    else if (isClaudeDirectImageMediaType(mime)) images.push(doc);
    else other.push(doc);
  }
  return [...pdfs, ...images, ...other];
}

/** Honest customer text when PDF+context exceeds request cap — never S3/S4/S5. */
export const DOCUMENT_DIRECT_REQUEST_TOO_LARGE_CUSTOMER_TEXT =
  "올려주신 문서가 커서 지금은 원본을 직접 읽어 드리기 어려워요. 잠시 후 다시 올려 주시거나, 꼭 필요한 페이지만 따로 보내 주시면 KEY가 이어서 볼게요.";

/**
 * Canonical MIME for Claude-first direct attach.
 * Upload already stores image/jpeg (not image/jpg); only normalize known aliases.
 * @returns {string|null}
 */
export function normalizeClaudeDirectAttachMediaType(mimeType) {
  const raw = String(mimeType ?? "").trim().toLowerCase();
  if (!raw) return null;
  if (raw === CLAUDE_FULL_PDF_MEDIA_TYPE) return CLAUDE_FULL_PDF_MEDIA_TYPE;
  if (raw === CLAUDE_FULL_JPEG_MEDIA_TYPE || raw === "image/jpg") {
    return CLAUDE_FULL_JPEG_MEDIA_TYPE;
  }
  if (raw === CLAUDE_FULL_PNG_MEDIA_TYPE) return CLAUDE_FULL_PNG_MEDIA_TYPE;
  return null;
}

export function isClaudeDirectAttachMediaType(mimeType) {
  return normalizeClaudeDirectAttachMediaType(mimeType) != null;
}

export function isClaudeDirectImageMediaType(mimeType) {
  const mime = normalizeClaudeDirectAttachMediaType(mimeType);
  return mime === CLAUDE_FULL_JPEG_MEDIA_TYPE || mime === CLAUDE_FULL_PNG_MEDIA_TYPE;
}

/** True when request body tries to inject client image bytes for Claude. */
export function requestHasForbiddenClientImageBytes(body = {}) {
  if (!body || typeof body !== "object") return false;
  const keys = [
    "claude_upright_image_base64",
    "claudeUprightImageBase64",
    "claude_upright_image",
    "claudeUprightImage",
    "attach_image_base64",
    "image_base64",
  ];
  for (const k of keys) {
    const v = body[k];
    if (v == null) continue;
    if (typeof v === "string" && v.trim()) return true;
    if (typeof v === "object" && String(v.base64 ?? "").trim()) return true;
  }
  return false;
}

/**
 * Minimal attach ops signals (no orientation / no decode detail / no PII).
 */
export function buildAttachOpsSignals({
  attachment_requested = false,
  attachment_attached = false,
  attachment_failed = false,
  attachment_failure_code = null,
  attachment_block_built = false,
} = {}) {
  const failed = attachment_failed === true;
  return {
    attachment_requested: attachment_requested === true,
    attachment_attached: attachment_attached === true,
    attachment_failed: failed,
    attachment_failure_code: failed
      ? String(attachment_failure_code ?? "attach_failed").slice(0, 80)
      : null,
    attachment_block_built: attachment_block_built === true,
  };
}

/**
 * Redacted attach metrics — never include bytes/base64/url/storage_path.
 */
export function buildDocumentDirectTraceMeta({
  documentId = null,
  mimeType = null,
  fileSizeBytes = null,
  directDocumentAttached = false,
  documentFetchMs = null,
  documentAttachMs = null,
  fallbackUsed = false,
  fallbackReason = null,
  ownershipVerified = false,
  estimatedRequestBytes = null,
} = {}) {
  return {
    document_id: documentId ?? null,
    mime_type: mimeType ?? null,
    file_size_bytes:
      typeof fileSizeBytes === "number" && Number.isFinite(fileSizeBytes)
        ? fileSizeBytes
        : null,
    direct_document_attached: directDocumentAttached === true,
    document_fetch_ms:
      typeof documentFetchMs === "number" ? documentFetchMs : null,
    document_attach_ms:
      typeof documentAttachMs === "number" ? documentAttachMs : null,
    document_fallback_used: fallbackUsed === true,
    document_fallback_reason: fallbackReason ?? null,
    ownership_verified: ownershipVerified === true,
    estimated_request_bytes:
      typeof estimatedRequestBytes === "number" && Number.isFinite(estimatedRequestBytes)
        ? estimatedRequestBytes
        : null,
  };
}

/**
 * Byte size of the final Anthropic Messages JSON body that would be POSTed.
 * Includes model/system/tools/tool_choice/messages (PDF base64 + payload text).
 */
export function estimateAnthropicMessagesRequestBytes({
  model = "",
  maxTokens = 4096,
  temperature = 0.3,
  system = "",
  tools = [],
  toolChoice = null,
  messages = [],
} = {}) {
  const bodyStr = JSON.stringify({
    model,
    max_tokens: maxTokens,
    temperature,
    system,
    tools,
    tool_choice: toolChoice,
    messages,
  });
  return Buffer.byteLength(bodyStr, "utf8");
}

/**
 * True when estimated full request exceeds the 30MB safety cap.
 */
export function isClaudeFullRequestTooLarge(estimatedRequestBytes) {
  return (
    typeof estimatedRequestBytes === "number" &&
    Number.isFinite(estimatedRequestBytes) &&
    estimatedRequestBytes > CLAUDE_FULL_REQUEST_MAX_BYTES
  );
}

/**
 * Anthropic Messages API native PDF document block (platform.claude.com PDF support).
 * @param {{ base64: string, mediaType?: string }}
 */
export function buildAnthropicPdfDocumentBlock({
  base64,
  mediaType = CLAUDE_FULL_PDF_MEDIA_TYPE,
} = {}) {
  const data = String(base64 ?? "").trim();
  if (!data) return null;
  return {
    type: "document",
    source: {
      type: "base64",
      media_type: mediaType || CLAUDE_FULL_PDF_MEDIA_TYPE,
      data,
    },
  };
}

/**
 * Anthropic Messages API image block (JPEG / PNG).
 * @param {{ base64: string, mediaType?: string }}
 */
export function buildAnthropicImageBlock({
  base64,
  mediaType = CLAUDE_FULL_JPEG_MEDIA_TYPE,
} = {}) {
  const data = String(base64 ?? "").trim();
  const mime = normalizeClaudeDirectAttachMediaType(mediaType);
  if (!data || !isClaudeDirectImageMediaType(mime)) return null;
  return {
    type: "image",
    source: {
      type: "base64",
      media_type: mime,
      data,
    },
  };
}

/**
 * PDF → document block · JPEG/PNG → image block.
 */
export function buildAnthropicDirectAttachBlock({ base64, mediaType } = {}) {
  const mime = normalizeClaudeDirectAttachMediaType(mediaType);
  if (!mime) return null;
  if (mime === CLAUDE_FULL_PDF_MEDIA_TYPE) {
    return buildAnthropicPdfDocumentBlock({ base64, mediaType: mime });
  }
  return buildAnthropicImageBlock({ base64, mediaType: mime });
}

function rejectMimeNotSupported({
  documentId,
  mime,
  ownershipVerified,
  fetchStarted,
  document = null,
}) {
  return {
    ok: false,
    reason: "mime_not_supported_for_direct",
    fallbackRecommended: true,
    ...(document
      ? {
          document: {
            id: document.id,
            customer_id: document.customer_id,
            original_filename: document.original_filename ?? null,
            mime_type: mime,
            ingest_status: document.ingest_status ?? null,
          },
        }
      : {}),
    metrics: buildDocumentDirectTraceMeta({
      documentId,
      mimeType: mime,
      ownershipVerified,
      fallbackUsed: true,
      fallbackReason: "mime_not_supported_for_direct",
      documentFetchMs: Math.max(0, Date.now() - fetchStarted),
    }),
  };
}

/**
 * Verify customer ownership and load original PDF/JPEG/PNG bytes from existing storage.
 * Does not OCR/parse. Does not invent content.
 *
 * @returns {Promise<{
 *   ok: boolean,
 *   reason?: string,
 *   pdfBase64?: string,
 *   mediaType?: string,
 *   fileSizeBytes?: number,
 *   document?: object,
 *   metrics: object,
 *   fallbackRecommended?: boolean,
 * }>}
 */
export async function verifyAndFetchCustomerPdfOriginal({
  supabase,
  customerId,
  documentId,
  env = process.env,
  // Test injection — never used for production traces (PDF or image bytes)
  injectedPdfBytes = null,
  injectedDocument = null,
} = {}) {
  const fetchStarted = Date.now();
  const cid = String(customerId ?? "").trim();
  const did = String(documentId ?? "").trim();
  // Production and Preview share the same ownership / MIME / size / Storage path.
  // No VERCEL_ENV hard-block — KEY(Claude) must read the same original bytes.

  if (!cid || !did) {
    return {
      ok: false,
      reason: "customer_or_document_id_required",
      fallbackRecommended: false,
      metrics: buildDocumentDirectTraceMeta({
        documentId: did || null,
        fallbackUsed: true,
        fallbackReason: "customer_or_document_id_required",
      }),
    };
  }

  // --- Unit-test / in-process injection (no storage) ---
  if (injectedPdfBytes != null && injectedDocument) {
    const doc = injectedDocument;
    if (String(doc.customer_id ?? "") !== cid || String(doc.id ?? "") !== did) {
      return {
        ok: false,
        reason: "document_ownership_denied",
        fallbackRecommended: false,
        metrics: buildDocumentDirectTraceMeta({
          documentId: did,
          ownershipVerified: false,
          fallbackUsed: true,
          fallbackReason: "document_ownership_denied",
          documentFetchMs: Math.max(0, Date.now() - fetchStarted),
        }),
      };
    }
    const mime = normalizeClaudeDirectAttachMediaType(
      doc.mime_type ?? CLAUDE_FULL_PDF_MEDIA_TYPE,
    );
    if (!mime) {
      return rejectMimeNotSupported({
        documentId: did,
        mime: String(doc.mime_type ?? "").trim(),
        ownershipVerified: true,
        fetchStarted,
      });
    }
    const buf = Buffer.isBuffer(injectedPdfBytes)
      ? injectedPdfBytes
      : Buffer.from(injectedPdfBytes);
    if (buf.length > CLAUDE_FULL_PDF_MAX_BYTES) {
      return {
        ok: false,
        reason: "pdf_too_large_for_direct_attach",
        fallbackRecommended: true,
        metrics: buildDocumentDirectTraceMeta({
          documentId: did,
          mimeType: mime,
          fileSizeBytes: buf.length,
          ownershipVerified: true,
          fallbackUsed: true,
          fallbackReason: "pdf_too_large_for_direct_attach",
          documentFetchMs: Math.max(0, Date.now() - fetchStarted),
        }),
      };
    }
    const fetchMs = Math.max(0, Date.now() - fetchStarted);
    const attachStarted = Date.now();
    const content_sha256 = contentSha256Hex(buf);
    const pdfBase64 = buf.toString("base64");
    const attachMs = Math.max(0, Date.now() - attachStarted);
    return {
      ok: true,
      pdfBase64,
      mediaType: mime,
      fileSizeBytes: buf.length,
      content_sha256,
      document: {
        id: did,
        customer_id: cid,
        original_filename: doc.original_filename ?? null,
        mime_type: mime,
        ingest_status: doc.ingest_status ?? null,
      },
      metrics: buildDocumentDirectTraceMeta({
        documentId: did,
        mimeType: mime,
        fileSizeBytes: buf.length,
        directDocumentAttached: true,
        documentFetchMs: fetchMs,
        documentAttachMs: attachMs,
        ownershipVerified: true,
      }),
    };
  }

  if (!supabase) {
    return {
      ok: false,
      reason: "supabase_required",
      fallbackRecommended: false,
      metrics: buildDocumentDirectTraceMeta({
        documentId: did,
        fallbackUsed: true,
        fallbackReason: "supabase_required",
      }),
    };
  }

  const { data: document, error: docError } = await supabase
    .from("customer_documents")
    .select(
      "id, customer_id, storage_path, mime_type, original_filename, ingest_status, deleted_at",
    )
    .eq("id", did)
    .eq("customer_id", cid)
    .is("deleted_at", null)
    .maybeSingle();

  if (docError) {
    return {
      ok: false,
      reason: "document_lookup_failed",
      fallbackRecommended: true,
      metrics: buildDocumentDirectTraceMeta({
        documentId: did,
        ownershipVerified: false,
        fallbackUsed: true,
        fallbackReason: "document_lookup_failed",
        documentFetchMs: Math.max(0, Date.now() - fetchStarted),
      }),
    };
  }

  if (!document) {
    return {
      ok: false,
      reason: "document_ownership_denied",
      fallbackRecommended: false,
      metrics: buildDocumentDirectTraceMeta({
        documentId: did,
        ownershipVerified: false,
        fallbackUsed: true,
        fallbackReason: "document_ownership_denied",
        documentFetchMs: Math.max(0, Date.now() - fetchStarted),
      }),
    };
  }

  const rawMime = String(document.mime_type ?? "").trim();
  const mime = normalizeClaudeDirectAttachMediaType(rawMime || CLAUDE_FULL_PDF_MEDIA_TYPE);
  if (!mime) {
    return rejectMimeNotSupported({
      documentId: did,
      mime: rawMime,
      ownershipVerified: true,
      fetchStarted,
      document,
    });
  }

  const storagePath = String(document.storage_path ?? "").trim();
  if (!storagePath) {
    return {
      ok: false,
      reason: "storage_path_missing",
      fallbackRecommended: true,
      metrics: buildDocumentDirectTraceMeta({
        documentId: did,
        mimeType: mime,
        ownershipVerified: true,
        fallbackUsed: true,
        fallbackReason: "storage_path_missing",
        documentFetchMs: Math.max(0, Date.now() - fetchStarted),
      }),
    };
  }

  const { data: blob, error: downloadError } = await supabase.storage
    .from(CUSTOMER_DOCUMENTS_BUCKET)
    .download(storagePath);

  if (downloadError || !blob) {
    return {
      ok: false,
      reason: "pdf_download_failed",
      fallbackRecommended: true,
      metrics: buildDocumentDirectTraceMeta({
        documentId: did,
        mimeType: mime,
        ownershipVerified: true,
        fallbackUsed: true,
        fallbackReason: "pdf_download_failed",
        documentFetchMs: Math.max(0, Date.now() - fetchStarted),
      }),
    };
  }

  const arrayBuffer = await blob.arrayBuffer();
  const buf = Buffer.from(arrayBuffer);
  const fetchMs = Math.max(0, Date.now() - fetchStarted);

  if (buf.length === 0) {
    return {
      ok: false,
      reason: "pdf_empty",
      fallbackRecommended: true,
      metrics: buildDocumentDirectTraceMeta({
        documentId: did,
        mimeType: mime,
        fileSizeBytes: 0,
        ownershipVerified: true,
        fallbackUsed: true,
        fallbackReason: "pdf_empty",
        documentFetchMs: fetchMs,
      }),
    };
  }

  if (buf.length > CLAUDE_FULL_PDF_MAX_BYTES) {
    return {
      ok: false,
      reason: "pdf_too_large_for_direct_attach",
      fallbackRecommended: true,
      metrics: buildDocumentDirectTraceMeta({
        documentId: did,
        mimeType: mime,
        fileSizeBytes: buf.length,
        ownershipVerified: true,
        fallbackUsed: true,
        fallbackReason: "pdf_too_large_for_direct_attach",
        documentFetchMs: fetchMs,
      }),
    };
  }

  const attachStarted = Date.now();
  const content_sha256 = contentSha256Hex(buf);
  const pdfBase64 = buf.toString("base64");
  const attachMs = Math.max(0, Date.now() - attachStarted);

  return {
    ok: true,
    pdfBase64,
    mediaType: mime,
    fileSizeBytes: buf.length,
    content_sha256,
    document: {
      id: document.id,
      customer_id: document.customer_id,
      original_filename: document.original_filename ?? null,
      mime_type: mime,
      ingest_status: document.ingest_status ?? null,
    },
    metrics: buildDocumentDirectTraceMeta({
      documentId: did,
      mimeType: mime,
      fileSizeBytes: buf.length,
      directDocumentAttached: true,
      documentFetchMs: fetchMs,
      documentAttachMs: attachMs,
      ownershipVerified: true,
    }),
  };
}

/**
 * List owned active insurance-series originals (no silent latest invent).
 * deleted_at IS NULL · customer ownership · insurance_policy series only.
 * Paginate past pageSize (default 40) until the last page — never silent-truncate the list.
 */
export async function listOwnedInsuranceOriginalDocuments({
  supabase = null,
  customerId = null,
  limit = 40,
  pageSize = 40,
  maxPages = 50,
} = {}) {
  const cid = String(customerId ?? "").trim();
  if (!supabase || !cid) {
    return {
      ok: false,
      reason: "missing_auth",
      documents: [],
      listing: [],
      list_complete: false,
      pages_fetched: 0,
    };
  }
  const size = Math.min(Math.max(Number(pageSize) || Number(limit) || 40, 1), 80);
  const pageCap = Math.min(Math.max(Number(maxPages) || 50, 1), 200);
  const raw = [];
  let pagesFetched = 0;
  let listComplete = false;
  let listError = null;

  for (let page = 0; page < pageCap; page += 1) {
    const from = page * size;
    const to = from + size - 1;
    const { data: rows, error } = await supabase
      .from("customer_documents")
      .select(
        "id, customer_id, original_filename, created_at, deleted_at, mime_type, storage_path, doc_class, customer_hint_type, metadata_json",
      )
      .eq("customer_id", cid)
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .range(from, to);

    pagesFetched += 1;
    if (error) {
      listError = error;
      break;
    }
    const batch = Array.isArray(rows) ? rows : [];
    raw.push(...batch);
    if (batch.length < size) {
      listComplete = true;
      break;
    }
  }
  if (!listComplete && !listError && pagesFetched >= pageCap) {
    listComplete = false;
  }

  if (listError && raw.length === 0) {
    return {
      ok: false,
      reason: "document_list_failed",
      documents: [],
      listing: [],
      list_complete: false,
      pages_fetched: pagesFetched,
      stage_counts: {
        listed_owned_raw: 0,
        after_insurance_series: 0,
        after_mime: 0,
        after_storage_path: 0,
        after_ownership: 0,
      },
    };
  }

  let afterSeries = 0;
  let afterMime = 0;
  let afterPath = 0;
  let afterOwner = 0;
  const documents = raw.filter((doc) => {
    if (!isInsurancePolicySeriesDocument(doc)) return false;
    afterSeries += 1;
    if (!isClaudeDirectAttachMediaType(doc?.mime_type)) return false;
    afterMime += 1;
    if (!String(doc?.storage_path ?? "").trim()) return false;
    afterPath += 1;
    if (String(doc?.customer_id ?? "") !== cid) return false;
    afterOwner += 1;
    return true;
  });

  const listing = documents.map((doc) => ({
    document_id: doc?.id != null ? String(doc.id) : null,
    original_filename: doc?.original_filename ?? null,
    created_at: doc?.created_at ?? null,
    mime_type: doc?.mime_type ?? null,
  }));

  return {
    ok: true,
    reason: listComplete ? "ok" : "list_page_cap_partial",
    documents,
    listing,
    list_complete: listComplete,
    pages_fetched: pagesFetched,
    stage_counts: {
      listed_owned_raw: raw.length,
      after_insurance_series: afterSeries,
      after_mime: afterMime,
      after_storage_path: afterPath,
      after_ownership: afterOwner,
    },
  };
}

/**
 * Vault recall — paginated list + batch fetch of owned originals, dedupe by content sha256.
 * Never silently picks latest-only. Never silently stops at page 40 / first 5–6 without reporting.
 * Claude attach may still be budget-capped; processing summary always reports remaining.
 */
export async function resolveOwnedInsuranceVaultRecall({
  supabase = null,
  customerId = null,
  env = process.env,
  maxUniqueAttach = CLAUDE_FIRST_VAULT_MAX_UNIQUE_ATTACH,
  byteBudget = CLAUDE_FIRST_VAULT_ATTACH_BYTE_BUDGET,
  verifyAndFetch = verifyAndFetchCustomerPdfOriginal,
  fetchBatchSize = 5,
} = {}) {
  const listed = await listOwnedInsuranceOriginalDocuments({
    supabase,
    customerId,
    pageSize: 40,
  });
  const listStages =
    listed?.stage_counts && typeof listed.stage_counts === "object"
      ? listed.stage_counts
      : {
          listed_owned_raw: 0,
          after_insurance_series: 0,
          after_mime: 0,
          after_storage_path: 0,
          after_ownership: 0,
        };
  const baseStage = () => ({
    ...listStages,
    list_complete: listed?.list_complete === true,
    pages_fetched: Number(listed?.pages_fetched) || 0,
    fetch_attempted: 0,
    fetch_ok: 0,
    fetch_failed: 0,
    sha_dupes_skipped: 0,
    id_dupes_skipped: 0,
    before_sha_unique: 0,
    after_sha_unique: 0,
    after_cap_budget: 0,
    budget_stop: false,
    cap_stop: false,
    failed_reason_counts: {},
  });
  if (!listed.ok) {
    return {
      mode: "unavailable",
      reason: listed.reason,
      attachments: [],
      listing: [],
      failed: [],
      stage_counts: baseStage(),
      processing: {
        total_count: 0,
        processed_count: 0,
        remaining_count: 0,
        complete: false,
        stop_reason: listed.reason || "document_list_failed",
      },
    };
  }
  if (!listed.documents.length) {
    return {
      mode: "empty",
      reason: "insurance_vault_empty",
      attachments: [],
      listing: [],
      failed: [],
      stage_counts: baseStage(),
      processing: {
        total_count: 0,
        processed_count: 0,
        remaining_count: 0,
        complete: listed.list_complete === true,
        stop_reason: listed.list_complete === true ? null : "list_page_cap_partial",
      },
    };
  }

  // PDF-first order (created_at desc preserved within each mime group by list order).
  const orderedDocuments = orderDocumentsPdfFirstForVaultRecall(listed.documents);
  const totalCandidates = orderedDocuments.length;

  const unique = [];
  const seenIds = new Set();
  const seenSha = new Set();
  const failed = [];
  const excluded = [];
  const failedReasonCounts = {};
  let fetchAttempted = 0;
  let fetchOk = 0;
  let fetchFailed = 0;
  let shaDupesSkipped = 0;
  let idDupesSkipped = 0;
  let budgetStop = false;
  let capStop = false;
  let totalBytes = 0;
  const maxUnique = Math.min(Math.max(Number(maxUniqueAttach) || 6, 1), 8);
  const budget = Math.min(
    Math.max(Number(byteBudget) || CLAUDE_FIRST_VAULT_ATTACH_BYTE_BUDGET, 1),
    CLAUDE_FULL_REQUEST_MAX_BYTES,
  );
  const batchSize = Math.min(Math.max(Number(fetchBatchSize) || 5, 1), 20);

  const packStage = () => ({
    ...listStages,
    list_complete: listed?.list_complete === true,
    pages_fetched: Number(listed?.pages_fetched) || 0,
    fetch_attempted: fetchAttempted,
    fetch_ok: fetchOk,
    fetch_failed: fetchFailed,
    sha_dupes_skipped: shaDupesSkipped,
    id_dupes_skipped: idDupesSkipped,
    before_sha_unique: fetchOk,
    after_sha_unique: unique.length,
    after_cap_budget: unique.length,
    budget_stop: budgetStop,
    cap_stop: capStop,
    failed_reason_counts: failedReasonCounts,
    pdf_first_order: true,
  });

  // Batch through every listed candidate (past the old silent 5-cut). Cap/budget only
  // limits Claude attach rows; remaining candidates are reported, never pretended complete.
  for (let batchStart = 0; batchStart < orderedDocuments.length; batchStart += batchSize) {
    const batch = orderedDocuments.slice(batchStart, batchStart + batchSize);
    for (const doc of batch) {
      const did = String(doc?.id ?? "").trim();
      if (!did) continue;
      if (seenIds.has(did)) {
        idDupesSkipped += 1;
        continue;
      }
      seenIds.add(did);

      if (unique.length >= maxUnique) {
        capStop = true;
        excluded.push({
          document_id: did,
          original_filename: doc?.original_filename ?? null,
          reason: "beyond_attach_cap",
        });
        continue;
      }

      fetchAttempted += 1;
      const fetched = await verifyAndFetch({
        supabase,
        customerId,
        documentId: did,
        env,
      });
      if (!fetched?.ok || !fetched.pdfBase64) {
        fetchFailed += 1;
        const reason = String(fetched?.reason ?? "pdf_download_failed").slice(0, 80);
        failedReasonCounts[reason] = (failedReasonCounts[reason] || 0) + 1;
        failed.push({
          document_id: did,
          original_filename: doc?.original_filename ?? null,
          reason,
        });
        continue;
      }
      fetchOk += 1;

      let sha = String(fetched.content_sha256 ?? "").trim().toLowerCase();
      if (!sha && fetched.pdfBase64) {
        try {
          sha = contentSha256Hex(Buffer.from(String(fetched.pdfBase64), "base64")) || "";
        } catch {
          sha = "";
        }
      }
      if (sha && seenSha.has(sha)) {
        shaDupesSkipped += 1;
        continue; // identical file bytes — one Claude attach only
      }

      const size = Number(fetched.fileSizeBytes) || 0;
      if (unique.length > 0 && totalBytes + size > budget) {
        budgetStop = true;
        excluded.push({
          document_id: did,
          original_filename: doc?.original_filename ?? null,
          reason: "beyond_byte_budget",
        });
        continue;
      }

      if (sha) seenSha.add(sha);
      totalBytes += size;
      unique.push({
        document_id: did,
        original_filename: fetched.document?.original_filename ?? doc?.original_filename ?? null,
        pdfBase64: fetched.pdfBase64,
        mediaType: fetched.mediaType,
        fileSizeBytes: size,
        content_sha256: sha || null,
        created_at: doc?.created_at ?? null,
      });
    }
  }

  const remaining =
    excluded.length +
    Math.max(0, totalCandidates - fetchAttempted - idDupesSkipped);
  const complete =
    listed.list_complete === true &&
    !capStop &&
    !budgetStop &&
    remaining <= 0 &&
    failed.length === 0;
  const stopReason = !listed.list_complete
    ? "list_page_cap_partial"
    : capStop
      ? "unique_attach_cap_partial"
      : budgetStop
        ? "attach_byte_budget_partial"
        : failed.length && !unique.length
          ? "all_originals_unavailable"
          : failed.length
            ? "partial_fetch_failures"
            : null;

  const processing = {
    total_count: totalCandidates,
    processed_count: fetchAttempted,
    remaining_count: Math.max(0, totalCandidates - fetchAttempted),
    attached_count: unique.length,
    excluded_count: excluded.length,
    complete,
    stop_reason: stopReason,
  };

  if (!unique.length) {
    return {
      mode: "unavailable",
      reason: failed.length ? "all_originals_unavailable" : "insurance_vault_empty",
      attachments: [],
      listing: listed.listing,
      failed,
      excluded,
      stage_counts: packStage(),
      processing,
    };
  }

  return {
    mode: complete ? "attach" : "partial_attach",
    reason: complete
      ? "owned_insurance_vault_deduped"
      : stopReason || "owned_insurance_vault_partial",
    attachments: unique,
    listing: listed.listing,
    failed,
    excluded,
    stage_counts: packStage(),
    processing,
  };
}

/**
 * Resolve content sha for merge: stored hash → SHA-256 of original bytes/base64.
 * Never filename+size.
 */
export function resolveAttachRowContentSha(row = null) {
  if (!row || typeof row !== "object") return "";
  const stored = String(row.content_sha256 ?? row.source_content_sha256 ?? "")
    .trim()
    .toLowerCase();
  if (stored) return stored;
  const b64 = row.pdfBase64 ?? row.base64 ?? null;
  if (!b64) return "";
  try {
    return contentSha256Hex(Buffer.from(String(b64), "base64")) || "";
  } catch {
    return "";
  }
}

/**
 * Merge explicit active-attach row + vault recall rows.
 * Dedupes by document_id then content_sha256 (stored or from bytes). Caps at maxUnique (default 6).
 * Prefer explicitDocumentId as the first row when present (factory primary id).
 * Never invent rows — caller must only pass ownership-verified attachments.
 * Never dedupe by filename+size alone.
 */
export function mergeOwnedDocumentAttachRows({
  vaultAttachments = [],
  explicitAttachment = null,
  explicitDocumentId = null,
  maxUnique = CLAUDE_FIRST_VAULT_MAX_UNIQUE_ATTACH,
} = {}) {
  const cap = Math.min(Math.max(Number(maxUnique) || 6, 1), 8);
  const preferId = String(explicitDocumentId ?? explicitAttachment?.document_id ?? "").trim();
  const incoming = [];
  if (explicitAttachment?.pdfBase64 || explicitAttachment?.base64) {
    incoming.push(explicitAttachment);
  }
  for (const row of Array.isArray(vaultAttachments) ? vaultAttachments : []) {
    if (row) incoming.push(row);
  }

  const byId = new Map();
  const seenSha = new Set();
  for (const row of incoming) {
    const did = String(row?.document_id ?? "").trim();
    if (!did) continue;
    if (byId.has(did)) continue;
    const sha = resolveAttachRowContentSha(row);
    if (sha && seenSha.has(sha)) continue;
    const normalized = sha && !row.content_sha256 ? { ...row, content_sha256: sha } : row;
    byId.set(did, normalized);
    if (sha) seenSha.add(sha);
  }

  const merged = [...byId.values()];
  if (preferId && byId.has(preferId)) {
    const preferred = byId.get(preferId);
    const rest = merged.filter((r) => String(r.document_id) !== preferId);
    return [preferred, ...rest].slice(0, cap);
  }
  return merged.slice(0, cap);
}

function normalizeFilenameKey(name = "") {
  return String(name ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

/**
 * Resolve a customer_documents row only when the user explicitly points at the box
 * or names a file (history "(첨부: …)" / filename). Never invent "latest" otherwise.
 */
export async function resolveExplicitCustomerDocumentMention({
  supabase = null,
  customerId = null,
  question = "",
  history = [],
  mentionedFilenames = [],
  allowRecentUploadPhrase = true,
} = {}) {
  const cid = String(customerId ?? "").trim();
  if (!supabase || !cid) {
    return { ok: false, documentId: null, reason: "missing_auth" };
  }

  const q = String(question ?? "");
  const names = (Array.isArray(mentionedFilenames) ? mentionedFilenames : [])
    .map((n) => String(n ?? "").trim())
    .filter(Boolean);
  const boxMention =
    /내\s*문서|문서함|올려\s*둔\s*(?:파일|사진|이미지|문서)|등록된\s*(?:파일|문서)|문서함에\s*있|파일\s*있잖아|그\s*파일|이\s*파일|방금\s*올린/.test(
      q,
    );
  const recentUploadPhrase = allowRecentUploadPhrase && /방금\s*올린/.test(q);
  if (!boxMention && names.length === 0) {
    return { ok: false, documentId: null, reason: "no_explicit_mention" };
  }

  const { data: rows, error } = await supabase
    .from("customer_documents")
    .select("id, original_filename, created_at, deleted_at")
    .eq("customer_id", cid)
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(80);

  if (error) {
    return { ok: false, documentId: null, reason: "document_list_failed", listing: [] };
  }
  const docs = Array.isArray(rows) ? rows : [];
  const listing = docs.map((doc) => ({
    document_id: doc?.id != null ? String(doc.id) : null,
    original_filename: doc?.original_filename ?? null,
  }));
  if (docs.length === 0) {
    return { ok: false, documentId: null, reason: "document_box_empty", listing };
  }

  if (names.length > 0) {
    for (const name of names) {
      const key = normalizeFilenameKey(name);
      const hit = docs.find((doc) => {
        const fn = normalizeFilenameKey(doc?.original_filename);
        return fn === key || fn.endsWith(key) || key.endsWith(fn);
      });
      if (hit?.id) {
        return {
          ok: true,
          documentId: String(hit.id),
          reason: "filename_match",
          original_filename: hit.original_filename ?? null,
          listing,
        };
      }
    }
    return { ok: false, documentId: null, reason: "filename_not_found", listing };
  }

  // "방금 올린 파일" — explicit recent-upload phrase only (not silent latest fallback).
  if (recentUploadPhrase && docs[0]?.id) {
    return {
      ok: true,
      documentId: String(docs[0].id),
      reason: "recent_upload_phrase",
      original_filename: docs[0].original_filename ?? null,
      listing,
    };
  }

  // Box mention without a name: only safe when exactly one document exists.
  if (boxMention && docs.length === 1 && docs[0]?.id) {
    return {
      ok: true,
      documentId: String(docs[0].id),
      reason: "single_document_box",
      original_filename: docs[0].original_filename ?? null,
      listing,
    };
  }

  return { ok: false, documentId: null, reason: "ambiguous_document_box", listing };
}

/**
 * Build user message content: optional PDF document or image block + JSON payload text.
 * Bytes live only in the in-flight provider request.
 */
export function buildClaudeFullUserContentWithPdf({
  userPayload,
  pdfBase64 = null,
  mediaType = CLAUDE_FULL_PDF_MEDIA_TYPE,
} = {}) {
  const text = JSON.stringify(userPayload ?? {}, null, 2);
  const attachBlock = pdfBase64
    ? buildAnthropicDirectAttachBlock({ base64: pdfBase64, mediaType })
    : null;
  if (!attachBlock) {
    return text;
  }
  return [attachBlock, { type: "text", text }];
}
