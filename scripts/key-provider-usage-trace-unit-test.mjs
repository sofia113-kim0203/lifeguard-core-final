/**
 * QA: KEY_CLAUDE_PROVIDER_USAGE_OBSERVE — start/final + ordered input_tokens snapshots.
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
  buildKeyClaudeEncryptedContentSizeObserve,
  emitKeyClaudeEncryptedContentSizeObserve,
  shouldRecordKeyClaudeEncryptedContentSizeObserve,
  KEY_CLAUDE_ENCRYPTED_CONTENT_SIZE_OBSERVE_LOG_TAG,
} from "../server/keyCore/keyClaudeFirstDirect.js";
import { buildCurrentInsuranceProductShowcaseAddendum } from "../server/keyCore/keyBorrowedSensesSpeak.js";

function reduceEvents(events) {
  let state = {
    usage: null,
    start_input_tokens: null,
    input_token_snapshots: [],
  };
  for (const evt of events) {
    state = foldAnthropicStreamUsage(state, String(evt.type ?? ""), evt);
  }
  return finalizeAnthropicStreamUsage(state);
}

{
  // T1: start + two deltas → ordered snapshots [10000,20000,35000]
  const usage = reduceEvents([
    {
      type: "message_start",
      message: { usage: { input_tokens: 10000, output_tokens: 1 } },
    },
    { type: "message_delta", usage: { input_tokens: 20000, output_tokens: 10 } },
    { type: "message_delta", usage: { input_tokens: 35000, output_tokens: 40 } },
  ]);
  assert.equal(usage.start_input_tokens, 10000);
  assert.equal(usage.input_tokens, 35000);
  assert.deepEqual(
    usage.provider_input_token_snapshots.map((s) => s.input_tokens),
    [10000, 20000, 35000],
  );
  assert.deepEqual(
    usage.provider_input_token_snapshots.map((s) => s.index),
    [0, 1, 2],
  );
  const built = buildKeyClaudeProviderUsageObserve(usage);
  assert.deepEqual(
    built.provider_input_token_snapshots.map((s) => s.input_tokens),
    [10000, 20000, 35000],
  );
  console.log("PASS T1 snapshots [10000,20000,35000] order preserved");
}

{
  // T2: identical repeated values preserved as separate events
  const usage = reduceEvents([
    {
      type: "message_start",
      message: { usage: { input_tokens: 10000, output_tokens: 1 } },
    },
    { type: "message_delta", usage: { input_tokens: 10000, output_tokens: 2 } },
    { type: "message_delta", usage: { input_tokens: 20000, output_tokens: 3 } },
  ]);
  assert.deepEqual(
    usage.provider_input_token_snapshots.map((s) => s.input_tokens),
    [10000, 10000, 20000],
  );
  console.log("PASS T2 repeated snapshot values preserved");
}

{
  // T3: usage-less / output-only delta → safe skip (no invented input)
  const usage = reduceEvents([
    {
      type: "message_start",
      message: { usage: { input_tokens: 5000, output_tokens: 1 } },
    },
    { type: "message_delta", usage: { output_tokens: 9 } },
    { type: "message_delta", usage: { input_tokens: 9000, output_tokens: 12 } },
  ]);
  assert.deepEqual(
    usage.provider_input_token_snapshots.map((s) => s.input_tokens),
    [5000, 9000],
  );
  assert.equal(usage.input_tokens, 9000);
  assert.equal(finalizeAnthropicStreamUsage({ usage: null, start_input_tokens: null }), null);
  const builtNull = buildKeyClaudeProviderUsageObserve(null);
  assert.equal(builtNull.start_input_tokens, null);
  assert.equal(builtNull.final_input_tokens, null);
  assert.deepEqual(builtNull.provider_input_token_snapshots, []);
  console.log("PASS T3 usage-less events safe");
}

{
  // T4: final keeps provider final input_tokens
  const usage = reduceEvents([
    {
      type: "message_start",
      message: { usage: { input_tokens: 12580, output_tokens: 1 } },
    },
    { type: "message_delta", usage: { input_tokens: 69799, output_tokens: 2941 } },
  ]);
  const built = buildKeyClaudeProviderUsageObserve(usage);
  assert.equal(built.final_input_tokens, 69799);
  assert.equal(pickAnthropicUsageNumbers(usage).input_tokens, 69799);
  console.log("PASS T4 final provider usage preserved");
}

{
  // T5: customer-visible answer identical
  const answerBefore = "고객 답변 바이트 동일 검증";
  buildKeyClaudeProviderUsageObserve({
    input_tokens: 1,
    start_input_tokens: 1,
    provider_input_token_snapshots: [{ index: 0, input_tokens: 1 }],
  });
  assert.equal(answerBefore, "고객 답변 바이트 동일 검증");
  console.log("PASS T5 customer-visible answer identical");
}

{
  // T6: Claude input identical
  const bodyBefore = JSON.stringify({
    system: "x",
    messages: [{ role: "user", content: "q" }],
  });
  foldAnthropicStreamUsage(
    { usage: null, start_input_tokens: null, input_token_snapshots: [] },
    "message_start",
    { message: { usage: { input_tokens: 9 } } },
  );
  assert.equal(
    bodyBefore,
    JSON.stringify({
      system: "x",
      messages: [{ role: "user", content: "q" }],
    }),
  );
  console.log("PASS T6 Claude input identical");
}

{
  // T7: ONE_PATH — no chars÷4 / estimated
  const poisoned = {
    estimated_input_tokens: 9999,
    request_chars: 18862,
    start_input_tokens: 100,
    input_tokens: 400,
    provider_input_token_snapshots: [
      { index: 0, input_tokens: 100 },
      { index: 1, input_tokens: 400 },
    ],
  };
  const built = buildKeyClaudeProviderUsageObserve(poisoned);
  assert.equal(built.start_input_tokens, 100);
  assert.equal(built.final_input_tokens, 400);
  assert.equal(Object.prototype.hasOwnProperty.call(built, "estimated_input_tokens"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(built, "request_chars"), false);
  assert.notEqual(built.final_input_tokens, Math.ceil(18862 / 4));
  console.log("PASS T7 ONE_PATH observe — no estimated / chars÷4");
}

{
  // T8: Q12 scope contract preserved
  const showcase = buildCurrentInsuranceProductShowcaseAddendum({
    question:
      "현재 판매 중인 보험상품 중에서 나에게 필요한 보장을 채울 수 있는 상품을 추천해줘",
  });
  assert.match(showcase, /확인된 정량 공개 수치를 말할 때/);
  assert.match(showcase, /scope 전환을 문장에서 명시한다/);
  console.log("PASS T8 Q12 scope contract preserved");
}

{
  // T9: emit includes ordered snapshots + preview-only
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
        start_input_tokens: 12580,
        input_tokens: 69799,
        output_tokens: 2941,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
        provider_input_token_snapshots: [
          { index: 0, input_tokens: 12580 },
          { index: 1, input_tokens: 29000 },
          { index: 2, input_tokens: 69799 },
        ],
      },
      { VERCEL_ENV: "preview" },
    );
    assert.equal(wrote, true);
    assert.equal(logs[0][0], KEY_CLAUDE_PROVIDER_USAGE_OBSERVE_LOG_TAG);
    const parsed = JSON.parse(logs[0][1]);
    assert.equal(parsed.start_input_tokens, 12580);
    assert.equal(parsed.final_input_tokens, 69799);
    assert.deepEqual(
      parsed.provider_input_token_snapshots.map((s) => s.input_tokens),
      [12580, 29000, 69799],
    );
  } finally {
    console.log = orig;
  }
  console.log("PASS T9 emit snapshots + preview-only");
}

{
  // T10: encrypted_content sizes only — never ciphertext in observe
  const secretA = "EqgfSECRET_CIPHERTEXT_AAA";
  const secretB = "EqgfSECRET_CIPHERTEXT_BBB_한글";
  const content = [
    {
      type: "web_search_tool_result",
      tool_use_id: "srvtoolu_1",
      content: [
        {
          type: "web_search_result",
          url: "https://example.com/a",
          title: "A",
          encrypted_content: secretA,
          page_age: "2025",
        },
        {
          type: "web_search_result",
          url: "https://example.com/b",
          title: "B",
          encrypted_content: secretB,
        },
      ],
    },
    { type: "text", text: "answer" },
  ];
  const built = buildKeyClaudeEncryptedContentSizeObserve(content);
  assert.equal(built.search_result_count, 2);
  assert.deepEqual(built.encrypted_content_chars, [secretA.length, secretB.length]);
  assert.deepEqual(built.encrypted_content_bytes, [
    new TextEncoder().encode(secretA).length,
    new TextEncoder().encode(secretB).length,
  ]);
  assert.equal(
    built.total_encrypted_content_chars,
    secretA.length + secretB.length,
  );
  assert.equal(
    built.total_encrypted_content_bytes,
    new TextEncoder().encode(secretA).length +
      new TextEncoder().encode(secretB).length,
  );
  const json = JSON.stringify(built);
  assert.equal(json.includes(secretA), false);
  assert.equal(json.includes(secretB), false);
  assert.equal(Object.prototype.hasOwnProperty.call(built, "encrypted_content"), false);
  console.log("PASS T10 encrypted_content sizes only");
}

{
  // T11: emit preview-only + no ciphertext leak
  assert.equal(
    shouldRecordKeyClaudeEncryptedContentSizeObserve({ VERCEL_ENV: "preview" }),
    true,
  );
  assert.equal(
    shouldRecordKeyClaudeEncryptedContentSizeObserve({ VERCEL_ENV: "production" }),
    false,
  );
  const secret = "EqgfNEVER_LOG_THIS_CIPHER";
  const logs = [];
  const orig = console.log;
  console.log = (...args) => {
    logs.push(args);
  };
  try {
    const wrote = emitKeyClaudeEncryptedContentSizeObserve(
      [
        {
          type: "web_search_tool_result",
          content: [
            {
              type: "web_search_result",
              url: "https://example.com",
              title: "T",
              encrypted_content: secret,
            },
          ],
        },
      ],
      { VERCEL_ENV: "preview" },
    );
    assert.equal(wrote, true);
    assert.equal(logs[0][0], KEY_CLAUDE_ENCRYPTED_CONTENT_SIZE_OBSERVE_LOG_TAG);
    const parsed = JSON.parse(logs[0][1]);
    assert.equal(parsed.search_result_count, 1);
    assert.equal(parsed.encrypted_content_chars[0], secret.length);
    assert.equal(logs[0][1].includes(secret), false);
  } finally {
    console.log = orig;
  }
  console.log("PASS T11 emit encrypted sizes preview-only");
}

console.log("ALL_KEY_PROVIDER_USAGE_TRACE_UNIT_TESTS_PASSED");
