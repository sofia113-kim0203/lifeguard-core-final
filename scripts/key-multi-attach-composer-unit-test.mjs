/**
 * Multi-attach composer — tray helpers, snapshot/restore, request body contract.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  appendChatComposerAttachment,
  formatChatComposerAttachLabel,
  listChatComposerDocumentIds,
  removeChatComposerAttachment,
  restoreChatComposerAttachmentsOnFailure,
  snapshotChatComposerAttachments,
} from "../src/lib/chatComposerAttachments.js";
import {
  listAttachedDocumentIds,
  resolveAttachDocumentIdContract,
} from "../src/lib/homeBrainAttachDocumentIds.js";
import { buildHomeBrainFactRequestBody } from "../src/lib/homeBrainFactRequestBody.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

console.log("key-multi-attach-composer-unit-test");

// 1 file → same single document_id wire shape (current_upload)
{
  const body = buildHomeBrainFactRequestBody("안녕", [], {
    currentTurnDocumentIds: ["doc-a"],
    documentIds: ["doc-a"],
  });
  assert.equal(body.document_id, "doc-a");
  assert.equal(Object.prototype.hasOwnProperty.call(body, "document_ids"), false);
  assert.deepEqual(body.current_turn_document_ids, ["doc-a"]);
}

// A·B → ordered document_ids + primary document_id = first (not last-only)
{
  const body = buildHomeBrainFactRequestBody("이 두 장 봐줘", [], {
    currentTurnDocumentIds: ["doc-a", "doc-b"],
    documentIds: ["doc-a", "doc-b"],
  });
  assert.equal(body.document_id, "doc-a");
  assert.deepEqual(body.document_ids, ["doc-a", "doc-b"]);
  assert.deepEqual(body.current_turn_document_ids, ["doc-a", "doc-b"]);
}

// Contract helper: single keeps documentIds empty for wire compat
{
  const one = resolveAttachDocumentIdContract({ documentId: "only" });
  assert.deepEqual(one, { documentId: "only", documentIds: [] });
  const multi = resolveAttachDocumentIdContract({
    documentIds: ["a", "b"],
  });
  assert.deepEqual(multi, { documentId: "a", documentIds: ["a", "b"] });
  assert.deepEqual(listAttachedDocumentIds(["a", "b"]), ["a", "b"]);
}

// Composer array append / remove — order + partial failure semantics
{
  let rows = [];
  rows = appendChatComposerAttachment(rows, {
    documentId: "doc-a",
    filename: "lifeguard-multi-upload-A.png",
    isImage: true,
  });
  rows = appendChatComposerAttachment(rows, {
    documentId: "doc-b",
    filename: "lifeguard-multi-upload-B.png",
    isImage: true,
  });
  assert.equal(rows.length, 2);
  assert.deepEqual(listChatComposerDocumentIds(rows), ["doc-a", "doc-b"]);
  assert.equal(
    formatChatComposerAttachLabel(rows),
    "lifeguard-multi-upload-A.png, lifeguard-multi-upload-B.png",
  );
  const afterBFail = appendChatComposerAttachment(rows.slice(0, 1), null);
  assert.deepEqual(listChatComposerDocumentIds(afterBFail), ["doc-a"]);
  const onlyB = appendChatComposerAttachment([], {
    documentId: "doc-b",
    filename: "lifeguard-multi-upload-B.png",
  });
  assert.deepEqual(listChatComposerDocumentIds(onlyB), ["doc-b"]);
  assert.deepEqual(
    listChatComposerDocumentIds(removeChatComposerAttachment(rows, "doc-a")),
    ["doc-b"],
  );
}

// Snapshot for turn payload — order preserved
{
  const snap = snapshotChatComposerAttachments([
    { documentId: "doc-a", filename: "A.png", isImage: true, previewUrl: "blob:a" },
    { documentId: "doc-b", filename: "B.png", isImage: true, previewUrl: "blob:b" },
  ]);
  assert.deepEqual(listChatComposerDocumentIds(snap), ["doc-a", "doc-b"]);
  assert.equal(snap[0].previewUrl, "blob:a");
}

// Failure restore: failed turn first, then in-flight new attaches (no dedupe)
{
  const failed = [
    { documentId: "doc-a", filename: "A.png" },
    { documentId: "doc-b", filename: "B.png" },
  ];
  const during = [{ documentId: "doc-c", filename: "C.png" }];
  const restored = restoreChatComposerAttachmentsOnFailure(failed, during);
  assert.deepEqual(listChatComposerDocumentIds(restored), ["doc-a", "doc-b", "doc-c"]);
  const dup = restoreChatComposerAttachmentsOnFailure(
    [{ documentId: "same", filename: "x.png" }],
    [{ documentId: "same", filename: "x.png" }],
  );
  assert.equal(dup.length, 2, "must not arbitrary-dedupe identical picks");
}

// Duplicate selection not arbitrarily removed at helper layer
{
  let rows = [];
  rows = appendChatComposerAttachment(rows, { documentId: "d1", filename: "same.png" });
  rows = appendChatComposerAttachment(rows, { documentId: "d2", filename: "same.png" });
  assert.equal(rows.length, 2);
}

// LifeguardHomeChat: single AttachmentTray, send-time snapshot clear, message tray
{
  const chatSrc = readFileSync(join(ROOT, "src/components/LifeguardHomeChat.jsx"), "utf8");
  const traySrc = readFileSync(join(ROOT, "src/components/AttachmentTray.jsx"), "utf8");
  assert.match(chatSrc, /chatAttachments/);
  assert.match(chatSrc, /appendChatComposerAttachment/);
  assert.match(chatSrc, /snapshotChatComposerAttachments/);
  assert.match(chatSrc, /restoreChatComposerAttachmentsOnFailure/);
  assert.match(chatSrc, /attachmentsForTurn/);
  assert.match(chatSrc, /setChatAttachments\(\[\]\)/);
  assert.match(chatSrc, /documentIds:\s*documentIdsForTurn/);
  assert.match(chatSrc, /<AttachmentTray/);
  assert.match(chatSrc, /msg\.attachments/);
  assert.doesNotMatch(chatSrc, /COMPOSER_ATTACH_LIST_MAX_PX/);
  assert.doesNotMatch(chatSrc, /setChatAttachDocumentId/);
  assert.doesNotMatch(chatSrc, /setChatAttachFilename/);
  assert.match(traySrc, /ATTACHMENT_TRAY_HEIGHT_PX = 52/);
  assert.match(traySrc, /overflowX:\s*"auto"/);
  assert.match(traySrc, /overflowY:\s*"hidden"/);
  assert.match(traySrc, /flexDirection:\s*"row"/);
  assert.doesNotMatch(traySrc, /overflowY:\s*"auto"/);
  assert.doesNotMatch(traySrc, /flexDirection:\s*"column"/);
}

console.log("PASS");
