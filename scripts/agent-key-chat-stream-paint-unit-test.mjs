/**
 * Advisor KEY stream paint smoothness gates — no Preview/Claude.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createAgentStreamPaintController } from "../src/lib/agentKeyChatStreamPaint.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
  console.log(`  ok ${name}`);
}

console.log("agent-key-chat-stream-paint-unit-test");

const chat = readFileSync(join(ROOT, "src/components/LifeguardHomeChat.jsx"), "utf8");
const paintSrc = readFileSync(join(ROOT, "src/lib/agentKeyChatStreamPaint.js"), "utf8");

test("wiring: agent path uses paint controller + streamLive plain text", () => {
  assert.match(chat, /createAgentStreamPaintController/);
  assert.match(chat, /paint\.append\(chunk\)/);
  assert.match(chat, /paint\.flush\(\)/);
  assert.match(chat, /paint\.finalize\(/);
  assert.match(chat, /streamLive:\s*true/);
  assert.match(chat, /streamLive:\s*false/);
  assert.match(chat, /msg\.thinking \|\| msg\.streamLive/);
  // No per-delta setMessages in onDelta body.
  const agentBlock = chat.match(
    /if \(isAgentAudience\) \{[\s\S]*?return;\s*\}\s*\n\s*if \(chatAttachUploading\)/,
  );
  assert.ok(agentBlock);
  assert.match(agentBlock[0], /onDelta:\s*\(chunk\)\s*=>\s*\{\s*paint\.append\(chunk\);\s*\}/);
  assert.doesNotMatch(agentBlock[0], /splitKeyAnswerMeaningUnits/);
});

test("first delta paints immediately; later deltas batch via raf", () => {
  const paints = [];
  const scheduled = [];
  let nextId = 1;
  const paint = createAgentStreamPaintController({
    onPaint: (text, meta) => paints.push({ text, ...meta }),
    raf: (cb) => {
      const id = nextId++;
      scheduled.push({ id, cb });
      return id;
    },
    caf: (id) => {
      const i = scheduled.findIndex((s) => s.id === id);
      if (i >= 0) scheduled.splice(i, 1);
    },
  });

  paint.append("안");
  assert.equal(paints.length, 1);
  assert.equal(paints[0].text, "안");
  assert.equal(paints[0].first, true);
  assert.equal(scheduled.length, 0);

  paint.append("녕");
  paint.append("하");
  assert.equal(paints.length, 1);
  assert.equal(paint.getAccumulated(), "안녕하");
  assert.equal(scheduled.length, 1);

  scheduled[0].cb(0);
  assert.equal(paints.length, 2);
  assert.equal(paints[1].text, "안녕하");
  assert.equal(paints[1].first, false);
});

test("no drop / no duplicate / order preserved; finalize seals server text", () => {
  const paints = [];
  const scheduled = [];
  let nextId = 1;
  const paint = createAgentStreamPaintController({
    onPaint: (text) => paints.push(text),
    raf: (cb) => {
      const id = nextId++;
      scheduled.push({ id, cb });
      return id;
    },
    caf: (id) => {
      const i = scheduled.findIndex((s) => s.id === id);
      if (i >= 0) scheduled.splice(i, 1);
    },
  });

  paint.append("가");
  paint.append("나");
  paint.append("다");
  assert.equal(paint.getAccumulated(), "가나다");
  paint.flush();
  assert.equal(paints[paints.length - 1], "가나다");

  const sealed = paint.finalize("가나다라");
  assert.equal(sealed, "가나다라");
  assert.equal(paints[paints.length - 1], "가나다라");
  assert.equal(paint.getAccumulated(), "가나다라");

  // Further append ignored after finalize.
  paint.append("무시");
  assert.equal(paint.getAccumulated(), "가나다라");
});

test("done flush cancels pending raf before seal", () => {
  const paints = [];
  const scheduled = [];
  let nextId = 1;
  let cancelled = 0;
  const paint = createAgentStreamPaintController({
    onPaint: (text) => paints.push(text),
    raf: (cb) => {
      const id = nextId++;
      scheduled.push({ id, cb });
      return id;
    },
    caf: (id) => {
      cancelled += 1;
      const i = scheduled.findIndex((s) => s.id === id);
      if (i >= 0) scheduled.splice(i, 1);
    },
  });
  paint.append("A");
  paint.append("B");
  assert.equal(scheduled.length, 1);
  paint.flush();
  assert.ok(cancelled >= 1);
  assert.equal(scheduled.length, 0);
  assert.equal(paints[paints.length - 1], "AB");
  paint.finalize("AB");
  assert.equal(paints[paints.length - 1], "AB");
});

test("no fake typing / no second Claude in paint helper", () => {
  assert.doesNotMatch(paintSrc, /setTimeout\(\s*\(\)\s*=>\s*.*char/);
  assert.doesNotMatch(paintSrc, /splitKeyAnswerMeaningUnits/);
  assert.match(paintSrc, /First delta paints immediately|never delay/i);
});

console.log(`agent-key-chat-stream-paint-unit-test: PASS (${passed})`);
