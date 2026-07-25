/**
 * Advisor KEY natural stream paint gates — no Preview/Claude.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  AGENT_STREAM_MAX_EOJEOL,
  createAgentStreamPaintController,
  matchEojeol,
  takeNaturalStreamBatch,
} from "../src/lib/agentKeyChatStreamPaint.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

let passed = 0;
function test(name, fn) {
  const ret = fn();
  if (ret && typeof ret.then === "function") {
    return ret.then(() => {
      passed += 1;
      console.log(`  ok ${name}`);
    });
  }
  passed += 1;
  console.log(`  ok ${name}`);
  return undefined;
}

function mockClock() {
  const rafJobs = [];
  const waitJobs = [];
  let nextId = 1;
  return {
    rafJobs,
    waitJobs,
    raf: (cb) => {
      const id = nextId++;
      rafJobs.push({ id, cb });
      return id;
    },
    caf: (id) => {
      const i = rafJobs.findIndex((s) => s.id === id);
      if (i >= 0) rafJobs.splice(i, 1);
    },
    scheduleWait: (cb, ms) => {
      const id = nextId++;
      waitJobs.push({ id, cb, ms });
      return id;
    },
    cancelWait: (id) => {
      const i = waitJobs.findIndex((s) => s.id === id);
      if (i >= 0) waitJobs.splice(i, 1);
    },
    tickRaf() {
      const job = rafJobs.shift();
      if (!job) return false;
      job.cb(0);
      return true;
    },
    tickWait() {
      const job = waitJobs.shift();
      if (!job) return false;
      job.cb();
      return true;
    },
    drain(max = 10000) {
      let n = 0;
      while ((rafJobs.length || waitJobs.length) && n < max) {
        if (rafJobs.length) this.tickRaf();
        else this.tickWait();
        n += 1;
      }
      return n;
    },
  };
}

console.log("agent-key-chat-stream-paint-unit-test");

const chat = readFileSync(join(ROOT, "src/components/LifeguardHomeChat.jsx"), "utf8");
const paintSrc = readFileSync(join(ROOT, "src/lib/agentKeyChatStreamPaint.js"), "utf8");

await test("wiring: natural paint + same markdown + jump-to-latest", () => {
  assert.match(chat, /createAgentStreamPaintController/);
  assert.match(chat, /paint\.append\(chunk\)/);
  assert.match(chat, /await paint\.finalize\(/);
  assert.match(chat, /paint\.cancel\(\)/);
  assert.doesNotMatch(chat, /paint\.flush\(/);
  assert.doesNotMatch(chat, /streamLive/);
  assert.match(chat, /<LifeguardAssistantMarkdown/);
  assert.match(chat, /최신 답변으로 ↓/);
  assert.match(chat, /jumpToLatestAnswer/);
  assert.match(chat, /shouldShowJumpToLatestAnswer/);
  const agentBlock = chat.match(
    /if \(isAgentAudience\) \{[\s\S]*?return;\s*\}\s*\n\s*if \(chatAttachUploading\)/,
  );
  assert.ok(agentBlock);
  assert.match(agentBlock[0], /onDelta:\s*\(chunk\)\s*=>\s*\{\s*paint\.append\(chunk\);\s*\}/);
  assert.doesNotMatch(agentBlock[0], /splitKeyAnswerMeaningUnits/);
});

await test("one-char / grapheme mode removed", () => {
  assert.doesNotMatch(paintSrc, /one grapheme per/i);
  assert.doesNotMatch(paintSrc, /exactly one Unicode grapheme/i);
  assert.doesNotMatch(paintSrc, /segmentGraphemes/);
  assert.doesNotMatch(paintSrc, /paintedCount \+= 1/);
  assert.match(paintSrc, /takeNaturalStreamBatch/);
  assert.match(paintSrc, /no bulk flush/i);
});

await test("natural batch: eojol + punctuation boundary", () => {
  const words = "하나 둘 셋 넷 다섯 여섯";
  const batch = takeNaturalStreamBatch(words);
  const eojol = matchEojeol(batch);
  assert.ok(eojol.length >= 2 && eojol.length <= AGENT_STREAM_MAX_EOJEOL);
  assert.equal(words.startsWith(batch), true);

  const punct = takeNaturalStreamBatch("짧은 문장. 다음");
  assert.equal(punct, "짧은 문장. ");
  assert.equal(takeNaturalStreamBatch("줄\n다음"), "줄\n");
});

await test("first delta immediate short bundle; later short batches", () => {
  const paints = [];
  const clock = mockClock();
  const paint = createAgentStreamPaintController({
    onPaint: (text, meta) => paints.push({ text, ...meta }),
    raf: clock.raf,
    caf: clock.caf,
    scheduleWait: clock.scheduleWait,
    cancelWait: clock.cancelWait,
  });

  paint.append("암 진단비");
  assert.equal(paints.length, 1);
  assert.equal(paints[0].first, true);
  assert.ok(paints[0].text.length > 0);
  assert.equal(paint.getAccumulated().startsWith(paints[0].text), true);

  paint.append(" 는 확인이 필요합니다. 추가 설명입니다.");
  assert.ok(clock.rafJobs.length >= 1 || paint.getPainted().includes("확인"));
  clock.drain();
  assert.equal(paint.getPainted(), paint.getAccumulated());
  // Growth steps are short bundles — never +1 grapheme-only mode for multi-char Korean runs.
  for (let i = 1; i < paints.length; i += 1) {
    const prev = paints[i - 1].text;
    const cur = paints[i].text;
    assert.equal(cur.startsWith(prev), true);
    const added = cur.slice(prev.length);
    if (!added) continue;
    // A single-grapheme-only step is allowed only for tiny leftovers / punctuation — forbid long 1-char drip.
    if (added.length === 1 && /[가-힣]/.test(added)) {
      // Hangul single-char step after first paint is the old mode — fail if many consecutive.
      const next = paints[i + 1];
      if (next) {
        const nextAdded = next.text.slice(cur.length);
        assert.notEqual(
          nextAdded.length === 1 && /[가-힣]/.test(nextAdded),
          true,
          "must not drip hangul one grapheme per frame",
        );
      }
    }
  }
});

await test("backlog catch-up uses short batches; done does not bulk-dump large remainder", async () => {
  const paints = [];
  const clock = mockClock();
  const paint = createAgentStreamPaintController({
    onPaint: (text) => paints.push(text),
    raf: clock.raf,
    caf: clock.caf,
    scheduleWait: clock.scheduleWait,
    cancelWait: clock.cancelWait,
  });

  const full =
    "하나 둘 셋 넷 다섯 여섯 일곱 여덟 아홉 열 열하나 열둘 열셋 열넷 열다섯";
  paint.append(full.slice(0, 5));
  const first = paint.getPainted();
  assert.ok(first.length > 0);
  paint.append(full.slice(5));
  assert.ok(paint.getPainted().length < full.length || clock.rafJobs.length > 0);

  const pending = paint.finalize(full);
  // Must not jump to full text in the same tick when a large remainder exists.
  if (paint.getPainted() === full) {
    // Only OK if remainder was already small enough for small-buffer seal.
    assert.ok(full.length - first.length <= 48 || paints.length >= 2);
  } else {
    assert.notEqual(paint.getPainted(), full);
  }

  let resolved = null;
  pending.then((v) => {
    resolved = v;
  });
  clock.drain();
  await pending;
  assert.equal(resolved, full);
  assert.equal(paint.getPainted(), full);

  // No single step that appends a huge remainder after first paint.
  for (let i = 1; i < paints.length; i += 1) {
    const added = paints[i].slice(paints[i - 1].length);
    assert.ok(added.length <= 80, `batch too large: ${added.length}`);
  }
});

await test("no drop / duplicate / reorder; final text matches server", async () => {
  const clock = mockClock();
  const paint = createAgentStreamPaintController({
    onPaint: () => {},
    raf: clock.raf,
    caf: clock.caf,
    scheduleWait: clock.scheduleWait,
    cancelWait: clock.cancelWait,
  });
  paint.append("AB");
  paint.append("C 다음 문장입니다");
  const p = paint.finalize("ABC 다음 문장입니다");
  clock.drain();
  const finalText = await p;
  assert.equal(finalText, "ABC 다음 문장입니다");
  assert.equal(paint.getAccumulated(), "ABC 다음 문장입니다");
  paint.append("ZZ");
  assert.equal(paint.getAccumulated(), "ABC 다음 문장입니다");
});

await test("cancel leaves partial; max-wait can flush short incomplete bundle", () => {
  const paints = [];
  const clock = mockClock();
  const paint = createAgentStreamPaintController({
    onPaint: (text) => paints.push(text),
    raf: clock.raf,
    caf: clock.caf,
    scheduleWait: clock.scheduleWait,
    cancelWait: clock.cancelWait,
    maxWaitMs: 40,
  });
  paint.append("첫째");
  assert.ok(paint.hasPainted());
  paint.append("단어");
  // Incomplete second eojol cluster may arm max-wait.
  if (clock.waitJobs.length) {
    clock.tickWait();
  }
  clock.drain();
  const left = paint.cancel();
  assert.equal(left, paint.getPainted());
  assert.ok(left.length > 0);
});

await test("no meaning-unit fake typing / no streamLive swap", () => {
  assert.doesNotMatch(paintSrc, /splitKeyAnswerMeaningUnits/);
  assert.doesNotMatch(paintSrc, /streamLive/);
  assert.doesNotMatch(chat, /streamLive/);
});

console.log(`agent-key-chat-stream-paint-unit-test: PASS (${passed})`);
