/**
 * Train R3 — next history / persist follow seal SSOT (not painted-only).
 */
import assert from "node:assert/strict";
import {
  KEY_MONOPOLY_FAILURE_CUSTOMER_TEXT,
  resolveCustomerHistoryPersistText,
} from "../src/lib/agentKeyChatStreamPaint.js";

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

test("R3-T1 divergent painted vs seal → persist = seal", () => {
  const painted = "월 납입보험료는 999만원입니다.";
  const sealed = "확인된 월 납입보험료는 45000원입니다.";
  assert.equal(
    resolveCustomerHistoryPersistText({
      sealedText: sealed,
      displayText: painted,
    }),
    sealed,
  );
});

test("R3-T2 failure seal → persist = failure seal", () => {
  assert.equal(
    resolveCustomerHistoryPersistText({
      sealedText: KEY_MONOPOLY_FAILURE_CUSTOMER_TEXT,
      displayText: "부분 paint 잔존",
    }),
    KEY_MONOPOLY_FAILURE_CUSTOMER_TEXT,
  );
});

test("R3-T3 empty seal → fall back to display", () => {
  const display = "화면/스트림만 있는 문장";
  assert.equal(
    resolveCustomerHistoryPersistText({
      sealedText: "   ",
      displayText: display,
    }),
    display,
  );
});

test("R3-T4 equal seal/display → seal", () => {
  const text = "확인된 계약은 2건입니다.";
  assert.equal(
    resolveCustomerHistoryPersistText({
      sealedText: text,
      displayText: text,
    }),
    text,
  );
});

if (process.exitCode) {
  console.error("R3 history seal SSOT unit tests FAILED");
  process.exit(1);
}
console.log("R3 history seal SSOT unit tests PASSED");
