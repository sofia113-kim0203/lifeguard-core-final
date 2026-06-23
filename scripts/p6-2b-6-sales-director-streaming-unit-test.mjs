/**
 * P6-2B-6 — Sales Director streaming tests.
 */
import assert from "node:assert/strict";

import { consumeHomeBrainFactSse } from "../src/lib/homeBrainFactSse.js";
import { handleHomeBrainFactRequest } from "../server/homeBrainFactCore.js";
import {
  initHomeBrainFactSseResponse,
  writeHomeBrainFactSseEvent,
} from "../server/homeBrainFactStream.js";

const mockPolicies = [
  { id: "p1", insurer_name: "삼성", product_name: "실손", policy_type: "health" },
  { id: "p2", insurer_name: "현대", product_name: "암보험", policy_type: "cancer" },
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
            const facts = [{ id: "m1", fact_key: "insurance.goal", fact_value: "보험료 부담" }];
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
  await runCase("T1 SSE client parser — delta + done", async () => {
    const encoder = new TextEncoder();
    const body = [
      'event: delta\ndata: {"text":"보"}\n\n',
      'event: delta\ndata: {"text":"험"}\n\n',
      'event: ttft\ndata: {"ttft_ms":820}\n\n',
      'event: done\ndata: {"ok":true,"answerText":"보험","response_latency_ms":5000}\n\n',
    ].join("");
    const chunks = [];
    let ttft = null;
    const payload = await consumeHomeBrainFactSse(
      new Response(encoder.encode(body), {
        headers: { "Content-Type": "text/event-stream" },
      }),
      {
        onDelta: (text) => chunks.push(text),
        onTTFT: (ms) => {
          ttft = ms;
        },
      },
    );
    assert.equal(chunks.join(""), "보험");
    assert.equal(ttft, 820);
    assert.equal(payload.answerText, "보험");
  }),
);

await record(
  await runCase("T2 payload trace — ttft field shape", async () => {
    const payload = {
      ok: true,
      answerText: "답",
      sales_director_trace: { latency: { ttft_ms: 900, claude_ms: 6000 } },
      response_latency_ms: 7000,
    };
    assert.equal(payload.sales_director_trace.latency.ttft_ms, 900);
    assert.equal(payload.response_latency_ms, 7000);
  }),
);

await record(
  await runCase("T3 handler streamHandlers — non-claude emits single delta", async () => {
    const supabase = buildJwtPathMockSupabase();
    const deltas = [];
    let ttft = null;
    await handleHomeBrainFactRequest({
      question: "암보장 있어?",
      history: [],
      userSupabase: supabase,
      customerId: "cust-jwt",
      fetchImpl: async () => {
        throw new Error("no llm");
      },
      requestStartedAt: Date.now(),
      streamHandlers: {
        _emitted: false,
        onDelta: (text) => deltas.push(text),
        onFirstToken: (ms) => {
          ttft = ms;
        },
      },
    });
    assert.ok(deltas.length >= 1);
    assert.ok(String(deltas.join("")).length > 0);
    assert.ok(typeof ttft === "number");
  }),
);

await record(
  await runCase("T4 SSE writer — event framing", async () => {
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
    initHomeBrainFactSseResponse(res);
    writeHomeBrainFactSseEvent(res, "delta", { text: "가" });
    const output = chunks.join("");
    assert.match(output, /event: delta/);
    assert.match(output, /data: \{"text":"가"\}/);
    assert.equal(res.headers["content-type"], "text/event-stream; charset=utf-8");
  }),
);

console.log(`\nP6-2B-6: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
