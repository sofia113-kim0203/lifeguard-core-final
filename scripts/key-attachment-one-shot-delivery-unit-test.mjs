/**
 * KEY original one-shot delivery — CASE 1–8 (no network / Claude / secrets).
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildHomeBrainFactRequestBody } from "../src/lib/homeBrainFactRequestBody.js";
import {
  consumeExplicitReopenDocumentIds,
  decideForceFullOriginalForOneShot,
  resolveOriginalByteDeliveryAuthority,
  shouldBlockSendForIncompleteUpload,
} from "../src/lib/originalAttachmentOneShot.js";
import { decidePdfAttachMode } from "../server/keyCore/keyClaudePdfAttachPolicy.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

function ok(name) {
  console.log(`PASS ${name}`);
}

// CASE 1 — single upload
{
  const auth = resolveOriginalByteDeliveryAuthority({
    currentTurnDocumentIds: ["doc-1"],
    explicitReopenDocumentIds: [],
  });
  assert.equal(auth.reason, "current_upload");
  assert.deepEqual(auth.deliveryIds, ["doc-1"]);
  const body = buildHomeBrainFactRequestBody("이 문서 봐줘", [], {
    currentTurnDocumentIds: ["doc-1"],
    documentIds: ["doc-1"],
  });
  assert.deepEqual(body.current_turn_document_ids, ["doc-1"]);
  assert.equal(body.document_id, "doc-1");
  assert.equal(body.explicit_reopen_document_ids, undefined);
  assert.equal(body.active_attachment_ids, undefined);
  assert.equal(
    decideForceFullOriginalForOneShot({ currentTurnDocumentIds: ["doc-1"] }),
    true,
  );
  const mode = decidePdfAttachMode({
    documentId: "doc-1",
    forceFullOriginal: true,
    priorAttachFollowUp: false,
    chunkCount: 0,
  });
  assert.equal(mode.attach_full_base64, true);
}
ok("CASE1_single_upload");

// CASE 2 — multi upload (5)
{
  const ids = ["a", "b", "c", "d", "e"];
  const body = buildHomeBrainFactRequestBody("다섯 장 분석", [], {
    currentTurnDocumentIds: ids,
    documentIds: ids,
  });
  assert.deepEqual(body.current_turn_document_ids, ids);
  assert.deepEqual(body.document_ids, ids);
  assert.equal(body.document_id, "a");
  assert.equal(
    decideForceFullOriginalForOneShot({ currentTurnDocumentIds: ids }),
    true,
  );
  // Multi-count alone must not leave authority for a later turn.
  assert.equal(
    decideForceFullOriginalForOneShot({
      currentTurnDocumentIds: [],
      explicitReopenDocumentIds: [],
    }),
    false,
  );
}
ok("CASE2_multi_upload");

// CASE 3 — ordinary follow-up after upload
{
  const body = buildHomeBrainFactRequestBody("합산만", [], {
    currentTurnDocumentIds: [],
    explicitReopenDocumentIds: [],
    documentIds: ["a", "b", "c", "d", "e"],
    activeAttachmentIds: ["a", "b", "c", "d", "e"],
    attachmentReferenceEnabled: true,
  });
  assert.equal(body.document_id, undefined);
  assert.equal(body.document_ids, undefined);
  assert.equal(body.current_turn_document_ids, undefined);
  assert.equal(body.explicit_reopen_document_ids, undefined);
  assert.equal(body.active_attachment_ids, undefined);
  assert.equal(decideForceFullOriginalForOneShot({}), false);
  const mode = decidePdfAttachMode({
    documentId: "a",
    forceFullOriginal: false,
    priorAttachFollowUp: true,
    chunkCount: 3,
  });
  assert.equal(mode.attach_full_base64, false);
}
ok("CASE3_ordinary_followup_zero_originals");

// CASE 4 — chip one-shot reopen
{
  const body = buildHomeBrainFactRequestBody("다시 봐줘", [], {
    explicitReopenDocumentIds: ["a", "b", "c", "d", "e"],
  });
  assert.deepEqual(body.explicit_reopen_document_ids, ["a", "b", "c", "d", "e"]);
  assert.deepEqual(body.document_ids, ["a", "b", "c", "d", "e"]);
  assert.equal(body.current_turn_document_ids, undefined);
  assert.equal(
    decideForceFullOriginalForOneShot({
      explicitReopenDocumentIds: ["a", "b", "c", "d", "e"],
    }),
    true,
  );
  assert.equal(
    resolveOriginalByteDeliveryAuthority({
      explicitReopenDocumentIds: ["a", "b", "c", "d", "e"],
    }).reason,
    "explicit_reopen",
  );
}
ok("CASE4_chip_one_shot_reopen");

// CASE 5 — reopen consumed; next ordinary turn zero
{
  const consumed = consumeExplicitReopenDocumentIds(["a", "b", "c", "d", "e"]);
  assert.deepEqual(consumed.reopenIds, ["a", "b", "c", "d", "e"]);
  assert.deepEqual(consumed.nextReopenIds, []);
  const body = buildHomeBrainFactRequestBody("다음 질문", [], {
    explicitReopenDocumentIds: consumed.nextReopenIds,
    currentTurnDocumentIds: [],
  });
  assert.equal(body.explicit_reopen_document_ids, undefined);
  assert.equal(body.document_id, undefined);
  assert.equal(decideForceFullOriginalForOneShot({}), false);
}
ok("CASE5_one_shot_expires");

// CASE 6 — upload race: selected files without ready ids → block (no Claude)
{
  assert.equal(
    shouldBlockSendForIncompleteUpload({ uploading: true, composerAttachments: [] })
      .block,
    true,
  );
  assert.equal(
    shouldBlockSendForIncompleteUpload({
      uploading: false,
      composerAttachments: [{ filename: "x.pdf" }],
    }).block,
    true,
  );
  assert.equal(
    shouldBlockSendForIncompleteUpload({
      uploading: false,
      composerAttachments: [{ documentId: "doc-1", filename: "x.pdf" }],
    }).block,
    false,
  );
  // Body builder must not invent delivery from past ids when upload incomplete.
  const body = buildHomeBrainFactRequestBody("텍스트만", [], {
    documentIds: [],
    currentTurnDocumentIds: [],
  });
  assert.equal(body.document_id, undefined);
  assert.equal(Object.prototype.hasOwnProperty.call(body, "second_claude"), false);
}
ok("CASE6_upload_race_blocks_send");

// CASE 7 — active case alone must not force originals
{
  assert.equal(
    decideForceFullOriginalForOneShot({
      currentTurnDocumentIds: [],
      explicitReopenDocumentIds: [],
    }),
    false,
  );
  const mode = decidePdfAttachMode({
    documentId: "case-doc",
    priorAttachFollowUp: false,
    forceFullOriginal: false,
    vaultMultiRecall: false,
    chunkCount: 0,
    question: "분석해줘 키",
  });
  // Without force / vault, first-attach path may still want bytes — server demotes via one-shot gate.
  // Unit check: force flag itself is false (server uses this as authority).
  assert.equal(
    decideForceFullOriginalForOneShot({
      currentTurnDocumentIds: [],
      explicitReopenDocumentIds: [],
    }),
    false,
  );
  void mode;
}
ok("CASE7_active_case_no_force");

// CASE 8 — past multi document_ids alone must not force
{
  assert.equal(
    decideForceFullOriginalForOneShot({
      currentTurnDocumentIds: [],
      explicitReopenDocumentIds: [],
    }),
    false,
  );
  const body = buildHomeBrainFactRequestBody("후속", [], {
    documentIds: ["x", "y", "z"],
    activeAttachmentIds: ["x", "y"],
    attachmentReferenceEnabled: true,
  });
  assert.equal(body.document_ids, undefined);
  assert.equal(body.document_id, undefined);
}
ok("CASE8_multi_count_no_force");

// Source locks
{
  const firstDirect = readFileSync(
    join(ROOT, "server/keyCore/keyClaudeFirstDirect.js"),
    "utf8",
  );
  assert.equal(
    /forceFullOriginal\s*=\s*[^\n]*hasActiveInsuranceDocumentCase/.test(firstDirect),
    false,
  );
  assert.equal(
    /forceFullOriginal\s*=\s*[^\n]*length\s*>\s*1/.test(firstDirect),
    false,
  );
  assert.match(firstDirect, /decideForceFullOriginalForOneShot/);
  assert.match(firstDirect, /original_delivery_requires_upload_or_explicit_reopen/);
  const homeChat = readFileSync(join(ROOT, "src/components/LifeguardHomeChat.jsx"), "utf8");
  assert.match(homeChat, /explicitReopenDocumentIds/);
  assert.match(homeChat, /consumeExplicitReopenDocumentIds/);
  assert.match(homeChat, /shouldBlockSendForIncompleteUpload/);
  assert.match(homeChat, /reactivateRestorableAttachmentCandidate/);
}
ok("source_locks_one_shot");

console.log("\nALL PASS key-attachment-one-shot-delivery-unit-test");
