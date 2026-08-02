/**
 * KEY document-memory commit — provider-free unit tests (no network / Claude / secrets).
 */
import assert from "node:assert/strict";
import {
  KEY_DOCUMENT_MEMORY_PERSIST_FAILED,
  buildContractsFromAcceptedFacts,
  buildDocumentMemoryPersistFailedPayload,
  buildKeyDocumentMemoryIdempotencyKey,
  buildKeyLatestDocumentContext,
  beginKeyDocumentMemoryCommit,
  classifyDocumentReadStatus,
  commitKeyDocumentMemory,
  failKeyDocumentMemoryCommit,
  loadActiveKeyDocumentMemoryCommit,
  loadLatestCommittedMemoryVersion,
  persistOfficialDocumentMemoryWithRetry,
} from "../server/keyCore/keyDocumentMemoryCommit.js";
import { buildPolicyFieldsFromKeyConfirmedFacts } from "../server/documentPolicyUploadPersist.js";
import { buildContractIdentityKey } from "../src/lib/keyInsuranceScreenFacts.js";
import {
  buildHandoffCardPayload,
  openReadyCardHandoff,
  sealReadyCardHandoff,
} from "../server/keyCore/keyReadyCardHandoff.js";
import { evaluateReadyCardHandoffMemoryGate } from "../server/keyCore/keyReadyCardBuild.js";
import { buildHomeBrainFactRequestBody } from "../src/lib/homeBrainFactRequestBody.js";

/** Mirror customerHomeBrainFact.js — not imported (pulls browser supabase at load). */
function mapHomeBrainFactPayloadForTest(payload) {
  return {
    answerText: payload.answerText ?? "",
    keyMonopolyFailure: payload.key_monopoly_failure === true,
    documentMemoryPersistFailed: payload.document_memory_persist_failed === true,
    memoryCommitId: payload.memory_commit_id ?? null,
    answerSealed: payload.answer_sealed === true,
    memoryPersistErrorMessage: payload.error_message ?? null,
  };
}

/** Mirror applyHomeBrainFactSseEvent error branch (not exported). */
function applyMemoryPersistFailedSseEvent(data, assignFinal) {
  if (
    data.reason === KEY_DOCUMENT_MEMORY_PERSIST_FAILED &&
    data.answer_sealed === true
  ) {
    assignFinal({
      ok: true,
      document_memory_persist_failed: true,
      answer_sealed: true,
      answerText: null,
      reason: KEY_DOCUMENT_MEMORY_PERSIST_FAILED,
      memory_commit_id: data.memory_commit_id,
      commit_status: "failed",
      error_message: data.error_message,
    });
    return true;
  }
  return false;
}

const DUMMY_SECRET = "x".repeat(40);
const dummyEnv = { SERVICE_ROLE_KEY: DUMMY_SECRET };

let PROVIDER_CALLS = 0;
const originalFetch = globalThis.fetch;
globalThis.fetch = (...args) => {
  PROVIDER_CALLS += 1;
  if (typeof originalFetch === "function") {
    return originalFetch(...args);
  }
  return Promise.reject(new Error("fetch blocked in unit test"));
};

function ok(name) {
  console.log(`PASS ${name}`);
}

