/**
 * Q8/Q9/Q12 — Product Showcase public-numeric grounding + scope preservation (addendum only).
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
  console.log("PASS Q8/Q9 T1 web_search execution alone ≠ number permission");
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
  console.log("PASS Q8/Q9 T2 exact search confirmation required before quant claims");
}

{
  assert.match(showcase, /정확한 수치가 확인되지 않으면 숫자를 생략하고 질적으로만 설명한다/);
  assert.match(showcase, /기억·추정·일반지식·합성으로 보충하지 않는다/);
  assert.match(showcase, /'약 ○만'·'○% 증가'·'○배'·'몇 위'·'30~50%'/);
  console.log("PASS Q8/Q9 T3 qualitative fallback when unconfirmed");
}

{
  assert.match(showcase, /검색 결과에서 실제로 확인된 수치는 그대로 사용해도 된다/);
  assert.doesNotMatch(showcase, /모든 숫자를 금지|숫자를 절대 말하지/);
  console.log("PASS Q8/Q9 T4 supported confirmed numbers still allowed");
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
  console.log("PASS Q8/Q9 T5 product name / current-sale / premium / personal fact preserved");
}

{
  assert.match(showcase, /정량 공개 수치/);
  assert.match(showcase, /질환 통계·발병률·유병률/);
  console.log("PASS Q8/Q9 T6 existing rule meaning preserved");
}

{
  // Q12 T1 — geography preservation
  assert.match(showcase, /지역\(한국·전 세계·국가·지역\)/);
  assert.match(showcase, /글로벌 수치를 한국 통계처럼, 또는 그 반대로 말하지 않는다/);
  console.log("PASS Q12 T1 geography preservation");
}

{
  // Q12 T2 — year preservation
  assert.match(showcase, /연도\/기간/);
  assert.match(showcase, /전 세계 GBD 2021 기준으로는/);
  console.log("PASS Q12 T2 year preservation");
}

{
  // Q12 T3 — metric/denominator preservation
  assert.match(showcase, /분모\/지표/);
  assert.match(showcase, /발생 비중/);
  assert.match(showcase, /DALY 비중/);
  assert.match(
    showcase,
    /환자 수·발생건수·발생 비중·DALY·사망순위를 같은 종류의 통계처럼 합쳐 말하지 않는다/,
  );
  console.log("PASS Q12 T3 metric/denominator preservation");
}

{
  // Q12 T4 — population preservation
  assert.match(showcase, /모집단\(진료환자·발생건수·전체 인구 등\)/);
  assert.match(showcase, /진료환자/);
  assert.match(showcase, /발생건수/);
  console.log("PASS Q12 T4 population preservation");
}

{
  // Q12 T5 — scope transition
  assert.match(showcase, /서로 다른 scope의 근거를 이어서 쓸 때는/);
  assert.match(showcase, /scope 전환을 문장에서 명시한다/);
  assert.match(showcase, /한국 2022년 심평원 진료환자 기준으로는/);
  console.log("PASS Q12 T5 scope transition required");
}

{
  // Q12 T6 — supported numeric still allowed
  assert.match(showcase, /숫자 사용 자체를 금지하지 않는다/);
  assert.match(showcase, /scope가 정확하면 확인된 수치는 말한다/);
  assert.match(showcase, /검색 결과에서 실제로 확인된 수치는 그대로 사용해도 된다/);
  console.log("PASS Q12 T6 supported numeric still allowed");
}

{
  // Q12 T7 — Q8/Q9 contract preserved (re-assert core phrases)
  assert.match(showcase, /web_search가 실행됐다는 사실만으로/);
  assert.match(
    showcase,
    /이번 턴 검색 결과에서 그 정확한 수치를 실제로 확인했다고 판단할 수 있을 때만/,
  );
  assert.match(showcase, /기억·추정·일반지식·합성으로 보충하지 않는다/);
  assert.match(showcase, /정확한 수치가 확인되지 않으면 숫자를 생략하고 질적으로만 설명한다/);
  console.log("PASS Q12 T7 Q8/Q9 contract preserved");
}

{
  // Q12 T8 — product rules preserved
  assert.match(
    showcase,
    /검색 결과에 없는 상품명·상품 계열을 공식 상품명처럼 만들지 않는다/,
  );
  assert.match(showcase, /현재 판매 확인 우선 근거/);
  assert.match(showcase, /월보험료 숫자는/);
  console.log("PASS Q12 T8 product name/current-sale/premium rules preserved");
}

{
  // Q12 T9 — personal verified facts rule preserved
  assert.match(
    showcase,
    /고객의 개인 보장 공백 비교는 insurance_contracts 또는 confirmed_facts에 확인 근거가 있을 때만 한다/,
  );
  console.log("PASS Q12 T9 personal verified facts rule preserved");
}

{
  const empty = buildCurrentInsuranceProductShowcaseAddendum({
    question: "오늘 날씨 어때?",
  });
  assert.equal(empty, "");
  console.log("PASS non-product ask → no showcase addendum");
}

console.log("ALL_Q8_Q9_Q12_PRODUCT_PUBLIC_NUMERIC_SCOPE_CONTRACT_UNIT_TESTS_PASSED");
