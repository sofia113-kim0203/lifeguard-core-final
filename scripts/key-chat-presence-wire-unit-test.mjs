import assert from "node:assert/strict";
import {
  buildKeyUploadChatPresenceContent,
  buildKeyUploadChatPresenceMessage,
} from "../src/lib/keyChatPresenceWire.js";

assert.equal(
  buildKeyUploadChatPresenceContent({
    keyFirstSentence: "보내주신 문서 잘 받았습니다.",
    keyFollowUpSentence: "특약·보장 상세는 이어서 말씀드리겠습니다.",
  }),
  "보내주신 문서 잘 받았습니다.\n\n특약·보장 상세는 이어서 말씀드리겠습니다.",
);

assert.equal(
  buildKeyUploadChatPresenceContent({ keyFirstSentence: "  KEY first  ", keyFollowUpSentence: "" }),
  "KEY first",
);

assert.equal(buildKeyUploadChatPresenceContent({}), null);

const message = buildKeyUploadChatPresenceMessage({ keyFirstSentence: "KEY only" });
assert.equal(message?.role, "assistant");
assert.equal(message?.content, "KEY only");
assert.equal(message?.keyPresence, true);
assert.equal(message?.keyPresenceSource, "document_upload");

console.log("key-chat-presence-wire-unit-test: PASS");
