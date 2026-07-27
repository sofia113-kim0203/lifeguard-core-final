/**
 * Out-of-domain place recommend completion — stop-asking + sufficient context + web_search path.
 */
import assert from "node:assert/strict";
import {
  isStopAskingRecommendIntent,
  hasSufficientPlaceRecommendContext,
  collectPlaceRecommendSignals,
  buildOutOfDomainPlaceRecommendAddendum,
} from "../server/keyCore/keyOutOfDomainRecommend.js";
import { composeClaudeFirstSystemText } from "../server/keyCore/keyClaudeFirstDirect.js";
import {
  shouldEnablePublicWebSearch,
  isExplicitCurrentInsuranceProductRequest,
  buildCurrentInsuranceProductShowcaseAddendum,
} from "../server/keyCore/keyBorrowedSensesSpeak.js";

assert.equal(isStopAskingRecommendIntent("어딘지 소개만 시켜줘 그만 물어보고"), true);
assert.equal(isStopAskingRecommendIntent("그냥 추천해줘"), true);
assert.equal(isStopAskingRecommendIntent("알아서 골라줘"), true);
assert.equal(isStopAskingRecommendIntent("그만 물어봐"), true);
assert.equal(isStopAskingRecommendIntent("분당 맛집 추천해줘"), false);

const history = [
  { role: "user", content: "분당 맛집 추천해줘." },
  { role: "assistant", content: "어떤 음식이 좋으세요?" },
  { role: "user", content: "정자동 카카오 사거리 근처 3명." },
  { role: "assistant", content: "음식 종류를 알려주시면 더 맞춰드릴게요." },
  { role: "user", content: "일식 저녁." },
  { role: "assistant", content: "분위기도 알려주시면 좋아요." },
  { role: "user", content: "이자카야 스타일." },
];

const signals = collectPlaceRecommendSignals({
  question: "어딘지 소개만 시켜줘 그만 물어보고.",
  history,
});
assert.equal(signals.location, true);
assert.equal(signals.party, true);
assert.equal(signals.time, true);
assert.equal(signals.cuisine_or_style, true);
assert.equal(signals.sufficient, true);
assert.equal(
  hasSufficientPlaceRecommendContext({
    question: "어딘지 소개만 시켜줘 그만 물어보고.",
    history,
  }),
  true,
);

const addendum = buildOutOfDomainPlaceRecommendAddendum({
  question: "어딘지 소개만 시켜줘 그만 물어보고.",
  history,
});
assert.match(addendum, /추가 질문/);
assert.match(addendum, /즉시 금지|바로 추천/);
assert.match(addendum, /web_search|공개 검색/);
assert.match(addendum, /야키토리 골목|미확인/);
assert.match(addendum, /보험으로 주제를 바꾸지/);

const system = composeClaudeFirstSystemText({
  question: "어딘지 소개만 시켜줘 그만 물어보고.",
  history,
});
assert.match(system, /추가 질문 중단|소개만|그냥 추천/);
assert.match(system, /즉시 금지|바로 제시/);
assert.match(system, /web_search|공개 검색/);

// Existing web_search enablement path reused for place thread + stop-ask.
assert.equal(
  shouldEnablePublicWebSearch({
    question: "어딘지 소개만 시켜줘 그만 물어보고.",
    history,
  }),
  true,
);
assert.equal(
  shouldEnablePublicWebSearch({
    question: "안녕하세요",
    history: [],
  }),
  false,
);
assert.equal(
  shouldEnablePublicWebSearch({
    question: "암 보장 보완 방향 짧게 추천해 주세요.",
    history: [],
  }),
  false,
);

// Explicit current-product showcase: web_search on (same Claude; insurance alone does not block).
const productAsk =
  "내 상황에 맞는 현재 판매 중인 암보험 상품 2~3개를 보험회사, 상품명, 대략적인 월보험료, 추천 이유와 함께 알려줘.";
assert.equal(isExplicitCurrentInsuranceProductRequest(productAsk), true);
assert.equal(shouldEnablePublicWebSearch({ question: productAsk, history: [] }), true);
assert.equal(
  isExplicitCurrentInsuranceProductRequest("암보험이 뭐예요? 보장 구조만 설명해 주세요."),
  false,
);
assert.equal(
  shouldEnablePublicWebSearch({
    question: "암보험이 뭐예요? 보장 구조만 설명해 주세요.",
    history: [],
  }),
  false,
);
assert.equal(
  isExplicitCurrentInsuranceProductRequest("지금 가입할 수 있는 암보험 공식 상품과 보험료 예시 알려줘"),
  true,
);
assert.equal(
  isExplicitCurrentInsuranceProductRequest("여러 회사 상품 소개해줘. 보험회사와 상품명 알려줘"),
  true,
);

const productAddendum = buildCurrentInsuranceProductShowcaseAddendum({ question: productAsk });
assert.match(productAddendum, /web_search_20250305|web_search/);
assert.match(productAddendum, /고객 이름|생년월일|병력|청구 정보/);
assert.match(productAddendum, /공식 상품명|현재 판매 확인|2026-07-27/);
assert.match(productAddendum, /월보험료를 숫자로 제시하지|월 5~10만|월 7~12만/);
assert.match(productAddendum, /부족한 수를 지어내지|검색 결과에 없는 상품명/);
assert.match(productAddendum, /마케팅 페이지가 열리는 것만으로|현재 판매 중이라고 단정하지/);
assert.match(productAddendum, /가격공시실|판매 시작일|상품설계가 가능한 공식 화면/);
assert.match(productAddendum, /현재 판매 여부는 확인되지 않았습니다/);
assert.match(productAddendum, /2607|전체 이름을 그대로/);
assert.match(productAddendum, /공식 예시라고 명시|임의 보간하지/);
assert.match(productAddendum, /확인되지 않았다.?고 답하지/);
assert.match(productAddendum, /만 55~56세|만 나이를 한 살로 확정하지/);
assert.match(productAddendum, /거절·부담보 가능성이 높다고 선판단하지/);
assert.match(productAddendum, /저와 함께 실제 견적을 내보겠습니다/);
assert.match(productAddendum, /보험사 공식 보험료 계산 또는 설계 상담이 필요합니다/);

const productSystem = composeClaudeFirstSystemText({
  question: productAsk,
  history: [],
});
assert.match(productSystem, /CURRENT_INSURANCE_PRODUCT_SHOWCASE/);
assert.match(productSystem, /공식 예시 보험료|월보험료를 숫자로 제시하지/);
assert.match(productSystem, /웹 검색 query에는 고객 이름/);
assert.match(productSystem, /마케팅 페이지가 열리는 것만으로/);
assert.match(productSystem, /보험사 공식 보험료 계산 또는 설계 상담이 필요합니다/);

const helloSystem = composeClaudeFirstSystemText({
  question: "안녕하세요",
  history: [],
});
assert.equal(/야키토리 골목/.test(helloSystem), false);
assert.equal(/추가 질문 중단/.test(helloSystem), false);
assert.equal(/CURRENT_INSURANCE_PRODUCT_SHOWCASE/.test(helloSystem), false);

console.log("key-out-of-domain-recommend-unit-test: PASS");
