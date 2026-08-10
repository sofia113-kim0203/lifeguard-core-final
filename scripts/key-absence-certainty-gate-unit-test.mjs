/**
 * Human Gate Repair A / A2 — absence-certainty Gate unit tests.
 * Classifier + pre-emit sentence veto (no network / Claude / Preview).
 */
import assert from "node:assert/strict";
import {
  collectVerifiedNegativeCoverageEvidence,
  evaluateAbsenceCertaintyGate,
  shouldEmitAbsenceCertaintySlice,
  evaluateCoverageAmountAttributionGate,
  shouldEmitCoverageAmountIntegritySlice,
  COVERAGE_AMOUNT_ATTRIBUTION_CLASS,
} from "../server/keyCore/keyAbsenceCertaintyGate.js";
import {
  hardOnlySafetyCheck,
  decideS10fPreEmitEmitDecision,
  buildS10fPreEmitObservationRecord,
  shapeVerifiedCoveragesForS10fAudit,
  createS10fPreEmitAuditBuffer,
  pushS10fPreEmitObservation,
  s10fPreEmitAuditEnvelopeFields,
  shouldExposeS10fPreEmitAuditEnvelope,
  isS10fPreEmitObservabilityEnabled,
} from "../server/keyCore/keyClaudeFirstDirect.js";
import { createImmediateAnswerDeltaStream } from "../server/keyCore/keyClaudeFirstSentenceCommit.js";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

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

test("1) verified negative 없음 + 진단비가 없어요 → BLOCK", () => {
  assertBlock("암 진단비가 없어요.");
});

test("1b) CLASSIFIER_MISS repair — 진단비는 없어요 → BLOCK", () => {
  assertBlock("암 진단비는 없어요.");
  assertBlock(
    "현재 보유하신 한화 3.10.5 간편건강보험은 수술비만 있고 암 진단비는 없어요.",
  );
});

test("1c) 뇌혈관 진단비는 없습니다 → BLOCK", () => {
  assertBlock("뇌혈관 진단비는 없습니다.");
});

test("2) verified negative 없음 + 포함돼 있지 않습니다 → BLOCK", () => {
  assertBlock(
    "이 계약에는 암 진단비, 뇌혈관 진단비 등 진단형 보장이 포함돼 있지 않습니다.",
  );
});