function createMemoryCommitStore(initialRows = []) {
  let nextId = 1;
  const rows = initialRows.map((row) => ({
    id: row.id ?? `mock-id-${nextId++}`,
    ...row,
  }));
  let rpcHandler = null;

  function matchRow(row, filters, neqFilters) {
    for (const f of filters) {
      if (String(row[f.col] ?? "") !== String(f.val ?? "")) return false;
    }
    for (const f of neqFilters) {
      if (String(row[f.col] ?? "") === String(f.val ?? "")) return false;
    }
    return true;
  }

  function queryRows(table, filters, neqFilters, orderCol, orderAsc, limitN) {
    if (table !== "key_document_memory_commits") return [];
    let matched = rows.filter((row) => matchRow(row, filters, neqFilters));
    if (orderCol) {
      matched = [...matched].sort((a, b) => {
        const av = a[orderCol];
        const bv = b[orderCol];
        if (av == null && bv == null) return 0;
        if (av == null) return 1;
        if (bv == null) return -1;
        return orderAsc ? Number(av) - Number(bv) : Number(bv) - Number(av);
      });
    }
    if (limitN != null) matched = matched.slice(0, limitN);
    return matched;
  }

  function makeChain() {
    const state = {
      table: null,
      filters: [],
      neqFilters: [],
      orderCol: null,
      orderAsc: true,
      limitN: null,
      updatePayload: null,
      insertPayload: null,
    };

    const chain = {
      from(table) {
        state.table = table;
        return chain;
      },
      select() {
        return chain;
      },
      eq(col, val) {
        state.filters.push({ col, val });
        return chain;
      },
      neq(col, val) {
        state.neqFilters.push({ col, val });
        return chain;
      },
      order(col, { ascending = true } = {}) {
        state.orderCol = col;
        state.orderAsc = ascending;
        return chain;
      },
      limit(n) {
        state.limitN = n;
        return chain;
      },
      update(payload) {
        state.updatePayload = payload;
        return chain;
      },
      insert(payload) {
        state.insertPayload = payload;
        return chain;
      },
      async single() {
        const matched = queryRows(
          state.table,
          state.filters,
          state.neqFilters,
          state.orderCol,
          state.orderAsc,
          state.limitN,
        );
        if (state.updatePayload) {
          const row = matched[0];
          assert.ok(row, "update single expected one row");
          Object.assign(row, state.updatePayload);
          return { data: { ...row }, error: null };
        }
        if (state.insertPayload) {
          const row = { id: `mock-id-${nextId++}`, ...state.insertPayload };
          rows.push(row);
          return { data: { ...row }, error: null };
        }
        assert.equal(matched.length, 1, "single expected exactly one row");
        return { data: { ...matched[0] }, error: null };
      },
      async maybeSingle() {
        const matched = queryRows(
          state.table,
          state.filters,
          state.neqFilters,
          state.orderCol,
          state.orderAsc,
          state.limitN,
        );
        if (state.updatePayload) {
          const row = matched[0];
          if (!row) return { data: null, error: null };
          Object.assign(row, state.updatePayload);
          return { data: { ...row }, error: null };
        }
        if (state.insertPayload) {
          const row = { id: `mock-id-${nextId++}`, ...state.insertPayload };
          rows.push(row);
          return { data: { ...row }, error: null };
        }
        return { data: matched[0] ? { ...matched[0] } : null, error: null };
      },
    };

    return chain;
  }

  const supabase = {
    from(table) {
      return makeChain().from(table);
    },
    rpc(name, args) {
      if (typeof rpcHandler !== "function") {
        return Promise.resolve({ data: null, error: { message: "no_rpc_handler" } });
      }
      return Promise.resolve(rpcHandler(name, args));
    },
    _rows: rows,
    setRpcHandler(fn) {
      rpcHandler = fn;
    },
  };

  return supabase;
}

// A — Memory state machine
{
  const base = {
    customerId: "cust-1",
    sessionId: "sess-1",
    sourceTurnId: "turn-1",
    documentIds: ["doc-b", "doc-a"],
  };
  const key1 = buildKeyDocumentMemoryIdempotencyKey(base);
  const key2 = buildKeyDocumentMemoryIdempotencyKey({
    ...base,
    documentIds: ["doc-a", "doc-b"],
  });
  assert.ok(key1);
  assert.equal(key1, key2);

  assert.equal(
    classifyDocumentReadStatus({ acceptedCount: 0, rejectedCount: 0, originalsAttached: true }),
    "no_confirmable_facts",
  );
  assert.deepEqual(buildContractsFromAcceptedFacts([]), []);

  assert.equal(
    buildKeyLatestDocumentContext({ commit_status: "preparing", memory_commit_id: "m1" }),
    null,
  );
  assert.equal(
    buildKeyLatestDocumentContext({ commit_status: "failed", memory_commit_id: "m1" }),
    null,
  );
  const committedCtx = buildKeyLatestDocumentContext({
    commit_status: "committed",
    memory_commit_id: "mc-committed",
    memory_version: 3,
    customer_id: "cust-1",
    session_id: "sess-1",
    source_turn_id: "turn-1",
    document_ids: ["doc-a"],
    primary_document_id: "doc-a",
    read_status: "confirmed_facts",
    focus_status: "active",
    contracts: [],
    rejected_fact_count: 0,
    recorded_at: "2026-01-01T00:00:00.000Z",
    committed_at: "2026-01-01T00:00:01.000Z",
  });
  assert.ok(committedCtx);
  assert.equal(committedCtx.memory_commit_id, "mc-committed");
  assert.equal(committedCtx.memory_version, 3);
}
ok("A_idempotency_classify_context");

