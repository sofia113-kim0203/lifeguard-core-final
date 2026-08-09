/**
 * Q8 — Product Showcase public-numeric search-or-silence contract (addendum only).
 */
import assert from "node:assert/strict";
import { buildCurrentInsuranceProductShowcaseAddendum } from "../server/keyCore/keyBorrowedSensesSpeak.js";

const PRODUCT_Q =
  "현재 판매 중인 보험상품 중에서 나에게 필요한 보장을 채울 수 있는 상품을 추천해줘";

const showcase = buildCurrentInsuranceProductShowcaseAddendum({ question: PRODUCT_Q });
assert.match(showcase, /\[CURRENT_INSURANCE_PRODUCT_SHOWCASE\]/);

{
  assert.match(showcase, /정량 공개 수치/);
  assert.match(showcase, /web_search|권위 있는 공개 출처/);
  assert.match(showcase, /실제로 확인된 경우에만/);
  console.log("PASS T1 unsupported public percentage → search-or-silence contract present");
}

{
  assert.match(showcase, /검색으로 확인된 수치는 그대로 사용해도 된다/);
  assert.doesNotMatch(showcase, /모든 숫자를 금지|숫자를 절대 말하지|퍼센트 사용 금지/);
  console.log("PASS T2 supported numbers still allowed");
}

{
  assert.match(showcase, /정확한 수치가 확인되지 않으면 숫자를 생략하고 질적으로만 설명한다/);
  assert.match(showcase, /기억·추정·합성·보간으로 채우지 않는다/);
  console.log("PASS T3 unsupported → qualitative fallback");
}

{
  assert.match(
    showcase,
    /검색 결과에 없는 상품명·상품 계열을 공식 상품명처럼 만들지 않는다/,
  );
  console.log("PASS T4 product name rule preserved");
}

{
  assert.match(showcase, /현재 판매 확인 우선 근거/);
  assert.match(
    showcase,
    /공식 마케팅 페이지가 열리는 것만으로 현재 판매 중이라고 단정하지 않는다/,
  );
  console.log("PASS T5 current-sale rule preserved");
}

{
  assert.match(showcase, /월보험료 숫자는/);
  assert.match(
    showcase,
    /'월 5~10만 원'·'월 7~12만 원'·'대략 이 정도' 같은 숫자 범위를 만들지 말고/,
  );
  console.log("PASS T6 premium rule preserved");
}

{
  assert.match(
    showcase,
    /고객의 개인 보장 공백 비교는 insurance_contracts 또는 confirmed_facts에 확인 근거가 있을 때만 한다/,
  );
  console.log("PASS T7 personal fact rule preserved");
}

{
  const empty = buildCurrentInsuranceProductShowcaseAddendum({
    question: "오늘 날씨 어때?",
  });
  assert.equal(empty, "");
  console.log("PASS non-product ask → no showcase addendum");
}

console.log("ALL_Q8_PRODUCT_PUBLIC_NUMERIC_CONTRACT_UNIT_TESTS_PASSED");
