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
  createCoalescedScrollToBottom,
  computeStickyFollowGlideStep,
  readChatMaxScroll,
  shouldAutoFollowChatScroll,
  shouldShowJumpToLatestAnswer,
  LIFEGUARD_CHAT_NEAR_BOTTOM_PX,
  LIFEGUARD_CHAT_GLIDE_MAX_STEP_PX,
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
    await runCase("jump-to-latest — only when scrolled away", () => {
      assert.equal(
        shouldShowJumpToLatestAnswer({ stickToBottom: false, nearBottom: false }),
        true,
      );
      assert.equal(
        shouldShowJumpToLatestAnswer({ stickToBottom: true, nearBottom: true }),
        false,
      );
      assert.equal(
        shouldShowJumpToLatestAnswer({ stickToBottom: false, nearBottom: true }),
        false,
      );
    })
  ) {
    passed += 1;
  } else failed += 1;

  if (
    await runCase("scrollChatContainerToBottom — writes maxScroll; skips within ±1px", () => {
      const el = { scrollTop: 0, scrollHeight: 2400, clientHeight: 400 };
      assert.equal(scrollChatContainerToBottom(el), true);
      assert.equal(el.scrollTop, 2000);
      assert.equal(scrollChatContainerToBottom(el), false);
      assert.equal(scrollChatContainerToBottom(null), false);
    })
  ) {
    passed += 1;
  } else failed += 1;

  if (
    await runCase("glide step — line wrap 20px does not jump full height on first frame", () => {
      assert.equal(LIFEGUARD_CHAT_GLIDE_MAX_STEP_PX, 6);
      const step = computeStickyFollowGlideStep(20);
      assert.ok(step > 0 && step <= 6);
      assert.equal(step, Math.min(6, Math.max(1, 20 * 0.35)));
      assert.equal(readChatMaxScroll({ scrollHeight: 1020, clientHeight: 200 }), 820);
    })
  ) {
    passed += 1;
  } else failed += 1;

  if (
    await runCase("glide follow — one loop; first frame <=6px; reaches maxScroll", () => {
      const ticks = [];
      const el = { scrollTop: 800, scrollHeight: 1020, clientHeight: 200 };
      let stick = true;
      let writes = 0;
      const tracked = {
        get scrollTop() {
          return el.scrollTop;
        },
        set scrollTop(v) {
          writes += 1;
          el.scrollTop = v;
        },
        get scrollHeight() {
          return el.scrollHeight;
        },
        set scrollHeight(v) {
          el.scrollHeight = v;
        },
        get clientHeight() {
          return el.clientHeight;
        },
      };
      const coalesced = createCoalescedScrollToBottom({
        raf: (cb) => {
          ticks.push(cb);
          return ticks.length;
        },
        caf: () => {
          ticks.length = 0;
        },
        shouldFollow: () => stick,
      });
      // Same-frame RO bursts: target refresh only — still one rAF.
      coalesced.schedule(tracked);
      coalesced.schedule(tracked);
      coalesced.schedule(tracked);
      assert.equal(ticks.length, 1);
      assert.equal(coalesced.pending, true);

      writes = 0;
      const before = el.scrollTop;
      ticks.shift()(0);
      const firstDelta = el.scrollTop - before;
      assert.equal(writes, 1);
      assert.ok(firstDelta > 0 && firstDelta <= 6, `first frame delta=${firstDelta}`);
      assert.ok(el.scrollTop < 820, "must not snap full 20px on first frame");

      // Mid-glide: new line grows maxScroll; same loop continues (one pending chain).
      el.scrollHeight = 1040;
      coalesced.schedule(tracked);
      assert.equal(ticks.length, 1);

      let prev = el.scrollTop;
      let frames = 0;
      while (ticks.length > 0 && frames < 80) {
        frames += 1;
        writes = 0;
        const cb = ticks.shift();
        cb(0);
        assert.ok(writes <= 1);
        assert.ok(el.scrollTop >= prev);
        prev = el.scrollTop;
      }
      assert.equal(el.scrollTop, 840);
      assert.equal(ticks.length, 0);
      assert.equal(coalesced.pending, false);

      el.scrollTop = 0;
      stick = false;
      coalesced.schedule(tracked);
      assert.equal(ticks.length, 0);
      assert.equal(el.scrollTop, 0);
    })
  ) {
    passed += 1;
  } else failed += 1;

  if (
    await runCase("glide follow — cancel stops writes; growth after cancel writes 0", () => {
      const ticks = [];
      let cancelledIds = 0;
      const el = { scrollTop: 0, scrollHeight: 1000, clientHeight: 200 };
      let stick = true;
      const coalesced = createCoalescedScrollToBottom({
        raf: (cb) => {
          ticks.push(cb);
          return 1;
        },
        caf: () => {
          cancelledIds += 1;
          ticks.length = 0;
        },
        shouldFollow: () => stick,
      });
      coalesced.schedule(el);
      assert.equal(coalesced.pending, true);
      coalesced.cancel();
      assert.equal(coalesced.pending, false);
      assert.equal(cancelledIds, 1);
      assert.equal(el.scrollTop, 0);

      stick = false;
      el.scrollHeight = 1200;
      coalesced.schedule(el);
      assert.equal(ticks.length, 0);
      assert.equal(el.scrollTop, 0);

      // Latest-answer resume
      stick = true;
      coalesced.schedule(el);
      assert.equal(ticks.length, 1);
      let guard = 0;
      while (ticks.length > 0 && guard < 200) {
        guard += 1;
        ticks.shift()(0);
      }
      assert.equal(el.scrollTop, 1000);
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
      assert.match(chatSource, /createAgentStreamPaintController/);
      assert.match(chatSource, /createCoalescedScrollToBottom/);
      assert.match(chatSource, /chatScrollContentRef/);
      assert.match(chatSource, /ro\.observe\(contentEl\)/);
      assert.match(chatSource, /coalescedScrollRef\.current\?\.cancel\(\)/);
      assert.match(chatSource, /finalizeInput/);
      assert.match(chatSource, /patchLastAssistantMessage\(liveMessages/);
      assert.match(chatSource, /sealedText\.startsWith\(paintedNow\)/);
      assert.match(chatSource, /aria-expanded=\{sidebarOpen\}/);
      assert.match(chatSource, /최신 답변으로 ↓/);
      assert.match(chatSource, /jumpToLatestAnswer/);
      assert.match(chatSource, /shouldShowJumpToLatestAnswer/);
      assert.match(chatSource, /onClick=\{jumpToLatestAnswer\}/);
      assert.match(
        chatSource,
        /jumpToLatestAnswer = useCallback\(\(\) => \{[\s\S]*?scrollChatContainerToBottom\(el/,
      );
      assert.match(
        chatSource,
        /jumpToLatestAnswer = useCallback\(\(\) => \{[\s\S]*?stickToBottomRef\.current = true/,
      );
      assert.doesNotMatch(
        chatSource,
        /jumpToLatestAnswer = useCallback\(\(\) => \{[\s\S]*?window\.scrollTo/,
      );
      assert.match(chatSource, /\[messages\.length,/);
      assert.doesNotMatch(chatSource, /}, \[messages, loading, streaming,/);
      assert.doesNotMatch(chatSource, /MutationObserver/);
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
