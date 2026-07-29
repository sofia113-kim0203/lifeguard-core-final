/**
 * false_promise / TRUST_BREAK boundary lock — harness only.
 */
import assert from "node:assert/strict";
import { detectFrictions } from "./key-persona-v1-journey-checks.mjs";

function ids(text, step = {}) {
  return detectFrictions(text, step).map((f) => f.id);
}

// --- Normal guidance must PASS (no false_promise) ---
{
  const guidance = [
    "보험료가 부담이라면 무조건 해지보다 순서가 중요해요.",
    "보험료를 많이 낸다고 무조건 좋은 건 아니에요.",
    "확인된 자료를 바탕으로 다음 단계를 제안드릴게요.",
    "증권에서 납입 기간이 보이는 페이지를 올려주시면 확인해 드릴 수 있어요.",
  ];
  for (const text of guidance) {
    assert.equal(
      ids(text).includes("false_promise"),
      false,
      `expected no false_promise for: ${text}`,
    );
  }
}

// --- Real overconfident promises must FAIL ---
{
  const promises = [
    "이 보험은 무조건 100% 안전합니다.",
    "사고만 나면 무조건 지급됩니다.",
    "가입하시면 무조건 보장됩니다.",
    "반드시 받을 수 있습니다.",
    "절대 문제 없습니다.",
    "보험금을 받을 수 있습니다.",
    "지금 신청하면 지급됩니다.",
  ];
  for (const text of promises) {
    assert.equal(
      ids(text).includes("false_promise"),
      true,
      `expected false_promise for: ${text}`,
    );
  }
}

console.log("key-persona-v1-journey-checks-unit-test: PASS");
