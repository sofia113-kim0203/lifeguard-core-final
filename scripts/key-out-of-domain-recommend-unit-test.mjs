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
import { shouldEnablePublicWebSearch } from "../server/keyCore/keyBorrowedSensesSpeak.js";

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

const helloSystem = composeClaudeFirstSystemText({
  question: "안녕하세요",
  history: [],
});
assert.equal(/야키토리 골목/.test(helloSystem), false);
assert.equal(/추가 질문 중단/.test(helloSystem), false);

console.log("key-out-of-domain-recommend-unit-test: PASS");
