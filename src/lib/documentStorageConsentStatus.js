/**
 * Document storage consent client status — not SSOT.
 * DB customer_consents remains SSOT; this only avoids treating "not yet fetched" as denied.
 */

export const DOCUMENT_STORAGE_CONSENT_STATUS = Object.freeze({
  UNKNOWN: "unknown",
  GRANTED: "granted",
  NOT_GRANTED: "not_granted",
});

export const DOCUMENT_STORAGE_CONSENT_REQUIRED_CHAT_TEXT =
  "문서 보관 동의가 필요합니다. 「내 문서」에서 동의를 완료해 주세요.";

export const DOCUMENT_STORAGE_CONSENT_LOOKUP_ERROR_TEXT =
  "동의 상태를 확인하지 못했습니다. 다시 시도해 주세요.";

/** Map listDocuments flag → granted | not_granted (never unknown). */
export function documentStorageConsentFromListFlag(hasDocumentStorageConsent) {
  return hasDocumentStorageConsent === true
    ? DOCUMENT_STORAGE_CONSENT_STATUS.GRANTED
    : DOCUMENT_STORAGE_CONSENT_STATUS.NOT_GRANTED;
}

export function isDocumentStorageConsentGranted(status) {
  return status === DOCUMENT_STORAGE_CONSENT_STATUS.GRANTED;
}

export function isDocumentStorageConsentUnknown(status) {
  return (
    status == null ||
    status === DOCUMENT_STORAGE_CONSENT_STATUS.UNKNOWN ||
    status === ""
  );
}

/**
 * Pure chat-attach gate after optional hydrate.
 * Query failure must not look like not_granted.
 */
export function resolveChatAttachConsentDecision({
  status = DOCUMENT_STORAGE_CONSENT_STATUS.UNKNOWN,
  hydrate = null,
} = {}) {
  const current = String(status ?? DOCUMENT_STORAGE_CONSENT_STATUS.UNKNOWN);
  if (current === DOCUMENT_STORAGE_CONSENT_STATUS.GRANTED) {
    return { allowUpload: true, status: current, message: null, reason: "granted" };
  }
  if (current === DOCUMENT_STORAGE_CONSENT_STATUS.NOT_GRANTED) {
    return {
      allowUpload: false,
      status: current,
      message: DOCUMENT_STORAGE_CONSENT_REQUIRED_CHAT_TEXT,
      reason: "not_granted",
    };
  }

  // unknown — use hydrate result when provided
  if (hydrate && hydrate.attempted === true) {
    if (hydrate.ok === false) {
      return {
        allowUpload: false,
        status: DOCUMENT_STORAGE_CONSENT_STATUS.UNKNOWN,
        message: DOCUMENT_STORAGE_CONSENT_LOOKUP_ERROR_TEXT,
        reason: "lookup_failed",
      };
    }
    const next = String(hydrate.status ?? DOCUMENT_STORAGE_CONSENT_STATUS.UNKNOWN);
    if (next === DOCUMENT_STORAGE_CONSENT_STATUS.GRANTED) {
      return { allowUpload: true, status: next, message: null, reason: "hydrated_granted" };
    }
    if (next === DOCUMENT_STORAGE_CONSENT_STATUS.NOT_GRANTED) {
      return {
        allowUpload: false,
        status: next,
        message: DOCUMENT_STORAGE_CONSENT_REQUIRED_CHAT_TEXT,
        reason: "hydrated_not_granted",
      };
    }
    return {
      allowUpload: false,
      status: DOCUMENT_STORAGE_CONSENT_STATUS.UNKNOWN,
      message: DOCUMENT_STORAGE_CONSENT_LOOKUP_ERROR_TEXT,
      reason: "hydrate_incomplete",
    };
  }

  return {
    allowUpload: false,
    status: DOCUMENT_STORAGE_CONSENT_STATUS.UNKNOWN,
    message: null,
    reason: "needs_hydrate",
  };
}