test("2b) 수술비는 포함돼 있지 않습니다 → BLOCK", () => {
  assertBlock("이 계약에서 수술비는 포함돼 있지 않습니다.");
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

test("4b) verified negative + 암 진단비는 없어요 → PASS", () => {
  const evidence = collectVerifiedNegativeCoverageEvidence({
    coverages: [
      {
        coverage_name: "암진단비",
        status: "verified_absent",
        verified_absent: true,
      },
    ],
  });
  assertPass("암 진단비는 없어요.", evidence);
});

test("5) 정보 없음 + 현재 자료에서는 확인되지 않습니다 → PASS", () => {
  assertPass(
    "현재 자료에서는 암 진단비를 확인할 수 없습니다. 원본에서 확인되지 않았습니다.",
  );
});

test("5b) 현재 자료에서는 암 진단비가 확인되지 않습니다 → PASS", () => {
  assertPass("현재 자료에서는 암 진단비가 확인되지 않습니다.");
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

// --- S10D coverage amount attribution integrity (pre-emit veto) ---

const S10D_COVERAGES_1_3 = [
  {
    coverage_name: "질병1~5종수술비IV (1종)",
    coverage_amount: "50만원",
    status: "verified",
  },
  {
    coverage_name: "질병1~5종수술비IV (3종)",
    coverage_amount: "500만원",
    status: "verified",
  },
];

function makeCombinedVetoStream(absenceEvidence = [], verifiedCoverages = []) {
  const emitted = [];
  const stream = createImmediateAnswerDeltaStream({
    shouldEmitSlice(slice) {
      return (
        shouldEmitAbsenceCertaintySlice(slice, absenceEvidence) &&
        shouldEmitCoverageAmountIntegritySlice(slice, verifiedCoverages)
      );
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

test("S10D-T1 MATCH — verified 1종=50 / answer 1종=50 → emit", () => {
  const coverages = [
    {
      coverage_name: "질병1~5종수술비IV (1종)",
      coverage_amount: "50만원",
    },
  ];
  const text = "질병1~5종수술비IV (1종) 50만원입니다.";
  const g = evaluateCoverageAmountAttributionGate({
    text,
    verifiedCoverages: coverages,
  });
  assert.equal(g.class, COVERAGE_AMOUNT_ATTRIBUTION_CLASS.MATCH);
  assert.equal(shouldEmitCoverageAmountIntegritySlice(text, coverages), true);
  const { stream, customerText } = makeCombinedVetoStream([], coverages);
  stream.pushAnswerText(text);
  stream.flush();
  assert.equal(customerText(), text);
});

test("S10D-T2 CLEAR_MISMATCH — verified 1종=50 / answer 2종=50 → veto", () => {
  const coverages = [
    {
      coverage_name: "질병1~5종수술비IV (1종)",
      coverage_amount: "50만원",
    },
  ];
  const text = "질병1~5종수술비IV (2종) 50만원입니다.";
  const g = evaluateCoverageAmountAttributionGate({
    text,
    verifiedCoverages: coverages,
  });
  assert.equal(g.class, COVERAGE_AMOUNT_ATTRIBUTION_CLASS.CLEAR_MISMATCH);
  assert.equal(shouldEmitCoverageAmountIntegritySlice(text, coverages), false);
  const { stream, customerText } = makeCombinedVetoStream([], coverages);
  stream.pushAnswerText(text);
  stream.flush();
  assert.equal(customerText(), "");
  assert.equal(stream.getVetoedSliceCount() >= 1, true);
});

test("S10D-T3 CLEAR_MISMATCH — grouped 1·2종 각 50 → veto", () => {
  const coverages = [
    {
      coverage_name: "질병1~5종수술비IV (1종)",
      coverage_amount: "50만원",
    },
  ];
  const text = "질병 1~5종 수술비 (1·2종) 각 50만원.";
  const g = evaluateCoverageAmountAttributionGate({
    text,
    verifiedCoverages: coverages,
  });
  assert.equal(g.class, COVERAGE_AMOUNT_ATTRIBUTION_CLASS.CLEAR_MISMATCH);
  assert.equal(shouldEmitCoverageAmountIntegritySlice(text, coverages), false);
});

test("S10D-T4 MATCH — 1종=50 / 3종=500 exact → emit", () => {
  const text =
    "질병1~5종수술비IV (1종) 50만원, (3종) 500만원입니다.";
  const g = evaluateCoverageAmountAttributionGate({
    text,
    verifiedCoverages: S10D_COVERAGES_1_3,
  });
  assert.equal(g.class, COVERAGE_AMOUNT_ATTRIBUTION_CLASS.MATCH);
  assert.equal(
    shouldEmitCoverageAmountIntegritySlice(text, S10D_COVERAGES_1_3),
    true,
  );
});

test("S10D-T5 CLEAR_MISMATCH — verified 3종=500 / answer 4종=500 → veto", () => {
  const coverages = [
    {
      coverage_name: "질병1~5종수술비IV (3종)",
      coverage_amount: "500만원",
    },
  ];
  const text = "질병1~5종수술비IV (4종) 500만원입니다.";
  const g = evaluateCoverageAmountAttributionGate({
    text,
    verifiedCoverages: coverages,
  });
  assert.equal(g.class, COVERAGE_AMOUNT_ATTRIBUTION_CLASS.CLEAR_MISMATCH);
  assert.equal(shouldEmitCoverageAmountIntegritySlice(text, coverages), false);
});

test("S10D-T6 NOT_CHECKABLE — ambiguous association → emit", () => {
  const coverages = S10D_COVERAGES_1_3;
  const text = "수술비 구성은 조금 더 열어봐야 정확히 말씀드릴 수 있어요.";
  const g = evaluateCoverageAmountAttributionGate({
    text,
    verifiedCoverages: coverages,
  });
  assert.ok(
    g.class === COVERAGE_AMOUNT_ATTRIBUTION_CLASS.MATCH ||
      g.class === COVERAGE_AMOUNT_ATTRIBUTION_CLASS.NOT_CHECKABLE,
  );
  assert.equal(shouldEmitCoverageAmountIntegritySlice(text, coverages), true);
});

test("S10D-T7 일반론 숫자 — 비대상 → emit", () => {
  const text =
    "암 진단비는 3천만원을 이야기하는 경우도 있다.";
  const g = evaluateCoverageAmountAttributionGate({
    text,
    verifiedCoverages: S10D_COVERAGES_1_3,
  });
  assert.notEqual(g.class, COVERAGE_AMOUNT_ATTRIBUTION_CLASS.CLEAR_MISMATCH);
  assert.equal(
    shouldEmitCoverageAmountIntegritySlice(text, S10D_COVERAGES_1_3),
    true,
  );
});

test("S10D-T8 보험료 일반문장 — 비대상 → emit", () => {
  const text = "매달 보험료가 대략 얼마인지부터 같이 보면 좋아요.";
  assert.equal(
    shouldEmitCoverageAmountIntegritySlice(text, S10D_COVERAGES_1_3),
    true,
  );
});

test("S10D-T9 absence veto 회귀 — unsupported absence still veto", () => {
  const bad = "뇌혈관 진단비는 포함돼 있지 않습니다.";
  const { stream, customerText } = makeCombinedVetoStream([], S10D_COVERAGES_1_3);
  stream.pushAnswerText(bad);
  stream.flush();
  assert.equal(customerText(), "");
  assert.equal(stream.getVetoedSliceCount() >= 1, true);
});

test("S10D-T10 catch-up/remainder — CLEAR_MISMATCH 우회 emit 없음", () => {
  const coverages = [
    {
      coverage_name: "질병1~5종수술비IV (1종)",
      coverage_amount: "50만원",
    },
  ];
  const bad = "질병 1~5종 수술비 (1·2종) 각 50만원.";
  const { stream, customerText } = makeCombinedVetoStream([], coverages);
  stream.pushAnswerText(bad);
  assert.equal(customerText(), "");
  // catch-up path must still veto
  stream.catchUpFinalAnswer(bad, { stopReason: "end_turn" });
  stream.flush();
  assert.equal(customerText().includes("1·2종"), false);
  assert.equal(customerText().includes("각 50만원"), false);
  assert.equal(stream.getVetoedSliceCount() >= 1, true);
});

test("S10D-T3b S9A-shaped grouped expansion both lines → veto units", () => {
  const coverages = S10D_COVERAGES_1_3;
  const lineA = "질병 1~5종 수술비 (3·4종) 각 500만원.";
  const lineB = "질병 1~5종 수술비 (1·2종) 각 50만원.";
  assert.equal(
    evaluateCoverageAmountAttributionGate({
      text: lineA,
      verifiedCoverages: coverages,
    }).class,
    COVERAGE_AMOUNT_ATTRIBUTION_CLASS.CLEAR_MISMATCH,
  );
  assert.equal(
    evaluateCoverageAmountAttributionGate({
      text: lineB,
      verifiedCoverages: coverages,
    }).class,
    COVERAGE_AMOUNT_ATTRIBUTION_CLASS.CLEAR_MISMATCH,
  );
  const { stream, customerText } = makeCombinedVetoStream([], coverages);
  stream.pushAnswerText(`${lineA} ${lineB}`);
  stream.flush();
  assert.equal(customerText().includes("3·4종"), false);
  assert.equal(customerText().includes("1·2종"), false);
});

// --- S10F TEMP pre-emit observability (observation must not change emit) ---

function makeObservedCombinedStream(absenceEvidence = [], verifiedCoverages = []) {
  const emitted = [];
  const observations = [];
  let seq = 0;
  const stream = createImmediateAnswerDeltaStream({
    shouldEmitSlice(slice) {
      const decided = decideS10fPreEmitEmitDecision({
        slice,
        absenceEvidence,
        verifiedCoverages,
      });
      seq += 1;
      observations.push(
        buildS10fPreEmitObservationRecord({
          request_id: "unit-s10f",
          sequence_index: seq,
          verifiedCoverages,
          candidate_slice: slice,
          gate_class: decided.gate_class,
          emit_decision: decided.emit_decision,
          bypass_path: false,
        }),
      );
      return decided.emit_decision;
    },
    onCommit(slice) {
      emitted.push(slice);
      return { keep: true };
    },
  });
  return {
    stream,
    observations,
    customerText() {
      return emitted.join("");
    },
  };
}

test("S10F-T1 MATCH — obs ON/OFF customer text identical", () => {
  const coverages = [
    { coverage_name: "질병1~5종수술비IV (1종)", coverage_amount: "50만원" },
  ];
  const text = "질병1~5종수술비IV (1종) 50만원입니다.";
  const legacy = shouldEmitCoverageAmountIntegritySlice(text, coverages);
  const decided = decideS10fPreEmitEmitDecision({
    slice: text,
    absenceEvidence: [],
    verifiedCoverages: coverages,
  });
  assert.equal(decided.emit_decision, legacy);
  assert.equal(decided.gate_class, COVERAGE_AMOUNT_ATTRIBUTION_CLASS.MATCH);
  const off = makeCombinedVetoStream([], coverages);
  off.stream.pushAnswerText(text);
  off.stream.flush();
  const on = makeObservedCombinedStream([], coverages);
  on.stream.pushAnswerText(text);
  on.stream.flush();
  assert.equal(on.customerText(), off.customerText());
  assert.equal(on.customerText(), text);
  assert.equal(on.observations.length >= 1, true);
  assert.equal(on.observations[0].bypass_path, false);
  assert.equal(
    on.observations[0].gate_class,
    COVERAGE_AMOUNT_ATTRIBUTION_CLASS.MATCH,
  );
  assert.equal(on.observations[0].emit_decision, true);
});

test("S10F-T2 CLEAR_MISMATCH — obs ON/OFF veto identical", () => {
  const coverages = [
    { coverage_name: "질병1~5종수술비IV (1종)", coverage_amount: "50만원" },
  ];
  const text = "질병1~5종수술비IV (2종) 50만원입니다.";
  const legacy = shouldEmitCoverageAmountIntegritySlice(text, coverages);
  const decided = decideS10fPreEmitEmitDecision({
    slice: text,
    absenceEvidence: [],
    verifiedCoverages: coverages,
  });
  assert.equal(decided.emit_decision, legacy);
  assert.equal(decided.emit_decision, false);
  assert.equal(
    decided.gate_class,
    COVERAGE_AMOUNT_ATTRIBUTION_CLASS.CLEAR_MISMATCH,
  );
  const off = makeCombinedVetoStream([], coverages);
  off.stream.pushAnswerText(text);
  off.stream.flush();
  const on = makeObservedCombinedStream([], coverages);
  on.stream.pushAnswerText(text);
  on.stream.flush();
  assert.equal(on.customerText(), off.customerText());
  assert.equal(on.customerText(), "");
  assert.equal(on.observations.length >= 1, true);
  assert.equal(
    on.observations[0].gate_class,
    COVERAGE_AMOUNT_ATTRIBUTION_CLASS.CLEAR_MISMATCH,
  );
  assert.equal(on.observations[0].emit_decision, false);
});

test("S10F-T3 NOT_CHECKABLE — obs ON/OFF emit identical", () => {
  const text = "수술비 구성은 조금 더 열어봐야 정확히 말씀드릴 수 있어요.";
  const legacy = shouldEmitCoverageAmountIntegritySlice(text, S10D_COVERAGES_1_3);
  const decided = decideS10fPreEmitEmitDecision({
    slice: text,
    absenceEvidence: [],
    verifiedCoverages: S10D_COVERAGES_1_3,
  });
  assert.equal(decided.emit_decision, legacy);
  assert.equal(decided.emit_decision, true);
  assert.notEqual(
    decided.gate_class,
    COVERAGE_AMOUNT_ATTRIBUTION_CLASS.CLEAR_MISMATCH,
  );
  const off = makeCombinedVetoStream([], S10D_COVERAGES_1_3);
  off.stream.pushAnswerText(text);
  off.stream.flush();
  const on = makeObservedCombinedStream([], S10D_COVERAGES_1_3);
  on.stream.pushAnswerText(text);
  on.stream.flush();
  assert.equal(on.customerText(), off.customerText());
  assert.equal(on.customerText(), text);
  assert.equal(on.observations.length >= 1, true);
  assert.equal(on.observations[0].emit_decision, true);
});

test("S10F-T4 absence veto — observation does not change result", () => {
  const bad = "뇌혈관 진단비는 포함돼 있지 않습니다.";
  const off = makeCombinedVetoStream([], S10D_COVERAGES_1_3);
  off.stream.pushAnswerText(bad);
  off.stream.flush();
  const on = makeObservedCombinedStream([], S10D_COVERAGES_1_3);
  on.stream.pushAnswerText(bad);
  on.stream.flush();
  assert.equal(on.customerText(), off.customerText());
  assert.equal(on.customerText(), "");
  assert.equal(on.observations.some((o) => o.emit_decision === false), true);
});

test("S10F-T5 fallback — bypass_path=true record only; no gate rewrite", () => {
  const sealed = "질병1~5종수술비IV (2종)\t50만원\n";
  const shape = shapeVerifiedCoveragesForS10fAudit(S10D_COVERAGES_1_3);
  assert.equal(shape.length, 2);
  assert.equal(
    Object.keys(shape.tuples[0]).sort().join(","),
    "coverage_amount,coverage_name",
  );
  const rec = buildS10fPreEmitObservationRecord({
    request_id: "unit-s10f-bypass",
    sequence_index: 1,
    verifiedCoverages: S10D_COVERAGES_1_3,
    candidate_slice: sealed,
    gate_class: null,
    emit_decision: true,
    bypass_path: true,
  });
  assert.equal(rec.bypass_path, true);
  assert.equal(rec.emit_decision, true);
  assert.equal(rec.gate_class, null);
  assert.equal(rec.candidate_slice, sealed);
  // S10G — in-memory buffer only; customer sealed text unchanged.
  const buf = createS10fPreEmitAuditBuffer();
  const ok = pushS10fPreEmitObservation(buf, rec);
  assert.equal(ok, true);
  assert.equal(buf.length, 1);
  assert.equal(buf[0].bypass_path, true);
  assert.equal(buf[0].candidate_slice, sealed);
  assert.equal(sealed, "질병1~5종수술비IV (2종)\t50만원\n");
});

test("S10G-T6 retrieval envelope — S10F records attachable on done trace", () => {
  const buf = createS10fPreEmitAuditBuffer();
  const rec = buildS10fPreEmitObservationRecord({
    request_id: "client-turn-1",
    sequence_index: 1,
    verifiedCoverages: S10D_COVERAGES_1_3,
    candidate_slice: "질병1~5종수술비IV (1종) 50만원",
    gate_class: COVERAGE_AMOUNT_ATTRIBUTION_CLASS.MATCH,
    emit_decision: true,
    bypass_path: false,
  });
  pushS10fPreEmitObservation(buf, rec);
  const previewEnv = {
    VERCEL_ENV: "preview",
    S10F_PRE_EMIT_OBSERVABILITY: "1",
  };
  assert.equal(shouldExposeS10fPreEmitAuditEnvelope(previewEnv), true);
  const fields = s10fPreEmitAuditEnvelopeFields(buf, previewEnv);
  assert.equal(Array.isArray(fields.s10f_pre_emit_audit), true);
  assert.equal(fields.s10f_pre_emit_audit.length, 1);
  const keys = Object.keys(fields.s10f_pre_emit_audit[0]).sort().join(",");
  assert.equal(
    keys,
    "bypass_path,candidate_slice,emit_decision,gate_class,request_id,sequence_index,verified_tuple_shape",
  );
  // Customer-visible / seal fields stay separate.
  const donePayload = {
    answerText: "고객에게 보이는 문장",
    key_speak_original: "고객에게 보이는 문장",
    sales_director_trace: {
      key_compose_trace: {
        key_voice_trace: {
          provider: "claude_first_direct",
          ...fields,
        },
      },
    },
  };
  assert.equal(donePayload.answerText, "고객에게 보이는 문장");
  assert.equal(donePayload.key_speak_original, "고객에게 보이는 문장");
  assert.equal(
    donePayload.sales_director_trace.key_compose_trace.key_voice_trace
      .s10f_pre_emit_audit[0].request_id,
    "client-turn-1",
  );
});

test("S10G-T7 Production/disabled — s10f_pre_emit_audit absent", () => {
  const buf = createS10fPreEmitAuditBuffer();
  pushS10fPreEmitObservation(
    buf,
    buildS10fPreEmitObservationRecord({
      request_id: "prod-turn",
      sequence_index: 1,
      verifiedCoverages: [],
      candidate_slice: "x",
      gate_class: COVERAGE_AMOUNT_ATTRIBUTION_CLASS.MATCH,
      emit_decision: true,
      bypass_path: false,
    }),
  );
  const prodEnv = { VERCEL_ENV: "production", S10F_PRE_EMIT_OBSERVABILITY: "1" };
  assert.equal(isS10fPreEmitObservabilityEnabled(prodEnv), true);
  assert.equal(shouldExposeS10fPreEmitAuditEnvelope(prodEnv), false);
  assert.deepEqual(s10fPreEmitAuditEnvelopeFields(buf, prodEnv), {});
  const disabledPreview = {
    VERCEL_ENV: "preview",
    S10F_PRE_EMIT_OBSERVABILITY: "0",
  };
  assert.equal(isS10fPreEmitObservabilityEnabled(disabledPreview), false);
  assert.equal(shouldExposeS10fPreEmitAuditEnvelope(disabledPreview), false);
  assert.deepEqual(s10fPreEmitAuditEnvelopeFields(buf, disabledPreview), {});
});

test("S10G-T8 no tmp write — S10F path does not use appendFileSync/os.tmpdir", () => {
  const srcPath = join(
    dirname(fileURLToPath(import.meta.url)),
    "..",
    "server",
    "keyCore",
    "keyClaudeFirstDirect.js",
  );
  const src = readFileSync(srcPath, "utf8");
  assert.equal(/appendS10fPreEmitObservation/.test(src), false);
  assert.equal(/resolveS10fPreEmitAuditDir/.test(src), false);
  assert.equal(/s10f-pre-emit-observability/.test(src), false);
  assert.equal(/from \"node:fs\"/.test(src), false);
  assert.equal(/from \"node:os\"/.test(src), false);
  assert.equal(/appendFileSync/.test(src), false);
  assert.equal(/tmpdir\(/.test(src), false);
  assert.equal(/createS10fPreEmitAuditBuffer/.test(src), true);
  assert.equal(/pushS10fPreEmitObservation/.test(src), true);
  assert.equal(/s10fPreEmitAuditEnvelopeFields/.test(src), true);
  assert.equal(/s10f_pre_emit_audit/.test(src), true);
});

console.log(
  process.exitCode
    ? "key-absence-certainty-gate-unit-test FAILED"
    : "key-absence-certainty-gate-unit-test OK",
);