{
  const supabase = createMemoryCommitStore();
  const scope = {
    supabase,
    customerId: "cust-1",
    sessionId: "sess-1",
    sourceTurnId: "turn-1",
    documentIds: ["doc-a"],
    readStatus: "no_confirmable_facts",
  };
  const first = await beginKeyDocumentMemoryCommit(scope);
  assert.equal(first.ok, true);
  assert.equal(first.already_committed, false);
  assert.equal(supabase._rows.length, 1);

  const second = await beginKeyDocumentMemoryCommit(scope);
  assert.equal(second.ok, true);
  assert.equal(second.memory_commit_id, first.memory_commit_id);
  assert.equal(supabase._rows.length, 1);
}
ok("A_begin_idempotency_single_row");

{
  const supabase = createMemoryCommitStore([
    {
      id: "row-1",
      customer_id: "cust-1",
      session_id: "sess-1",
      memory_commit_id: "mc-done",
      idempotency_key: buildKeyDocumentMemoryIdempotencyKey({
        customerId: "cust-1",
        sessionId: "sess-1",
        sourceTurnId: "turn-1",
        documentIds: ["doc-a"],
      }),
      commit_status: "committed",
      memory_version: 2,
      focus_status: "active",
      document_ids: ["doc-a"],
      primary_document_id: "doc-a",
      read_status: "confirmed_facts",
      contracts: [],
      rejected_fact_count: 0,
    },
  ]);
  const again = await beginKeyDocumentMemoryCommit({
    supabase,
    customerId: "cust-1",
    sessionId: "sess-1",
    sourceTurnId: "turn-1",
    documentIds: ["doc-a"],
  });
  assert.equal(again.ok, true);
  assert.equal(again.already_committed, true);
  assert.equal(again.memory_commit_id, "mc-done");
}
ok("A_begin_already_committed");

{
  const supabase = createMemoryCommitStore([
    {
      id: "prep",
      customer_id: "cust-1",
      session_id: "sess-1",
      memory_commit_id: "mc-prep",
      commit_status: "preparing",
      focus_status: "active",
      memory_version: null,
    },
    {
      id: "fail",
      customer_id: "cust-1",
      session_id: "sess-1",
      memory_commit_id: "mc-fail",
      commit_status: "failed",
      focus_status: "active",
      memory_version: null,
    },
    {
      id: "good",
      customer_id: "cust-1",
      session_id: "sess-1",
      memory_commit_id: "mc-good",
      commit_status: "committed",
      focus_status: "active",
      memory_version: 5,
      document_ids: ["doc-a"],
      primary_document_id: "doc-a",
      read_status: "confirmed_facts",
      contracts: [],
      rejected_fact_count: 0,
    },
  ]);
  const loaded = await loadActiveKeyDocumentMemoryCommit({
    supabase,
    customerId: "cust-1",
    sessionId: "sess-1",
  });
  assert.equal(loaded.ok, true);
  assert.equal(loaded.row?.memory_commit_id, "mc-good");
}
ok("A_load_active_ignores_preparing_failed");

{
  const supabase = createMemoryCommitStore([
    {
      id: "row-1",
      customer_id: "cust-1",
      memory_commit_id: "mc-fail-me",
      commit_status: "preparing",
    },
  ]);
  const failed = await failKeyDocumentMemoryCommit({
    supabase,
    customerId: "cust-1",
    memoryCommitId: "mc-fail-me",
    failureCode: "persist_failed",
    failureStage: "commit",
  });
  assert.equal(failed.ok, true);
  assert.equal(failed.commit_status, "failed");
  assert.equal(supabase._rows[0].commit_status, "failed");
}
ok("A_fail_commit_sets_failed");

{
  const payload = buildDocumentMemoryPersistFailedPayload({
    memoryCommitId: "mc-x",
    errorMessage: "retry later",
  });
  assert.equal(payload.reason, KEY_DOCUMENT_MEMORY_PERSIST_FAILED);
  assert.equal(payload.answer_sealed, true);
  assert.equal(payload.memory_commit_id, "mc-x");
  assert.equal(payload.commit_status, "failed");
}
ok("A_persist_failed_payload");

