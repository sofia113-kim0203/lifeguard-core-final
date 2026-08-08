/**
 * S3 TRACE BRIDGE (minimized) — targeted unit:
 * runtime direct bag → one_key_core_trace_summary.key_confirmation_trace
 * no derived rejected count · no nested fallback · customer text unchanged
 */
import assert from "node:assert/strict";
import {
  buildPersistableTurnTraceSummary,
  buildAssistantTurnMetadata,
} from "../src/lib/lifeguardChatSessionCore.js";
import {
  buildKeyConfirmationTrace,
  extractKeyConfirmationTraceFromDonePayload,
} from "../src/lib/keyConfirmationTrace.js";

const CUSTOMER_ANSWER =
  "원본 기준으로 보험사와 상품명만 짧게 말씀드립니다.";

function main() {
  console.log("key-confirmation-trace-bridge-unit-test");

  const runtimeTrace = buildKeyConfirmationTrace({
    original_attachment_count: 1,
    current_turn_document_count: 1,
    current_turn_document_ids: ["adc8b791-6fc1-4612-b2b3-befb3e521c08"],
    sidecar_present: true,
    sidecar_ok: true,
    confirmed_source_facts_count: 2,
    confirmed_promotion: 0,
    provenance_source_document_ids: ["adc8b791-6fc1-4612-b2b3-befb3e521c08"],
    gate_attempted: true,
    gate_accepted_count: 2,
    gate_rejected_count: 0,
    gate_rejected_reason_counts: { schema: 0 },
    memory_commit_id: "81970139-a968-40a0-86c1-1fd530ac5c5d",
    memory_persist_status: "committed",
  });

  assert.ok(runtimeTrace);
  assert.equal(runtimeTrace.confirmed_source_facts_count, 2);
  assert.equal(runtimeTrace.gate_rejected_count, 0);

  // No derived rejected count from reason_counts alone.
  const noRejectedCount = buildKeyConfirmationTrace({
    gate_attempted: true,
    gate_accepted_count: 0,
    gate_rejected_reason_counts: { ownership: 2, schema: 1 },
  });
  assert.equal(Object.prototype.hasOwnProperty.call(noRejectedCount, "gate_rejected_count"), false);
  assert.deepEqual(noRejectedCount.gate_rejected_reason_counts, {
    ownership: 2,
    schema: 1,
  });

  // Nested fallback reconstruction removed — only explicit bag.
  assert.equal(
    extractKeyConfirmationTraceFromDonePayload({
      sales_director_trace: {
        key_compose_trace: {
          key_voice_trace: {
            key_record_sidecar: { ok: true, confirmed_source_facts_count: 9 },
          },
        },
      },
      one_key_core_trace: {
        steps: [{ step: "key_confirmed_fact_gate", payload: { accepted_count: 9 } }],
      },
    }),
    null,
  );

  const donePayload = {
    ok: true,
    answerText: CUSTOMER_ANSWER,
    response_source: "one_key_core_s1",
    compose_mode: "key_claude_first_direct",
    key_confirmation_trace: runtimeTrace,
    raw_confirmed_facts: [{ fact: "SECRET_FACT_BODY_MUST_NOT_PERSIST" }],
  };

  const turnTrace = buildPersistableTurnTraceSummary(donePayload);
  const nested = turnTrace.one_key_core_trace_summary?.key_confirmation_trace;
  assert.equal(nested?.confirmed_source_facts_count, 2);
  assert.equal(nested?.sidecar_ok, true);
  assert.equal(nested?.memory_commit_id, "81970139-a968-40a0-86c1-1fd530ac5c5d");
  // Not a top-level sibling on the summary return object.
  assert.equal(turnTrace.key_confirmation_trace, undefined);

  const metadata = buildAssistantTurnMetadata("87d54513-ce9a-4323-bae7-4833702826fd", {
    composeMode: turnTrace.compose_mode,
    oneKeyCoreTraceSummary: turnTrace.one_key_core_trace_summary,
  });

  assert.equal(
    metadata.one_key_core_trace_summary?.key_confirmation_trace?.gate_accepted_count,
    2,
  );
  assert.equal(
    Object.prototype.hasOwnProperty.call(metadata, "key_confirmation_trace"),
    false,
  );

  const metaJson = JSON.stringify(metadata);
  assert.equal(metaJson.includes("SECRET_FACT_BODY_MUST_NOT_PERSIST"), false);
  assert.equal(metaJson.includes(CUSTOMER_ANSWER), false);
  assert.equal(CUSTOMER_ANSWER.includes("key_confirmation_trace"), false);

  const emptyTrace = buildPersistableTurnTraceSummary({
    answerText: CUSTOMER_ANSWER,
    response_source: "one_key_core_s1",
  });
  assert.equal(
    Object.prototype.hasOwnProperty.call(
      emptyTrace.one_key_core_trace_summary ?? {},
      "key_confirmation_trace",
    ),
    false,
  );

  console.log(
    "PASS summary.key_confirmation_trace preserved; no derive/fallback; customer text clean",
  );
}

try {
  main();
  process.exitCode = 0;
} catch (err) {
  console.error("FAIL", err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
}
