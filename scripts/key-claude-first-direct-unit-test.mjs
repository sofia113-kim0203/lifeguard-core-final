import assert from "node:assert/strict";
import {
  isClaudeFirstDirectPreview,
  extractPartialCustomerAnswer,
  hardOnlySafetyCheck,
  buildSystemPrompt,
  selectReplacingHardReasons,
} from "../server/keyCore/keyClaudeFirstDirect.js";

assert.equal(
  isClaudeFirstDirectPreview({ VERCEL_ENV: "preview", KEY_BORROWED_SENSES: "shadow" }),
  true,
);
assert.equal(
  isClaudeFirstDirectPreview({ VERCEL_ENV: "production", KEY_BORROWED_SENSES: "shadow" }),
  false,
);
assert.equal(
  isClaudeFirstDirectPreview({
    VERCEL_ENV: "preview",
    KEY_BORROWED_SENSES: "shadow",
    KEY_CLAUDE_FIRST_DIRECT: "0",
  }),
  false,
);

const p = extractPartialCustomerAnswer('{"customer_answer":"안녕');
assert.equal(p.text, "안녕");
assert.equal(p.complete, false);
const p2 = extractPartialCustomerAnswer('{"customer_answer":"안녕"}');
assert.equal(p2.text, "안녕");
assert.equal(p2.complete, true);

const soft = hardOnlySafetyCheck("확인된 22건 기준으로 같이 보면 좋겠어요.", {
  allowed_numbers: ["22", "21", "1"],
  allowed_entities: ["삼성생명"],
});
assert.equal(soft.hard_fail, false);

const hard = hardOnlySafetyCheck("지금 가입하세요. 해지해도 됩니다.", {
  allowed_numbers: ["22"],
  allowed_entities: ["삼성생명"],
});
assert.equal(hard.hard_fail, true);

const prompt = buildSystemPrompt();
assert.match(prompt, /No emoji/i);
assert.match(prompt, /cite/i);
assert.match(prompt, /Clean readable Korean/i);
assert.match(prompt, /Tone \(required\)/i);
assert.match(prompt, /visual_blocks/i);
assert.match(prompt, /warm/i);

// Monopoly A: definitive-only wording must not monopoly-replace.
const definitiveOnly = selectReplacingHardReasons(
  ["recommendation_or_termination"],
  "확인된 범위에서는 큰 문제는 없어 보여요. 증권으로 한 번 더 같이 보면 좋겠어요.",
);
assert.deepEqual(definitiveOnly, []);

// Monopoly A: real enroll push still replaces.
const enrollReplace = selectReplacingHardReasons(
  ["recommendation_or_termination"],
  "지금 가입하세요. 특약을 바로 추가하시는 게 좋아요.",
);
assert.equal(enrollReplace.includes("recommendation_or_termination"), true);

console.log("key-claude-first-direct-unit-test: PASS");