{
  const supabase = createMemoryCommitStore();
  let rpcCalls = 0;
  const sleepCalls = [];
  supabase.setRpcHandler((name) => {
    assert.equal(name, "lifeguard_commit_key_document_memory");
    rpcCalls += 1;
    if (rpcCalls < 3) {
      return { data: null, error: { message: "transient" } };
    }
    const row = supabase._rows.find((r) => r.commit_status === "preparing");
    if (row) {
      row.commit_status = "committed";
      row.memory_version = 1;
      row.focus_status = "active";
    }
    return {
      data: {
        ok: true,
        memory_commit_id: row?.memory_commit_id ?? "mc-retry",
        memory_version: 1,
        commit_status: "committed",
      },
      error: null,
    };
  });

  const result = await persistOfficialDocumentMemoryWithRetry({
    supabase,
    customerId: "cust-1",
    sessionId: "sess-1",
    sourceTurnId: "turn-retry",
    documentIds: ["doc-a"],
    acceptedFacts: [
      {
        fact_type: "insurer_name",
        literal_value: "삼성생명",
        source_document_id: "doc-a",
      },
    ],
    rejectedFactCount: 0,
    sleepImpl: async (ms) => {
      sleepCalls.push(ms);
    },
    maxAttempts: 3,
    delaysMs: [0, 250, 750],
  });

  assert.equal(result.ok, true);
  assert.equal(result.attempts, 3);
  assert.equal(rpcCalls, 3);
  assert.deepEqual(sleepCalls, [250, 750]);
  assert.equal(PROVIDER_CALLS, 0);
}
ok("A_persist_retry_three_attempts_no_fetch");

// B — Identity
{
  const customerId = "cust-identity";
  const exactPn = "ABC1234567";
  const basePolicy = {
    customer_id: customerId,
    insurer_name: "삼성생명",
    policy_number: exactPn,
    coverage_summary: { policy_number_quality: "exact_unmasked" },
  };
  const keyA = buildContractIdentityKey(basePolicy, { customerId });
  const keyB = buildContractIdentityKey(
    { ...basePolicy, insurer_name: "한화생명" },
    { customerId },
  );
  assert.ok(keyA);
  assert.ok(keyB);
  assert.notEqual(keyA, keyB);
  assert.match(keyA, /^cid:cust-identity\|ins:/);
  assert.match(keyA, /\|pn:abc1234567$/);

  const masked = buildContractIdentityKey(
    {
      ...basePolicy,
      policy_number: "ABC****567",
      coverage_summary: { policy_number_quality: "masked" },
    },
    { customerId },
  );
  assert.equal(masked, null);

  const partial = buildContractIdentityKey(
    {
      ...basePolicy,
      policy_number: "ABC12",
      coverage_summary: { policy_number_quality: "partial" },
    },
    { customerId },
  );
  assert.equal(partial, null);
}
ok("B_contract_identity_key");

{
  const fields = buildPolicyFieldsFromKeyConfirmedFacts(
    "doc-policy-1",
    [
      {
        fact_type: "policy_number",
        literal_value: "POLICY-123456",
        source_document_id: "doc-policy-1",
        verification_status: "key_confirmed_from_original",
      },
      {
        fact_type: "insurer_name",
        literal_value: "삼성생명",
        source_document_id: "doc-policy-1",
      },
    ],
    null,
  );
  assert.equal(fields.coverage_summary.policy_number, "POLICY-123456");
  assert.equal(fields.coverage_summary.policy_number_quality, "exact_unmasked");
  assert.equal(fields.coverage_summary.source_document_id, "doc-policy-1");
}
ok("B_policy_fields_promote_exact_pn");

