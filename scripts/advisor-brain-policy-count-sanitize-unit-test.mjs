/**
 * Advisor Brain — sanitizeAdvisorBrainMessage policy-count guard unit tests.
 */
import assert from "node:assert/strict";
import { sanitizeAdvisorBrainMessage } from "../server/advisorBrain/advisorBrainGuardrails.js";

const SAFE = "가입 보험은 등록 정보 기준으로 확인 중입니다";

function assertNoPolicyCountDigits(text) {
  assert.doesNotMatch(text, /보험[^.\n]{0,24}[\d,]+\s*건/);
  assert.doesNotMatch(text, /(?:총|합계)\s*[\d,]+\s*건(?:입니다|이에요)?/);
}

// 1 — block bare insurance count
{
  const out = sanitizeAdvisorBrainMessage("보험 6건입니다.", {
    hasPremiumEvidence: false,
    hasCoverageEvidence: true,
  });
  assert.match(out, new RegExp(SAFE));
  assertNoPolicyCountDigits(out);
  assert.doesNotMatch(out, /6\s*건/);
  console.log("1 PASS — 보험 6건입니다");
}

// 2 — block total enrollment count
{
  const out = sanitizeAdvisorBrainMessage("가입 보험은 총 8건입니다.", {
    hasPremiumEvidence: false,
    hasCoverageEvidence: true,
  });
  assert.match(out, new RegExp(SAFE));
  assertNoPolicyCountDigits(out);
  assert.doesNotMatch(out, /8\s*건/);
  console.log("2 PASS — 가입 보험은 총 8건입니다");
}

// 3 — premium with evidence: current guardrail still sanitizes (no bypass in this patch)
{
  const out = sanitizeAdvisorBrainMessage("월 보험료는 318,683원입니다.", {
    hasPremiumEvidence: true,
    hasCoverageEvidence: true,
  });
  assert.equal(out, "월 보험료: 미확인입니다.");
  assert.match(out, /미확인/);
  assert.doesNotMatch(out, /318,683/);
  console.log("3 PASS — premium with evidence follows current guardrail sanitize");
}

// 4 — premium without evidence still sanitized (regression)
{
  const out = sanitizeAdvisorBrainMessage("월 보험료는 318,683원입니다.", {
    hasPremiumEvidence: false,
    hasCoverageEvidence: true,
  });
  assert.match(out, /미확인/);
  assert.doesNotMatch(out, /318,683/);
  console.log("4 PASS — premium without evidence still sanitized");
}

// 5 — non-insurance numbers not over-stripped
{
  const original = "35세 기준으로 검토하면 좋습니다.";
  const out = sanitizeAdvisorBrainMessage(original, {
    hasPremiumEvidence: false,
    hasCoverageEvidence: true,
  });
  assert.equal(out, original);
  assert.match(out, /35세/);
  console.log("5 PASS — age number preserved");
}

// 6 — premium-unknown contract count (not policy inventory) preserved
{
  const original = "월 보험료가 확인되지 않은 계약이 1건 있습니다.";
  const out = sanitizeAdvisorBrainMessage(original, {
    hasPremiumEvidence: false,
    hasCoverageEvidence: true,
  });
  assert.match(out, /1건/);
  console.log("6 PASS — premium-unknown contract count preserved");
}

// 7 — additional blocked phrasing samples
{
  const samples = [
    "보유 보험 4건으로 확인됩니다.",
    "확인되는 보험은 6건입니다.",
    "등록된 가입 보험 6건을 먼저 확인했습니다.",
  ];
  for (const sample of samples) {
    const out = sanitizeAdvisorBrainMessage(sample, {
      hasPremiumEvidence: false,
      hasCoverageEvidence: true,
    });
    assertNoPolicyCountDigits(out);
    assert.match(out, new RegExp(SAFE));
  }
  console.log("7 PASS — additional blocked phrasing samples");
}

console.log("\nAll advisor-brain policy-count sanitize tests passed.");
