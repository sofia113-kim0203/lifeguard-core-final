import assert from "node:assert/strict";
import {
  KEY_TURN_MIRROR_EMPTY,
  KEY_INSURANCE_UPLOAD_GUIDANCE,
  KEY_INSURANCE_UPLOAD_GUIDANCE_SHORT,
  BASELINE_STATUS,
  buildMyInsuranceStatus,
  buildKeyTurnMirror,
  buildIndustryCoverageBaseline,
  classifyCoverageToBaselineItem,
  collectVerifiedCoverageRows,
  evaluateLumpSumBaselineStatus,
  formatManwonAmount,
  isRetiredPolicyRow,
  sumConfirmedMonthlyPremium,
} from "../src/lib/keyInsuranceScreenFacts.js";
import { KEY_INDUSTRY_COVERAGE_BASELINE_ITEMS } from "../src/lib/keyIndustryCoverageBaselineTable.js";

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

const deduped = buildMyInsuranceStatus([
  {
    id: "d1",
    insurer_name: "KB손해보험",
    product_name: "자녀보험",
    monthly_premium: 42860,
  },
  {
    id: "d2",
    insurer_name: "KB손해보험",
    product_name: "자녀보험",
    monthly_premium: 42860,
  },
]);
assert.equal(deduped.totalCount, 1, "left rail drops duplicate insurer+product+premium cards");

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

// --- KEY 업계누적 보장 기준선 v1 ---
assert.equal(KEY_INDUSTRY_COVERAGE_BASELINE_ITEMS.length, 7);
assert.equal(classifyCoverageToBaselineItem("뇌출혈 진단비"), null, "뇌출혈 ≠ 뇌혈관질환");
assert.equal(classifyCoverageToBaselineItem("급성심근경색 진단비"), null, "급성심근경색 ≠ 허혈성심장질환");
assert.equal(classifyCoverageToBaselineItem("뇌혈관질환 진단비"), "cerebrovascular_diagnosis");
assert.equal(classifyCoverageToBaselineItem("허혈성심장질환 진단비"), "ischemic_heart_diagnosis");
assert.equal(classifyCoverageToBaselineItem("유사암 진단비"), null, "유사암은 일반암 합산 제외");
assert.equal(classifyCoverageToBaselineItem("암진단비"), "cancer_diagnosis");

const deletedPolicyRows = collectVerifiedCoverageRows([
  {
    id: "gone",
    insurer_name: "삭제보험",
    product_name: "구증권",
    coverage_summary: {
      retired_reason: "source_document_deleted",
      rider_details: [{ rider_name: "암진단비", coverage_amount: 30000000 }],
    },
  },
]);
assert.equal(deletedPolicyRows.length, 0, "삭제 문서 유래 담보 제외");

const aliasDup = collectVerifiedCoverageRows([
  {
    id: "p-alias",
    insurer_name: "삼성화재",
    product_name: "종합",
    coverage_summary: {
      rider_details: [
        { rider_name: "암 진단비", coverage_amount: 30000000 },
        { rider_name: "암진단비", coverage_amount: 30000000 },
      ],
    },
  },
]);
assert.equal(aliasDup.length, 1, "같은 특약 별칭·동일금액 중복합산 방지");

const baselineEmptyTable = buildIndustryCoverageBaseline([
  {
    id: "p-brain-narrow",
    insurer_name: "A손보",
    product_name: "건강",
    coverage_summary: {
      rider_details: [{ rider_name: "뇌출혈 진단비", coverage_amount: 10000000 }],
    },
  },
]);
const brainItem = baselineEmptyTable.items.find((i) => i.id === "cerebrovascular_diagnosis");
assert.ok(brainItem);
assert.equal(brainItem.includedCoverages.length, 0, "좁은 뇌출혈을 뇌혈관 합산에 넣지 않음");
assert.equal(brainItem.status, BASELINE_STATUS.NEED, "금액 미확인 → 현재 미확인(확인 필요)");
assert.equal(brainItem.industry_range_low, 10000000);
assert.equal(brainItem.industry_representative, 20000000);
assert.equal(brainItem.industry_range_high, 30000000);

const unclearBaseline = buildIndustryCoverageBaseline([
  {
    id: "p-unclear",
    insurer_name: "B생명",
    product_name: "보장",
    coverage_summary: {
      rider_details: [{ rider_name: "암진단비", coverage_amount: null }],
    },
  },
]);
// Comparison baseline present; null current amount → 확인 필요 (현재 미확인).
assert.equal(
  unclearBaseline.items.find((i) => i.id === "cancer_diagnosis").status,
  BASELINE_STATUS.NEED,
);