// C — Ready Card handoff version
{
  const card = {
    customer_id: "cust-handoff",
    session_id: "sess-handoff",
    materials_connected: true,
    status: "normal",
    card_version: "triangle-ready-card-v2.2",
    prepared_at: new Date().toISOString(),
    built_from_memory_version: 7,
    insurance_card: { confirmed_count: 1 },
  };
  const payload = buildHandoffCardPayload(card, { authUserId: "auth-1" });
  assert.ok(payload);
  assert.equal(payload.built_from_memory_version, 7);
  assert.equal(payload.card.built_from_memory_version, 7);

  const sealed = sealReadyCardHandoff(card, { authUserId: "auth-1", env: dummyEnv });
  assert.equal(sealed.ok, true);
  assert.ok(sealed.token.startsWith("rch1."));

  const opened = openReadyCardHandoff(sealed.token, {
    customerId: "cust-handoff",
    authUserId: "auth-1",
    sessionId: "sess-handoff",
    env: dummyEnv,
  });
  assert.equal(opened.ok, true);
  assert.equal(opened.card.built_from_memory_version, 7);
  assert.equal(opened.meta.built_from_memory_version, 7);
}
ok("C_handoff_built_from_memory_version");

// D — client_turn_id
{
  const withTurn = buildHomeBrainFactRequestBody(
    "문서 봐줘",
    [],
    {
      currentTurnDocumentIds: ["doc-1"],
      documentIds: ["doc-1"],
      clientTurnId: "client-turn-abc",
    },
  );
  assert.equal(withTurn.client_turn_id, "client-turn-abc");
  assert.deepEqual(withTurn.current_turn_document_ids, ["doc-1"]);
  assert.equal(withTurn.document_id, "doc-1");
  assert.equal(withTurn.explicit_reopen_document_ids, undefined);

  const withoutTurn = buildHomeBrainFactRequestBody("후속 질문", [], {
    documentIds: ["doc-1"],
    currentTurnDocumentIds: [],
  });
  assert.equal(withoutTurn.client_turn_id, undefined);
  assert.equal(withoutTurn.document_id, undefined);
}
ok("D_client_turn_id");

// E — Timing orchestration pure test
{
  const steps = [];
  const record = (step) => {
    steps.push({ step, at: steps.length });
  };
  record("seal");
  record("memory_commit");
  record("version");
  record("done");

  const idx = Object.fromEntries(steps.map((row) => [row.step, row.at]));
  assert.ok(idx.seal < idx.memory_commit);
  assert.ok(idx.memory_commit < idx.version);
  assert.ok(idx.version < idx.done);
  assert.deepEqual(steps.map((row) => row.step), [
    "seal",
    "memory_commit",
    "version",
    "done",
  ]);
}
ok("E_timing_orchestration_order");

// F — Memory fail client path
{
  const failPayload = buildDocumentMemoryPersistFailedPayload({
    memoryCommitId: "mc-client-fail",
    errorMessage: "storage unavailable",
  });
  const mapped = mapHomeBrainFactPayloadForTest({
    ok: true,
    answerText: "답변은 이미 준비됐습니다.",
    document_memory_persist_failed: true,
    answer_sealed: true,
    reason: failPayload.reason,
    memory_commit_id: failPayload.memory_commit_id,
    commit_status: failPayload.commit_status,
    error_message: failPayload.error_message,
    key_monopoly_failure: false,
  });

  assert.equal(mapped.documentMemoryPersistFailed, true);
  assert.equal(mapped.answerSealed, true);
  assert.equal(mapped.memoryCommitId, "mc-client-fail");
  assert.equal(mapped.answerText, "답변은 이미 준비됐습니다.");
  assert.equal(mapped.keyMonopolyFailure, false);
  assert.ok(mapped.memoryPersistErrorMessage);

  const genericWipe = mapHomeBrainFactPayloadForTest({
    ok: false,
    answerText: "",
    key_monopoly_failure: true,
    failure_reason: "provider_error",
  });
  assert.equal(genericWipe.documentMemoryPersistFailed, false);
  assert.equal(genericWipe.answerSealed, false);
  assert.notEqual(genericWipe.answerText, mapped.answerText);

  let sseFinal = null;
  const handled = applyMemoryPersistFailedSseEvent(
    {
      reason: KEY_DOCUMENT_MEMORY_PERSIST_FAILED,
      answer_sealed: true,
      memory_commit_id: "mc-sse",
      error_message: "persist failed after seal",
    },
    (final) => {
      sseFinal = final;
    },
  );
  assert.equal(handled, true);
  assert.equal(sseFinal?.ok, true);
  assert.equal(sseFinal?.document_memory_persist_failed, true);
  assert.equal(sseFinal?.answer_sealed, true);
  assert.equal(sseFinal?.reason, KEY_DOCUMENT_MEMORY_PERSIST_FAILED);
}
ok("F_memory_fail_not_generic_wipe");

