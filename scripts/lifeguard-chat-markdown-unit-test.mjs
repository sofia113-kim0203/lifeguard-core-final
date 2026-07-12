import assert from "node:assert/strict";
import { prepareAssistantChatText } from "../src/lib/lifeguardChatMarkdownCore.js";

const cleaned = prepareAssistantChatText(
  '안녕 😊\n<cite index="1-1">본문</cite>\n\n\n다음',
);
assert.equal(cleaned.includes("😊"), false);
assert.equal(cleaned.includes("<cite"), false);
assert.equal(cleaned.includes("본문"), true);
assert.equal(cleaned.includes("다음"), true);
assert.equal(/\n{3,}/.test(cleaned), false);

console.log("lifeguard-chat-markdown-unit-test: PASS");
