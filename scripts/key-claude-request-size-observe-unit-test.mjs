/**
 * KEY→Claude request size observer — unit proof (no Provider, no SSE).
 */
import assert from "node:assert/strict";
import {
  KEY_CLAUDE_REQUEST_SIZE_OBSERVE_LOG_TAG,
  KEY_CLAUDE_REQUEST_SIZE_OBSERVE_SCHEMA,
  assertSafeKeyClaudeRequestSizeObservation,
  buildKeyClaudeRequestSizeObservation,
  emitKeyClaudeRequestSizeObservation,
  shouldRecordKeyClaudeRequestSizeObserve,
} from "../server/keyCore/keyClaudeRequestSizeObserve.js";
import { buildOnePathClaudeFirstRequest } from "../server/keyCore/keyOnePathClaudeFirst.js";

assert.equal(shouldRecordKeyClaudeRequestSizeObserve({ VERCEL_ENV: "preview" }), true);
assert.equal(shouldRecordKeyClaudeRequestSizeObserve({ VERCEL_ENV: "production" }), false);
assert.equal(shouldRecordKeyClaudeRequestSizeObserve({ VERCEL_ENV: "development" }), false);

assert.equal(
  emitKeyClaudeRequestSizeObservation(
    { schema: KEY_CLAUDE_REQUEST_SIZE_OBSERVE_SCHEMA },
    { VERCEL_ENV: "production" },
  ),
  false,
);

const fatPolicy = {
  insurer_name: "한화손해보험",
  product_name: "3.10.5 간편건강보험(세만기형) 무배당2411",
  policy_number: "LA20249638413000",
  coverage_summary: Array.from({ length: 40 }, (_, i) => ({
    name: `담보_${i}`,
    amount: `${(i + 1) * 10}만원`,
    note: "x".repeat(120),
  })),
};

const history = Array.from({ length: 12 }, (_, i) => ({
  role: i % 2 === 0 ? "user" : "assistant",
  content:
    i % 2 === 0
      ? `질문 ${i}: 필요한 보장 추천해줄 수 있어?`
      : `# 긴 이전 답변 ${i}\n` + "답변본문.".repeat(180),
}));

const built = buildOnePathClaudeFirstRequest({
  question: "나에게 추천해줄수있어 필요한보장?",
  history,
  policyTruthContext: {
    confirmed_contracts: [fatPolicy, { ...fatPolicy, policy_number: "OTHER" }],
    confirmed_facts: Array.from({ length: 20 }, (_, i) => ({
      fact: `fact_${i}`,
      detail: "y".repeat(80),
    })),
  },
  readyCardMeta: {
    status: "hit",
    materials_connected: true,
    card_version: "v-test",
    unknowns: ["실손", "암진단비"],
    document_status: { active_count: 5 },
  },
  readyCardSsot: {
    policies: [fatPolicy],
    policy_count: 1,
    activeDocuments: Array.from({ length: 5 }, (_, i) => ({
      id: `doc-${i}`,
      original_filename: `file-${i}.jpg`,
      note: "z".repeat(60),
    })),
    activeClaimCases: [],
    insuranceClockBrief: { notes: "clock".repeat(40) },
    lifeLedgerBrief: { notes: "ledger".repeat(40) },
    claimEvidenceBrief: null,
    priorConsultation: {
      related_turns: history.filter((h) => h.role === "assistant").slice(0, 4),
    },
  },
  customerId: "36aadc18-6e16-4d1f-9417-7a753b7e3692",
  conversationId: "87d54513-ce9a-4323-bae7-4833702826fd",
});

const tinyPngBase64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

const body = {
  model: "claude-sonnet-4-6",
  max_tokens: 4096,
  temperature: 0.4,
  system: built.system,
  messages: [
    {
      role: "user",
      content: [
        ...built.messages[0].content,
        {
          type: "image",
          source: {
            type: "base64",
            media_type: "image/png",
            data: tinyPngBase64,
          },
        },
      ],
    },
  ],
  tools: [],
  stream: true,
};

const obs = buildKeyClaudeRequestSizeObservation({ body });
assert.equal(obs.schema, KEY_CLAUDE_REQUEST_SIZE_OBSERVE_SCHEMA);
assert.ok(obs.section_chars.system > 0);
assert.ok(obs.section_chars.question > 0);
assert.ok(obs.section_chars.customer_card > 1000);
assert.ok(obs.section_chars.recent_dialogue > 0);
assert.ok(obs.section_chars.prior_answers > 0);
assert.equal(obs.images.count, 1);
assert.equal(obs.images.items[0].sha256.length, 64);
assert.ok(obs.totals.request_chars > obs.section_chars.customer_card);
assertSafeKeyClaudeRequestSizeObservation(obs);

// Mutation guard — observation path must not alter Provider body.
const before = JSON.stringify(body);
buildKeyClaudeRequestSizeObservation({ body });
assert.equal(JSON.stringify(body), before);

const logs = [];
const origLog = console.log;
console.log = (...args) => {
  logs.push(args);
};
try {
  assert.equal(
    emitKeyClaudeRequestSizeObservation(obs, { VERCEL_ENV: "preview" }),
    true,
  );
} finally {
  console.log = origLog;
}
assert.equal(logs.length, 1);
assert.equal(logs[0][0], KEY_CLAUDE_REQUEST_SIZE_OBSERVE_LOG_TAG);
const logged = JSON.parse(logs[0][1]);
assert.equal(logged.privacy_guard.raw_prompt_text_present, false);
assert.equal(logged.privacy_guard.image_bytes_present, false);
assert.doesNotMatch(logs[0][1], /iVBORw0KGgo/);
assert.doesNotMatch(logs[0][1], /답변본문/);

const rows = [
  ["system", obs.section_chars.system],
  ["question", obs.section_chars.question],
  ["customer_card", obs.section_chars.customer_card],
  ["memory", obs.section_chars.memory],
  ["recent_dialogue", obs.section_chars.recent_dialogue],
  ["prior_answers", obs.section_chars.prior_answers],
  ["handoff", obs.section_chars.handoff],
  ["wholesale_envelope", obs.section_chars.wholesale_envelope],
  ["other_user_text", obs.section_chars.other_user_text],
  ["image_payload", obs.section_chars.image_payload],
  ["tools", obs.section_chars.tools],
  ["TOTAL_REQUEST", obs.totals.request_chars],
  ["unaccounted", obs.totals.unaccounted_chars],
];

console.log("REQUEST_SIZE_OBSERVE_UNIT_RESULT");
for (const [name, chars] of rows) {
  console.log(`${name}\t${chars}`);
}
console.log(
  "card_breakdown\t" +
    JSON.stringify({
      insurance_contracts: obs.card_breakdown.insurance_contracts_chars,
      confirmed_facts: obs.card_breakdown.confirmed_facts_chars,
      recent_conversation: obs.card_breakdown.recent_conversation_chars,
      prior_consultation: obs.card_breakdown.prior_consultation_chars,
      entrusted_and_ready: obs.card_breakdown.entrusted_and_ready_chars,
      other_card_fields: obs.card_breakdown.other_card_fields_chars,
    }),
);
console.log("PASS key-claude-request-size-observe-unit-test");
