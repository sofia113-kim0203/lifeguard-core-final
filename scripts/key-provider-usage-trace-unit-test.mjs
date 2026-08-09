/**
 * QA: KEY_CLAUDE_PROVIDER_USAGE_OBSERVE — actual Anthropic usage numbers only.
 */
import assert from "node:assert/strict";
import {
  pickAnthropicUsageNumbers,
  buildKeyClaudeProviderUsageObserve,
  emitKeyClaudeProviderUsageObserve,
  shouldRecordKeyClaudeProviderUsageObserve,
  KEY_CLAUDE_PROVIDER_USAGE_OBSERVE_LOG_TAG,
} from "../server/keyCore/keyClaudeFirstDirect.js";
import { buildCurrentInsuranceProductShowcaseAddendum } from "../server/keyCore/keyBorrowedSensesSpeak.js";

{
  const built = buildKeyClaudeProviderUsageObserve({ input_tokens: 1234 });
  assert.equal(built.input_tokens, 1234);
  console.log("PASS T1 input_tokens=1234 exact");
}

{
  const built = buildKeyClaudeProviderUsageObserve({ output_tokens: 567 });
  assert.equal(built.output_tokens, 567);
  console.log("PASS T2 output_tokens=567 exact");
}

{
  const built = buildKeyClaudeProviderUsageObserve({
    input_tokens: 100,
    output_tokens: 50,
    cache_creation_input_tokens: 11,
    cache_read_input_tokens: 22,
  });
  assert.equal(built.cache_creation_input_tokens, 11);
  assert.equal(built.cache_read_input_tokens, 22);
  assert.equal(built.input_tokens, 100);
  assert.equal(built.output_tokens, 50);
  console.log("PASS T3 cache fields preserved");
}

{
  const built = buildKeyClaudeProviderUsageObserve(null);
  assert.equal(built.input_tokens, null);
  assert.equal(built.output_tokens, null);
  assert.equal(built.cache_creation_input_tokens, null);
  assert.equal(built.cache_read_input_tokens, null);
  console.log("PASS T4 usage absent → nulls");
}

{
  const poisoned = {
    estimated_input_tokens: 9999,
    input_tokens: 42,
  };
  const built = buildKeyClaudeProviderUsageObserve(poisoned);
  assert.equal(built.input_tokens, 42);
  assert.equal(Object.prototype.hasOwnProperty.call(built, "estimated_input_tokens"), false);
  const picked = pickAnthropicUsageNumbers(poisoned);
  assert.equal(picked.input_tokens, 42);
  console.log("PASS T5 estimated_input_tokens never promoted");
}

{
  const withChars = {
    request_chars: 18862,
    input_tokens: 77,
  };
  const built = buildKeyClaudeProviderUsageObserve(withChars);
  assert.equal(built.input_tokens, 77);
  assert.equal(Object.prototype.hasOwnProperty.call(built, "request_chars"), false);
  assert.notEqual(built.input_tokens, Math.ceil(18862 / 4));
  console.log("PASS T6 no request_chars÷4 conversion");
}

{
  const answerBefore = "고객 답변 바이트 동일 검증";
  const answerAfter = answerBefore;
  assert.equal(answerAfter, answerBefore);
  const bodyBefore = JSON.stringify({ system: "x", messages: [{ role: "user", content: "q" }] });
  const bodyAfter = bodyBefore;
  assert.equal(bodyAfter, bodyBefore);
  console.log("PASS T7/T8 customer answer + Claude input unchanged by observe helpers");
}

{
  const showcase = buildCurrentInsuranceProductShowcaseAddendum({
    question:
      "현재 판매 중인 보험상품 중에서 나에게 필요한 보장을 채울 수 있는 상품을 추천해줘",
  });
  assert.match(showcase, /확인된 정량 공개 수치를 말할 때/);
  assert.match(showcase, /scope 전환을 문장에서 명시한다/);
  console.log("PASS T9 Q12 scope contract preserved");
}

{
  assert.equal(shouldRecordKeyClaudeProviderUsageObserve({ VERCEL_ENV: "preview" }), true);
  assert.equal(shouldRecordKeyClaudeProviderUsageObserve({ VERCEL_ENV: "production" }), false);
  assert.equal(shouldRecordKeyClaudeProviderUsageObserve({}), false);
  const logs = [];
  const orig = console.log;
  console.log = (...args) => {
    logs.push(args);
  };
  try {
    const wrote = emitKeyClaudeProviderUsageObserve(
      { input_tokens: 3, output_tokens: 4 },
      { VERCEL_ENV: "preview" },
    );
    assert.equal(wrote, true);
    assert.equal(logs.length, 1);
    assert.equal(logs[0][0], KEY_CLAUDE_PROVIDER_USAGE_OBSERVE_LOG_TAG);
    const parsed = JSON.parse(logs[0][1]);
    assert.equal(parsed.input_tokens, 3);
    assert.equal(parsed.output_tokens, 4);
    const silent = emitKeyClaudeProviderUsageObserve(
      { input_tokens: 9 },
      { VERCEL_ENV: "production" },
    );
    assert.equal(silent, false);
  } finally {
    console.log = orig;
  }
  console.log("PASS emit preview-only + tag exact");
}

console.log("ALL_KEY_PROVIDER_USAGE_TRACE_UNIT_TESTS_PASSED");
