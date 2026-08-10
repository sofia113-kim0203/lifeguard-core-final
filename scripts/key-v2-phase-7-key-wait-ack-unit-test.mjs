/**
 * KEY v2 phase 7 — customer wait time: KEY wait ack before final answer.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { consumeHomeBrainFactSse } from "../src/lib/homeBrainFactSse.js";
import {
  buildKeyWaitAck,
  KEY_WAIT_ACK_DEFAULT,
  KEY_WAIT_ACK_GREETING,
} from "../server/keyWaitAck.js";
import { handleHomeBrainFactRequest } from "../server/homeBrainFactCore.js";
import { writeHomeBrainFactSseEvent } from "../server/homeBrainFactStream.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const GREETING_FIXTURE = JSON.parse(
  readFileSync(
    join(
      __dirname,
      "..",
      "fixtures",
      "key-human-voice-greeting-v1",
      "turn1-greeting-wait-ack.json",
    ),
    "utf8",
  ),
);

const mockPolicies = [
  { id: "p1", insurer_name: "삼성", product_name: "실손", policy_type: "health" },
];

function buildJwtPathMockSupabase() {
  return {
    from(table) {
      const chain = {
        _head: false,
        select(_columns, options = {}) {
          chain._head = options.head === true;
          return chain;
        },
        eq() {
          return chain;
        },
        is() {
          return chain;
        },
        order() {
          return chain;
        },
        limit() {
          return chain;
        },
        maybeSingle: async () => {
          if (table === "customer_profiles") {
            return { data: { id: "cust-jwt", display_name: "QA", memory_version: 1 }, error: null };
          }
          return { data: null, error: null };
        },
        then(onFulfilled, onRejected) {
          let payload = { data: [], error: null, count: 0 };
          if (table === "active_profile_insurance_policies") payload = { data: mockPolicies, error: null };
          if (table === "customer_memory_facts") {
            const facts = [{ id: "m1", fact_key: "insurance.goal", fact_value: "보험료" }];
            payload = chain._head
              ? { data: null, error: null, count: facts.length }
              : { data: facts, error: null, count: facts.length };
          }
          if (table === "customer_documents") payload = { data: [], error: null, count: 0 };
          if (table === "customer_conversations") payload = { data: [], error: null };
          if (table === "customer_consents") {
            payload = { data: [{ id: "c1", consent_type: "terms", granted: true }], error: null };
          }
          if (table === "profile_health") payload = { data: null, error: null };
          return Promise.resolve(payload).then(onFulfilled, onRejected);
        },
      };
      return chain;
    },
  };
}

async function runCase(name, fn) {
  try {
    await fn();
    console.log(`PASS ${name}`);
    return true;
  } catch (error) {
    console.error(`FAIL ${name}`);
    console.error(error);
    return false;
  }
}

let passed = 0;
let failed = 0;

async function record(ok) {
  if (ok) passed += 1;
  else failed += 1;
}

await record(
  await runCase("V2-W1 buildKeyWaitAck — KEY voice, no sales director label", async () => {
    assert.equal(buildKeyWaitAck("암보장 있어?"), KEY_WAIT_ACK_DEFAULT);
    assert.equal(buildKeyWaitAck("안녕하세요"), KEY_WAIT_ACK_GREETING);
    assert.doesNotMatch(buildKeyWaitAck("보험료"), /영업부장|Sales Director|시스템|엔진|Brain|Layer/i);
  }),
);

await record(
  await runCase("V2-W1b Turn1 greeting fixture — human voice, 10-type default unchanged", async () => {
    assert.equal(KEY_WAIT_ACK_GREETING, GREETING_FIXTURE.expected_greeting_ack);
    assert.equal(KEY_WAIT_ACK_DEFAULT, GREETING_FIXTURE.expected_default_ack);
    for (const q of GREETING_FIXTURE.greeting_inputs) {
      const ack = buildKeyWaitAck(q);
      assert.equal(ack, GREETING_FIXTURE.expected_greeting_ack, q);
      for (const bad of GREETING_FIXTURE.forbidden_substrings) {
        assert.equal(ack.includes(bad), false, `${q} must not include ${bad}`);
      }
    }
    for (const row of GREETING_FIXTURE.regression_default_inputs) {
      assert.equal(
        buildKeyWaitAck(row.question),
        GREETING_FIXTURE.expected_default_ack,
        row.type,
      );
    }
  }),
);

await record(
  await runCase("V2-W2 SSE parser — ack event before delta", async () => {
    const encoder = new TextEncoder();
    const body = [
      'event: ack\ndata: {"text":"말씀 주신 내용 잘 받았어요. 함께 확인해 볼게요."}\n\n',
      'event: delta\ndata: {"text":"가입"}\n\n',
      'event: done\ndata: {"ok":true,"answerText":"가입된 보험이 있는 것은 확인돼요."}\n\n',
    ].join("");
    const acks = [];
    const deltas = [];
    await consumeHomeBrainFactSse(
      new Response(encoder.encode(body), {
        headers: { "Content-Type": "text/event-stream" },
      }),
      {
        onAck: (text) => acks.push(text),
        onDelta: (text) => deltas.push(text),
      },
    );
    assert.equal(acks.length, 1);
    assert.match(acks[0], /함께 확인/);
    assert.equal(deltas.join(""), "가입");
  }),
);

await record(
  await runCase("V2-W3 handler — onKeyWaitAck fires before onDelta", async () => {
    const events = [];
    await handleHomeBrainFactRequest({
      question: "암보장 있어?",
      history: [],
      userSupabase: buildJwtPathMockSupabase(),
      customerId: "cust-jwt",
      fetchImpl: async () => {
        throw new Error("no llm");
      },
      requestStartedAt: Date.now(),
      streamHandlers: {
        _emitted: false,
        onKeyWaitAck: (text) => events.push({ type: "ack", text }),
        onDelta: (text) => events.push({ type: "delta", text }),
        onFirstToken: () => {},
      },
    });
    assert.equal(events[0]?.type, "ack");
    assert.match(events[0]?.text ?? "", /함께 확인/);
    assert.equal(events.at(-1)?.type, "delta");
  }),
);

await record(
  await runCase("V2-W4 SSE writer — ack event framing", async () => {
    const chunks = [];
    const res = {
      statusCode: 0,
      headers: {},
      setHeader(name, value) {
        this.headers[name.toLowerCase()] = value;
      },
      write(chunk) {
        chunks.push(String(chunk));
      },
      end() {},
    };
    writeHomeBrainFactSseEvent(res, "ack", { text: "함께 확인해 볼게요." });
    const output = chunks.join("");
    assert.match(output, /event: ack/);
    assert.match(output, /함께 확인/);
  }),
);

await record(
  await runCase("V2-W5 claim judgment regression — phase 6 compose unchanged", async () => {
    const { finalizeHumanSalesDirectorResponse } = await import("../server/humanUnderstandingLoop.js");
    const { ONE_BRAIN_SURFACES } = await import("../server/oneBrainResponseLayer.js");
    const question = "사고났는데 받을 거 있어?";
    const finalized = finalizeHumanSalesDirectorResponse({
      question,
      classificationIntent: "general_consultation",
      surface: ONE_BRAIN_SURFACES.HOME,
      factBundle: {
        question,
        key_orchestrator: true,
        policy_count: 2,
        policies: [{ product_name: "실손" }],
      },
      customerState: { question, keyOrchestrator: true },
    });
    assert.match(finalized.text, /사고·치료|열리는 축/);
  }),
);

console.log(
  `\nKEY v2 phase 7 wait ack: ${failed > 0 ? "FAILED" : "ALL PASSED"} (${passed}/${passed + failed})`,
);
process.exit(failed > 0 ? 1 : 0);
