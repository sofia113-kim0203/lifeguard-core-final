/**
 * Human Gate Repair A / A2 — absence-certainty Gate unit tests.
 * Classifier + pre-emit sentence veto (no network / Claude / Preview).
 */
import assert from "node:assert/strict";
import {
  collectVerifiedNegativeCoverageEvidence,
  evaluateAbsenceCertaintyGate,
  shouldEmitAbsenceCertaintySlice,
} from "../server/keyCore/keyAbsenceCertaintyGate.js";
import { hardOnlySafetyCheck } from "../server/keyCore/keyClaudeFirstDirect.js";
import { createImmediateAnswerDeltaStream } from "../server/keyCore/keyClaudeFirstSentenceCommit.js";

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

function assertBlock(text, evidence = []) {
  const g = evaluateAbsenceCertaintyGate({
    text,
    verifiedNegativeEvidence: evidence,
  });
  assert.equal(g.ok, false, `expected BLOCK for: ${text}`);
  assert.equal(g.reason, "unverified_customer_coverage_claim");
  const hard = hardOnlySafetyCheck(text, {
    verifiedNegativeEvidence: evidence,
  });
  assert.equal(hard.hard_fail, true);
  assert.ok(hard.hard.includes("unverified_customer_coverage_claim"));
}

function assertPass(text, evidence = []) {
  const g = evaluateAbsenceCertaintyGate({
    text,
    verifiedNegativeEvidence: evidence,
  });
  assert.equal(g.ok, true, `expected PASS for: ${text}`);
  const hard = hardOnlySafetyCheck(text, {
    verifiedNegativeEvidence: evidence,
  });
  assert.equal(
    hard.hard.includes("unverified_customer_coverage_claim"),
    false,
    `absence reason must not hard-fail: ${text}`,
  );
}

function makeVetoStream(evidence = []) {
  const emitted = [];
  const stream = createImmediateAnswerDeltaStream({
    shouldEmitSlice(slice) {
      return shouldEmitAbsenceCertaintySlice(slice, evidence);
    },
    onCommit(slice) {
      emitted.push(slice);
      return { keep: true };
    },
  });
  return {
    stream,
    emitted,
    customerText() {
      return emitted.join("");
    },
  };
}

function pushCumulative(stream, parts) {
  let acc = "";
  for (const part of parts) {
    acc += part;
    stream.pushAnswerText(acc);
  }
}

// --- Repair A classifier (regression) ---

test("1) verified negative 없음 + 진단비가 없습니다 → BLOCK", () => {
  assertBlock("암 진단비가 없습니다.");
});

test("2) verified negative 없음 + 포함돼 있지 않습니다 → BLOCK", () => {
  assertBlock(
    "이 계약에는 암 진단비, 뇌혈관 진단비 등 진단형 보장이 포함돼 있지 않습니다.",
  );
});

test("3) verified negative 없음 + 보장받을 수 없습니다 → BLOCK", () => {
  assertBlock("고객님 계약으로 뇌혈관 진단비를 보장받을 수 없습니다.");
});

test("4) verified negative 있음 + 진단비가 없습니다 → PASS", () => {
  const evidence = collectVerifiedNegativeCoverageEvidence({
    coverages: [
      {
        coverage_name: "암진단비",
        status: "verified_absent",
        verified_absent: true,
      },
    ],
  });
  assert.ok(evidence.length >= 1);
  assertPass("이 계약에는 암 진단비가 없습니다.", evidence);
});

test("5) 정보 없음 + 현재 자료에서는 확인되지 않습니다 → PASS", () => {
  assertPass(
    "현재 자료에서는 암 진단비를 확인할 수 없습니다. 원본에서 확인되지 않았습니다.",
  );
});

test("6) 일반적인 보험 구조 설명 → PASS", () => {
  assertPass(
    "3대질병보험은 기본적으로 진단비 → 수술비 → 후유장해 순으로 구성하는 것이 효율적입니다. 일반적으로 약관은 보통 보장 대상 질병분류코드를 지정합니다.",
  );
});

