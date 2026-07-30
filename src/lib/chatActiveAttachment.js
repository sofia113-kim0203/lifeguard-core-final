/**
 * Conversation active attachment (Slice A) — not composer UI state.
 * Links explicit photo follow-ups to the same-chat document_id + rotation.
 */

export const PRIOR_ATTACH_REATTACH_CUSTOMER_TEXT =
  "이전에 첨부한 사진을 현재 대화에서 다시 확인할 수 없습니다. 사진을 다시 첨부해 주세요.";

/** Strong / explicit photo references — always eligible when active exists. */
export function isExplicitPriorAttachFollowUpQuestion(question = "") {
  const q = String(question ?? "");
  return /이\s*사진|그\s*사진|방금\s*사진|첨부\s*사진|첨부한\s*사진|이\s*이미지|방금\s*첨부|잘못\s*읽었|잘못\s*읽은|사진만\s*분석|사진\s*다시|이\s*파일|그\s*파일|올려\s*준\s*(?:사진|이미지|파일|문서)|내\s*문서|문서함|방금\s*올린|올려\s*둔\s*(?:파일|사진|이미지|문서)/.test(
    q,
  );
}

/** Short analyze asks that keep the current-chat attachment (not general insurance chat). */
export function isAttachAnalyzeFollowUpQuestion(question = "") {
  const q = String(question ?? "")
    .replace(/\s+/g, " ")
    .trim();
  return /^(?:이\s*)?(?:사진|이미지|파일|문서)?\s*(?:분석|확인)해\s*(?:줘|봐)(?:요)?[.!]?$|^(?:분석|확인)해\s*(?:줘|봐)(?:요)?[.!]?$|^(?:분석|확인)\s*부탁(?:해)?(?:요)?[.!]?$/.test(
    q,
  );
}

/** Explicit pointer into the customer's document box (not silent latest-doc invent). */
export function isExplicitDocumentBoxMentionQuestion(question = "") {
  const q = String(question ?? "");
  return /내\s*문서|문서함|올려\s*둔\s*(?:파일|사진|이미지|문서)|등록된\s*(?:파일|문서)|방금\s*올린|문서함에\s*있|파일\s*있잖아/.test(
    q,
  );
}

/**
 * Explicit whole-insurance / vault-original recall intent.
 * Not a new rule engine — narrow customer ask that owned insurance originals should be selected.
 * Does NOT itself invent a document_id (server ownership list + allowLatestFallback=false).
 */
export function isInsuranceDocumentRecallQuestion(question = "") {
  const q = String(question ?? "")
    .replace(/\s+/g, " ")
    .trim();
  if (!q) return false;
  // Already an explicit box/filename pointer — existing mention path owns that turn.
  if (isExplicitDocumentBoxMentionQuestion(q)) return false;
  return (
    // Allow fillers between 보험 and 분석: 전체/전부/조사 등 ("내 보험 전체를 분석…")
    /내\s*보험\s*(?:전체|전부|조사|현황)?\s*(을\s*|를\s*)?(분석|점검|확인|봐|보여)/.test(q) ||
    /가입한\s*보험\s*(?:전체|전부)?\s*(을\s*|를\s*)?(분석|점검|확인)/.test(q) ||
    /가입한\s*보험\s*(이\s*)?(뭐야|무엇|뭔지)/.test(q) ||
    /내가\s*가입한\s*보험/.test(q) ||
    /내\s*보장\s*(을\s*)?(분석|점검|확인)/.test(q) ||
    /내\s*보험에서/.test(q) ||
    /보관한\s*보험\s*(자료|문서|파일|원본)/.test(q) ||
    /보험\s*(자료|문서|원본)\s*(으로|로)\s*(분석|점검|확인)/.test(q) ||
    /내\s*암\s*·?\s*뇌혈관|암\s*·\s*뇌혈관\s*·\s*허혈/.test(q) ||
    /진단비\s*(를\s*)?(알려|확인|분석|점검)/.test(q)
  );
}

/** Contract-count / list questions — ledger is sole confirmed count authority. */
export function isPolicyCountOrLedgerQuestion(question = "") {
  const q = String(question ?? "")
    .replace(/\s+/g, " ")
    .trim();
  if (!q) return false;
  return (
    /가입\s*건수/.test(q) ||
    /계약\s*(이\s*)?몇\s*건/.test(q) ||
    /보험\s*(이\s*)?몇\s*건/.test(q) ||
    /몇\s*건(?:이야|인가요|이지|임|인지)/.test(q) ||
    /계약\s*수/.test(q) ||
    /보험\s*건수/.test(q) ||
    /보험\s*목록/.test(q) ||
    /계약\s*목록/.test(q) ||
    /내\s*보험\s*(이\s*)?몇/.test(q) ||
    /가입한\s*보험\s*(이\s*)?몇/.test(q)
  );
}

