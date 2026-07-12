/**
 * Claude-Full document-direct — ownership check + original PDF attach (no KEY pre-summary).
 * Bytes/base64/signed URLs must never enter DB trace/metadata/logs.
 */

export const CUSTOMER_DOCUMENTS_BUCKET = "customer-documents";
export const CLAUDE_FULL_PDF_MAX_BYTES = 20 * 1024 * 1024; // align with upload cap
/** Full Anthropic Messages request body safety cap (PDF + context + tools/schema). */
export const CLAUDE_FULL_REQUEST_MAX_BYTES = 30 * 1024 * 1024;
export const CLAUDE_FULL_PDF_MEDIA_TYPE = "application/pdf";

/** Honest customer text when PDF+context exceeds request cap — never S3/S4/S5. */
export const DOCUMENT_DIRECT_REQUEST_TOO_LARGE_CUSTOMER_TEXT =
  "올려주신 문서가 커서 지금은 원본을 직접 읽어 드리기 어려워요. 잠시 후 다시 올려 주시거나, 꼭 필요한 페이지만 따로 보내 주시면 KEY가 이어서 볼게요.";

function isProductionEnv(env = process.env) {
  return String(env?.VERCEL_ENV ?? "").trim().toLowerCase() === "production";
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
 * Verify customer ownership and load original PDF bytes from existing storage.
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
  // Test injection — never used for production traces
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
    const mime = String(doc.mime_type ?? CLAUDE_FULL_PDF_MEDIA_TYPE).trim();
    if (mime !== CLAUDE_FULL_PDF_MEDIA_TYPE) {
      return {
        ok: false,
        reason: "mime_not_pdf_direct",
        fallbackRecommended: true,
        metrics: buildDocumentDirectTraceMeta({
          documentId: did,
          mimeType: mime,
          ownershipVerified: true,
          fallbackUsed: true,
          fallbackReason: "mime_not_pdf_direct",
          documentFetchMs: Math.max(0, Date.now() - fetchStarted),
        }),
      };
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
      mediaType: CLAUDE_FULL_PDF_MEDIA_TYPE,
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

  const mime = String(document.mime_type ?? "").trim() || CLAUDE_FULL_PDF_MEDIA_TYPE;
  if (mime !== CLAUDE_FULL_PDF_MEDIA_TYPE) {
    return {
      ok: false,
      reason: "mime_not_pdf_direct",
      fallbackRecommended: true,
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
        ownershipVerified: true,
        fallbackUsed: true,
        fallbackReason: "mime_not_pdf_direct",
        documentFetchMs: Math.max(0, Date.now() - fetchStarted),
      }),
    };
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
    mediaType: CLAUDE_FULL_PDF_MEDIA_TYPE,
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
 * Build user message content for Claude-Full: optional PDF document block + JSON payload text.
 * PDF bytes live only in the in-flight provider request.
 */
export function buildClaudeFullUserContentWithPdf({
  userPayload,
  pdfBase64 = null,
  mediaType = CLAUDE_FULL_PDF_MEDIA_TYPE,
} = {}) {
  const text = JSON.stringify(userPayload ?? {}, null, 2);
  const docBlock = pdfBase64
    ? buildAnthropicPdfDocumentBlock({ base64: pdfBase64, mediaType })
    : null;
  if (!docBlock) {
    return text;
  }
  return [docBlock, { type: "text", text }];
}
