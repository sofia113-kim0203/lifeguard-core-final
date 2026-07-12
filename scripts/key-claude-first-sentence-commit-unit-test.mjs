import assert from "node:assert/strict";
import {
  createSentenceCommitStream,
  findNextCommitEnd,
  sentenceHardLiteBlocks,
  SENTENCE_COMMIT_ABORT_CLOSER,
} from "../server/keyCore/keyClaudeFirstSentenceCommit.js";

assert.equal(sentenceHardLiteBlocks("지금 가입하세요."), true);
assert.equal(sentenceHardLiteBlocks("확인된 22건을 같이 보면 좋겠어요."), false);

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

console.log("key-claude-first-sentence-commit-unit-test: PASS");