/** Document-box recheck that should reload the whole owned insurance vault. */
export function isInsuranceVaultDocumentBoxRecheckQuestion(question = "") {
  const q = String(question ?? "")
    .replace(/\s+/g, " ")
    .trim();
  if (!q) return false;
  if (!isExplicitDocumentBoxMentionQuestion(q) && !/문서함|올려\s*둔\s*문서|보관함/.test(q)) {
    return false;
  }
  return (
    /다시\s*(봐|확인|읽어|점검|분석)/.test(q) ||
    /문서함.*(봐|보|확인|읽어|분석)/.test(q) ||
    /지금\s*다시/.test(q) ||
    /원본.*(봐|확인)/.test(q) ||
    /문서.*(전부|전체|다)\s*(을\s*|를\s*)?(봐|보|확인|분석)/.test(q) ||
    /자료\s*(전부|전체|다)\s*(을\s*|를\s*)?(봐|보|확인|분석)/.test(q)
  );
}

/**
 * Multi-original vault recall: remaining / all docs in the box — not a single active attach.
 * Does not invent document_ids; server ownership list + sha dedupe decide attach set.
 */
export function isMultiDocumentVaultRecallQuestion(question = "") {
  const q = String(question ?? "")
    .replace(/\s+/g, " ")
    .trim();
  if (!q) return false;
  if (
    /나머지\s*(문서|파일|자료|것들)/.test(q) &&
    /(분석|확인|봐|보|읽어|검토)/.test(q)
  ) {
    return true;
  }
  if (
    /문서함/.test(q) &&
    /(전체|전부|나머지|모두|다)\s*.*(분석|확인|봐|보|읽어|검토)/.test(q)
  ) {
    return true;
  }
  if (/문서함.*자료\s*(전체|전부)/.test(q) && /(봐|보|분석|확인|읽어)/.test(q)) {
    return true;
  }
  if (
    /(자료|문서|파일)\s*(전체|전부)\s*(을\s*|를\s*)?(봐|보|분석|확인|읽어)/.test(q)
  ) {
    return true;
  }
  if (
    /함께\s*(분석|확인|봐|보)/.test(q) &&
    /(문서|파일|자료|문서함|나머지)/.test(q)
  ) {
    return true;
  }
  return false;
}

/**
 * Explicit owned-vault asks (box / count / multi / insurance recall phrasing).
 * NOT the sole access permission — active insurance document case does not need these words.
 */
export function wantsOwnedInsuranceVaultEvidence(question = "") {
  const q = String(question ?? "")
    .replace(/\s+/g, " ")
    .trim();
  if (!q) return false;
  if (isPolicyCountOrLedgerQuestion(q)) return true;
  if (isInsuranceDocumentRecallQuestion(q)) return true;
  if (isInsuranceVaultDocumentBoxRecheckQuestion(q)) return true;
  if (isMultiDocumentVaultRecallQuestion(q)) return true;
  if (isOriginalDocumentRereadQuestion(q) && /보험|계약|갱신|담보|보험료|증권/.test(q)) {
    return true;
  }
  return false;
}

/**
 * Document access permission for owned insurance originals.
 * Active insurance document case → provide related originals without keyword gating.
 * Without active case → only explicit owned-vault asks (box/count/multi/…).
 * Presence never attaches vault originals.
 */
export function shouldProvideOwnedInsuranceVaultOriginals({
  question = "",
  isPresenceTurn = false,
  attachedDocumentId = null,
} = {}) {
  if (isPresenceTurn === true) return false;
  if (String(attachedDocumentId ?? "").trim()) return true;
  return wantsOwnedInsuranceVaultEvidence(question) === true;
}

/**
 * Vault recall gate — presence off; evidence flag already resolved by caller.
 * Active singular document_id must not block vault once evidence is true.
 */
export function shouldRunOwnedVaultRecall({
  wantsVaultEvidence = false,
  isPresenceTurn = false,
} = {}) {
  return isPresenceTurn !== true && wantsVaultEvidence === true;
}

/**
 * Follow-up that needs Storage original bytes again (not chart-memory summary).
 * Used with prior_attach_follow_up — does not delete reuse policy for soft summary turns.
 */
export function isOriginalDocumentRereadQuestion(question = "") {
  const q = String(question ?? "")
    .replace(/\s+/g, " ")
    .trim();
  if (!q) return false;
  // Soft summary / memory asks — keep reuse_no_repeat.
  if (
    /짧게\s*정리|결론이\s*뭐|얼마였지|지난\s*분석|방금\s*말한\s*내용|기억나|다시\s*말해/.test(q) &&
    !/원문|서류|파일|사진|첨부|문서/.test(q)
  ) {
    return false;
  }
  return (
    /원문\s*(을\s*)?(다시\s*)?(봐|확인|읽어|검토)/.test(q) ||
    /다시\s*정확히\s*(분석|확인|봐|읽어)/.test(q) ||
    /서류에서\s*(확인|찾아|봐)/.test(q) ||
    /파일에서\s*(확인|찾아|봐)/.test(q) ||
    /첨부\s*(파일|사진|문서|원본)\s*(을\s*)?(다시\s*)?(봐|확인|읽어)/.test(q) ||
    /갱신형인지\s*(원문|서류|파일)?/.test(q) ||
    /이\s*담보\s*금액\s*(을\s*)?다시/.test(q) ||
    /아까\s*분석한\s*숫자/.test(q) ||
    /다른\s*보장도\s*(서류|원문|파일)/.test(q) ||
    /원문을\s*다시\s*확인/.test(q)
  );
}

