import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { prepareAssistantChatText } from "../src/lib/lifeguardChatMarkdownCore.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const mdSrc = readFileSync(join(ROOT, "src/lib/lifeguardChatMarkdown.jsx"), "utf8");

const cleaned = prepareAssistantChatText(
  '안녕 😊\n<cite index="1-1">본문</cite>\n\n\n다음',
);
assert.equal(cleaned.includes("😊"), false);
assert.equal(cleaned.includes("<cite"), false);
assert.equal(cleaned.includes("본문"), true);
assert.equal(cleaned.includes("다음"), true);
assert.equal(/\n{3,}/.test(cleaned), false);

assert.match(mdSrc, /import \{ memo \} from "react"/);
assert.match(mdSrc, /memo\(/);
assert.match(mdSrc, /export function parseAssistantMarkdownBlocks/);
assert.match(mdSrc, /StableMarkdownBlock/);
assert.match(mdSrc, /key=\{`\$\{block\.type\}-\$\{block\.start\}`\}/);
assert.match(mdSrc, /prev\.contentKey === next\.contentKey/);
assert.doesNotMatch(mdSrc, /key=\{`p-\$\{key\+\+\}`\}/);
assert.doesNotMatch(mdSrc, /key=\{`table-\$\{key\+\+\}`\}/);
assert.doesNotMatch(mdSrc, /let key = 0/);

console.log("lifeguard-chat-markdown-unit-test: PASS");