// Inject temporary ranges only inside this test object to validate amount rules.
const withRanges = buildIndustryCoverageBaseline([
  {
    id: "p-cancer",
    insurer_name: "C생명",
    product_name: "보장",
    coverage_summary: {
      rider_details: [{ rider_name: "암진단비", coverage_amount: 50000000 }],
    },
  },
]);
assert.equal(withRanges.items.find((i) => i.id === "cancer_diagnosis").currentAmount, 50000000);
assert.equal(formatManwonAmount(80000000), "8,000만원");
assert.equal(formatManwonAmount(50000000), "5,000만원");

const seatLike = buildIndustryCoverageBaseline([
  {
    id: "v1",
    insurer_name: "KB손해보험",
    coverage_summary: {
      rider_details: [
        { rider_name: "암진단비", coverage_amount: 50000000 },
        { rider_name: "뇌출혈 진단비", coverage_amount: 10000000 },
      ],
    },
  },
  {
    id: "v2",
    insurer_name: "한화생명",
    coverage_summary: {
      rider_details: [{ rider_name: "암진단비", coverage_amount: 30000000 }],
    },
  },
]);
const seatCancer = seatLike.items.find((i) => i.id === "cancer_diagnosis");
assert.equal(seatCancer.currentDisplay, "8,000만원");
assert.equal(seatCancer.status, BASELINE_STATUS.OVERLAP, "8000만 > high 7000만 → 중복·보험료 점검");
assert.equal(seatCancer.showCompareBar, true, "금액형 비교 기준선 있으면 그래프 활성");
assert.equal(seatCancer.industry_representative, 50000000);
assert.match(String(seatCancer.sourceDisplay), /비교 기준선/);
assert.equal(
  seatLike.items.find((i) => i.id === "cerebrovascular_diagnosis").includedCoverages.length,
  0,
  "뇌출혈 미합산",
);
assert.ok(
  seatLike.items
    .filter((i) =>
      ["caregiving", "hospital_daily", "surgery", "major_treatment"].includes(i.id),
    )
    .every((i) => i.status === BASELINE_STATUS.TABLE_PENDING && i.industry_range_low == null),
  "구조형 4개는 금액 기준선 null · 기준 확인 중",
);

// Restaurant turn must not be intercepted by baseline (mirror empty; baseline still builds).
const restaurantMirror = buildKeyTurnMirror({
  answerText: "분당에 한식당 소개시켜줄게요.",
  visualBlocks: [],
  policies: [],
});
assert.equal(restaurantMirror.empty, true);
assert.ok(buildIndustryCoverageBaseline([]).items.length === 7);

assert.equal(evaluateLumpSumBaselineStatus(null, 30000000, 100000000), BASELINE_STATUS.NEED);
assert.equal(evaluateLumpSumBaselineStatus(20000000, 30000000, 100000000), BASELINE_STATUS.SHORT);
assert.equal(evaluateLumpSumBaselineStatus(50000000, 30000000, 100000000), BASELINE_STATUS.MET);
assert.equal(evaluateLumpSumBaselineStatus(150000000, 30000000, 100000000), BASELINE_STATUS.OVERLAP);
assert.equal(evaluateLumpSumBaselineStatus(50000000, null, null), BASELINE_STATUS.TABLE_PENDING);

// v1 comparison: amount cards have low/representative/high; structured stay null.
const amountIds = new Set([
  "cancer_diagnosis",
  "cerebrovascular_diagnosis",
  "ischemic_heart_diagnosis",
]);
for (const item of KEY_INDUSTRY_COVERAGE_BASELINE_ITEMS) {
  if (amountIds.has(item.id)) {
    assert.equal(typeof item.industry_range_low, "number");
    assert.equal(typeof item.industry_representative, "number");
    assert.equal(typeof item.industry_range_high, "number");
    assert.equal(item.source_kind, "key_comparison_v1");
  } else {
    assert.equal(item.industry_range_low, null);
    assert.equal(item.industry_representative, null);
    assert.equal(item.industry_range_high, null);
    assert.equal(item.source_kind, "none");
  }
}
assert.equal(
  KEY_INDUSTRY_COVERAGE_BASELINE_ITEMS.find((i) => i.id === "cancer_diagnosis").industry_range_low,
  30000000,
);
assert.equal(
  KEY_INDUSTRY_COVERAGE_BASELINE_ITEMS.find((i) => i.id === "cancer_diagnosis")
    .industry_representative,
  50000000,
);
assert.equal(
  KEY_INDUSTRY_COVERAGE_BASELINE_ITEMS.find((i) => i.id === "cancer_diagnosis").industry_range_high,
  70000000,
);

console.log("PASS key-insurance-screen-facts-unit-test");
