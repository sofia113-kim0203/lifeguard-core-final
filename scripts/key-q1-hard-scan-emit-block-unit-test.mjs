/**
 * Train Q1 — hard-scan fact/amount emit-block (no network / Claude / rewrite AI).
 * Proves rogue amounts are vetoed pre-emit and classified as emit-block hard.
 */
import assert from "node:assert/strict";
import {
  hardOnlySafetyCheck,
  hasFactAmountEmitBlockHard,
  buildClaudeFirstSpeakAllowlistForEmitBlock,
  shouldEmitFactAmountHardSlice,
  decideS10fPreEmitEmitDecision,
} from "../server/keyCore/keyClaudeFirstDirect.js";
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

test("Q1-T1 hardOnlySafetyCheck marks rogue amount as jailbreak_fact", () => {
  const allow = buildClaudeFirstSpeakAllowlistForEmitBlock({
    reality: {
      policy_count: 2,
      policies: [
        { insurer_name: "삼성생명", product_name: "종신", monthly_premium: 45000 },
      ],
    },
    coverages: [{ coverage_name: "질병수술비", coverage_amount: "50만원" }],
  });
  assert.ok(allow.allowed_numbers.includes("50"));
  assert.ok(allow.allowed_numbers.includes("45000") || allow.allowed_numbers.includes("45"));
  const rogue = hardOnlySafetyCheck("월 납입보험료는 999만원입니다.", {
    allowed_numbers: allow.allowed_numbers,
    allowed_entities: allow.allowed_entities,
  });
  assert.equal(rogue.hard_fail, true);
  assert.ok(rogue.hard.includes("jailbreak_fact"));
  assert.equal(hasFactAmountEmitBlockHard(rogue.hard), true);
});

test("Q1-T2 verified coverage amount is not fact-amount emit-block", () => {
  const allow = buildClaudeFirstSpeakAllowlistForEmitBlock({
    reality: { policy_count: 1, policies: [{ insurer_name: "삼성생명" }] },
    coverages: [{ coverage_name: "질병수술비", coverage_amount: "50만원" }],
  });
  const ok = hardOnlySafetyCheck("질병수술비는 50만원입니다.", {
    allowed_numbers: allow.allowed_numbers,
    allowed_entities: allow.allowed_entities,
  });
  assert.equal(hasFactAmountEmitBlockHard(ok.hard), false);
  assert.equal(shouldEmitFactAmountHardSlice("질병수술비는 50만원입니다.", allow), true);
});

test("Q1-T3 pre-emit veto drops rogue amount slice", () => {
  const allow = buildClaudeFirstSpeakAllowlistForEmitBlock({
    reality: { policy_count: 1, policies: [{ insurer_name: "삼성생명", monthly_premium: 10000 }] },
    coverages: [],
  });
  const emitted = [];
  const stream = createImmediateAnswerDeltaStream({
    shouldEmitSlice(slice) {
      return decideS10fPreEmitEmitDecision({
        slice,
        absenceEvidence: [],
        verifiedCoverages: [],
        speakAllowlist: allow,
      }).emit_decision;
    },
    onCommit(slice) {
      emitted.push(slice);
      return { keep: true };
    },
  });
  stream.pushAnswerText("월 납입보험료는 999만원입니다.");
  stream.flush();
  assert.equal(emitted.join(""), "");
  assert.equal(shouldEmitFactAmountHardSlice("월 납입보험료는 999만원입니다.", allow), false);
});

test("Q1-T4 speakAllowlist null keeps legacy emit (no accidental global block)", () => {
  const decided = decideS10fPreEmitEmitDecision({
    slice: "월 납입보험료는 999만원입니다.",
    absenceEvidence: [],
    verifiedCoverages: [],
    speakAllowlist: null,
  });
  assert.equal(decided.factAmountAllowed, true);
  assert.equal(decided.emit_decision, true);
});

test("Q1-T5 allowed premium amount emits", () => {
  const allow = buildClaudeFirstSpeakAllowlistForEmitBlock({
    reality: {
      policy_count: 1,
      policies: [{ insurer_name: "삼성생명", monthly_premium: 45000 }],
    },
    coverages: [],
  });
  const emitted = [];
  const stream = createImmediateAnswerDeltaStream({
    shouldEmitSlice(slice) {
      return decideS10fPreEmitEmitDecision({
        slice,
        absenceEvidence: [],
        verifiedCoverages: [],
        speakAllowlist: allow,
      }).emit_decision;
    },
    onCommit(slice) {
      emitted.push(slice);
      return { keep: true };
    },
  });
  const text = "월 납입보험료는 45000원입니다.";
  stream.pushAnswerText(text);
  stream.flush();
  assert.equal(emitted.join(""), text);
});

if (process.exitCode) {
  console.error("Q1 hard-scan emit-block unit tests FAILED");
  process.exit(1);
}
console.log("Q1 hard-scan emit-block unit tests PASSED");
