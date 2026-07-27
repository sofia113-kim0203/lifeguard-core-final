/**
 * Surgery 0 — Preview QA turn recorder unit tests.
 */
import assert from "node:assert/strict";
import {
  shouldActivateQaTurnRecorder,
  isPreviewVercelEnv,
  buildSystemCapture,
  buildUserPayloadCapture,
  buildOriginalsManifest,
  scrubSecretsInText,
  scrubDeepForQaTrace,
  recordQaTurnTrace,
  completeQaTurnTraceWrite,
  purgeQaTurnTraces,
  createTurnTraceId,
  hashSensitiveId,
  isHistoryFullEnabled,
  assembleQaTurnTracePayload,
  QA_TURN_WRITE_TIMEOUT_MS,
} from "../server/keyCore/keyQaTurnRecorder.js";

let passed = 0;
function ok(name) {
  passed += 1;
  console.log(`PASS ${name}`);
}

// 1. production env → write 0
{
  let inserts = 0;
  const result = await recordQaTurnTrace({
    env: {
      VERCEL_ENV: "production",
      KEY_QA_TURN_RECORDER: "1",
      KEY_QA_TURN_RECORDER_CUSTOMER_IDS: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
    },
    customerId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
    systemCapture: { system_text_final: "x" },
    insertImpl: async () => {
      inserts += 1;
      return { ok: true };
    },
  });
  assert.equal(result.attempted, false);
  assert.equal(inserts, 0);
  assert.equal(shouldActivateQaTurnRecorder({
    env: { VERCEL_ENV: "production", KEY_QA_TURN_RECORDER: "1", KEY_QA_TURN_RECORDER_CUSTOMER_IDS: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee" },
    customerId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
  }), false);
  ok("1_production_write_0");
}

// 2. development env → write 0
{
  let inserts = 0;
  const result = await recordQaTurnTrace({
    env: {
      VERCEL_ENV: "development",
      KEY_QA_TURN_RECORDER: "1",
      KEY_QA_TURN_RECORDER_CUSTOMER_IDS: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
    },
    customerId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
    insertImpl: async () => {
      inserts += 1;
      return { ok: true };
    },
  });
  assert.equal(isPreviewVercelEnv({ VERCEL_ENV: "development" }), false);
  assert.equal(result.attempted, false);
  assert.equal(inserts, 0);
  ok("2_development_write_0");
}

// 3. preview + recorder flag missing → write 0
{
  let inserts = 0;
  const result = await recordQaTurnTrace({
    env: {
      VERCEL_ENV: "preview",
      KEY_QA_TURN_RECORDER_CUSTOMER_IDS: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
    },
    customerId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
    insertImpl: async () => {
      inserts += 1;
      return { ok: true };
    },
  });
  assert.equal(result.attempted, false);
  assert.equal(inserts, 0);
  ok("3_preview_flag_missing_write_0");
}

// 4. allowlist miss → write 0
{
  let inserts = 0;
  const result = await recordQaTurnTrace({
    env: {
      VERCEL_ENV: "preview",
      KEY_QA_TURN_RECORDER: "1",
      KEY_QA_TURN_RECORDER_CUSTOMER_IDS: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
    },
    customerId: "11111111-2222-3333-4444-555555555555",
    insertImpl: async () => {
      inserts += 1;
      return { ok: true };
    },
  });
  assert.equal(result.attempted, false);
  assert.equal(inserts, 0);
  ok("4_allowlist_miss_write_0");
}

// 5. count question only → POLICY_COUNT_AUTHORITY recorded
{
  const withCount = buildSystemCapture({
    systemText: "BASE\n\n[POLICY_COUNT_AUTHORITY]\n장부 6건",
    policyCountAuthorityAddendum: "active_distinct_count=6 · 장부 6건",
    hasDomainContext: true,
  });
  const withoutCount = buildSystemCapture({
    systemText: "BASE",
    policyCountAuthorityAddendum: null,
    hasDomainContext: true,
  });
  assert.ok(withCount.system_block_order.includes("POLICY_COUNT_AUTHORITY"));
  assert.equal(withCount.flags.has_policy_count_authority, true);
  assert.equal(withCount.flags.policy_count_authority_n, 6);
  assert.equal(withoutCount.flags.has_policy_count_authority, false);
  assert.ok(!withoutCount.system_block_order.includes("POLICY_COUNT_AUTHORITY"));
  ok("5_policy_count_authority_count_only");
}

// 6. originals manifest has no bytes/base64
{
  const manifest = buildOriginalsManifest({
    attachments: [
      {
        document_id: "doc-1",
        content_sha256: "abc123",
        mediaType: "application/pdf",
        base64: "JVBERi0xLjQ=",
        bytes: new Uint8Array([1, 2, 3]),
      },
    ],
    vaultRecall: { mode: "attach", listing: [{ id: "doc-1" }], reason: "vault" },
  });
  const json = JSON.stringify(manifest);
  assert.equal(json.includes("JVBERi0"), false);
  assert.equal(manifest.blocks[0].document_id, "doc-1");
  assert.equal(manifest.blocks[0].sha256, "abc123");
  assert.ok(!("base64" in manifest.blocks[0]) || manifest.blocks[0].base64 === "[REDACTED_FORBIDDEN_KEY]");
  ok("6_originals_no_bytes_base64");
}

// 7. Authorization / Cookie / secret scrub
{
  const scrubbed = scrubSecretsInText(
    "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.aaa.bbb Cookie: session=abc ANTHROPIC_API_KEY=sk-ant-secret QA_PASSWORD=plain",
  );
  assert.ok(scrubbed.includes("[REDACTED]"));
  assert.equal(scrubbed.includes("sk-ant-secret"), false);
  assert.equal(scrubbed.includes("QA_PASSWORD=plain"), false);
  const deep = scrubDeepForQaTrace({
    Authorization: "Bearer tok",
    nested: { api_key: "x", ok: "y" },
  });
  assert.equal(deep.Authorization, "[REDACTED_FORBIDDEN_KEY]");
  assert.equal(deep.nested.api_key, "[REDACTED_FORBIDDEN_KEY]");
  ok("7_secret_scrub");
}

// 8. timeout/storage fail does not throw into customer path
{
  const timed = await completeQaTurnTraceWrite({
    writePromise: new Promise((resolve) => {
      setTimeout(() => resolve({ ok: true }), 50);
    }),
    timeoutMs: 5,
  });
  assert.equal(timed.error_code, "timeout");

  let threw = false;
  try {
    const r = await recordQaTurnTrace({
      env: {
        VERCEL_ENV: "preview",
        KEY_QA_TURN_RECORDER: "on",
        KEY_QA_TURN_RECORDER_CUSTOMER_IDS: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
      },
      customerId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
      insertImpl: async () => {
        throw new Error("storage down");
      },
    });
    assert.equal(r.ok, false);
    assert.equal(r.error_code, "storage_fail");
  } catch {
    threw = true;
  }
  assert.equal(threw, false);
  ok("8_timeout_storage_no_throw");
}

// 9. voice_trace link via turn_trace_id
{
  const id = createTurnTraceId();
  const payload = assembleQaTurnTracePayload({
    turnTraceId: id,
    env: { VERCEL_ENV: "preview" },
    customerId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
  });
  assert.equal(payload.voice_trace_link.turn_trace_id, id);
  assert.equal(payload.voice_trace_link.compose_mode, "key_claude_first_direct");
  assert.equal(payload.customer_id_hash, hashSensitiveId("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee", { VERCEL_ENV: "preview" }));
  ok("9_voice_trace_turn_trace_id_link");
}

// 10. history_full default OFF
{
  assert.equal(isHistoryFullEnabled({}), false);
  assert.equal(isHistoryFullEnabled({ KEY_QA_TURN_RECORDER_HISTORY_FULL: "0" }), false);
  const capture = buildUserPayloadCapture({
    userPayload: { policy_truth: { COUNT_QUESTION: true } },
    history: [
      { role: "assistant", content: "총 12건입니다" },
      { role: "user", content: "몇 건이야?" },
    ],
    question: "몇 건이야?",
    historyFull: false,
  });
  assert.equal(capture.history_full, false);
  assert.equal(capture.history_messages_redacted, undefined);
  assert.ok(capture.history_contract_pollution_hits.length >= 1);
  ok("10_history_full_default_off");
}

// 11. purge dry-run / trace-id / expired
{
  const store = [
    {
      turn_trace_id: "qatr_keep",
      expires_at: new Date(Date.now() + 3600_000).toISOString(),
      customer_id_hash: "hash-a",
    },
    {
      turn_trace_id: "qatr_old",
      expires_at: new Date(Date.now() - 3600_000).toISOString(),
      customer_id_hash: "hash-b",
    },
  ];
  const admin = {
    from() {
      const state = { mode: null, filter: null };
      const api = {
        select() {
          return api;
        },
        eq(col, val) {
          state.mode = "eq";
          state.filter = { col, val };
          return api;
        },
        lt(col, val) {
          state.mode = "lt";
          state.filter = { col, val };
          return api;
        },
        in(col, ids) {
          state.deleteIds = ids;
          return api;
        },
        limit() {
          let rows = [...store];
          if (state.mode === "eq" && state.filter?.col === "turn_trace_id") {
            rows = rows.filter((r) => r.turn_trace_id === state.filter.val);
          } else if (state.mode === "eq" && state.filter?.col === "customer_id_hash") {
            rows = rows.filter((r) => r.customer_id_hash === state.filter.val);
          } else if (state.mode === "lt" && state.filter?.col === "expires_at") {
            rows = rows.filter((r) => r.expires_at < state.filter.val);
          }
          return Promise.resolve({ data: rows, error: null });
        },
        delete() {
          return {
            in: async (_col, ids) => {
              for (const id of ids) {
                const idx = store.findIndex((r) => r.turn_trace_id === id);
                if (idx >= 0) store.splice(idx, 1);
              }
              return { error: null };
            },
          };
        },
      };
      return api;
    },
  };

  const dry = await purgeQaTurnTraces({
    admin,
    mode: "all-expired",
    dryRun: true,
    env: {},
  });
  assert.equal(dry.ok, true);
  assert.equal(dry.dry_run, true);
  assert.equal(dry.would_delete, 1);

  const byId = await purgeQaTurnTraces({
    admin,
    mode: "trace-id",
    traceId: "qatr_old",
    dryRun: false,
    env: { KEY_QA_TURN_RECORDER_PURGE: "1" },
  });
  assert.equal(byId.ok, true);
  assert.equal(byId.deleted, 1);
  assert.equal(store.some((r) => r.turn_trace_id === "qatr_old"), false);
  ok("11_purge_dry_run_trace_expired");
}

// 12. Claude call 1 / second Claude 0 (capture contract)
{
  let inserts = 0;
  const result = await recordQaTurnTrace({
    env: {
      VERCEL_ENV: "preview",
      KEY_QA_TURN_RECORDER: "true",
      KEY_QA_TURN_RECORDER_CUSTOMER_IDS: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
    },
    customerId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
    claudeCapture: {
      provider_messages_request_count: 1,
      second_claude_call: false,
      provider_raw_customer_text: "답",
    },
    insertImpl: async ({ payload }) => {
      inserts += 1;
      assert.equal(payload.claude.second_claude_call, false);
      assert.equal(payload.claude.provider_messages_request_count, 1);
      return { ok: true };
    },
  });
  assert.equal(result.ok, true);
  assert.equal(inserts, 1);
  assert.ok(result.write_ms <= QA_TURN_WRITE_TIMEOUT_MS + 200);
  ok("12_claude_call_one_second_zero");
}

console.log(`\nkey-qa-turn-recorder-unit-test: ${passed}/12 PASS`);
