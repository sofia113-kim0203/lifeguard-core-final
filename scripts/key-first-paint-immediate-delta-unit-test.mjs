/**
 * Customer stream completeness — sentence-boundary emit, no incomplete EOF flush.
 */
import assert from "node:assert/strict";
import {
  createImmediateAnswerDeltaStream,
  createSentenceCommitStream,
  endsWithSentenceBoundary,
  findNextCommitEnd,
  resolveCompleteAnswerText,
  trimToLastCompleteSentence,
} from "../server/keyCore/keyClaudeFirstSentenceCommit.js";

// Baseline: sentence commit waits for boundary + safety buffer.
{
  const end = findNextCommitEnd("첫 문장입니다. 다음", {
    flushAll: false,
    safetyBufferChars: 8,
  });
  assert.equal(end, -1, "sentence path must wait (pre-T4 behavior)");
}

// A: equal final — no duplicate commit after full complete stream.
{
  const units = [];
  const s = createImmediateAnswerDeltaStream({
    onCommit: (u) => units.push(u),
  });
  const full = "암보험은 확인이 필요해요.";
  s.pushAnswerText(full);
  assert.equal(s.getCommitted(), full);
  const before = units.length;
  const cu = s.catchUpFinalAnswer(full);
  assert.equal(cu.appended, false);
  assert.equal(units.length, before);
  assert.equal(s.getCommitted(), full);
}

// B: continuation — suffix only after committed prefix.
{
  const units = [];
  const s = createImmediateAnswerDeltaStream({
    onCommit: (u) => units.push(u),
  });
  // No sentence boundary yet — nothing customer-emitted.
  s.pushAnswerText("암보험은");
  assert.equal(s.getCommitted(), "");
  assert.ok(s.getPending().includes("암보험은"));
  const sealed = "암보험은 확인이 필요해요.";
  const cu = s.catchUpFinalAnswer(sealed);
  assert.equal(cu.appended, true);
  assert.equal(s.getCommitted(), sealed);
  assert.equal(s.getPending(), "");
}

// C: post-process divergence candidate must not rewrite emitted prefix (stream helper).
{
  const s = createImmediateAnswerDeltaStream({ onCommit: () => {} });
  s.pushAnswerText("암보험은 괜찮아요. ");
  const emitted = s.getCommitted();
  assert.ok(emitted.startsWith("암보험은 괜찮"));
  const divergent = "암보험이 괜찮은지는 확인이 필요해요.";
  const cu = s.catchUpFinalAnswer(divergent);
  assert.equal(cu.appended, false);
  assert.equal(cu.reason, "final_not_prefix_of_committed");
  assert.equal(s.getCommitted(), emitted);
}

// D: EOF mid-word tail never emitted; complete sentence retained.
{
  const units = [];
  const s = createImmediateAnswerDeltaStream({
    onCommit: (u) => units.push(u),
  });
  const raw =
    "확인된 내용입니다. 부족한 부분이 뭔지 바";
  s.pushAnswerText(raw);
  assert.ok(s.getCommitted().includes("확인된 내용입니다."));
  assert.ok(!s.getCommitted().includes("바"));
  assert.ok(s.getPending().includes("바") || s.getPending().includes("부족"));
  const flush = s.flush();
  assert.ok(flush.dropped_pending_len > 0);
  assert.equal(s.getPending(), "");
  assert.ok(!s.getCommitted().includes("바"));
  const complete = resolveCompleteAnswerText(raw, { stopReason: "max_tokens" });
  assert.equal(complete.includes("바"), false);
  assert.ok(endsWithSentenceBoundary(complete));
  const cu = s.catchUpFinalAnswer(raw, { stopReason: "max_tokens" });
  assert.ok(!s.getCommitted().includes("바"));
  assert.ok(s.getCommitted().includes("확인된 내용입니다."));
  assert.equal(trimToLastCompleteSentence(raw).includes("바"), false);
  void cu;
  void units;
}

// Immediate path emits at sentence boundary (not mid-word).
{
  const immediateUnits = [];
  const immediate = createImmediateAnswerDeltaStream({
    onCommit: (u) => immediateUnits.push(u),
  });
  immediate.pushAnswerText("첫 문장입니다. 다음");
  assert.equal(immediateUnits.join(""), "첫 문장입니다.");
  assert.ok(immediate.getPending().includes("다음"));

  const sentenceUnits = [];
  const sentence = createSentenceCommitStream({
    onCommit: (u) => sentenceUnits.push(u),
    safetyBufferChars: 8,
  });
  sentence.pushAnswerText("첫 문장입니다. 다음");
  assert.equal(sentenceUnits.length, 0, "buffered sentence path still waits on safety buffer");
}

console.log("key-first-paint-immediate-delta-unit-test: PASS");
