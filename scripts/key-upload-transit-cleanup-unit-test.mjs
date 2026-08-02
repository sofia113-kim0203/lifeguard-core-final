/**
 * STAGE 5C — upload transit cleanup after document vault store (provider-free).
 */
import assert from "node:assert/strict";
import { buildHomeBrainFactRequestBody } from "../src/lib/homeBrainFactRequestBody.js";
import {
  armPendingDocumentDeliveryAfterStore,
  buildUploadTransitCleanupTrace,
  consumePendingDocumentDelivery,
  createEmptyPendingDocumentDelivery,
  discardComposerUploadTransit,
  planUploadTransitCleanupAfterDocumentStore,
  planUploadTransitOnMemoryCommitFailure,
} from "../src/lib/uploadTransitCleanup.js";

let PROVIDER_CALLS = 0;
const originalFetch = globalThis.fetch;
globalThis.fetch = (...args) => {
  PROVIDER_CALLS += 1;
  if (typeof originalFetch === "function") return originalFetch(...args);
  return Promise.reject(new Error("fetch blocked"));
};

const revoked = [];
const RealURL = globalThis.URL;
globalThis.URL = class extends RealURL {
  static revokeObjectURL(url) {
    revoked.push(String(url));
    if (typeof RealURL.revokeObjectURL === "function") {
      try {
        RealURL.revokeObjectURL(url);
      } catch {
        /* ignore */
      }
    }
  }
};

function ok(name) {
  console.log(`PASS ${name}`);
}

// A — single file store → all transit after 0; next request has no attach fields after consume
{
  revoked.length = 0;
  const composerBefore = [
    {
      documentId: "doc-1",
      filename: "policy.jpg",
      previewUrl: "blob:http://local/fake-1",
      mime: "image/jpeg",
      isImage: true,
    },
  ];
  const planned = planUploadTransitCleanupAfterDocumentStore({
    composerAttachments: composerBefore,
    storedRows: [
      { documentId: "doc-1", filename: "policy.jpg", mime: "image/jpeg" },
    ],
    priorPending: createEmptyPendingDocumentDelivery(),
  });
  assert.equal(planned.composerAttachments.length, 0);
  assert.equal(planned.restorableCandidate, null);
  assert.equal(planned.activeAttachmentId, null);
  assert.deepEqual(planned.activeAttachmentIds, []);
  assert.equal(planned.attachHint, "");
  assert.equal(planned.trace.preview_count_after, 0);
  assert.equal(planned.trace.raw_file_count_after, 0);
  assert.equal(planned.trace.client_attachment_id_count_after, 0);
  assert.equal(planned.pendingDelivery.documentIds.length, 1);
  assert.ok(revoked.includes("blob:http://local/fake-1"));

  const consumed = consumePendingDocumentDelivery(planned.pendingDelivery);
  assert.deepEqual(consumed.deliveryIds, ["doc-1"]);
  assert.equal(consumed.nextPending.documentIds.length, 0);

  const followup = buildHomeBrainFactRequestBody("그중 확인이 필요한 내용이 뭐야?", [], {
    currentTurnDocumentIds: consumed.nextPending.documentIds,
    activeAttachmentIds: ["doc-1"],
    documentIds: ["doc-1"],
  });
  assert.equal(followup.document_id, undefined);
  assert.equal(followup.document_ids, undefined);
  assert.equal(followup.current_turn_document_ids, undefined);
  assert.equal(followup.active_attachment_ids, undefined);
  const followJson = JSON.stringify(followup);
  assert.equal(/base64|blob:|data:image/i.test(followJson), false);
}
ok("A_single_file_cleanup");

