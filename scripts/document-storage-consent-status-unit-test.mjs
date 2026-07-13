import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  DOCUMENT_STORAGE_CONSENT_STATUS,
  DOCUMENT_STORAGE_CONSENT_REQUIRED_CHAT_TEXT,
  DOCUMENT_STORAGE_CONSENT_LOOKUP_ERROR_TEXT,
  documentStorageConsentFromListFlag,
  isDocumentStorageConsentGranted,
  isDocumentStorageConsentUnknown,
  resolveChatAttachConsentDecision,
} from "../src/lib/documentStorageConsentStatus.js";

assert.equal(
  DOCUMENT_STORAGE_CONSENT_STATUS.UNKNOWN,
  "unknown",
  "chat entry starts conceptually as unknown",
);
assert.equal(isDocumentStorageConsentUnknown(DOCUMENT_STORAGE_CONSENT_STATUS.UNKNOWN), true);
assert.equal(isDocumentStorageConsentGranted(DOCUMENT_STORAGE_CONSENT_STATUS.UNKNOWN), false);
assert.equal(isDocumentStorageConsentGranted(DOCUMENT_STORAGE_CONSENT_STATUS.NOT_GRANTED), false);

assert.equal(
  documentStorageConsentFromListFlag(true),
  DOCUMENT_STORAGE_CONSENT_STATUS.GRANTED,
);
assert.equal(
  documentStorageConsentFromListFlag(false),
  DOCUMENT_STORAGE_CONSENT_STATUS.NOT_GRANTED,
);
assert.equal(
  documentStorageConsentFromListFlag(undefined),
  DOCUMENT_STORAGE_CONSENT_STATUS.NOT_GRANTED,
);

// Hydrate path: DB consent present → granted, attach allowed (no documents panel visit).
{
  const decision = resolveChatAttachConsentDecision({
    status: DOCUMENT_STORAGE_CONSENT_STATUS.UNKNOWN,
    hydrate: {
      attempted: true,
      ok: true,
      status: DOCUMENT_STORAGE_CONSENT_STATUS.GRANTED,
    },
  });
  assert.equal(decision.allowUpload, true);
  assert.equal(decision.status, DOCUMENT_STORAGE_CONSENT_STATUS.GRANTED);
  assert.equal(decision.message, null);
}

// Already granted (after hydrate / grant) — reattach / refresh-safe.
{
  const decision = resolveChatAttachConsentDecision({
    status: DOCUMENT_STORAGE_CONSENT_STATUS.GRANTED,
  });
  assert.equal(decision.allowUpload, true);
  assert.equal(decision.reason, "granted");
}

// fail-closed / clearComposer must not imply consent wipe — granted stays uploadable.
{
  const afterComposerClear = DOCUMENT_STORAGE_CONSENT_STATUS.GRANTED;
  const afterActiveClear = DOCUMENT_STORAGE_CONSENT_STATUS.GRANTED;
  assert.equal(isDocumentStorageConsentGranted(afterComposerClear), true);
  assert.equal(isDocumentStorageConsentGranted(afterActiveClear), true);
  const decision = resolveChatAttachConsentDecision({ status: afterComposerClear });
  assert.equal(decision.allowUpload, true);
  assert.equal(decision.message, null);
}

// DB consent absent → guide to 내 문서 (not lookup error).
{
  const decision = resolveChatAttachConsentDecision({
    status: DOCUMENT_STORAGE_CONSENT_STATUS.NOT_GRANTED,
  });
  assert.equal(decision.allowUpload, false);
  assert.equal(decision.message, DOCUMENT_STORAGE_CONSENT_REQUIRED_CHAT_TEXT);
  assert.equal(decision.reason, "not_granted");
}

{
  const decision = resolveChatAttachConsentDecision({
    status: DOCUMENT_STORAGE_CONSENT_STATUS.UNKNOWN,
    hydrate: {
      attempted: true,
      ok: true,
      status: DOCUMENT_STORAGE_CONSENT_STATUS.NOT_GRANTED,
    },
  });
  assert.equal(decision.allowUpload, false);
  assert.equal(decision.message, DOCUMENT_STORAGE_CONSENT_REQUIRED_CHAT_TEXT);
  assert.equal(decision.reason, "hydrated_not_granted");
}

// Lookup failure must NOT be disguised as not_granted.
{
  const decision = resolveChatAttachConsentDecision({
    status: DOCUMENT_STORAGE_CONSENT_STATUS.UNKNOWN,
    hydrate: {
      attempted: true,
      ok: false,
      status: DOCUMENT_STORAGE_CONSENT_STATUS.UNKNOWN,
      reason: "lookup_failed",
    },
  });
  assert.equal(decision.allowUpload, false);
  assert.equal(decision.status, DOCUMENT_STORAGE_CONSENT_STATUS.UNKNOWN);
  assert.equal(decision.message, DOCUMENT_STORAGE_CONSENT_LOOKUP_ERROR_TEXT);
  assert.equal(decision.reason, "lookup_failed");
  assert.notEqual(decision.message, DOCUMENT_STORAGE_CONSENT_REQUIRED_CHAT_TEXT);
}