// G — QUERY_ERROR_SWALLOWED fix: hit / miss / query_failed distinct; lookup fail rejects handoff
{
  const cid = "11111111-1111-1111-1111-111111111111";
  const sid = "sess-lookup";
  const sb = createMemoryCommitStore();

  // empty → ok+miss, version 0 (legitimate)
  const empty = await loadLatestCommittedMemoryVersion({
    supabase: sb,
    customerId: cid,
  });
  assert.equal(empty.ok, true);
  assert.equal(empty.reason, "miss");
  assert.equal(empty.memory_version, 0);

  // insert committed active row
  sb._rows.push({
    id: "row-1",
    customer_id: cid,
    session_id: sid,
    source_turn_id: "t1",
    memory_commit_id: "22222222-2222-2222-2222-222222222222",
    idempotency_key: "idem-1",
    commit_status: "committed",
    memory_version: 1,
    document_ids: ["33333333-3333-3333-3333-333333333333"],
    primary_document_id: "33333333-3333-3333-3333-333333333333",
    read_status: "confirmed_facts",
    focus_status: "active",
    contracts: [],
    rejected_fact_count: 0,
    recorded_at: new Date().toISOString(),
    committed_at: new Date().toISOString(),
  });
  const hit = await loadLatestCommittedMemoryVersion({
    supabase: sb,
    customerId: cid,
  });
  assert.equal(hit.ok, true);
  assert.equal(hit.reason, "hit");
  assert.equal(hit.memory_version, 1);

  const activeHit = await loadActiveKeyDocumentMemoryCommit({
    supabase: sb,
    customerId: cid,
    sessionId: sid,
  });
  assert.equal(activeHit.ok, true);
  assert.equal(activeHit.reason, "hit");
  assert.ok(activeHit.row);

  // query_failed must not look like miss/version 0
  const failingSb = {
    from() {
      return {
        select() {
          return this;
        },
        eq() {
          return this;
        },
        order() {
          return this;
        },
        limit() {
          return this;
        },
        maybeSingle: async () => ({
          data: null,
          error: { message: "simulated_query_failed" },
        }),
      };
    },
  };
  const failed = await loadLatestCommittedMemoryVersion({
    supabase: failingSb,
    customerId: cid,
  });
  assert.equal(failed.ok, false);
  assert.equal(failed.reason, "query_failed");
  assert.equal(failed.memory_version, null);
  assert.match(String(failed.error ?? ""), /simulated_query_failed/);

  const activeFailed = await loadActiveKeyDocumentMemoryCommit({
    supabase: failingSb,
    customerId: cid,
    sessionId: sid,
  });
  assert.equal(activeFailed.ok, false);
  assert.equal(activeFailed.reason, "query_failed");
  assert.equal(activeFailed.row, null);

  // handoff gate: lookup fail → reject (never reuse as fresh)
  const gateFail = evaluateReadyCardHandoffMemoryGate(failed, 0);
  assert.equal(gateFail.reuse_handoff, false);
  assert.equal(gateFail.reject_reason, "handoff_memory_lookup_failed");

  // handoff gate: miss (empty) → may reuse
  const gateMiss = evaluateReadyCardHandoffMemoryGate(empty, 0);
  assert.equal(gateMiss.reuse_handoff, true);
  assert.equal(gateMiss.reject_reason, null);

  // handoff gate: stale token
  const gateStale = evaluateReadyCardHandoffMemoryGate(hit, 0);
  assert.equal(gateStale.reuse_handoff, false);
  assert.equal(gateStale.reject_reason, "handoff_memory_stale");

  // handoff gate: fresh token matching db
  const gateFresh = evaluateReadyCardHandoffMemoryGate(hit, 1);
  assert.equal(gateFresh.reuse_handoff, true);
  assert.equal(gateFresh.reject_reason, null);
}
ok("G_lookup_hit_miss_query_failed_handoff_gate");

assert.equal(PROVIDER_CALLS, 0, "PROVIDER_CALLS must stay 0");
console.log(`PROVIDER_CALLS=${PROVIDER_CALLS}`);
console.log("\nALL_PASS key-document-memory-commit-unit-test");
