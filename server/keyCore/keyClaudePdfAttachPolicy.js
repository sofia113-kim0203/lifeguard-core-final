/**
 * Triangle v2.2 T1 — PDF attach mode for Claude-first.
 * Goal: stop repeating full PDF base64 every turn. Original stays in KEY storage.
 * Extracts are never auto-promoted to verified insurance facts.
 */

export function isFullPrecisionDocumentReviewQuestion(question = "") {
  const q = String(question ?? "").trim();
  if (!q) return false;
  return /전체\s*(을\s*|를\s*)?(분석|검토|설명|읽어)|처음부터|모든\s*페이지|원문\s*전체|꼼꼼히|전부\s*(다\s*)?(봐|보|설명|분석|검토)|파일\s*전체|문서\s*전체/.test(
    q,
  );
}

/**
 * @returns {{
 *   mode: "none"|"full_original_once"|"partial_evidence"|"reuse_no_repeat",
 *   attach_full_base64: boolean,
 *   review_scope: string|null,
 *   evidence_status: string|null,
 *   reason: string,
 * }}
 */
export function decidePdfAttachMode({
  documentId = null,
  priorAttachFollowUp = false,
  question = "",
  chunkCount = 0,
  mediaType = null,
} = {}) {
  const docId = String(documentId ?? "").trim();
  if (!docId) {
    return {
      mode: "none",
      attach_full_base64: false,
      review_scope: null,
      evidence_status: null,
      reason: "no_document_id",
    };
  }

  const mime = String(mediaType ?? "").trim().toLowerCase();
  const isImage = mime.startsWith("image/");

  // Subsequent turns with active prior attach: never re-ship full original bytes.
  if (priorAttachFollowUp === true) {
    return {
      mode: "reuse_no_repeat",
      attach_full_base64: false,
      review_scope:
        "reuse_prior_document_context_no_full_original_rebroadcast; scope_not_full_reread_unless_excerpts_provided",
      evidence_status: chunkCount > 0 ? "document_extracted_unverified" : "unknown",
      reason: "prior_attach_follow_up_skip_full_base64",
    };
  }

  // Existing processed document (chunks present): default to excerpts, not full base64,
  // unless customer explicitly asks for full-precision original review.
  if (!isImage && chunkCount > 0 && !isFullPrecisionDocumentReviewQuestion(question)) {
    return {
      mode: "partial_evidence",
      attach_full_base64: false,
      review_scope:
        "prepared_document_excerpts_only_not_full_original; do_not_claim_full_document_review",
      evidence_status: "document_extracted_unverified",
      reason: "processed_document_use_excerpts",
    };
  }

  // Fresh attach / full-precision request / no excerpts yet: allow original once.
  return {
    mode: "full_original_once",
    attach_full_base64: true,
    review_scope: isFullPrecisionDocumentReviewQuestion(question)
      ? "full_original_precision_review_this_turn"
      : "full_original_this_turn_no_prepared_excerpts",
    evidence_status: "document_source_confirmed",
    reason: isFullPrecisionDocumentReviewQuestion(question)
      ? "full_precision_requested"
      : "fresh_attach_or_no_excerpts",
  };
}

/**
 * Load prepared chunks for a document (no embedding RPC).
 * Content is document_extracted_unverified — never treat as insurer_api_verified.
 */
export async function loadCustomerDocumentChunksByDocumentId({
  supabase = null,
  customerId = null,
  documentId = null,
  limit = 40,
} = {}) {
  const cid = String(customerId ?? "").trim();
  const did = String(documentId ?? "").trim();
  if (!supabase || !cid || !did) return [];
  try {
    const { data, error } = await supabase
      .from("customer_document_chunks")
      .select("id, document_id, chunk_index, content, metadata")
      .eq("customer_id", cid)
      .eq("document_id", did)
      .is("deleted_at", null)
      .order("chunk_index", { ascending: true })
      .limit(Math.max(1, Math.min(80, Number(limit) || 40)));
    if (error) return [];
    return (Array.isArray(data) ? data : [])
      .map((row, index) => {
        const content = String(row?.content ?? "").trim();
        if (!content) return null;
        const meta = row?.metadata && typeof row.metadata === "object" ? row.metadata : {};
        return {
          id: row?.id != null ? String(row.id) : null,
          document_id: row?.document_id != null ? String(row.document_id) : did,
          chunk_index:
            typeof row?.chunk_index === "number" ? row.chunk_index : index,
          page: meta.page ?? meta.page_number ?? null,
          section: meta.section ?? null,
          content,
          source: "customer_document_chunks",
          evidence_status: "document_extracted_unverified",
        };
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}
