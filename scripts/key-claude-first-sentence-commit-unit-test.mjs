import assert from "node:assert/strict";
import {
  createSentenceCommitStream,
  findNextCommitEnd,
  sentenceHardLiteBlocks,
  SENTENCE_COMMIT_ABORT_CLOSER,
} from "../server/keyCore/keyClaudeFirstSentenceCommit.js";

assert.equal(sentenceHardLiteBlocks("지금 가입하세요."), true);
assert.equal(sentenceHardLiteBlocks("확인된 22건을 같이 보면 좋겠어요."), false);
assert.equal(sentenceHardLiteBlocks("- **가입 시점 및 약관**: 확인이 필요합니다."), false);

const commits = [];
const stream = createSentenceCommitStream({
  onCommit: (s) => commits.push(s),
  safetyBufferChars: 0,
});

stream.pushAnswerText("안녕하세요. ");
stream.pushAnswerText("안녕하세요. 보험 현황을 말씀드릴게요. ");
stream.flush();
assert.ok(commits.length >= 1);
assert.ok(stream.getCommitted().includes("안녕하세요"));
assert.equal(stream.isAborted(), false);

const blocked = [];
const risky = createSentenceCommitStream({
  onCommit: (s) => blocked.push(s),
  safetyBufferChars: 0,
});
risky.pushAnswerText("먼저 현황을 볼게요. ");
risky.pushAnswerText("먼저 현황을 볼게요. 지금 가입하세요. 끝.");
risky.flush();
assert.ok(blocked.join("").includes("현황"));
assert.equal(risky.isAborted(), true);
assert.equal(blocked.join("").includes("가입하세요"), false);
assert.ok(SENTENCE_COMMIT_ABORT_CLOSER.length > 10);

const end = findNextCommitEnd("첫 문장입니다. 다음", {
  flushAll: false,
  safetyBufferChars: 8,
});
assert.equal(end, -1, "safety buffer should wait");
const end2 = findNextCommitEnd("첫 문장입니다. 다음내용이충분히깁니다", {
  flushAll: false,
  safetyBufferChars: 8,
});
assert.ok(end2 > 0);

// --- Catch-up: final longer than progressive commit → suffix append only ---
{
  const units = [];
  const s = createSentenceCommitStream({
    onCommit: (u) => units.push(u),
    safetyBufferChars: 0,
  });
  const progressive =
    "영수증에서 확인된 내용입니다.\n\n| 항목 | 내용 |\n| 병원명 | 분당서울대학교병원 |\n";
  s.pushAnswerText(progressive);
  const before = s.getCommitted();
  assert.ok(before.length > 0);
  assert.ok(before.includes("분당서울대학교병원"));

  const full =
    "영수증에서 확인된 내용입니다.\n\n| 항목 | 내용 |\n| 병원명 | 분당서울대학교병원 |\n| 총액 | 123,000원 |\n\n추가로 궁금하시면 말씀해 주세요.";
  const cu = s.catchUpFinalAnswer(full);
  assert.equal(cu.appended, true);
  s.flush();
  const after = s.getCommitted();
  assert.equal(after.startsWith(before), true, "committed prefix preserved (no replace)");
  assert.ok(after.includes("123,000원"), "table last rows completed");
  assert.ok(after.includes("말씀해 주세요"), "closing sentence completed");
  assert.equal(after.includes(before + before), false, "no duplicated committed block");
  // Each committed unit appears once as contiguous prefix growth — count hospital row once
  assert.equal(
    (after.match(/분당서울대학교병원/g) || []).length,
    1,
    "no duplicate table row from catch-up",
  );
  assert.equal(s.didCatchUpAppend(), true);
  assert.equal(s.isAborted(), false);
}

// --- Catch-up identical final → no append, no replace ---
{
  const units = [];
  const s = createSentenceCommitStream({
    onCommit: (u) => units.push(u),
    safetyBufferChars: 0,
  });
  const full = "짧은 답입니다. 끝이에요.";
  s.pushAnswerText(full);
  s.flush();
  const snap = s.getCommitted();
  const cu = s.catchUpFinalAnswer(full);
  assert.equal(cu.appended, false);
  s.flush();
  assert.equal(s.getCommitted(), snap);
}

// --- Catch-up hard-lite on suffix: keep prior commits, block violation ---
{
  const units = [];
  const s = createSentenceCommitStream({
    onCommit: (u) => units.push(u),
    safetyBufferChars: 0,
  });
  s.pushAnswerText("먼저 현황을 볼게요. ");
  const before = s.getCommitted();
  const cu = s.catchUpFinalAnswer("먼저 현황을 볼게요. 지금 가입하세요. 끝.");
  s.flush();
  assert.equal(s.getCommitted().startsWith(before), true);
  assert.equal(s.getCommitted().includes("가입하세요"), false);
  assert.equal(s.isAborted(), true);
  assert.equal(s.getAbortReason(), "sentence_hard_lite");
  assert.ok(cu.appended === true || s.isAborted());
}

// Markdown table rows are committable units.
const tableEnd = findNextCommitEnd("| 병원명 | 분당서울대학교병원 |\n| 다음 |", {
  flushAll: false,
  safetyBufferChars: 0,
});
assert.ok(tableEnd > 0);

console.log("key-claude-first-sentence-commit-unit-test: PASS");
