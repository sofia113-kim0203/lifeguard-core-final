/**
 * TOKEN BOMB S4-T — Preview runtime trace unit tests (fake fetch / no Provider).
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  KEY_CLAUDE_PREVIEW_RUNTIME_TRACE_SCHEMA,
  PREVIEW_RUNTIME_TRACE_MAX_BYTES,
  PREVIEW_RUNTIME_TRACE_MAX_OBSERVATIONS,
  assertNoRawCustomerContentInPreviewTrace,
  buildKeyClaudePreviewRuntimeTrace,
  buildSelectionObservationForPreview,
  mapProviderFetchObservationForPreview,
  sanitizeKeyClaudePreviewRuntimeTrace,
  shouldEmitKeyClaudePreviewRuntimeTrace,
  toPacketTypeId,
} from "../server/keyCore/keyClaudePreviewRuntimeTrace.js";
import { buildProviderFetchObservation } from "../server/keyCore/keyClaudeFirstOnDemandShadow.js";
import { finalizeKeyCustomerText } from "../server/keyCore/keyCustomerMonopoly.js";
import { sealKeyCustomerText } from "../server/keyCore/keyCustomerTextSeal.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

function sha256File(rel) {
  return createHash("sha256").update(readFileSync(join(ROOT, rel))).digest("hex");
}

// T9 / T8 gates
assert.equal(shouldEmitKeyClaudePreviewRuntimeTrace({ VERCEL_ENV: "preview" }), true);
assert.equal(shouldEmitKeyClaudePreviewRuntimeTrace({ VERCEL_ENV: "production" }), false);
assert.equal(shouldEmitKeyClaudePreviewRuntimeTrace({ VERCEL_ENV: "development" }), false);
assert.equal(
  buildKeyClaudePreviewRuntimeTrace({
    env: { VERCEL_ENV: "production" },
    actualProviderFetchCount: 1,
    providerFetchObservations: [{}],
  }),
  null,
);

// T1 — one fetch
{
  const body = {
    system: [{ type: "text", text: "SYS" }],
    messages: [{ role: "user", content: [{ type: "text", text: "q" }] }],
    tools: [],
  };
  const obs = buildProviderFetchObservation({
    providerFetchIndex: 1,
    body,
    priorHeavyContextReplayed: false,
  });
  const trace = buildKeyClaudePreviewRuntimeTrace({
    env: { VERCEL_ENV: "preview" },
    liveRequestMode: "FULL_CURRENT",
    actualProviderFetchCount: 1,
    providerFetchObservations: [obs],
    selectionAvailable: false,
    turnEnrich: {
      usage: {
        input_tokens: 100,
        output_tokens: 20,
        cache_creation_input_tokens: 10,
        cache_read_input_tokens: 5,
      },
      stop_reason: "end_turn",
      ttft_ms: 40,
      first_customer_delta_ms: 40,
      provider_complete_ms: 200,
      customer_complete_ms: 210,
      provider_start_ms: 0,
    },
  });
  assert.equal(trace.schema, KEY_CLAUDE_PREVIEW_RUNTIME_TRACE_SCHEMA);
  assert.equal(trace.actual_provider_fetch_count, 1);
  assert.equal(trace.provider_fetch_observations.length, 1);
  assert.equal(trace.provider_fetch_observations[0].fetch_index, 1);
  assert.ok(trace.provider_fetch_observations[0].request_body_bytes > 0);
  assert.equal(trace.selection_observation.selection_available, false);
  assert.equal(trace.selection_observation.selected_prompt_block_count, null);
}

// T2 — two fetches, heavy replay false on selective
{
  const bodyLight = {
    system: [{ type: "text", text: "S" }],
    messages: [
      { role: "user", content: [{ type: "text", text: "weather" }] },
      { role: "assistant", content: [{ type: "server_tool_use", name: "web_search" }] },
    ],
    tools: [{ type: "web_search_20250305", name: "web_search" }],
  };
  const o1 = buildProviderFetchObservation({
    providerFetchIndex: 1,
    body: bodyLight,
    priorHeavyContextReplayed: false,
  });
  const o2 = buildProviderFetchObservation({
    providerFetchIndex: 2,
    body: bodyLight,
    priorHeavyContextReplayed: false,
  });
  const trace = buildKeyClaudePreviewRuntimeTrace({
    env: { VERCEL_ENV: "preview" },
    liveRequestMode: "ONE_SHOT_SELECTIVE",
    actualProviderFetchCount: 2,
    providerFetchObservations: [o1, o2],
    selectionPlan: {
      selected_prompt_blocks: ["CORE_IDENTITY", "COND_WEATHER_CURRENT_INFO"],
      selected_resource_packets: [],
    },
    selectionAvailable: true,
    contextFlags: {
      full_chart_present: false,
      full_ledger_present: false,
      full_memory_present: false,
      full_conversation_present: false,
      prior_original_present: false,
    },
  });
  assert.equal(trace.actual_provider_fetch_count, 2);
  assert.equal(trace.provider_fetch_observations.length, 2);
  assert.equal(trace.provider_fetch_observations[0].fetch_index, 1);
  assert.equal(trace.provider_fetch_observations[1].fetch_index, 2);
  assert.equal(trace.provider_fetch_observations[1].heavy_context_replay, false);
}

// T3 — usage present → TOTAL_INPUT_FOOTPRINT computable
{
  const mapped = mapProviderFetchObservationForPreview(
    { provider_fetch_index: 1, body_bytes: 10, system_chars: 3, message_count: 1 },
    {
      usage: {
        input_tokens: 50,
        cache_creation_input_tokens: 20,
        cache_read_input_tokens: 10,
        output_tokens: 7,
      },
    },
  );
  const footprint =
    mapped.input_tokens +
    mapped.cache_creation_input_tokens +
    mapped.cache_read_input_tokens;
  assert.equal(footprint, 80);
}

// T4 — usage absent → null, no estimate
{
  const mapped = mapProviderFetchObservationForPreview(
    { provider_fetch_index: 1, body_bytes: 999, usage: null },
    {},
  );
  assert.equal(mapped.input_tokens, null);
  assert.equal(mapped.cache_creation_input_tokens, null);
  assert.equal(mapped.cache_read_input_tokens, null);
  assert.equal(mapped.output_tokens, null);
}

// T5 — Selective inventory IDs only (drop hashed packet / resource ids)
{
  const sel = buildSelectionObservationForPreview({
    liveRequestMode: "ONE_SHOT_SELECTIVE",
    selectionAvailable: true,
    selectionPlan: {
      selected_prompt_blocks: ["CORE_IDENTITY", "COND_POLICY_COUNT"],
      selected_resource_packets: [
        {
          packet_id: "policy_count_packet",
          resource_id: "res_customer_secret",
          fact_scopes: ["confirmed_contract_count"],
        },
        {
          packet_id: "coverage_packet_rh_2cda00cbbe58a2d5",
          fact_scopes: ["coverage_amount", "evil_scope"],
        },
      ],
    },
  });
  assert.equal(sel.selection_available, true);
  assert.deepEqual(sel.selected_prompt_block_ids, [
    "COND_POLICY_COUNT",
    "CORE_IDENTITY",
  ]);
  assert.ok(sel.selected_resource_packet_type_ids.includes("policy_count_packet"));
  assert.ok(sel.selected_resource_packet_type_ids.includes("coverage_packet"));
  assert.ok(!sel.selected_resource_packet_type_ids.some((id) => id.includes("rh_")));
  assert.ok(!JSON.stringify(sel).includes("res_customer_secret"));
  assert.deepEqual(sel.selected_fact_scope_ids, [
    "confirmed_contract_count",
    "coverage_amount",
  ]);
}

// T6 — Baseline inventory fabricated = no
{
  const base = buildSelectionObservationForPreview({
    liveRequestMode: "FULL_CURRENT",
    selectionAvailable: false,
  });
  assert.equal(base.selection_available, false);
  assert.equal(base.selected_prompt_block_count, null);
  assert.deepEqual(base.selected_prompt_block_ids, []);
}

// T7 — canary privacy
{
  const dirty = {
    schema: KEY_CLAUDE_PREVIEW_RUNTIME_TRACE_SCHEMA,
    note: "user@example.com paid 보험료",
    provider_fetch_observations: [],
  };
  assert.throws(() => assertNoRawCustomerContentInPreviewTrace(dirty));
  const clean = buildKeyClaudePreviewRuntimeTrace({
    env: { VERCEL_ENV: "preview" },
    liveRequestMode: "FULL_CURRENT",
    actualProviderFetchCount: 1,
    providerFetchObservations: [
      buildProviderFetchObservation({
        providerFetchIndex: 1,
        body: {
          system: [{ type: "text", text: "CANARY_SYSTEM_PROMPT_SHOULD_NOT_LEAK" }],
          messages: [
            {
              role: "user",
              content: [
                {
                  type: "text",
                  text: "고객질문 canary 계약번호 ABC-123",
                },
              ],
            },
          ],
          tools: [],
        },
      }),
    ],
    selectionAvailable: false,
  });
  const s = JSON.stringify(clean);
  assert.ok(!s.includes("CANARY_SYSTEM_PROMPT_SHOULD_NOT_LEAK"));
  assert.ok(!s.includes("고객질문"));
  assert.ok(!s.includes("ABC-123"));
  assert.ok(!s.includes("base64,"));
}

// T10 — customer final text / finalize / seal unchanged by helper
{
  const answer = "확인된 범위에서 답변합니다.";
  const before = finalizeKeyCustomerText(answer, { failureMode: false, startedAt: new Date() });
  const sealedBefore = sealKeyCustomerText(before.customerText ?? before.keySpeakOriginal ?? answer);
  const body = {
    model: "x",
    system: [{ type: "text", text: "s" }],
    messages: [{ role: "user", content: [{ type: "text", text: "q" }] }],
  };
  const bodyHashBefore = createHash("sha256").update(JSON.stringify(body)).digest("hex");
  buildKeyClaudePreviewRuntimeTrace({
    env: { VERCEL_ENV: "preview" },
    actualProviderFetchCount: 1,
    providerFetchObservations: [
      buildProviderFetchObservation({ providerFetchIndex: 1, body }),
    ],
  });
  const after = finalizeKeyCustomerText(answer, { failureMode: false, startedAt: new Date() });
  const sealedAfter = sealKeyCustomerText(after.customerText ?? after.keySpeakOriginal ?? answer);
  assert.equal(
    String(before.keySpeakOriginal ?? before.customerText),
    String(after.keySpeakOriginal ?? after.customerText),
  );
  assert.equal(JSON.stringify(sealedBefore), JSON.stringify(sealedAfter));
  const bodyHashAfter = createHash("sha256").update(JSON.stringify(body)).digest("hex");
  assert.equal(bodyHashBefore, bodyHashAfter);
}

// T11 — size / observation cap
{
  const many = Array.from({ length: 8 }, (_, i) =>
    buildProviderFetchObservation({
      providerFetchIndex: i + 1,
      body: {
        system: [{ type: "text", text: "x".repeat(200) }],
        messages: [{ role: "user", content: [{ type: "text", text: "y" }] }],
        tools: [],
      },
    }),
  );
  const trace = buildKeyClaudePreviewRuntimeTrace({
    env: { VERCEL_ENV: "preview" },
    actualProviderFetchCount: 8,
    providerFetchObservations: many,
  });
  assert.ok(trace.provider_fetch_observations.length <= PREVIEW_RUNTIME_TRACE_MAX_OBSERVATIONS);
  assert.equal(trace.actual_provider_fetch_count, 8);
  assert.equal(trace.observations_truncated, true);
  assert.ok(Buffer.byteLength(JSON.stringify(trace), "utf8") <= PREVIEW_RUNTIME_TRACE_MAX_BYTES);
}

assert.equal(toPacketTypeId("premium_packet_rh_deadbeef"), "premium_packet");
assert.equal(toPacketTypeId("not_a_packet"), null);

// Production gate already covered; Preview presence:
{
  const t = buildKeyClaudePreviewRuntimeTrace({
    env: { VERCEL_ENV: "preview" },
    actualProviderFetchCount: 0,
    providerFetchObservations: [],
  });
  assert.ok(t);
  assert.equal(t.privacy_guard.raw_customer_content_present, false);
}

console.log("TOKEN_BOMB_S4_PREVIEW_TRACE: tests passed");
console.log(
  JSON.stringify({
    SCHEMA: KEY_CLAUDE_PREVIEW_RUNTIME_TRACE_SCHEMA,
    MAX_BYTES: PREVIEW_RUNTIME_TRACE_MAX_BYTES,
    MAX_OBS: PREVIEW_RUNTIME_TRACE_MAX_OBSERVATIONS,
    HELPER_SHA256: sha256File("server/keyCore/keyClaudePreviewRuntimeTrace.js"),
  }),
);