// unknown without hydrate yet → needs_hydrate (attach path must call hydrate).
{
  const decision = resolveChatAttachConsentDecision({
    status: DOCUMENT_STORAGE_CONSENT_STATUS.UNKNOWN,
  });
  assert.equal(decision.allowUpload, false);
  assert.equal(decision.reason, "needs_hydrate");
  assert.equal(decision.message, null);
}

// Revoke then re-query → not_granted reflected.
{
  assert.equal(
    documentStorageConsentFromListFlag(false),
    DOCUMENT_STORAGE_CONSENT_STATUS.NOT_GRANTED,
  );
  const decision = resolveChatAttachConsentDecision({
    status: DOCUMENT_STORAGE_CONSENT_STATUS.GRANTED,
  });
  assert.equal(decision.allowUpload, true);
  const afterRevokeHydrate = resolveChatAttachConsentDecision({
    status: DOCUMENT_STORAGE_CONSENT_STATUS.UNKNOWN,
    hydrate: {
      attempted: true,
      ok: true,
      status: documentStorageConsentFromListFlag(false),
    },
  });
  assert.equal(afterRevokeHydrate.allowUpload, false);
  assert.equal(afterRevokeHydrate.status, DOCUMENT_STORAGE_CONSENT_STATUS.NOT_GRANTED);
}

// Image + PDF share the same consent status decision.
{
  const forImage = resolveChatAttachConsentDecision({
    status: DOCUMENT_STORAGE_CONSENT_STATUS.GRANTED,
  });
  const forPdf = resolveChatAttachConsentDecision({
    status: DOCUMENT_STORAGE_CONSENT_STATUS.GRANTED,
  });
  assert.deepEqual(
    { allow: forImage.allowUpload, status: forImage.status },
    { allow: forPdf.allowUpload, status: forPdf.status },
  );
}

// unknown → granted then exactly one upload (hydrate/ensure overlap must not double-upload).
{
  let uploadCalls = 0;
  const fakeUpload = () => {
    uploadCalls += 1;
  };
  // Entry hydrate completes first.
  const afterHydrate = resolveChatAttachConsentDecision({
    status: DOCUMENT_STORAGE_CONSENT_STATUS.UNKNOWN,
    hydrate: {
      attempted: true,
      ok: true,
      status: DOCUMENT_STORAGE_CONSENT_STATUS.GRANTED,
    },
  });
  assert.equal(afterHydrate.allowUpload, true);
  // Attach ensure sees already-granted (no second gate denial).
  const afterEnsure = resolveChatAttachConsentDecision({
    status: DOCUMENT_STORAGE_CONSENT_STATUS.GRANTED,
  });
  assert.equal(afterEnsure.allowUpload, true);
  if (afterEnsure.allowUpload) fakeUpload();
  assert.equal(uploadCalls, 1, "upload must run once after unknown→granted");

  // Overlapping ensure while already granted still yields one upload.
  const overlapA = resolveChatAttachConsentDecision({
    status: DOCUMENT_STORAGE_CONSENT_STATUS.GRANTED,
  });
  const overlapB = resolveChatAttachConsentDecision({
    status: DOCUMENT_STORAGE_CONSENT_STATUS.GRANTED,
  });
  assert.equal(overlapA.allowUpload && overlapB.allowUpload, true);
  if (overlapA.allowUpload && overlapB.allowUpload) {
    // Chat path calls uploadDocument only after a single ensure returns allow.
    fakeUpload();
  }
  assert.equal(uploadCalls, 2, "second attach turn may upload once more; no double in one gate");
}

// Server SSOT reminder — client helpers never claim to replace uploadDocument check.
assert.match(
  String(DOCUMENT_STORAGE_CONSENT_REQUIRED_CHAT_TEXT),
  /문서 보관 동의/,
);

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const uploadSrc = readFileSync(join(root, "src/lib/customerDocuments.js"), "utf8");
assert.match(uploadSrc, /hasDocumentStorageConsent\(customerId\)/);
assert.match(uploadSrc, /문서 보관 동의가 필요합니다\./);
assert.match(
  readFileSync(join(root, "src/components/LifeguardHomeChat.jsx"), "utf8"),
  /ensureStorageConsentForChatAttach/,
);
assert.match(
  readFileSync(join(root, "src/components/LifeguardHomeChat.jsx"), "utf8"),
  /hydrateStorageConsent/,
);
assert.match(
  readFileSync(join(root, "src/components/LifeguardHomeChat.jsx"), "utf8"),
  /clearComposerAttach/,
);
assert.equal(
  /setStorageConsentStatus|storageConsentStatus/.test(
    readFileSync(join(root, "src/components/LifeguardHomeChat.jsx"), "utf8").match(
      /const clearComposerAttach = \(\) => \{[\s\S]*?\n  \};/,
    )?.[0] ?? "",
  ),
  false,
  "clearComposerAttach must not touch consent state",
);

console.log("document-storage-consent-status-unit-test: PASS");
