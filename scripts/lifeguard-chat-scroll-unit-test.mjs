/**
 * Lifeguard chat scroll helpers — unit tests (no DOM / React).
 * Usage: node scripts/lifeguard-chat-scroll-unit-test.mjs
 */
import assert from "node:assert/strict";
import {
  isScrollNearBottom,
  scrollChatContainerToBottom,
  shouldAutoFollowChatScroll,
  LIFEGUARD_CHAT_NEAR_BOTTOM_PX,
} from "../src/lib/lifeguardChatScroll.js";

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

  console.log(`${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
