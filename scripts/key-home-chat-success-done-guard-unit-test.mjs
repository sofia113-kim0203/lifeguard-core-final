/**
 * Red-error success-done guard — local unit tests (no network / Preview / LIVE).
 * Mirrors LifeguardHomeChat.jsx sawSuccessfulSseDone contract + source wiring.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CHAT_SRC = readFileSync(
  join(ROOT, "src/components/LifeguardHomeChat.jsx"),
  "utf8",
);
const HARD_ERROR = "질문에 답변하지 못했습니다.";

/** Exact decision table used by the repair (success-done only). */
function noteSuccessfulSseDone(payload, sawSuccessfulSseDone = false) {
  if (payload?.ok === true) return true;
  return sawSuccessfulSseDone === true;
}

function shouldSetHardQuestionFailedError(sawSuccessfulSseDone) {
  return sawSuccessfulSseDone !== true;
}

/**
 * Minimal send/catch simulation for T1–T6.
 * @param {{ events: Array<{ type: string, payload?: object, text?: string }> }} args
 */
function simulateTurn({ events }) {
  let sawSuccessfulSseDone = false;
  let painted = "";
  let hardError = null;
  let threw = false;

  for (const ev of events) {
    if (ev.type === "ack") {
      // ACK only — thinking placeholder; does not set success flag.
      continue;
    }
    if (ev.type === "delta") {
      painted += String(ev.text ?? "");
      continue;
    }
    if (ev.type === "done") {
      sawSuccessfulSseDone = noteSuccessfulSseDone(ev.payload, sawSuccessfulSseDone);
      continue;
    }
    if (ev.type === "throw") {
      threw = true;
      if (shouldSetHardQuestionFailedError(sawSuccessfulSseDone)) {
        hardError = HARD_ERROR;
      }
    }
  }

  return {
    sawSuccessfulSseDone,
    painted,
    hardError,
    threw,
    answerKept: Boolean(String(painted).trim()),
  };
}

function test(name, fn) {
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (err) {
    console.error(`FAIL ${name}`);
    console.error(err);
    process.exitCode = 1;
  }
}

// --- Source wiring (exact repair points) ---
test("WIRING declaration outside try near paint", () => {
  assert.match(
    CHAT_SRC,
    /let paint = null;\s*\n\s*\/\/ Success-done only[\s\S]*?let sawSuccessfulSseDone = false;\s*\n\s*try \{/,
  );
});

test("WIRING onDone sets flag only when payload.ok === true", () => {
  assert.match(
    CHAT_SRC,
    /onDone:\s*\(payload\)\s*=>\s*\{[\s\S]*?if \(payload\?\.ok === true\) \{\s*\n\s*sawSuccessfulSseDone = true;\s*\n\s*\}/,
  );
});

test("WIRING catch suppresses hard setError only on success-done", () => {
  assert.match(
    CHAT_SRC,
    /if \(sawSuccessfulSseDone !== true\) \{\s*\n\s*setError\(toCustomerErrorMessage\(err, "질문에 답변하지 못했습니다\."\)\);\s*\n\s*\}/,
  );
});

test("WIRING does not use hasPaintedAnswer / sawSseDone as success guard", () => {
  const guardIdx = CHAT_SRC.indexOf("if (sawSuccessfulSseDone !== true)");
  assert.ok(guardIdx >= 0, "success-done catch guard missing");
  const catchGuardWindow = CHAT_SRC.slice(guardIdx, guardIdx + 280);
  assert.match(
    catchGuardWindow,
    /setError\(toCustomerErrorMessage\(err, "질문에 답변하지 못했습니다\."\)\)/,
  );
  assert.equal(catchGuardWindow.includes("hasPaintedAnswer"), false);
  assert.equal(/\bsawSseDone\b/.test(catchGuardWindow), false);
});

// --- T1–T6 ---
test("T1 partial delta 후 throw → error 표시 유지", () => {
  const r = simulateTurn({
    events: [
      { type: "delta", text: "김진우님, 현재 확인된…" },
      { type: "throw" },
    ],
  });
  assert.equal(r.sawSuccessfulSseDone, false);
  assert.equal(r.answerKept, true);
  assert.equal(r.hardError, HARD_ERROR);
});

test("T2 done ok:false → error 표시 유지", () => {
  const r = simulateTurn({
    events: [
      { type: "delta", text: "부분 답변" },
      { type: "done", payload: { ok: false, answerText: "부분 답변" } },
      { type: "throw" },
    ],
  });
  assert.equal(r.sawSuccessfulSseDone, false);
  assert.equal(r.hardError, HARD_ERROR);
});

test("T3 done ok:true 후 후속 throw → KEY 본문 유지 + hard red error 억제", () => {
  const body =
    "김진우님, 현재 확인된 계약과 대화에서 말씀하신 관심 보장을 바탕으로 정리해드릴게요.";
  const r = simulateTurn({
    events: [
      { type: "delta", text: body },
      { type: "done", payload: { ok: true, answerText: body } },
      { type: "throw" },
    ],
  });
  assert.equal(r.sawSuccessfulSseDone, true);
  assert.equal(r.painted, body);
  assert.equal(r.answerKept, true);
  assert.equal(r.hardError, null);
});

test("T4 정상 done ok:true, throw 없음 → 기존 정상 동작", () => {
  const body = "정상 최종 답변입니다.";
  const r = simulateTurn({
    events: [
      { type: "delta", text: body },
      { type: "done", payload: { ok: true, answerText: body } },
    ],
  });
  assert.equal(r.sawSuccessfulSseDone, true);
  assert.equal(r.threw, false);
  assert.equal(r.hardError, null);
  assert.equal(r.painted, body);
});

test("T5 ACK only / partial answer → success flag false", () => {
  const ackOnly = simulateTurn({
    events: [{ type: "ack" }, { type: "throw" }],
  });
  assert.equal(ackOnly.sawSuccessfulSseDone, false);
  assert.equal(ackOnly.hardError, HARD_ERROR);

  const partial = simulateTurn({
    events: [
      { type: "ack" },
      { type: "delta", text: "한" },
      { type: "throw" },
    ],
  });
  assert.equal(partial.sawSuccessfulSseDone, false);
  assert.equal(partial.hardError, HARD_ERROR);
});

test("T6 기존 성공 답변 content 변경 없음", () => {
  const original =
    "이 계약에는 암 진단비, 뇌혈관 진단비, 심장 진단비 담보가 확인되지 않습니다.";
  const r = simulateTurn({
    events: [
      { type: "delta", text: original },
      { type: "done", payload: { ok: true, answerText: original } },
      { type: "throw" },
    ],
  });
  assert.equal(r.painted, original);
  assert.equal(r.hardError, null);
  // Guard must not rewrite customer text.
  assert.equal(
    noteSuccessfulSseDone({ ok: true, answerText: original + " MUTATED" }, false),
    true,
  );
  assert.equal(r.painted.includes("MUTATED"), false);
});

if (!process.exitCode) {
  console.log("ALL_PASS key-home-chat-success-done-guard");
}
