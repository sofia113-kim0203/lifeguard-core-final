/**
 * Conversation active attachment (Slice A) — not composer UI state.
 * Links explicit photo follow-ups to the same-chat document_id + rotation.
 */

export const PRIOR_ATTACH_REATTACH_CUSTOMER_TEXT =
  "이전에 첨부한 사진을 현재 대화에서 다시 확인할 수 없습니다. 사진을 다시 첨부해 주세요.";

/** Strong / explicit photo references — always eligible when active exists. */
export function isExplicitPriorAttachFollowUpQuestion(question = "") {
  const q = String(question ?? "");
  return /이\s*사진|그\s*사진|방금\s*사진|첨부\s*사진|첨부한\s*사진|이\s*이미지|방금\s*첨부|잘못\s*읽었|잘못\s*읽은|사진만\s*분석|사진\s*다시/.test(
    q,
  );
}

/**
 * Ambiguous recheck alone ("다시 확인해줘") — needs recent photo readout context.
 * Not matched when the same utterance already has an explicit photo ref.
 */
export function isAmbiguousAttachRecheckQuestion(question = "") {
  const q = String(question ?? "");
  if (isExplicitPriorAttachFollowUpQuestion(q)) return false;
  return /다시\s*읽어|다시\s*확인/.test(q);
}

/**
 * Recent turns show an attach / photo readout (not general chit-chat).
 */
export function hasRecentAttachReadoutContext({ history = [] } = {}) {
  const rows = Array.isArray(history) ? history : [];
  const window = rows.slice(-6);
  for (let i = window.length - 1; i >= 0; i -= 1) {
    const row = window[i];
    const c = String(row?.content ?? "");
    if (/\(첨부:/.test(c)) return true;
    if (isExplicitPriorAttachFollowUpQuestion(c)) return true;
    if (row?.metadata?.active_attachment_id) return true;
    // Assistant attach-readout fingerprints (no raw image bytes).
    if (
      /첨부\s*(?:문서|이미지|사진)|사진에서|첨부\s*파일/.test(c) &&
      /미확인|보험사|상품명|납입|월\s*보험료|표/.test(c)
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Explicit prior-attachment references, or ambiguous recheck only with recent photo context.
 * Not general insurance intent.
 */
export function isPriorAttachFollowUpQuestion(question = "", options = {}) {
  const q = String(question ?? "");
  if (isExplicitPriorAttachFollowUpQuestion(q)) return true;
  if (isAmbiguousAttachRecheckQuestion(q)) {
    return hasRecentAttachReadoutContext(options) === true;
  }
  return false;
}

export function normalizeActiveAttachment(input = null) {
  if (!input || typeof input !== "object") return null;
  const id = String(input.active_attachment_id ?? input.document_id ?? input.id ?? "").trim();
  if (!id) return null;
  const mime = String(input.active_attachment_mime ?? input.mime_type ?? input.mime ?? "").trim() || null;
  const turnsRaw = input.active_rotation_quarter_turns ?? input.rotation_quarter_turns ?? 0;
  let turns = 0;
  if (typeof turnsRaw === "string" && /^[0-3]$/.test(turnsRaw.trim())) {
    turns = Number(turnsRaw.trim());
  } else if (typeof turnsRaw === "number" && Number.isInteger(turnsRaw) && turnsRaw >= 0 && turnsRaw <= 3) {
    turns = turnsRaw;
  }
  return {
    active_attachment_id: id,
    active_attachment_mime: mime,
    active_rotation_quarter_turns: turns,
  };
}

/**
 * Home brain result signals that original attach failed this turn.
 * Clear conversation activeAttachment so the failed document_id is not resent.
 * Does not erase already-shown "(첨부: …)" message text.
 */
export function shouldClearActiveAttachmentAfterTurn(result = null) {
  if (!result || typeof result !== "object") return false;
  const reason = String(result.failureReason ?? result.failure_reason ?? "").trim();
  if (
    reason === "prior_attach_missing" ||
    reason === "attach_process_failed" ||
    reason === "production_document_access_forbidden"
  ) {
    return true;
  }
  if (
    reason &&
    /^(document_ownership_denied|mime_not_supported|document_too_large|storage_|pdf_|image_|block_build|attach_)/i.test(
      reason,
    )
  ) {
    return true;
  }
  const signals =
    result.salesDirectorTrace?.key_compose_trace?.key_voice_trace?.attach_signals ??
    result.sales_director_trace?.key_compose_trace?.key_voice_trace?.attach_signals ??
    null;
  if (signals?.attachment_failed === true) return true;
  if (String(signals?.attachment_failure_code ?? "").trim()) return true;
  const text = String(result.answerText ?? result.customerText ?? "").trim();
  if (text.includes("첨부 파일을 처리하지 못했습니다")) return true;
  if (text.includes(PRIOR_ATTACH_REATTACH_CUSTOMER_TEXT)) return true;
  return false;
}

/** Walk message metadata (newest first) for persisted active attachment. */
export function extractActiveAttachmentFromSessionMessages(messages = []) {
  const rows = Array.isArray(messages) ? messages : [];
  for (let i = rows.length - 1; i >= 0; i -= 1) {
    const meta = rows[i]?.metadata ?? rows[i]?.metadata_json ?? null;
    const normalized = normalizeActiveAttachment(meta);
    if (normalized) return normalized;
    const nested = normalizeActiveAttachment(meta?.active_attachment);
    if (nested) return nested;
  }
  return null;
}