/** Filenames referenced in chat bubbles / question text — used to resolve a named document only. */
export function extractMentionedFilenamesFromChat(question = "", history = []) {
  const names = [];
  const push = (raw) => {
    const name = String(raw ?? "").trim();
    if (!name || name === "파일") return;
    if (!names.includes(name)) names.push(name);
  };
  const scan = (text) => {
    const s = String(text ?? "");
    for (const match of s.matchAll(/\(첨부:\s*([^)]+)\)/g)) {
      push(match[1]);
    }
    for (const match of s.matchAll(
      /["'“”]?([\w가-힣A-Za-z0-9][\w가-힣A-Za-z0-9.\s_-]{0,120}\.(?:jpg|jpeg|png|pdf|webp|heic))["'“”]?/gi,
    )) {
      push(match[1]);
    }
  };
  scan(question);
  for (const row of Array.isArray(history) ? history : []) {
    // Dual-read: Claude-first history may use `.text` (oneKeyCoreTurn remap).
    scan(row?.content ?? row?.text ?? row?.message);
  }
  return names;
}

/** Prefer content, then text/message — same shape as context pack / Claude-first history. */
export function readChatTurnText(row = null) {
  return String(row?.content ?? row?.text ?? row?.message ?? "");
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
    const c = readChatTurnText(row);
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
  if (isAttachAnalyzeFollowUpQuestion(q)) {
    if (options.priorAttachFollowUp === true || options.prior_attach_follow_up === true) {
      return true;
    }
    return (
      hasRecentAttachReadoutContext(options) === true ||
      (Array.isArray(options.history) &&
        options.history.some((row) => /\(첨부:/.test(readChatTurnText(row))))
    );
  }
  if (isAmbiguousAttachRecheckQuestion(q)) {
    return hasRecentAttachReadoutContext(options) === true;
  }
  return false;
}

/** Clear conversation active attach when that document was deleted from current insurance. */
export function clearActiveAttachmentIfDocumentDeleted(activeAttachment = null, deletedDocumentId = null) {
  const deleted = String(deletedDocumentId ?? "").trim();
  if (!deleted) return normalizeActiveAttachment(activeAttachment);
  const normalized = normalizeActiveAttachment(activeAttachment);
  if (!normalized) return null;
  if (normalized.active_attachment_id === deleted) return null;
  return normalized;
}

/**
 * Strip deleted document_id from in-memory message metadata so refresh cannot
 * reinject it via extractActiveAttachmentFromSessionMessages.
 * Does not rewrite bubble text (e.g. "(첨부: …)" history lines stay).
 */
export function scrubDeletedDocumentFromMessageActiveAttachments(
  messages = [],
  deletedDocumentId = null,
) {
  const deleted = String(deletedDocumentId ?? "").trim();
  const rows = Array.isArray(messages) ? messages : [];
  if (!deleted) return rows;
  return rows.map((row) => {
    if (!row || typeof row !== "object") return row;
    const meta = row.metadata && typeof row.metadata === "object" ? row.metadata : null;
    if (!meta) return row;
    const id = String(meta.active_attachment_id ?? "").trim();
    const nestedId = String(meta.active_attachment?.active_attachment_id ?? "").trim();
    if (id !== deleted && nestedId !== deleted) return row;
    const nextMeta = { ...meta };
    if (id === deleted) {
      delete nextMeta.active_attachment_id;
      delete nextMeta.active_attachment_mime;
      delete nextMeta.active_rotation_quarter_turns;
    }
    if (nestedId === deleted) {
      delete nextMeta.active_attachment;
    }
    const next = { ...row, metadata: nextMeta };
    if (Object.keys(nextMeta).length === 0) {
      delete next.metadata;
    }
    return next;
  });
}

/**
 * Reuse conversation active attach when the id is still valid.
 * Empty / unloaded document list must NOT discard a live active id — server ownership
 * check is authoritative. Only reject when the loaded list proves missing/deleted.
 */
export function isReusableActiveAttachmentId(activeId = null, documents = []) {
  const id = String(activeId ?? "").trim();
  if (!id) return false;
  const rows = Array.isArray(documents) ? documents : [];
  // Chat mount often has documents=[] until 내 문서 panel loads — keep active id.
  if (rows.length === 0) return true;
  const row = rows.find((doc) => String(doc?.id ?? doc?.document_id ?? "").trim() === id);
  if (!row) return false;
  const deletedAt = row.deleted_at ?? row.deletedAt ?? null;
  if (deletedAt) return false;
  return true;
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
