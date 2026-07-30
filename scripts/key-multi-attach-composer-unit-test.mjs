/**
 * Multi-attach composer — array state, labels, request body document_ids contract.
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
} from "../src/lib/chatComposerAttachments.js";
import {
  listAttachedDocumentIds,
  resolveAttachDocumentIdContract,
} from "../src/lib/homeBrainAttachDocumentIds.js";
import { buildHomeBrainFactRequestBody } from "../src/lib/homeBrainFactRequestBody.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

console.log("key-multi-attach-composer-unit-test");

// 1 file → same single document_id wire shape
{
  const body = buildHomeBrainFactRequestBody("안녕", [], { documentId: "doc-a" });
  assert.equal(body.document_id, "doc-a");
  assert.equal(Object.prototype.hasOwnProperty.call(body, "document_ids"), false);
}

// A·B → ordered document_ids + primary document_id = first (not last-only)
{
  const body = buildHomeBrainFactRequestBody("이 두 장 봐줘", [], {
    documentIds: ["doc-a", "doc-b"],
  });
  assert.equal(body.document_id, "doc-a");
  assert.deepEqual(body.document_ids, ["doc-a", "doc-b"]);
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
  // B fails → never appended; A stays
  const afterBFail = appendChatComposerAttachment(rows.slice(0, 1), null);
  assert.deepEqual(listChatComposerDocumentIds(afterBFail), ["doc-a"]);
  // A fails / B succeeds → only B
  const onlyB = appendChatComposerAttachment([], {
    documentId: "doc-b",
    filename: "lifeguard-multi-upload-B.png",
  });
  assert.deepEqual(listChatComposerDocumentIds(onlyB), ["doc-b"]);
  // remove one chip
  assert.deepEqual(
    listChatComposerDocumentIds(removeChatComposerAttachment(rows, "doc-a")),
    ["doc-b"],
  );
}

// Duplicate selection not arbitrarily removed at helper layer
{
  let rows = [];
  rows = appendChatComposerAttachment(rows, { documentId: "d1", filename: "same.png" });
  rows = appendChatComposerAttachment(rows, { documentId: "d2", filename: "same.png" });
  assert.equal(rows.length, 2);
}

// LifeguardHomeChat uses array composer + documentIds on send
{
  const chatSrc = readFileSync(join(ROOT, "src/components/LifeguardHomeChat.jsx"), "utf8");
  assert.match(chatSrc, /chatAttachments/);
  assert.match(chatSrc, /appendChatComposerAttachment/);
  assert.match(chatSrc, /chatAttachments\.map/);
  assert.match(chatSrc, /documentIds:\s*documentIdsForTurn/);
  assert.match(chatSrc, /\(첨부: \$\{composerAttachLabel/);
  assert.doesNotMatch(chatSrc, /setChatAttachDocumentId/);
  assert.doesNotMatch(chatSrc, /setChatAttachFilename/);
}

console.log("PASS");
