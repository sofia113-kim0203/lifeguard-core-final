/**
 * Advisor KEY one-grapheme stream paint gates — no Preview/Claude.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  commonGraphemePrefixCount,
  createAgentStreamPaintController,
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
    drain(max = 10000) {
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

await test("wiring: one-grapheme paint + same markdown renderer", () => {
  assert.match(chat, /createAgentStreamPaintController/);
  assert.match(chat, /paint\.append\(chunk\)/);
  assert.match(chat, /await paint\.finalize\(/);
  assert.match(chat, /paint\.cancel\(\)/);
  assert.doesNotMatch(chat, /paint\.flush\(/);
  assert.doesNotMatch(chat, /streamLive/);
  assert.match(chat, /: msg\.thinking \? \(/);
  assert.match(chat, /<LifeguardAssistantMarkdown/);
  const agentBlock = chat.match(
    /if \(isAgentAudience\) \{[\s\S]*?return;\s*\}\s*\n\s*if \(chatAttachUploading\)/,
  );
  assert.ok(agentBlock);
  assert.match(agentBlock[0], /onDelta:\s*\(chunk\)\s*=>\s*\{\s*paint\.append\(chunk\);\s*\}/);
  assert.doesNotMatch(agentBlock[0], /splitKeyAnswerMeaningUnits/);
});

await test("grapheme segmentation: hangul + emoji", () => {
  const parts = segmentGraphemes("안녕👍가");
  assert.deepEqual(parts, ["안", "녕", "👍", "가"]);
  assert.equal(commonGraphemePrefixCount(["안", "녕"], ["안", "녕", "하"]), 2);
});

await test("first grapheme immediate; later exactly one per rAF", () => {
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
  assert.equal(paint.getAccumulated(), "안녕");
  assert.equal(paint.getPainted(), "안");
  assert.equal(clock.scheduled.length, 1);

  clock.tick();
  assert.equal(paints.length, 2);
  assert.equal(paints[1].text, "안녕");
  assert.equal(paints[1].text.length - paints[0].text.length, 1);
  // Caught up — no extra frame until more source arrives.
  assert.equal(clock.scheduled.length, 0);

  paint.append("하");
  assert.equal(clock.scheduled.length, 1);
  clock.tick();
  assert.equal(paints[paints.length - 1].text, "안녕하");
  // Each paint after the first adds exactly one grapheme.
  for (let i = 1; i < paints.length; i += 1) {
    const prev = segmentGraphemes(paints[i - 1].text);
    const cur = segmentGraphemes(paints[i].text);
    assert.equal(cur.length, prev.length + 1);
    assert.deepEqual(cur.slice(0, prev.length), prev);
  }
});

await test("done does not bulk flush; drains one grapheme/frame to server text", async () => {
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
  // Must NOT jump to full text immediately.
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
  // After first paint, each step +1 grapheme (finalize may repaint same prefix — allow equal).
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

await test("no drop / duplicate / reorder; append ignored after finalize", async () => {
  const paints = [];
  const clock = mockRaf();
  const paint = createAgentStreamPaintController({
    onPaint: (text) => paints.push(text),
    raf: clock.raf,
    caf: clock.caf,
  });
  paint.append("AB");
  paint.append("C");
  const p = paint.finalize("ABC");
  clock.drain();
  const finalText = await p;
  assert.equal(finalText, "ABC");
  assert.equal(paint.getAccumulated(), "ABC");
  paint.append("ZZ");
  assert.equal(paint.getAccumulated(), "ABC");
  assert.equal(paint.getPainted(), "ABC");
});

await test("cancel leaves partial; no bulk complete", () => {
  const paints = [];
  const clock = mockRaf();
  const paint = createAgentStreamPaintController({
    onPaint: (text) => paints.push(text),
    raf: clock.raf,
    caf: clock.caf,
  });
  paint.append("한글테스트");
  assert.equal(paint.getPainted(), "한");
  const left = paint.cancel();
  assert.equal(left, "한");
  assert.equal(clock.scheduled.length, 0);
  assert.notEqual(left, "한글테스트");
});

await test("no setTimeout char delay / no meaning-unit fake typing", () => {
  assert.doesNotMatch(paintSrc, /setTimeout\(\s*\(\)\s*=>\s*.*char/);
  assert.doesNotMatch(paintSrc, /splitKeyAnswerMeaningUnits/);
  assert.match(paintSrc, /one grapheme per|exactly one Unicode grapheme/i);
  assert.match(paintSrc, /no bulk flush/i);
});

console.log(`agent-key-chat-stream-paint-unit-test: PASS (${passed})`);
