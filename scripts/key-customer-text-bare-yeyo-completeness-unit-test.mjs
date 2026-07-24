/**
 * Regression — scoped claim-zero bare-yeyo completeness (HG mbs55pbpk).
 * 1) in-progress claim 0 + phrase → repair to 없어요
 * 2) in-progress claim ≠ 0 → no auto-negation repair
 * 3) "정답은 예요 / 보장은 예요" → never → 없어요
 * 4) "그거예요 / 이미 없어요" → unchanged
 */
import assert from "node:assert/strict";
import {
  hasBareTopicYeyoHardIncompleteness,
  hasInProgressClaimZeroBareYeyoPhrase,
  repairInProgressClaimZeroBareYeyo,
} from "../server/keyCore/keyCustomerTextCompleteness.js";
import { koreanCompleteness } from "../server/keyCore/keyVoiceGate.js";
import { sealKeyCustomerText } from "../server/keyCore/keyCustomerTextSeal.js";

const HG_FAIL_OPENING =
  "지금 기록상 **진행 중인 청구 건**은 예요.\n\n---\n\n**⏳ 암 청구 — 거절, 사유 미확인**";
const HG_FAIL_FIRST = "지금 기록상 **진행 중인 청구 건**은 예요.";

// Gate detection stays general.
assert.equal(hasBareTopicYeyoHardIncompleteness(HG_FAIL_FIRST), true);
assert.equal(koreanCompleteness(HG_FAIL_FIRST), false);
assert.equal(hasInProgressClaimZeroBareYeyoPhrase(HG_FAIL_OPENING), true);

// 1) verified in-progress == 0 → repair
const repaired = repairInProgressClaimZeroBareYeyo(HG_FAIL_OPENING, {
  verifiedInProgressClaimCount: 0,
});
assert.equal(repaired.completeness_guard.applied, true);
assert.equal(repaired.completeness_guard.reason, "in_progress_claim_zero_bare_yeyo");
assert.match(repaired.customerText, /청구 건\*\*은 없어요/);
assert.equal(/은 예요/.test(repaired.customerText), false);
assert.match(repaired.customerText, /\n\n---\n\n/);
assert.equal(
  koreanCompleteness("지금 기록상 **진행 중인 청구 건**은 없어요."),
  true,
);
const sealed = sealKeyCustomerText(repaired.customerText);
assert.match(sealed.key_speak_original, /없어요/);

// 2) verified in-progress != 0 → no auto-negation repair
const blockedByCount = repairInProgressClaimZeroBareYeyo(HG_FAIL_OPENING, {
  verifiedInProgressClaimCount: 1,
});
assert.equal(blockedByCount.completeness_guard.applied, false);
assert.equal(
  blockedByCount.completeness_guard.reason,
  "bare_topic_yeyo_hard_incomplete",
);
assert.equal(blockedByCount.completeness_guard.repair_blocked, true);
assert.equal(blockedByCount.customerText, HG_FAIL_OPENING);

const blockedNullCount = repairInProgressClaimZeroBareYeyo(HG_FAIL_OPENING, {
  verifiedInProgressClaimCount: null,
});
assert.equal(blockedNullCount.completeness_guard.applied, false);
assert.equal(blockedNullCount.customerText, HG_FAIL_OPENING);

// 3) other bare yeyo → never map to 없어요
for (const sample of ["정답은 예요.", "보장은 예요."]) {
  assert.equal(hasBareTopicYeyoHardIncompleteness(sample), true);
  assert.equal(hasInProgressClaimZeroBareYeyoPhrase(sample), false);
  assert.equal(koreanCompleteness(sample), false);
  const out = repairInProgressClaimZeroBareYeyo(sample, {
    verifiedInProgressClaimCount: 0,
  });
  assert.equal(out.completeness_guard.applied, false, sample);
  assert.equal(out.completeness_guard.reason, "bare_topic_yeyo_hard_incomplete", sample);
  assert.equal(/없어요/.test(out.customerText), false, sample);
  assert.equal(out.customerText, sample, sample);
}

// 4) intact forms
for (const sample of [
  "지금 기록상 **진행 중인 청구 건**은 없어요.",
  "중요한 건 그거예요.",
  "맞는 답은 그거예요.",
]) {
  const out = repairInProgressClaimZeroBareYeyo(sample, {
    verifiedInProgressClaimCount: 0,
  });
  assert.equal(out.completeness_guard.applied, false, sample);
  assert.equal(out.customerText, sample, sample);
  assert.equal(hasBareTopicYeyoHardIncompleteness(sample), false, sample);
}

console.log("BARE_TOPIC_YEYO_COMPLETENESS_OK");
