/**
 * Lifeguard chat scroll helpers — unit tests (no DOM / React).
 * Usage: node scripts/lifeguard-chat-scroll-unit-test.mjs
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  isScrollNearBottom,
  scrollChatContainerToBottom,
  shouldAutoFollowChatScroll,
  LIFEGUARD_CHAT_NEAR_BOTTOM_PX,
  resolveAppendOnlyAssistantText,
  splitKeyAnswerMeaningUnits,
  joinKeyAnswerMeaningUnits,
} from "../src/lib/lifeguardChatScroll.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

let passed = 0;
let failed = 0;

async function runCase(name, fn) {
  try {
    await fn();
    console.log(`PASS ${name}`);
    return true;
  } catch (err) {
    console.error(`FAIL ${name}`);
    console.error(err);
    return false;
  }
}

async function main() {
  console.log("lifeguard-chat-scroll-unit-test");

  if (
    await runCase("near-bottom — within threshold", () => {
      assert.equal(
        isScrollNearBottom({ scrollTop: 880, scrollHeight: 1000, clientHeight: 100 }, 120),
        true,
      );
      assert.equal(LIFEGUARD_CHAT_NEAR_BOTTOM_PX, 120);
    })
  ) {
    passed += 1;
  } else failed += 1;

  if (
    await runCase("near-bottom — scrolled up (not sticky)", () => {
      assert.equal(
        isScrollNearBottom({ scrollTop: 100, scrollHeight: 1000, clientHeight: 100 }, 120),
        false,
      );
    })
  ) {
    passed += 1;
  } else failed += 1;

  if (
    await runCase("auto-follow — restore force OR stick", () => {
      assert.equal(shouldAutoFollowChatScroll({ restoreForceOnce: true, stickToBottom: false }), true);
      assert.equal(shouldAutoFollowChatScroll({ restoreForceOnce: false, stickToBottom: true }), true);
      assert.equal(shouldAutoFollowChatScroll({ restoreForceOnce: false, stickToBottom: false }), false);
    })
  ) {
    passed += 1;
  } else failed += 1;

  if (
    await runCase("scrollChatContainerToBottom — sets scrollTop to scrollHeight", () => {
      const el = { scrollTop: 0, scrollHeight: 2400, clientHeight: 400 };
      assert.equal(scrollChatContainerToBottom(el), true);
      assert.equal(el.scrollTop, 2400);
      assert.equal(scrollChatContainerToBottom(null), false);
    })
  ) {
    passed += 1;
  } else failed += 1;

  if (
    await runCase("append-only — Claude original identity", () => {
      assert.equal(resolveAppendOnlyAssistantText("", "안녕."), "안녕.");
      assert.equal(resolveAppendOnlyAssistantText("안녕.", "안녕. 이어서."), "안녕. 이어서.");
      assert.equal(resolveAppendOnlyAssistantText("안녕.", "안녕."), "안녕.");

      const sample =
        "어제 수술 기준으로는 실손 청구를 준비해보는 게 맞습니다.\n\n- 진단서\n- 영수증\n\n진단코드는 C73입니다.";
      const units = splitKeyAnswerMeaningUnits(sample);
      assert.ok(units.length >= 2, "long answer splits into meaning units");
      assert.equal(joinKeyAnswerMeaningUnits(units), sample);

      let shown = "";
      for (const unit of units) {
        shown += unit;
      }
      assert.equal(shown, sample, "paced reveal concatenates to Claude original");
      assert.ok(shown.includes("C73"));
      assert.ok(shown.includes("영수증"));
    })
  ) {
    passed += 1;
  } else failed += 1;

  if (
    await runCase("chat UI — E display guards present", () => {
      const chatSource = readFileSync(join(ROOT, "src/components/LifeguardHomeChat.jsx"), "utf8");
      assert.match(chatSource, /KEY가 확인하고 있어요/);
      assert.match(chatSource, /onReplace:\s*\(\)\s*=>\s*\{\s*\}/);
      assert.match(chatSource, /splitKeyAnswerMeaningUnits/);
      assert.match(chatSource, /resolveAppendOnlyAssistantText/);
      assert.match(chatSource, /aria-expanded=\{sidebarOpen\}/);
      assert.doesNotMatch(chatSource, /sentenceHardLiteBlocks|sentence_hard_lite/);
      assert.doesNotMatch(chatSource, /createSentenceCommitStream/);
    })
  ) {
    passed += 1;
  } else failed += 1;

  console.log(`${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
