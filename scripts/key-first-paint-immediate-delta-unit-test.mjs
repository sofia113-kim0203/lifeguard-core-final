/**
 * T4 — immediate delta + streamed === sealed (no sentence wait).
 */
import assert from "node:assert/strict";
import {
  createImmediateAnswerDeltaStream,
  createSentenceCommitStream,
  findNextCommitEnd,
} from "../server/keyCore/keyClaudeFirstSentenceCommit.js";

// Baseline: sentence commit waits for boundary + safety buffer.
{
  const end = findNextCommitEnd("첫 문장입니다. 다음", {
    flushAll: false,
    safetyBufferChars: 8,
  });
  assert.equal(end, -1, "sentence path must wait (pre-T4 behavior)");
}

// T4: first non-empty chunk emits immediately (no sentence completion).
{
  const units = [];
  const s = createImmediateAnswerDeltaStream({
    onCommit: (u) => units.push(u),
  });
  s.pushAnswerText("안녕");
  assert.deepEqual(units, ["안녕"], "first non-empty delta must emit immediately");
  s.pushAnswerText("안녕하세요");
  assert.deepEqual(units, ["안녕", "하세요"]);
  assert.equal(s.getCommitted(), "안녕하세요");
}

// Catch-up keeps streamed === sealed.
{
  const units = [];
  const s = createImmediateAnswerDeltaStream({
    onCommit: (u) => units.push(u),
  });
  s.pushAnswerText("확인된 내용입니다");
  const sealed = "확인된 내용입니다. 이어서 말씀드릴게요.";
  const cu = s.catchUpFinalAnswer(sealed);
  assert.equal(cu.appended, true);
  assert.equal(s.getCommitted(), sealed, "streamed text must equal sealed");
}

// Immediate path must not wait where sentence path still waits.
{
  const sentenceUnits = [];
  const sentence = createSentenceCommitStream({
    onCommit: (u) => sentenceUnits.push(u),
    safetyBufferChars: 8,
  });
  sentence.pushAnswerText("첫 문장입니다. 다음");
  assert.equal(sentenceUnits.length, 0, "sentence path still buffers");

  const immediateUnits = [];
  const immediate = createImmediateAnswerDeltaStream({
    onCommit: (u) => immediateUnits.push(u),
  });
  immediate.pushAnswerText("첫 문장입니다. 다음");
  assert.equal(immediateUnits.join(""), "첫 문장입니다. 다음");
  assert.ok(immediateUnits.length >= 1, "immediate path emits without boundary wait");
}

console.log("key-first-paint-immediate-delta-unit-test: PASS");