// --- Repair A2 pre-emit veto ---

test("A2-T1 safe 문장 → streamed === Claude 원문", () => {
  const claude =
    "암진단비는 3천만원입니다. 수술비는 추가 확인이 필요합니다.";
  const { stream, customerText } = makeVetoStream([]);
  stream.pushAnswerText(claude);
  stream.flush();
  assert.equal(customerText(), claude);
  assert.equal(stream.getCommitted(), claude);
});

test("A2-T2 safe + unsupported absence + safe → 가운데만 없음 / 앞뒤 원문", () => {
  const s1 = "암진단비는 3천만원입니다.";
  const bad = " 뇌혈관 진단비는 포함돼 있지 않습니다.";
  const s3 = " 수술비는 추가 확인이 필요합니다.";
  const claude = `${s1}${bad}${s3}`;
  const { stream, customerText } = makeVetoStream([]);
  stream.pushAnswerText(claude);
  stream.flush();
  const out = customerText();
  assert.equal(out.includes("포함돼 있지 않습니다"), false);
  assert.ok(out.startsWith(s1));
  assert.ok(out.endsWith(s3.trim()) || out.endsWith(s3));
  assert.equal(out, `${s1}${s3}`);
  assert.equal(stream.getCommitted(), out);
  // no replacement prose
  assert.equal(out.includes("확인되지 않습니다"), false);
});

test("A2-T3 verified negative → 원문 그대로 존재", () => {
  const evidence = collectVerifiedNegativeCoverageEvidence({
    coverages: [
      {
        coverage_name: "뇌혈관진단비",
        status: "verified_absent",
        verified_absent: true,
      },
    ],
  });
  const claude = "이 계약에는 뇌혈관 진단비가 포함돼 있지 않습니다.";
  const { stream, customerText } = makeVetoStream(evidence);
  stream.pushAnswerText(claude);
  stream.flush();
  assert.equal(customerText(), claude);
});

test("A2-T4 확인되지 않습니다 → 원문 그대로 존재", () => {
  const claude = "현재 자료에서는 암 진단비를 확인할 수 없습니다.";
  const { stream, customerText } = makeVetoStream([]);
  stream.pushAnswerText(claude);
  stream.flush();
  assert.equal(customerText(), claude);
});

test("A2-T5 일반 보험 설명 → 원문 그대로 존재", () => {
  const claude =
    "일반적으로 3대질병보험은 진단비 → 수술비 순으로 구성하는 것이 효율적입니다.";
  const { stream, customerText } = makeVetoStream([]);
  stream.pushAnswerText(claude);
  stream.flush();
  assert.equal(customerText(), claude);
});

test("A2-T6 fragmented delta — 선노출 없음", () => {
  const { stream, emitted, customerText } = makeVetoStream([]);
  // Same claim split across chunks; must not paint "포함돼 " before gate.
  pushCumulative(stream, ["뇌혈관 진단비는 포함돼 ", "있지 않습니다."]);
  assert.equal(emitted.length, 0, "no fragment may emit before full sentence gate");
  assert.equal(customerText(), "");
  stream.flush();
  assert.equal(customerText(), "");
  assert.equal(stream.getVetoedSliceCount() >= 1, true);
});

test("A2-T7 unsafe 마지막 remainder(no final punctuation) → done 시 emit 금지", () => {
  const { stream, customerText } = makeVetoStream([]);
  stream.pushAnswerText("뇌혈관 진단비는 포함돼 있지 않습니다");
  assert.equal(customerText(), "");
  stream.flush();
  assert.equal(customerText(), "");
  assert.equal(stream.getCommitted(), "");
});

test("A2-T8 safe 마지막 remainder → done 시 원문 그대로 flush", () => {
  const claude = "수술비는 추가 확인이 필요합니다";
  const { stream, customerText } = makeVetoStream([]);
  stream.pushAnswerText(claude);
  assert.equal(customerText(), "");
  stream.flush();
  assert.equal(customerText(), claude);
  assert.equal(stream.getCommitted(), claude);
});

