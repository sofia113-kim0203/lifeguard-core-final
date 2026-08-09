/**
 * Q8/Q9 — Product Showcase public-numeric search-or-silence contract (addendum only).
 */
import assert from "node:assert/strict";
import { buildCurrentInsuranceProductShowcaseAddendum } from "../server/keyCore/keyBorrowedSensesSpeak.js";

const PRODUCT_Q =
  "현재 판매 중인 보험상품 중에서 나에게 필요한 보장을 채울 수 있는 상품을 추천해줘";

const showcase = buildCurrentInsuranceProductShowcaseAddendum({ question: PRODUCT_Q });
assert.match(showcase, /\[CURRENT_INSURANCE_PRODUCT_SHOWCASE\]/);

{
  assert.match(showcase, /web_search가 실행됐다는 사실만으로/);
  assert.match(showcase, /정량 공개 수치를 말해도 된다고 해석하지 않는다/);
  console.log("PASS T1 web_search execution alone ≠ number permission");
}

{
  assert.match(showcase, /퍼센트/);
  assert.match(showcase, /환자 수/);
  assert.match(showcase, /증감률/);
  assert.match(showcase, /순위/);
  assert.match(showcase, /배수/);
  assert.match(showcase, /시장 수치/);
  assert.match(
    showcase,
    /이번 턴 검색 결과에서 그 정확한 수치를 실제로 확인했다고 판단할 수 있을 때만/,
  );
  console.log("PASS T2 exact search confirmation required before quant claims");
}

{
  assert.match(showcase, /정확한 수치가 확인되지 않으면 숫자를 생략하고 질적으로만 설명한다/);
  assert.match(showcase, /기억·추정·일반지식·합성으로 보충하지 않는다/);
  assert.match(showcase, /'약 ○만'·'○% 증가'·'○배'·'몇 위'·'30~50%'/);
  console.log("PASS T3 qualitative fallback when unconfirmed");
}

{
  assert.match(showcase, /검색 결과에서 실제로 확인된 수치는 그대로 사용해도 된다/);
  assert.doesNotMatch(showcase, /모든 숫자를 금지|숫자를 절대 말하지/);
  console.log("PASS T4 supported confirmed numbers still allowed");
}

{
  assert.match(
    showcase,
    /검색 결과에 없는 상품명·상품 계열을 공식 상품명처럼 만들지 않는다/,
  );
  assert.match(showcase, /현재 판매 확인 우선 근거/);
  assert.match(showcase, /월보험료 숫자는/);
  assert.match(
    showcase,
    /고객의 개인 보장 공백 비교는 insurance_contracts 또는 confirmed_facts에 확인 근거가 있을 때만 한다/,
  );
  console.log("PASS T5 product name / current-sale / premium / personal fact preserved");
}

{
  assert.match(showcase, /정량 공개 수치/);
  assert.match(showcase, /질환 통계·발병률·유병률/);
  console.log("PASS T6 Q8 existing rule meaning preserved (strengthened in place)");
}

{
  const empty = buildCurrentInsuranceProductShowcaseAddendum({
    question: "오늘 날씨 어때?",
  });
  assert.equal(empty, "");
  console.log("PASS non-product ask → no showcase addendum");
}

console.log("ALL_Q8_Q9_PRODUCT_PUBLIC_NUMERIC_CONTRACT_UNIT_TESTS_PASSED");
