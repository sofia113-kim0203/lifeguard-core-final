/**
 * Train T1 — customer error messages must not leak OCR / factory / Work Order.
 */
import assert from "node:assert/strict";
import {
  containsCustomerInternalErrorLeak,
  toCustomerErrorMessage,
} from "../src/lib/uiLocale.js";

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

const FALLBACK = "질문에 답변하지 못했습니다.";

test("T1-T1 OCR Korean error → fallback", () => {
  assert.equal(containsCustomerInternalErrorLeak("OCR 추출에 실패했습니다."), true);
  assert.equal(
    toCustomerErrorMessage({ message: "OCR 추출에 실패했습니다." }, FALLBACK),
    FALLBACK,
  );
});

test("T1-T2 Work Order / 공장 leak → fallback", () => {
  assert.equal(
    toCustomerErrorMessage({ message: "공장 Work Order 생성 실패" }, FALLBACK),
    FALLBACK,
  );
  assert.equal(
    toCustomerErrorMessage({ message: "factory_enqueue failed" }, FALLBACK),
    FALLBACK,
  );
});

test("T1-T3 safe Korean customer copy → kept", () => {
  const safe = "질문에 답변하지 못했습니다. 잠시 후 다시 시도해 주세요.";
  assert.equal(containsCustomerInternalErrorLeak(safe), false);
  assert.equal(toCustomerErrorMessage({ message: safe }, FALLBACK), safe);
});

test("T1-T4 memory-fail safe copy → kept", () => {
  const safe =
    "답변은 준비됐지만 KEY 공식 기억 저장이 완료되지 않았습니다. 기억 저장을 다시 시도해 주세요.";
  assert.equal(toCustomerErrorMessage({ message: safe }, FALLBACK), safe);
});

test("T1-T5 English internal without Korean → fallback (legacy)", () => {
  assert.equal(
    toCustomerErrorMessage({ message: "Work Order timeout" }, FALLBACK),
    FALLBACK,
  );
});

if (process.exitCode) {
  console.error("T1 customer error internal leak unit tests FAILED");
  process.exit(1);
}
console.log("T1 customer error internal leak unit tests PASSED");
