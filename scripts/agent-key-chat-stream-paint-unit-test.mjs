/**
 * Shared KEY one-grapheme stream paint gates — customer + advisor. No Preview/Claude.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  STREAM_BACKLOG_RESTORE_BREATH,
  STREAM_BACKLOG_SKIP_BREATH,
  commonGraphemePrefixCount,
  createAgentStreamPaintController,
  punctuationBreathFrames,
  segmentGraphemes,
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

function mockRaf() {
  const scheduled = [];
  let nextId = 1;
  return {
    scheduled,
    raf: (cb) => {
      const id = nextId++;
      scheduled.push({ id, cb });
      return id;
    },
    caf: (id) => {
      const i = scheduled.findIndex((s) => s.id === id);
      if (i >= 0) scheduled.splice(i, 1);
    },
    tick() {
      const job = scheduled.shift();
      if (!job) return false;
      job.cb(0);
      return true;
    },
    drain(max = 20000) {
      let n = 0;
      while (scheduled.length && n < max) {
        this.tick();
        n += 1;
      }
      return n;
    },
  };
}

console.log("agent-key-chat-stream-paint-unit-test");

const chat = readFileSync(join(ROOT, "src/components/LifeguardHomeChat.jsx"), "utf8");
const paintSrc = readFileSync(join(ROOT, "src/lib/agentKeyChatStreamPaint.js"), "utf8");

await test("wiring: customer + agent share same paint controller", () => {
  assert.match(chat, /createAgentStreamPaintController/);
  assert.doesNotMatch(chat, /streamLive/);
  assert.match(chat, /<LifeguardAssistantMarkdown/);

  const agentBlock = chat.match(
    /if \(isAgentAudience\) \{[\s\S]*?return;\s*\}\s*\n\s*if \(chatAttachUploading\)/,
  );
  assert.ok(agentBlock);
  assert.match(agentBlock[0], /paint\.append\(chunk\)/);
  assert.match(agentBlock[0], /await paint\.finalize\(/);
  assert.doesNotMatch(agentBlock[0], /splitKeyAnswerMeaningUnits/);
  assert.doesNotMatch(agentBlock[0], /takeNaturalStreamBatch/);

  assert.match(chat, /onDelta:\s*\(chunk\)\s*=>\s*\{\s*markFirstSse\(\);\s*paint\.append\(chunk\);\s*\}/);
  assert.match(chat, /await paint\.finalize\(finalText\)/);
  assert.doesNotMatch(chat, /splitKeyAnswerMeaningUnits/);
  assert.doesNotMatch(paintSrc, /takeNaturalStreamBatch/);
  assert.doesNotMatch(paintSrc, /AGENT_STREAM_MIN_EOJEOL/);
});

await test("grapheme segmentation: hangul + emoji", () => {
  const parts = segmentGraphemes("안녕👍가");
  assert.deepEqual(parts, ["안", "녕", "👍", "가"]);
  assert.equal(commonGraphemePrefixCount(["안", "녕"], ["안", "녕", "하"]), 2);
});

await test("punctuation breath frames", () => {
  assert.equal(punctuationBreathFrames(",", false), 1);
  assert.equal(punctuationBreathFrames("：", false), 1);
  assert.equal(punctuationBreathFrames(".", false), 2);
  assert.equal(punctuationBreathFrames("\n", false), 2);
  assert.equal(punctuationBreathFrames("가", false), 0);
  assert.equal(punctuationBreathFrames(".", true), 0);
  assert.equal(STREAM_BACKLOG_SKIP_BREATH, 120);
  assert.equal(STREAM_BACKLOG_RESTORE_BREATH, 60);
});

await test("first grapheme immediate; later exactly one per paint", () => {
  const paints = [];
  const clock = mockRaf();
  const paint = createAgentStreamPaintController({
    onPaint: (text, meta) => paints.push({ text, ...meta }),
    raf: clock.raf,
    caf: clock.caf,
  });

  paint.append("안녕");
  assert.equal(paints.length, 1);
  assert.equal(paints[0].text, "안");
  assert.equal(paints[0].first, true);
  assert.equal(paint.getPainted(), "안");
  assert.equal(clock.scheduled.length, 1);

  clock.tick();
  assert.equal(paints[1].text, "안녕");
  for (let i = 1; i < paints.length; i += 1) {
    const prev = segmentGraphemes(paints[i - 1].text);
    const cur = segmentGraphemes(paints[i].text);
    assert.equal(cur.length, prev.length + 1);
    assert.deepEqual(cur.slice(0, prev.length), prev);
  }
});

await test("comma breath +1 frame; sentence end +2 frames", () => {
  const paints = [];
  const clock = mockRaf();
  const paint = createAgentStreamPaintController({
    onPaint: (text) => paints.push(text),
    raf: clock.raf,
    caf: clock.caf,
  });

  paint.append("가,나");
  assert.equal(paint.getPainted(), "가");
  clock.tick(); // paints ","
  assert.equal(paint.getPainted(), "가,");
  const afterComma = paints.length;
  clock.tick(); // breath idle — no new grapheme
  assert.equal(paints.length, afterComma);
  assert.equal(paint.getPainted(), "가,");
  clock.tick(); // paints "나"
  assert.equal(paint.getPainted(), "가,나");

  const paints2 = [];
  const clock2 = mockRaf();
  const paint2 = createAgentStreamPaintController({
    onPaint: (text) => paints2.push(text),
    raf: clock2.raf,
    caf: clock2.caf,
  });
  paint2.append("다.");
  assert.equal(paint2.getPainted(), "다");
  clock2.tick(); // "."
  assert.equal(paint2.getPainted(), "다.");
  const n = paints2.length;
  clock2.tick(); // idle 1
  assert.equal(paints2.length, n);
  clock2.tick(); // idle 2
  assert.equal(paints2.length, n);
});

await test("backlog >=120 skips breath only; still one grapheme/paint", () => {
  const paints = [];
  const clock = mockRaf();
  const paint = createAgentStreamPaintController({
    onPaint: (text) => paints.push(text),
    raf: clock.raf,
    caf: clock.caf,
  });
  // Period while waiting queue still ≥120 so breath is skipped.
  const body = `${"가".repeat(10)}.${"나".repeat(120)}`;
  paint.append(body);
  assert.equal(paint.getPainted(), "가");
  let sawPeriod = false;
  for (let i = 0; i < 400 && clock.scheduled.length; i += 1) {
    const before = paint.getPainted();
    clock.tick();
    const after = paint.getPainted();
    if (after.length === before.length) {
      if (sawPeriod) assert.fail("idle breath must be skipped under backlog");
      continue;
    }
    const added = after.slice(before.length);
    assert.equal(segmentGraphemes(added).length, 1);
    if (added === ".") {
      sawPeriod = true;
      const n = paints.length;
      clock.tick();
      assert.equal(paints.length, n + 1, "next grapheme must paint without breath idle");
      assert.equal(paint.getPainted().endsWith(".나"), true);
      break;
    }
  }
  assert.equal(sawPeriod, true);
  clock.drain();
  assert.equal(paint.getPainted(), body);
});

await test("done does not bulk flush; drains one grapheme to server text", async () => {
  const paints = [];
  const clock = mockRaf();
  const paint = createAgentStreamPaintController({
    onPaint: (text) => paints.push(text),
    raf: clock.raf,
    caf: clock.caf,
  });

  paint.append("가나다라");
  assert.equal(paint.getPainted(), "가");
  const pending = paint.finalize("가나다라");
  assert.equal(paint.getPainted(), "가");
  assert.notEqual(paints[paints.length - 1], "가나다라");

  let resolved = null;
  pending.then((v) => {
    resolved = v;
  });
  while (resolved == null && clock.scheduled.length) {
    clock.tick();
  }
  await pending;
  assert.equal(resolved, "가나다라");
  assert.equal(paint.getPainted(), "가나다라");

  const uniqueGrowth = [];
  for (const t of paints) {
    if (uniqueGrowth.length === 0 || uniqueGrowth[uniqueGrowth.length - 1] !== t) {
      uniqueGrowth.push(t);
    }
  }
  for (let i = 1; i < uniqueGrowth.length; i += 1) {
    const prev = segmentGraphemes(uniqueGrowth[i - 1]);
    const cur = segmentGraphemes(uniqueGrowth[i]);
    assert.equal(cur.length, prev.length + 1);
  }
});

await test("no drop / duplicate / reorder; final text match; append ignored after finalize", async () => {
  const clock = mockRaf();
  const paint = createAgentStreamPaintController({
    onPaint: () => {},
    raf: clock.raf,
    caf: clock.caf,
  });
  paint.append("AB");
  paint.append("C");
  const p = paint.finalize("ABC");
  clock.drain();
  const finalText = await p;
  assert.equal(finalText, "ABC");
  paint.append("ZZ");
  assert.equal(paint.getAccumulated(), "ABC");
  assert.equal(paint.getPainted(), "ABC");
});

await test("cancel leaves partial; no bulk complete", () => {
  const clock = mockRaf();
  const paint = createAgentStreamPaintController({
    onPaint: () => {},
    raf: clock.raf,
    caf: clock.caf,
  });
  paint.append("한글테스트");
  assert.equal(paint.getPainted(), "한");
  const left = paint.cancel();
  assert.equal(left, "한");
  assert.equal(clock.scheduled.length, 0);
});

await test("no eojol batch / no setInterval typing / no meaning-unit fake typing", () => {
  assert.doesNotMatch(paintSrc, /takeNaturalStreamBatch/);
  assert.doesNotMatch(paintSrc, /setInterval/);
  assert.doesNotMatch(paintSrc, /splitKeyAnswerMeaningUnits/);
  assert.match(paintSrc, /exactly one Unicode grapheme/i);
  assert.match(paintSrc, /no bulk flush/i);
});

console.log(`agent-key-chat-stream-paint-unit-test: PASS (${passed})`);