// B — five files
{
  revoked.length = 0;
  const rows = [1, 2, 3, 4, 5].map((i) => ({
    documentId: `doc-${i}`,
    filename: `p${i}.jpg`,
    mime: "image/jpeg",
  }));
  const composerBefore = rows.map((r) => ({
    ...r,
    previewUrl: `blob:http://local/${r.documentId}`,
    isImage: true,
  }));
  const planned = planUploadTransitCleanupAfterDocumentStore({
    composerAttachments: composerBefore,
    storedRows: rows,
  });
  assert.equal(planned.composerAttachments.length, 0);
  assert.equal(planned.pendingDelivery.documentIds.length, 5);
  assert.equal(planned.trace.preview_count_after, 0);
  assert.equal(planned.trace.client_attachment_id_count_after, 0);
  assert.equal(revoked.length, 5);

  const consumed = consumePendingDocumentDelivery(planned.pendingDelivery);
  const sendBody = buildHomeBrainFactRequestBody("다섯 장 분석", [], {
    currentTurnDocumentIds: consumed.deliveryIds,
    documentIds: consumed.deliveryIds,
  });
  assert.deepEqual(sendBody.current_turn_document_ids, consumed.deliveryIds);
  const nextBody = buildHomeBrainFactRequestBody("다음 질문", [], {
    currentTurnDocumentIds: consumed.nextPending.documentIds,
    activeAttachmentIds: consumed.deliveryIds,
  });
  assert.equal(nextBody.current_turn_document_ids, undefined);
  assert.equal(nextBody.document_id, undefined);
}
ok("B_five_files_cleanup");

// C — same file re-select: input reset is caller-side; pending does not merge stale File rows
{
  const first = armPendingDocumentDeliveryAfterStore(null, [
    { documentId: "doc-a", filename: "a.jpg", mime: "image/jpeg" },
  ]);
  const cleared = discardComposerUploadTransit([
    {
      documentId: "doc-a",
      filename: "a.jpg",
      previewUrl: "blob:http://local/a",
      mime: "image/jpeg",
      isImage: true,
    },
  ]);
  assert.equal(cleared.length, 0);
  const second = armPendingDocumentDeliveryAfterStore(
    createEmptyPendingDocumentDelivery(),
    [{ documentId: "doc-a", filename: "a.jpg", mime: "image/jpeg" }],
  );
  assert.deepEqual(second.documentIds, ["doc-a"]);
  assert.equal(first.documentIds.length, 1);
}
ok("C_reselect_no_merge_with_stale_composer");

// D — KEY commit failure plan: no revive / no auto reupload / no empty-memory Claude
{
  const fail = planUploadTransitOnMemoryCommitFailure();
  assert.equal(fail.reviveComposer, false);
  assert.equal(fail.autoReupload, false);
  assert.equal(fail.restorableCandidate, null);
  assert.equal(fail.claudeWithEmptyMemory, false);
  assert.equal(fail.keepVaultDocumentIds, true);
}
ok("D_memory_commit_failure_no_revive");

// E — store failure must not arm pending as success
{
  const planned = planUploadTransitCleanupAfterDocumentStore({
    composerAttachments: [],
    storedRows: [],
  });
  assert.equal(planned.pendingDelivery.documentIds.length, 0);
  assert.equal(planned.trace.document_store_committed, true);
  // Explicit: empty storedRows ⇒ no delivery authority
  const authBody = buildHomeBrainFactRequestBody("질문", [], {
    currentTurnDocumentIds: planned.pendingDelivery.documentIds,
  });
  assert.equal(authBody.document_id, undefined);
}
ok("E_no_store_no_pending_authority");

// Trace success shape
{
  const t = buildUploadTransitCleanupTrace({
    documentStoreCommitted: true,
    before: { raw_file_count: 5, preview_count: 5 },
    after: {
      raw_file_count: 0,
      preview_count: 0,
      client_attachment_id_count: 0,
      current_upload_document_id_count: 0,
    },
    objectUrlsRevoked: 5,
    nextTurnOriginalCount: 0,
  });
  assert.equal(t.raw_file_count_after, 0);
  assert.equal(t.preview_count_after, 0);
  assert.equal(t.client_attachment_id_count_after, 0);
  assert.equal(t.current_upload_document_id_count_after, 0);
  assert.equal(t.next_turn_original_count, 0);
  assert.equal(t.object_urls_revoked, 5);
}
ok("F_trace_all_after_zero");

assert.equal(PROVIDER_CALLS, 0);
console.log(`PROVIDER_CALLS=${PROVIDER_CALLS}`);
console.log("\nALL_PASS key-upload-transit-cleanup-unit-test");
