/**
 * KEY original one-shot delivery — CASE 1–11 (no network / Claude / secrets).
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildHomeBrainFactRequestBody } from "../src/lib/homeBrainFactRequestBody.js";
import {
  armExplicitReopenOneShot,
  beginExplicitReopenFlight,
  decideForceFullOriginalForOneShot,
  EXPLICIT_REOPEN_STATUS,
  markExplicitReopenAck,
  resolveExplicitReopenFlightFailure,
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

// CASE 5 — reopen consumed after ACK; next ordinary turn zero
{
  let flight = armExplicitReopenOneShot(["a", "b", "c", "d", "e"]);
  const begun = beginExplicitReopenFlight(flight);
  assert.equal(begun.ok, true);
  assert.deepEqual(begun.requestSnapshotIds, ["a", "b", "c", "d", "e"]);
  flight = markExplicitReopenAck(begun.nextState);
  assert.equal(flight.status, EXPLICIT_REOPEN_STATUS.CONSUMED);
  assert.deepEqual(flight.documentIds, []);
  const body = buildHomeBrainFactRequestBody("다음 질문", [], {
    explicitReopenDocumentIds: flight.documentIds,
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

// CASE 9 — ACK 전 실패 후 재시도
{
  let flight = armExplicitReopenOneShot(["a", "b", "c", "d", "e"]);
  assert.equal(flight.status, EXPLICIT_REOPEN_STATUS.ARMED);
  const begun = beginExplicitReopenFlight(flight);
  assert.equal(begun.nextState.status, EXPLICIT_REOPEN_STATUS.IN_FLIGHT);
  assert.deepEqual(begun.requestSnapshotIds, ["a", "b", "c", "d", "e"]);
  // Network failure before ack → re-arm
  flight = resolveExplicitReopenFlightFailure(begun.nextState);
  assert.equal(flight.status, EXPLICIT_REOPEN_STATUS.ARMED);
  assert.deepEqual(flight.documentIds, ["a", "b", "c", "d", "e"]);
  const retry = beginExplicitReopenFlight(flight);
  assert.equal(retry.ok, true);
  assert.deepEqual(retry.requestSnapshotIds, ["a", "b", "c", "d", "e"]);
  const body = buildHomeBrainFactRequestBody("재시도", [], {
    explicitReopenDocumentIds: retry.requestSnapshotIds,
  });
  assert.deepEqual(body.explicit_reopen_document_ids, ["a", "b", "c", "d", "e"]);
  assert.equal(
    decideForceFullOriginalForOneShot({
      explicitReopenDocumentIds: retry.requestSnapshotIds,
    }),
    true,
  );
}
ok("CASE9_pre_ack_failure_rearms");

// CASE 10 — ACK 후 스트림 실패 → consumed 유지
{
  let flight = armExplicitReopenOneShot(["a", "b", "c", "d", "e"]);
  const begun = beginExplicitReopenFlight(flight);
  flight = markExplicitReopenAck(begun.nextState);
  assert.equal(flight.status, EXPLICIT_REOPEN_STATUS.CONSUMED);
  assert.equal(flight.ackReceived, true);
  // Stream mid-failure after ack must not re-arm
  flight = resolveExplicitReopenFlightFailure({
    ...flight,
    status: EXPLICIT_REOPEN_STATUS.CONSUMED,
    ackReceived: true,
  });
  assert.equal(flight.status, EXPLICIT_REOPEN_STATUS.CONSUMED);
  assert.deepEqual(flight.documentIds, []);
  const body = buildHomeBrainFactRequestBody("다음 질문", [], {
    explicitReopenDocumentIds: flight.documentIds,
  });
  assert.equal(body.explicit_reopen_document_ids, undefined);
  assert.equal(body.document_id, undefined);
}
ok("CASE10_post_ack_failure_stays_consumed");

// CASE 11 — 동시 전송 방어
{
  let flight = armExplicitReopenOneShot(["x", "y"]);
  const first = beginExplicitReopenFlight(flight);
  assert.equal(first.ok, true);
  assert.deepEqual(first.requestSnapshotIds, ["x", "y"]);
  const second = beginExplicitReopenFlight(first.nextState);
  assert.equal(second.ok, false);
  assert.equal(second.reason, "already_in_flight");
  assert.deepEqual(second.requestSnapshotIds, []);
  const body = buildHomeBrainFactRequestBody("중복", [], {
    explicitReopenDocumentIds: second.requestSnapshotIds,
  });
  assert.equal(body.explicit_reopen_document_ids, undefined);
}
ok("CASE11_concurrent_flight_blocked");

// CASE 12 — D wiring: pending/composer snapshot IDs → currentTurnDocumentIds → wire
// (composer tray may already be empty after STAGE 5C cleanup)
{
  const pendingFive = ["p1", "p2", "p3", "p4", "p5"];
  const body0 = buildHomeBrainFactRequestBody("T0", [], {
    currentTurnDocumentIds: pendingFive,
  });
  assert.deepEqual(body0.current_turn_document_ids, pendingFive);
  assert.equal(body0.prior_attach_follow_up, undefined);
  // document_ids on wire is derived from current-turn scope, not a separate legacy authority.
  assert.deepEqual(body0.document_ids, pendingFive);

  const body1 = buildHomeBrainFactRequestBody("T1", [], {
    currentTurnDocumentIds: [],
  });
  assert.equal(body1.current_turn_document_ids, undefined);
  assert.equal(body1.document_ids, undefined);
  assert.equal(body1.prior_attach_follow_up, undefined);

  const pendingOne = ["solo"];
  const bodySolo = buildHomeBrainFactRequestBody("T0 one", [], {
    currentTurnDocumentIds: pendingOne,
  });
  assert.deepEqual(bodySolo.current_turn_document_ids, pendingOne);
  assert.equal(bodySolo.document_id, "solo");
  assert.equal(bodySolo.document_ids, undefined);
}
ok("CASE12_pending_ids_wire_current_turn");

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
  assert.match(homeChat, /beginExplicitReopenFlight/);
  assert.match(homeChat, /markExplicitReopenAck/);
  assert.match(homeChat, /resolveExplicitReopenFlightFailure/);
  assert.match(homeChat, /shouldBlockSendForIncompleteUpload/);
  assert.match(homeChat, /reactivateRestorableAttachmentCandidate/);
  assert.doesNotMatch(
    homeChat,
    /One-shot reopen: consume at request-build time/,
  );
  // D lock: wire currentTurnDocumentIds from documentIdsForTurn (pending snapshot), not composer-only.
  assert.match(
    homeChat,
    /currentTurnDocumentIds:\s*documentIdsForTurn\.slice\(\)/,
  );
  assert.doesNotMatch(
    homeChat,
    /currentTurnDocumentIds:\s*composerDocumentIds\.slice\(\)/,
  );
  // Must not reintroduce legacy documentIds as original-byte authority on attachOptions.
  assert.doesNotMatch(
    homeChat,
    /documentIdsForTurn\.length\s*>\s*1\s*\?\s*\{\s*documentIds:\s*documentIdsForTurn/,
  );
}
ok("source_locks_one_shot");

console.log("\nALL PASS key-attachment-one-shot-delivery-unit-test");