test("A2 extra: streamed === sealed lineage (committed)", () => {
  const s1 = "암진단비는 3천만원입니다.";
  const bad = " 뇌혈관 진단비는 포함돼 있지 않습니다.";
  const s3 = " 수술비는 추가 확인이 필요합니다.";
  const { stream, customerText } = makeVetoStream([]);
  stream.pushAnswerText(`${s1}${bad}${s3}`);
  stream.flush();
  const streamed = customerText();
  const sealed = stream.getCommitted();
  assert.equal(streamed, sealed);
  assert.equal(streamed.includes("포함돼 있지 않습니다"), false);
  assert.equal(streamed.includes("확인되지 않았습니다"), false);
});

// --- Repair A2 PRE-COMMIT CLOSURE — bullet / markdown table emit units ---

test("A2-T9 safe bullet/list → streamed === Claude 원문", () => {
  const claude =
    "- 암진단비는 3천만원입니다.\n- 수술비는 추가 확인이 필요합니다.\n";
  const { stream, customerText } = makeVetoStream([]);
  stream.pushAnswerText(claude);
  stream.flush();
  assert.equal(customerText(), claude);
  assert.equal(stream.getCommitted(), claude);
});

test("A2-T10 safe + unsupported absence bullet + safe → unsafe unit만 미emit", () => {
  const b1 = "- 암진단비는 3천만원입니다.\n";
  const bad = "- 뇌혈관 진단비는 포함돼 있지 않습니다.\n";
  const b3 = "- 수술비는 추가 확인이 필요합니다.\n";
  const claude = `${b1}${bad}${b3}`;
  const { stream, customerText } = makeVetoStream([]);
  stream.pushAnswerText(claude);
  stream.flush();
  const out = customerText();
  assert.equal(out, `${b1}${b3}`);
  assert.equal(out.includes("포함돼 있지 않습니다"), false);
  assert.equal(out.includes("확인되지 않습니다"), false);
  assert.equal(stream.getCommitted(), out);
});

test("A2-T11 safe markdown table → 전체 원문 그대로", () => {
  const claude =
    "| 담보 | 확인 상태 |\n| --- | --- |\n| 암진단비 | 3천만원 |\n| 수술비 | 확인 필요 |\n";
  const { stream, customerText } = makeVetoStream([]);
  stream.pushAnswerText(claude);
  stream.flush();
  assert.equal(customerText(), claude);
  assert.equal(stream.getCommitted(), claude);
});

test("A2-T12 table: unsupported absence row만 veto / 나머지 원문", () => {
  const header = "| 담보 | 확인 상태 |\n";
  const sep = "| --- | --- |\n";
  const safe1 = "| 암진단비 | 3천만원 |\n";
  const bad = "| 뇌혈관 진단비 | 포함돼 있지 않습니다 |\n";
  const safe2 = "| 수술비 | 확인 필요 |\n";
  const claude = `${header}${sep}${safe1}${bad}${safe2}`;
  const { stream, customerText } = makeVetoStream([]);
  stream.pushAnswerText(claude);
  stream.flush();
  const out = customerText();
  assert.equal(out, `${header}${sep}${safe1}${safe2}`);
  assert.equal(out.includes("포함돼 있지 않습니다"), false);
  assert.equal(out.includes("확인되지 않습니다"), false);
  assert.equal(out.includes("확인되지 않았습니다"), false);
  assert.ok(out.includes("| 암진단비 | 3천만원 |"));
  assert.ok(out.includes("| 수술비 | 확인 필요 |"));
  assert.equal(stream.getCommitted(), out);
});

console.log(
  process.exitCode
    ? "key-absence-certainty-gate-unit-test FAILED"
    : "key-absence-certainty-gate-unit-test OK",
);
