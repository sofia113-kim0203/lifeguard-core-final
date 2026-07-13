import assert from "node:assert/strict";
import {
  isClaudeFirstDirectPreview,
  extractPartialCustomerAnswer,
  hardOnlySafetyCheck,
  buildSystemPrompt,
  selectReplacingHardReasons,
  finalizeClaudeFirstStreamContentBlocks,
  hasClientToolUse,
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
assert.match(prompt, /plain Korean text first/i);
assert.match(prompt, /warm/i);
assert.match(prompt, /emit_claude_full is only for optional visual_blocks/i);

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

// Server web_search blocks must keep native types (never rewrite to client tool_use).
const finalized = finalizeClaudeFirstStreamContentBlocks([
  { type: "text", text: "분당 맛집을 찾고 계시는군요!" },
  {
    type: "server_tool_use",
    id: "srvtoolu_test",
    name: "web_search",
    input_json: '{"query":"분당 맛집"}',
  },
  {
    type: "web_search_tool_result",
    tool_use_id: "srvtoolu_test",
    content: [{ type: "web_search_result", title: "A", url: "https://example.com" }],
  },
  {
    type: "tool_use",
    id: "toolu_client",
    name: "emit_claude_full",
    input_json: '{"customer_answer":"표입니다."}',
  },
]);
assert.equal(finalized[0].type, "text");
assert.equal(finalized[1].type, "server_tool_use");
assert.equal(finalized[1].name, "web_search");
assert.deepEqual(finalized[1].input, { query: "분당 맛집" });
assert.equal(Object.prototype.hasOwnProperty.call(finalized[1], "input_json"), false);
assert.equal(finalized[2].type, "web_search_tool_result");
assert.equal(finalized[2].tool_use_id, "srvtoolu_test");
assert.equal(finalized[3].type, "tool_use");
assert.equal(finalized[3].name, "emit_claude_full");
assert.deepEqual(finalized[3].input, { customer_answer: "표입니다." });

assert.equal(hasClientToolUse(finalized), true);
assert.equal(
  hasClientToolUse(finalized.filter((b) => b.type !== "tool_use")),
  false,
);
assert.equal(
  hasClientToolUse([
    { type: "server_tool_use", id: "s1", name: "web_search", input: { query: "x" } },
    { type: "web_search_tool_result", tool_use_id: "s1", content: [] },
  ]),
  false,
);

console.log("key-claude-first-direct-unit-test: PASS");
