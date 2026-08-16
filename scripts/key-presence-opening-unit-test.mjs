/**
 * Presence 1장 — attempt-once + customer-win discard. No Claude. No HEART.
 */
import assert from "node:assert/strict";
import {
  beginPresenceOpeningAttempt,
  clearPresenceRanForSession,
  hasPresenceRanThisSession,
  shouldDiscardPresenceOpeningResult,
  threadBlocksPresenceOpening,
} from "../src/lib/keyPresenceSession.js";
import {
  buildPresenceOpeningUserText,
  shouldInvokePresenceClaude,
} from "../server/keyCore/keyPresenceContext.js";

function test(name, fn) {
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (err) {
    console.error(`FAIL ${name}`);
    console.error(err);
    process.exitCode = 1;
  }
}

test("empty new seat is eligible; life threads are not a gate", () => {
  const gate = shouldInvokePresenceClaude({
    presenceContext: { active_life_thread_candidates: [] },
  });
  assert.equal(gate.ok, true);
  assert.equal(gate.reason, "eligible");
});

test("customer question or active stream still blocks invoke", () => {
  assert.equal(
    shouldInvokePresenceClaude({ customerQuestionPending: true }).ok,
    false,
  );
  assert.equal(shouldInvokePresenceClaude({ answerStreamActive: true }).ok, false);
  assert.equal(shouldInvokePresenceClaude({ sessionAlreadyRan: true }).ok, false);
});

test("old thread or spoken assistant blocks opening", () => {
  assert.equal(threadBlocksPresenceOpening([]), false);
  assert.equal(
    threadBlocksPresenceOpening([{ role: "assistant", content: "", thinking: true, presenceTurn: true }]),
    false,
  );
  assert.equal(threadBlocksPresenceOpening([{ role: "user", content: "안녕" }]), true);
  assert.equal(
    threadBlocksPresenceOpening([{ role: "assistant", content: "먼저 말했어요.", presenceTurn: true }]),
    true,
  );
});

test("begin attempt marks before a second caller can start", () => {
  const cid = "qa-presence-unit";
  const sid = "session-presence-unit";
  clearPresenceRanForSession(cid, sid);
  assert.equal(beginPresenceOpeningAttempt(cid, sid), true);
  assert.equal(hasPresenceRanThisSession(cid, sid), true);
  assert.equal(beginPresenceOpeningAttempt(cid, sid), false);
  clearPresenceRanForSession(cid, sid);
});

test("opening clothes are fact + purpose; no sample greeting", () => {
  const first = buildPresenceOpeningUserText({ visitKind: "first_visit" });
  const again = buildPresenceOpeningUserText({ visitKind: "revisit" });
  assert.equal(first.includes("처음 방문했다"), true);
  assert.equal(first.includes("첫 만남답게"), true);
  assert.equal(first.includes("고정문구 없이"), true);
  assert.equal(first.includes("안녕하세요"), false);
  assert.equal(first.includes("무엇을 도와드릴까요"), false);
  assert.equal(again.includes("처음 방문했다"), false);
  assert.equal(again.includes("다시 방문했다"), true);
  assert.equal(buildPresenceOpeningUserText(null), "");
  assert.equal(buildPresenceOpeningUserText({ visitKind: "unknown" }), "");
});

test("late opening is discarded when aborted or customer won", () => {
  assert.equal(shouldDiscardPresenceOpeningResult({ aborted: true }), true);
  assert.equal(shouldDiscardPresenceOpeningResult({ customerWon: true }), true);
  assert.equal(shouldDiscardPresenceOpeningResult({}), false);
});

if (process.exitCode) {
  console.error("key-presence-opening unit tests FAILED");
  process.exit(1);
}
console.log("key-presence-opening unit tests PASSED");
