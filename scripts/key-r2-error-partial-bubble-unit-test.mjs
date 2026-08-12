/**
 * Train R2 — hard stream error removes this-turn incomplete assistant bubble.
 * No network / React mount.
 */
import assert from "node:assert/strict";
import { shouldRemoveAssistantBubbleOnStreamError } from "../src/lib/agentKeyChatStreamPaint.js";

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

const TURN = "turn-r2-1";

test("R2-T1 thinking bubble → remove", () => {
  assert.equal(
    shouldRemoveAssistantBubbleOnStreamError({
      lastAssistant: {
        role: "assistant",
        thinking: true,
        content: "KEY가 확인하고 있어요.",
        turnId: TURN,
      },
      turnId: TURN,
      memoryFailSealed: false,
      sawSuccessfulSseDone: false,
    }),
    true,
  );
});

test("R2-T2 partial paint → remove", () => {
  assert.equal(
    shouldRemoveAssistantBubbleOnStreamError({
      lastAssistant: {
        role: "assistant",
        thinking: false,
        content: "월 납입보험료는 99",
        turnId: TURN,
      },
      turnId: TURN,
      memoryFailSealed: false,
      sawSuccessfulSseDone: false,
    }),
    true,
  );
});

test("R2-T3 memoryFailSealed → keep", () => {
  assert.equal(
    shouldRemoveAssistantBubbleOnStreamError({
      lastAssistant: {
        role: "assistant",
        thinking: false,
        content: "확인된 계약은 2건입니다.",
        turnId: TURN,
      },
      turnId: TURN,
      memoryFailSealed: true,
      sawSuccessfulSseDone: false,
    }),
    false,
  );
});

test("R2-T4 successful SSE done → keep", () => {
  assert.equal(
    shouldRemoveAssistantBubbleOnStreamError({
      lastAssistant: {
        role: "assistant",
        thinking: false,
        content: "확인된 계약은 2건입니다.",
        turnId: TURN,
      },
      turnId: TURN,
      memoryFailSealed: false,
      sawSuccessfulSseDone: true,
    }),
    false,
  );
});

test("R2-T5 other-turn assistant → keep", () => {
  assert.equal(
    shouldRemoveAssistantBubbleOnStreamError({
      lastAssistant: {
        role: "assistant",
        thinking: false,
        content: "이전 턴 답변",
        turnId: "turn-other",
      },
      turnId: TURN,
      memoryFailSealed: false,
      sawSuccessfulSseDone: false,
    }),
    false,
  );
});

if (process.exitCode) {
  console.error("R2 error partial bubble unit tests FAILED");
  process.exit(1);
}
console.log("R2 error partial bubble unit tests PASSED");
