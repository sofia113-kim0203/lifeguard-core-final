/**
 * P4-UI POLISH — consultation transcript UI + emoji guard unit tests.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import {
  applyLifeguardCustomerOutputGuard,
  polishLifeguardCustomerText,
  stripCustomerFacingEmojis,
  stripLifeguardSpeakerPrefix,
} from "../server/lifeguardOutputGuard.js";
import { LG } from "../src/lib/lifeguardCustomerTheme.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

async function runCase(name, fn) {
  try {
    await fn();
    console.log(`PASS ${name}`);
    return true;
  } catch (error) {
    console.log(`FAIL ${name}: ${error instanceof Error ? error.message : String(error)}`);
    return false;
  }
}

async function main() {
  console.log("p4-ui-polish-unit-test");
  let passed = 0;
  let failed = 0;

  if (
    await runCase("T1 emoji strip — common emoticons removed", () => {
      assert.equal(stripCustomerFacingEmojis("안녕하세요 😊"), "안녕하세요");
      assert.equal(stripCustomerFacingEmojis("좋아요 👍 ✨"), "좋아요");
      assert.doesNotMatch(polishLifeguardCustomerText("LIFEGUARD: 😄 테스트"), /😄|LIFEGUARD\s*:/i);
    })
  ) {
    passed += 1;
  } else failed += 1;

  if (
    await runCase("T2 speaker prefix — LIFEGUARD: removed", () => {
      assert.equal(stripLifeguardSpeakerPrefix("LIFEGUARD: 보험료가 부담되시나요?"), "보험료가 부담되시나요?");
      assert.equal(applyLifeguardCustomerOutputGuard("LIFEGUARD: 안내드립니다"), "안내드립니다");
    })
  ) {
    passed += 1;
  } else failed += 1;

  if (
    await runCase("T3 chat UI — no message bubbles (consultation transcript)", () => {
      const chat = readFileSync(join(ROOT, "src/components/LifeguardHomeChat.jsx"), "utf8");
      assert.doesNotMatch(chat, /userBubble|assistantBubble/);
      assert.doesNotMatch(chat, /borderRadius:\s*"18px"/);
      assert.match(chat, /textAlign: msg\.role === "user" \? "right" : "left"/);
      assert.match(chat, /lineHeight: 1\.75/);
      assert.match(chat, /color: LG\.text/);
      assert.doesNotMatch(chat, /📎/);
    })
  ) {
    passed += 1;
  } else failed += 1;

  if (
    await runCase("T4 prompts — no emoji instruction in lifeguard chat core", () => {
      const core = readFileSync(join(ROOT, "server/lifeguardChatCore.js"), "utf8");
      const casual = readFileSync(join(ROOT, "server/casualChatResponseCore.js"), "utf8");
      assert.match(core, /Never use emojis/);
      assert.match(core, /Never prefix replies with/);
      assert.match(casual, /Never use emojis/);
    })
  ) {
    passed += 1;
  } else failed += 1;

  if (
    await runCase("T5 theme unchanged — ivory background preserved", () => {
      assert.equal(LG.bg, "#FAFAF8");
      assert.equal(LG.text, "#111111");
      assert.equal(LG.textMuted, "#666666");
      const auth = readFileSync(join(ROOT, "src/components/AuthPanel.jsx"), "utf8");
      assert.match(auth, /당신의 보험 파트너/);
    })
  ) {
    passed += 1;
  } else failed += 1;

  if (
    await runCase("T6 documents panel — listDocuments wired read-only", () => {
      const chat = readFileSync(join(ROOT, "src/components/LifeguardHomeChat.jsx"), "utf8");
      assert.match(chat, /listDocuments\(authUser/);
      assert.match(chat, /CustomerDocumentsList/);
      assert.match(chat, /formatDocClass\(document\.doc_class\)/);
      assert.match(chat, /formatOcrStatus\(document\)/);
      assert.match(chat, /formatAnalysisComplete\(document\)/);
      assert.match(chat, /아직 업로드된 문서가 없어요/);
      assert.doesNotMatch(chat, /업로드된 문서가 있어요\. 대화에서/);
    })
  ) {
    passed += 1;
  } else failed += 1;

  if (
    await runCase("T7 chat focus — two-stage refocus after navigation and send", () => {
      const chat = readFileSync(join(ROOT, "src/components/LifeguardHomeChat.jsx"), "utf8");
      const textareaBlock = chat.match(/<textarea[\s\S]*?\/>/)?.[0] ?? "";
      assert.match(chat, /requestAnimationFrame/);
      assert.match(chat, /window\.setTimeout/);
      assert.match(chat, /goBackToChat/);
      assert.match(chat, /focusChatInput\(\)/);
      assert.match(chat, /ref=\{inputRef\}/);
      assert.match(textareaBlock, /disabled=\{isDisabled\}/);
      assert.doesNotMatch(textareaBlock, /loading/);
      assert.match(chat, /e\.shiftKey/);
    })
  ) {
    passed += 1;
  } else failed += 1;

  console.log(`${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
