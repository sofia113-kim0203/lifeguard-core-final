/**
 * WEB_SEARCH customer-speech block separation — structure only.
 * No network / Claude / language filters.
 */
import assert from "node:assert/strict";
import {
  joinCustomerSpeechTextFromContentBlocks,
  pickCustomerAnswer,
  selectCustomerSpeechTextPartsFromContentBlocks,
} from "../server/keyCore/keyClaudeFirstDirect.js";

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

const PLANNING =
  "I'll search for currently available insurance products that could complement the confirmed coverage from the customer's Hanwha policy.";
const FINAL_KO =
  "현재 확인된 계약 원본 기준으로 정리하고, 공개 검색으로 확인된 상품 후보를 말씀드릴게요.";
const INTERMEDIATE = "중간 검색 메모 — 고객 발화 아님";
const FINAL_WITH_CITE =
  "KB손해보험 암보험 후보입니다.[1] 공식 안내를 기준으로 말씀드립니다.";

test("1) web_search structure → final text only; planning exposure 0", () => {
  const content = [
    { type: "text", text: PLANNING },
    { type: "server_tool_use", id: "srv_1", name: "web_search", input: { query: "x" } },
    {
      type: "web_search_tool_result",
      tool_use_id: "srv_1",
      content: [{ type: "web_search_result", url: "https://example.com", title: "t" }],
    },
    { type: "text", text: FINAL_KO },
  ];
  const speech = joinCustomerSpeechTextFromContentBlocks(content);
  assert.equal(speech, FINAL_KO);
  assert.equal(speech.includes(PLANNING), false);
  assert.equal(speech.includes("I'll search"), false);

  const picked = pickCustomerAnswer({ content });
  assert.equal(picked.customer_answer, FINAL_KO);
  assert.equal(picked.source, "plain_text");
});

test("2) two searches → only text after last tool-related block", () => {
  const content = [
    { type: "text", text: "planning1" },
    { type: "server_tool_use", id: "srv_1", name: "web_search", input: {} },
    { type: "web_search_tool_result", tool_use_id: "srv_1", content: [] },
    { type: "text", text: INTERMEDIATE },
    { type: "server_tool_use", id: "srv_2", name: "web_search", input: {} },
    { type: "web_search_tool_result", tool_use_id: "srv_2", content: [] },
    { type: "text", text: FINAL_KO },
  ];
  const parts = selectCustomerSpeechTextPartsFromContentBlocks(content);
  assert.deepEqual(parts, [FINAL_KO]);
  assert.equal(joinCustomerSpeechTextFromContentBlocks(content), FINAL_KO);
  assert.equal(pickCustomerAnswer({ content }).customer_answer.includes(INTERMEDIATE), false);
  assert.equal(pickCustomerAnswer({ content }).customer_answer.includes("planning1"), false);
});

test("3) no-tool normal turn → all customer text preserved", () => {
  const content = [
    { type: "text", text: "안녕하세요." },
    { type: "text", text: "이어서 답변입니다." },
  ];
  assert.equal(
    joinCustomerSpeechTextFromContentBlocks(content),
    "안녕하세요.\n\n이어서 답변입니다.",
  );
  assert.equal(
    pickCustomerAnswer({ content }).customer_answer,
    "안녕하세요.\n\n이어서 답변입니다.",
  );
});

test("4) tools offered but no tool event → full text preserved", () => {
  const content = [{ type: "text", text: FINAL_KO }];
  assert.equal(joinCustomerSpeechTextFromContentBlocks(content), FINAL_KO);
  assert.equal(pickCustomerAnswer({ content }).customer_answer, FINAL_KO);
});

test("5) citations in final text → preserved as-is (no rewrite)", () => {
  const content = [
    { type: "text", text: PLANNING },
    { type: "server_tool_use", id: "srv_1", name: "web_search", input: {} },
    { type: "web_search_tool_result", tool_use_id: "srv_1", content: [] },
    { type: "text", text: FINAL_WITH_CITE },
  ];
  const speech = joinCustomerSpeechTextFromContentBlocks(content);
  assert.equal(speech, FINAL_WITH_CITE);
  assert.equal(speech.includes("[1]"), true);
  assert.equal(speech.includes(PLANNING), false);
});

test("selection ignores client tool_use alone (server-tool lane only)", () => {
  const content = [
    { type: "text", text: "before client tool" },
    { type: "tool_use", id: "tool_1", name: "record_x", input: {} },
    { type: "text", text: "after client tool" },
  ];
  // Client tool_use is not server-tool-related → keep all text (no false drop).
  assert.equal(
    joinCustomerSpeechTextFromContentBlocks(content),
    "before client tool\n\nafter client tool",
  );
});

console.log(
  process.exitCode
    ? "key-web-search-customer-speech-separation-unit-test FAILED"
    : "key-web-search-customer-speech-separation-unit-test OK",
);
