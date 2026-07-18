import assert from "node:assert/strict";
import {
  KEY_TURN_MIRROR_EMPTY,
  KEY_INSURANCE_UPLOAD_GUIDANCE,
  KEY_INSURANCE_UPLOAD_GUIDANCE_SHORT,
  buildMyInsuranceStatus,
  buildKeyTurnMirror,
  isRetiredPolicyRow,
  sumConfirmedMonthlyPremium,
} from "../src/lib/keyInsuranceScreenFacts.js";

assert.match(KEY_INSURANCE_UPLOAD_GUIDANCE, /자동으로 불러오는 연결이 아직 준비되지 않았습니다/);
assert.match(KEY_INSURANCE_UPLOAD_GUIDANCE, /내보험다보여 조회자료/);
assert.match(KEY_INSURANCE_UPLOAD_GUIDANCE, /자동조회 연동이 준비되면/);
assert.equal(/지금 바로 조회|본인인증 버튼|클릭하여 조회/.test(KEY_INSURANCE_UPLOAD_GUIDANCE), false);
assert.match(KEY_INSURANCE_UPLOAD_GUIDANCE_SHORT, /자동으로 불러오는 연결이 아직 준비되지 않았습니다/);
assert.match(KEY_INSURANCE_UPLOAD_GUIDANCE_SHORT, /보험자료를 올려주시면/);

assert.equal(isRetiredPolicyRow({ coverage_summary: { retired_reason: "source_document_deleted" } }), true);
assert.equal(
  isRetiredPolicyRow({
    id: "p1",
    insurer_name: "삼성생명",
    product_name: "종신",
    monthly_premium: 50000,
  }),
  false,
);

const status = buildMyInsuranceStatus([
  {
    id: "p1",
    insurer_name: "삼성생명",
    product_name: "종신",
    monthly_premium: 50000,
  },
  {
    id: "p2",
    insurer_name: "한화생명",
    product_name: null,
    monthly_premium: null,
  },
  {
    id: "gone",
    insurer_name: "삭제보험",
    product_name: "구증권",
    monthly_premium: 10000,
    coverage_summary: { retired_reason: "source_document_deleted" },
  },
]);
assert.equal(status.totalCount, 2);
assert.equal(status.confirmedCount, 1);
assert.equal(status.needsCount, 1);
assert.equal(sumConfirmedMonthlyPremium(status.policies), 50000);
assert.equal(
  status.policies.some((p) => p.id === "gone"),
  false,
  "retired/deleted-source policies excluded from left rail",
);

const emptyMirror = buildKeyTurnMirror({
  answerText: "분당에서 가족 식사하기 좋은 곳 알려드릴게요.",
  visualBlocks: [],
  policies: status.policies,
});
assert.equal(emptyMirror.empty, true);
assert.equal(emptyMirror.emptyMessage, KEY_TURN_MIRROR_EMPTY);

const insuranceMirror = buildKeyTurnMirror({
  answerText:
    "확인된 계약 기준으로 삼성생명 종신 월 50,000원입니다. 소득은 아직 확인이 필요합니다.",
  visualBlocks: [],
  policies: [
    {
      id: "p1",
      insurer_name: "삼성생명",
      product_name: "종신",
      monthly_premium: 50000,
    },
  ],
});
assert.equal(insuranceMirror.empty, false);
assert.ok(insuranceMirror.judgment);
assert.ok(insuranceMirror.confirmed.length >= 1 || insuranceMirror.needsConfirmation.length >= 1);

console.log("PASS key-insurance-screen-facts-unit-test");
