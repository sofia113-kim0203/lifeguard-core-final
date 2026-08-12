/**
 * Train T2 — customer SSE done must not carry factory / phase8 meta.
 */
import assert from "node:assert/strict";
import {
  CUSTOMER_SSE_DONE_STRIP_KEYS,
  stripCustomerHomeBrainDoneSseMeta,
  writeHomeBrainFactSseEvent,
} from "../server/homeBrainFactStream.js";

function test(name, fn) {
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (err) {
    console.error(`FAIL ${name}`);
    console.error(err);
    process.exitCode = 1;
  }
}

test("T2-T1 strip removes factory + phase8 keys", () => {
  const input = {
    ok: true,
    answerText: "확인된 계약은 2건입니다.",
    phase8_golden_parallel_trace: { schema_version: "phase8-golden-parallel-trace-v1" },
    factory_called: ["policy_extract"],
    sales_director_factory_audit: { answer_evidence: [] },
    factory_enqueue: { document_id: "doc-1" },
    claude_factory_direction: "extract",
    factory_hypothesis: "x",
    factory_primary_disconnect: "y",
    answer_evidence: [{ id: 1 }],
    session_goal: { goal: "보장 확인", status: "active" },
    key_monopoly_failure: false,
  };
  const out = stripCustomerHomeBrainDoneSseMeta(input);
  for (const key of CUSTOMER_SSE_DONE_STRIP_KEYS) {
    assert.equal(Object.hasOwn(out, key), false, `must strip ${key}`);
  }
  assert.equal(out.answerText, input.answerText);
  assert.deepEqual(out.session_goal, input.session_goal);
  assert.equal(out.key_monopoly_failure, false);
  // Input not mutated
  assert.ok(Object.hasOwn(input, "phase8_golden_parallel_trace"));
  assert.ok(Object.hasOwn(input, "factory_called"));
});

test("T2-T2 writeHomeBrainFactSseEvent done applies strip", () => {
  const chunks = [];
  const res = {
    write(s) {
      chunks.push(String(s));
    },
  };
  writeHomeBrainFactSseEvent(res, "done", {
    ok: true,
    answerText: "안전 문장",
    phase8_golden_parallel_trace: { x: 1 },
    factory_called: ["wo"],
  });
  const joined = chunks.join("");
  assert.match(joined, /^event: done\n/);
  assert.doesNotMatch(joined, /phase8_golden_parallel_trace/);
  assert.doesNotMatch(joined, /factory_called/);
  assert.match(joined, /안전 문장/);
});

test("T2-T3 non-done events keep factory keys", () => {
  const chunks = [];
  const res = {
    write(s) {
      chunks.push(String(s));
    },
  };
  writeHomeBrainFactSseEvent(res, "marks", {
    factory_called: ["keep"],
  });
  assert.match(chunks.join(""), /factory_called/);
});

if (process.exitCode) {
  console.error("T2 customer SSE done meta strip unit tests FAILED");
  process.exit(1);
}
console.log("T2 customer SSE done meta strip unit tests PASSED");
