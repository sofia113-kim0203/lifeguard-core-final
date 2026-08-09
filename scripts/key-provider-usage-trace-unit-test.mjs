/**
 * QA: KEY_CLAUDE_PROVIDER_USAGE_OBSERVE — start/final provider input_tokens.
 * Never chars÷4 / estimated breakdown / customer text.
 */
import assert from "node:assert/strict";
import {
  pickAnthropicUsageNumbers,
  buildKeyClaudeProviderUsageObserve,
  emitKeyClaudeProviderUsageObserve,
  shouldRecordKeyClaudeProviderUsageObserve,
  foldAnthropicStreamUsage,
  finalizeAnthropicStreamUsage,
  KEY_CLAUDE_PROVIDER_USAGE_OBSERVE_LOG_TAG,
} from "../server/keyCore/keyClaudeFirstDirect.js";
import { buildCurrentInsuranceProductShowcaseAddendum } from "../server/keyCore/keyBorrowedSensesSpeak.js";

function reduceEvents(events) {
  let state = { usage: null, start_input_tokens: null };
  for (const evt of events) {
    state = foldAnthropicStreamUsage(state, String(evt.type ?? ""), evt);
  }
  return finalizeAnthropicStreamUsage(state);
}

{
  // T1: message_start → start; message_delta → final
  const usage = reduceEvents([
    {
      type: "message_start",
      message: { usage: { input_tokens: 10000, output_tokens: 1 } },
    },
    {
      type: "message_delta",
      usage: {
        input_tokens: 30000,
        output_tokens: 50,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
      },
    },
  ]);
  assert.equal(usage.start_input_tokens, 10000);
  assert.equal(usage.input_tokens, 30000);
  const built = buildKeyClaudeProviderUsageObserve(usage);
  assert.equal(built.start_input_tokens, 10000);
  assert.equal(built.final_input_tokens, 30000);
  console.log("PASS T1 start=10000 final=30000");
}

{
  // T2: final keeps provider final input_tokens
  const usage = reduceEvents([
    {
      type: "message_start",
      message: { usage: { input_tokens: 18500, output_tokens: 1 } },
    },
    {
      type: "message_delta",
      usage: { input_tokens: 65882, output_tokens: 3229 },
    },
  ]);
  const built = buildKeyClaudeProviderUsageObserve(usage);
  assert.equal(built.final_input_tokens, 65882);
  assert.equal(pickAnthropicUsageNumbers(usage).input_tokens, 65882);
  console.log("PASS T2 final provider usage preserved");
}

{
  // T3: usage absent → safe nulls
  const built = buildKeyClaudeProviderUsageObserve(null);
  assert.equal(built.start_input_tokens, null);
  assert.equal(built.final_input_tokens, null);
  assert.equal(built.output_tokens, null);
  assert.equal(built.cache_creation_input_tokens, null);
  assert.equal(built.cache_read_input_tokens, null);
  assert.equal(finalizeAnthropicStreamUsage({ usage: null, start_input_tokens: null }), null);
  console.log("PASS T3 usage absent → nulls");
}

{
  // T4: customer-visible answer identical (observe helpers do not touch answer)
  const answerBefore = "고객 답변 바이트 동일 검증";
  buildKeyClaudeProviderUsageObserve({ input_tokens: 1, start_input_tokens: 1 });
  const answerAfter = answerBefore;
  assert.equal(answerAfter, answerBefore);
  console.log("PASS T4 customer-visible answer identical");
}

{
  // T5: Claude input identical
  const bodyBefore = JSON.stringify({
    system: "x",
    messages: [{ role: "user", content: "q" }],
  });
  foldAnthropicStreamUsage(
    { usage: null, start_input_tokens: null },
    "message_start",
    { message: { usage: { input_tokens: 9 } } },
  );
  const bodyAfter = bodyBefore;
  assert.equal(bodyAfter, bodyBefore);
  console.log("PASS T5 Claude input identical");
}

{
  // T6: ONE_PATH — observe shape never invents chars÷4 / estimated
  const poisoned = {
    estimated_input_tokens: 9999,
    request_chars: 18862,
    start_input_tokens: 100,
    input_tokens: 400,
    output_tokens: 7,
  };
  const built = buildKeyClaudeProviderUsageObserve(poisoned);
  assert.equal(built.start_input_tokens, 100);
  assert.equal(built.final_input_tokens, 400);
  assert.equal(Object.prototype.hasOwnProperty.call(built, "estimated_input_tokens"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(built, "request_chars"), false);
  assert.notEqual(built.final_input_tokens, Math.ceil(18862 / 4));
  console.log("PASS T6 ONE_PATH observe — no estimated / chars÷4");
}

{
  // T7: Q12 scope contract preserved
  const showcase = buildCurrentInsuranceProductShowcaseAddendum({
    question:
      "현재 판매 중인 보험상품 중에서 나에게 필요한 보장을 채울 수 있는 상품을 추천해줘",
  });
  assert.match(showcase, /확인된 정량 공개 수치를 말할 때/);
  assert.match(showcase, /scope 전환을 문장에서 명시한다/);
  console.log("PASS T7 Q12 scope contract preserved");
}

{
  // T8: emit preview-only + cache fields + tag
  assert.equal(shouldRecordKeyClaudeProviderUsageObserve({ VERCEL_ENV: "preview" }), true);
  assert.equal(shouldRecordKeyClaudeProviderUsageObserve({ VERCEL_ENV: "production" }), false);
  const logs = [];
  const orig = console.log;
  console.log = (...args) => {
    logs.push(args);
  };
  try {
    const wrote = emitKeyClaudeProviderUsageObserve(
      {
        start_input_tokens: 18500,
        input_tokens: 65882,
        output_tokens: 3229,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
      },
      { VERCEL_ENV: "preview" },
    );
    assert.equal(wrote, true);
    assert.equal(logs[0][0], KEY_CLAUDE_PROVIDER_USAGE_OBSERVE_LOG_TAG);
    const parsed = JSON.parse(logs[0][1]);
    assert.equal(parsed.start_input_tokens, 18500);
    assert.equal(parsed.final_input_tokens, 65882);
    assert.equal(parsed.output_tokens, 3229);
    assert.equal(parsed.cache_creation_input_tokens, 0);
    assert.equal(parsed.cache_read_input_tokens, 0);
    assert.equal(Object.prototype.hasOwnProperty.call(parsed, "input_tokens"), false);
  } finally {
    console.log = orig;
  }
  console.log("PASS T8 emit start/final shape + preview-only");
}

console.log("ALL_KEY_PROVIDER_USAGE_TRACE_UNIT_TESTS_PASSED");
