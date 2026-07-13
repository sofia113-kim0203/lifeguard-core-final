/**
 * Claude-Full / Claude-first document-direct — ownership + original PDF/image attach
 * (no KEY pre-summary / no OCR substitute).
 * Bytes/base64/signed URLs must never enter DB trace/metadata/logs.
 */

export const CUSTOMER_DOCUMENTS_BUCKET = "customer-documents";
export const CLAUDE_FULL_PDF_MAX_BYTES = 20 * 1024 * 1024; // align with upload cap
/** Full Anthropic Messages request body safety cap (PDF + context + tools/schema). */
export const CLAUDE_FULL_REQUEST_MAX_BYTES = 30 * 1024 * 1024;
export const CLAUDE_FULL_PDF_MEDIA_TYPE = "application/pdf";
export const CLAUDE_FULL_JPEG_MEDIA_TYPE = "image/jpeg";
export const CLAUDE_FULL_PNG_MEDIA_TYPE = "image/png";

/** Honest customer text when PDF+context exceeds request cap — never S3/S4/S5. */
export const DOCUMENT_DIRECT_REQUEST_TOO_LARGE_CUSTOMER_TEXT =
  "올려주신 문서가 커서 지금은 원본을 직접 읽어 드리기 어려워요. 잠시 후 다시 올려 주시거나, 꼭 필요한 페이지만 따로 보내 주시면 KEY가 이어서 볼게요.";

function isProductionEnv(env = process.env) {
  return String(env?.VERCEL_ENV ?? "").trim().toLowerCase() === "production";
}

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

  if (isProductionEnv(env)) {
    return {
      ok: false,
      reason: "production_document_access_forbidden",
      fallbackRecommended: false,
      metrics: buildDocumentDirectTraceMeta({
        documentId: did || null,
        fallbackUsed: true,
        fallbackReason: "production_document_access_forbidden",
      }),
    };
  }

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
    const pdfBase64 = buf.toString("base64");
    const attachMs = Math.max(0, Date.now() - attachStarted);
    return {
      ok: true,
      pdfBase64,
      mediaType: mime,
      fileSizeBytes: buf.length,
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
  const pdfBase64 = buf.toString("base64");
  const attachMs = Math.max(0, Date.now() - attachStarted);

  return {
    ok: true,
    pdfBase64,
    mediaType: mime,
    fileSizeBytes: buf.length,
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
