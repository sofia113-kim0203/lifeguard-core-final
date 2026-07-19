import assert from "node:assert/strict";
import { register } from "node:module";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Inline Vite supabase stub so this test needs no helper files / VITE_* env.
const SUPABASE_STUB_SOURCE = `
export const supabase = {
  from() {
    throw new Error("stub_supabase_from_unused");
  },
  rpc() {
    throw new Error("stub_supabase_rpc_unused");
  },
  storage: {
    from() {
      return {
        remove: async () => ({ error: new Error("stub_storage_unused") }),
      };
    },
  },
};
`;
const SUPABASE_STUB_URL = `data:text/javascript,${encodeURIComponent(SUPABASE_STUB_SOURCE)}`;
const HOOK_SOURCE = `
export async function resolve(specifier, context, nextResolve) {
  if (
    specifier === "./supabase.js" ||
    specifier === "../lib/supabase.js" ||
    specifier.endsWith("/supabase.js")
  ) {
    return { shortCircuit: true, url: ${JSON.stringify(SUPABASE_STUB_URL)} };
  }
  return nextResolve(specifier, context);
}
`;
register(`data:text/javascript,${encodeURIComponent(HOOK_SOURCE)}`);

const {
  DOCUMENT_DELETE_REASON,
  softDeleteDocument,
  isStorageRemoveAlreadyGoneError,
  claimCaseReferencesSourceDocument,
  retirePoliciesForSourceDocument,
  retireOrphanSourceDeletedPoliciesForCustomer,
  filterPoliciesToActiveSourceDocuments,
} = await import("../src/lib/customerDocuments.js");
const { finalizeCustomerDocumentSoftDelete } = await import(
  "../server/documentSoftDeleteFinalize.js"
);
const {
  clearActiveAttachmentIfDocumentDeleted,
  normalizeActiveAttachment,
  scrubDeletedDocumentFromMessageActiveAttachments,
} = await import("../src/lib/chatActiveAttachment.js");
const {
  rememberClearedActiveAttachmentId,
  readClearedActiveAttachmentIds,
  rejectClearedActiveAttachment,
  clearedActiveAttachmentStorageKey,
} = await import("../src/lib/lifeguardChatSessionCore.js");

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const DOC_DIRECT = readFileSync(
  join(root, "server/keyCore/keyClaudeFullDocumentDirect.js"),
  "utf8",
);
const CUSTOMER_DOCS = readFileSync(join(root, "src/lib/customerDocuments.js"), "utf8");
const HOME_CHAT = readFileSync(join(root, "src/components/LifeguardHomeChat.jsx"), "utf8");
const DOCS_PANEL = readFileSync(join(root, "src/components/DocumentsPanel.jsx"), "utf8");
const UI_LOCALE = readFileSync(join(root, "src/lib/uiLocale.js"), "utf8");

assert.equal(DOCUMENT_DELETE_REASON.DOCUMENT_SOFT_DELETE_FAILED, "document_soft_delete_failed");
assert.equal(DOCUMENT_DELETE_REASON.POLICY_RETIRE_FAILED, "policy_retire_failed");
assert.equal(DOCUMENT_DELETE_REASON.CLAIM_SCRUB_FAILED, "claim_scrub_failed");
assert.equal(DOCUMENT_DELETE_REASON.STORAGE_REMOVE_FAILED, "storage_remove_failed");
assert.equal(DOCUMENT_DELETE_REASON.MEMORY_SCRUB_FAILED, "memory_scrub_failed");

const memoryScrubOk = async () => ({ ok: true, scrub: { retired_keyed_superseded: 0 } });

assert.equal(isStorageRemoveAlreadyGoneError({ message: "Object not found" }), true);
assert.equal(isStorageRemoveAlreadyGoneError({ message: "permission denied" }), false);

function makeSoftDeleteSupabase({
  document,
  rpcResult = null,
  rpcError = null,
  profileHealth = null,
  profileSelectError = null,
  profileUpdateError = null,
  policyUpdateError = null,
  policies = [],
  activeDocuments = [],
}) {
  let rpcCalls = 0;
  let profileUpdates = 0;
  let docReads = 0;
  let policyUpdates = 0;
  const state = {
    document: document ? { ...document } : null,
    activeDocuments: Array.isArray(activeDocuments)
      ? activeDocuments.map((d) => ({ ...d }))
      : [],
    profileHealth: profileHealth
      ? {
          customer_id: profileHealth.customer_id,
          details_json: structuredClone(profileHealth.details_json ?? {}),
        }
      : null,
    policies: Array.isArray(policies) ? policies.map((p) => ({ ...p })) : [],
    rpcCalls: 0,
    profileUpdates: 0,
    docReads: 0,
    policyUpdates: 0,
  };

  const client = {
    from(table) {
      if (table === "customer_documents") {
        const api = {
          select() {
            return api;
          },
          eq() {
            return api;
          },
          is() {
            return api;
          },
          not() {
            return api;
          },
          maybeSingle: async () => {
            state.docReads += 1;
            docReads += 1;
            return { data: state.document, error: null };
          },
          then(resolve) {
            // Active (non-deleted) docs — matches RLS-visible SELECT.
            const active = [];
            if (state.document && !state.document.deleted_at) {
              active.push({ id: state.document.id });
            }
            for (const row of state.activeDocuments) {
              if (row?.id && !active.some((d) => d.id === row.id)) {
                active.push({ id: row.id });
              }
            }
            resolve({ data: active, error: null });
          },
        };
        return api;
      }
      if (table === "profile_insurance_policies") {
        let mode = "select";
        let updatePayload = null;
        let filterId = null;
        const api = {
          select() {
            mode = "select";
            return api;
          },
          update(payload) {
            mode = "update";
            updatePayload = payload;
            return api;
          },
          eq(col, val) {
            if (col === "id") filterId = val;
            return api;
          },
          is() {
            return api;
          },
          then(resolve) {
            if (mode === "select") {
              resolve({ data: state.policies, error: null });
              return;
            }
            if (mode === "update") {
              if (policyUpdateError) {
                resolve({ error: policyUpdateError });
                return;
              }
              const row = state.policies.find((p) => p.id === filterId);
              if (row && updatePayload) {
                Object.assign(row, updatePayload);
                state.policyUpdates += 1;
                policyUpdates += 1;
              }
              resolve({ error: null });
            }
          },
        };
        return api;
      }
      if (table === "profile_health") {
        return {
          select() {
            return this;
          },
          eq() {
            return this;
          },
          maybeSingle: async () => {
            if (profileSelectError) return { data: null, error: profileSelectError };
            return { data: state.profileHealth, error: null };
          },
          update(payload) {
            return {
              eq: async () => {
                if (profileUpdateError) return { error: profileUpdateError };
                state.profileUpdates += 1;
                profileUpdates += 1;
                if (state.profileHealth) {
                  state.profileHealth.details_json = payload.details_json;
                  state.profileHealth.updated_at = payload.updated_at;
                }
                return { error: null };
              },
            };
          },
        };
      }
      throw new Error(`unexpected_table:${table}`);
    },
    rpc: async (name, args) => {
      assert.equal(name, "lifeguard_soft_delete_customer_document");
      state.rpcCalls += 1;
      rpcCalls += 1;
      if (rpcError) return { data: null, error: rpcError };
      if (rpcResult === false) {
        return { data: null, error: null };
      }
      const deletedAt = new Date().toISOString();
      if (state.document) state.document.deleted_at = deletedAt;
      return {
        data: rpcResult ?? { id: args.p_document_id, deleted_at: deletedAt },
        error: null,
      };
    },
    _state: state,
    _counts: () => ({ rpcCalls, profileUpdates, docReads }),
  };
  return client;
}

const authUser = { id: "auth-1" };
const ensureCustomerContext = async () => ({ customerId: "cust-1" });

function makeFinalize(admin, { storageRemove, scrubInsuranceMemory = memoryScrubOk } = {}) {
  return async (documentId) =>
    finalizeCustomerDocumentSoftDelete({
      admin,
      customerId: "cust-1",
      documentId,
      storageRemove,
      scrubInsuranceMemory,
    });
}

// --- claim scrub fail → success=false, clear_active_attachment, no final success ---
{
  const supabase = makeSoftDeleteSupabase({
    document: {
      id: "doc-scrub-fail",
      customer_id: "cust-1",
      storage_path: "cust-1/doc-scrub-fail.pdf",
      deleted_at: null,
    },
    profileHealth: {
      customer_id: "cust-1",
      details_json: {
        key_active_claim_cases: [
          {
            claim_case_key: "doc:doc-scrub-fail:date:2026-07-12",
            medical_event: { source_document_id: "doc-scrub-fail" },
          },
        ],
      },
    },
    profileUpdateError: { message: "profile_health_update_denied" },
  });
  let storageCalls = 0;
  const result = await softDeleteDocument(authUser, "doc-scrub-fail", {
    supabase,
    ensureCustomerContext,
    finalizeSoftDelete: makeFinalize(supabase, {
      storageRemove: async () => {
        storageCalls += 1;
        return { ok: true };
      },
    }),
  });
  assert.equal(result.success, false);
  assert.equal(result.reason, DOCUMENT_DELETE_REASON.CLAIM_SCRUB_FAILED);
  assert.equal(result.soft_delete_ok, true);
  assert.equal(result.current_insurance_invalidated, true);
  assert.equal(result.clear_active_attachment, true);
  assert.equal(result.storage_remove_ok, null);
  assert.match(result.error_message, /일부 관련 기록을 정리하지 못했습니다/);
  assert.equal(storageCalls, 0, "storage must not run before claim scrub succeeds");
  assert.ok(supabase._state.document.deleted_at, "RPC soft-delete already applied");
}

// --- idempotent re-delete completes safely (already soft-deleted + clean claims) ---
{
  const supabase = makeSoftDeleteSupabase({
    document: {
      id: "doc-retry",
      customer_id: "cust-1",
      storage_path: "cust-1/doc-retry.pdf",
      deleted_at: "2026-07-12T00:00:00.000Z",
    },
    profileHealth: {
      customer_id: "cust-1",
      details_json: {
        key_active_claim_cases: [
          { claim_case_key: "date:2026-01-01:kind:checkup", medical_event: { event_date: "2026-01-01" } },
        ],
      },
    },
  });
  let storageCalls = 0;
  const finalizeSoftDelete = makeFinalize(supabase, {
    storageRemove: async () => {
      storageCalls += 1;
      return { ok: true, already_gone: true };
    },
  });
  const first = await softDeleteDocument(authUser, "doc-retry", {
    supabase,
    ensureCustomerContext,
    finalizeSoftDelete,
  });
  assert.equal(first.success, true);
  assert.equal(first.soft_delete_ok, true);
  assert.equal(first.claim_cases_scrub?.ok, true);
  assert.equal(first.storage_remove_ok, true);
  assert.equal(supabase._state.rpcCalls, 0, "already deleted → skip RPC");
  assert.equal(storageCalls, 1);

  const second = await softDeleteDocument(authUser, "doc-retry", {
    supabase,
    ensureCustomerContext,
    finalizeSoftDelete,
  });
  assert.equal(second.success, true, "second delete is idempotent success");
  assert.equal(second.clear_active_attachment, true);
  assert.equal(supabase._state.rpcCalls, 0);
  assert.equal(storageCalls, 2);
}

// --- storage remove fail → success=false but soft-deleted doc excluded from KEY lookup ---
{
  const supabase = makeSoftDeleteSupabase({
    document: {
      id: "doc-storage-fail",
      customer_id: "cust-1",
      storage_path: "cust-1/doc-storage-fail.pdf",
      deleted_at: null,
    },
    profileHealth: {
      customer_id: "cust-1",
      details_json: { key_active_claim_cases: [] },
    },
  });
  const result = await softDeleteDocument(authUser, "doc-storage-fail", {
    supabase,
    ensureCustomerContext,
    finalizeSoftDelete: makeFinalize(supabase, {
      storageRemove: async () => ({ ok: false, error: { message: "storage_timeout" } }),
    }),
  });
  assert.equal(result.success, false);
  assert.equal(result.reason, DOCUMENT_DELETE_REASON.STORAGE_REMOVE_FAILED);
  assert.equal(result.soft_delete_ok, true);
  assert.equal(result.current_insurance_invalidated, true);
  assert.equal(result.clear_active_attachment, true);
  assert.ok(supabase._state.document.deleted_at);

  // KEY document direct path filters deleted_at IS NULL — soft-deleted id is excluded.
  assert.match(DOC_DIRECT, /\.is\(\s*["']deleted_at["']\s*,\s*null\s*\)/);
  assert.match(CUSTOMER_DOCS, /\.is\(\s*["']deleted_at["']\s*,\s*null\s*\)/);

  // Simulate KEY lookup after soft-delete: deleted_at set → treated as missing/denied.
  const deletedAt = supabase._state.document.deleted_at;
  const keyLookupWouldReturn =
    deletedAt == null ? supabase._state.document : null;
  assert.equal(keyLookupWouldReturn, null, "KEY must not read soft-deleted document");
}

// --- partial failure must not restore active document_id / prior_attach for next request ---
{
  const active = normalizeActiveAttachment({
    active_attachment_id: "doc-partial",
    active_attachment_mime: "image/jpeg",
    active_rotation_quarter_turns: 1,
  });
  const supabase = makeSoftDeleteSupabase({
    document: {
      id: "doc-partial",
      customer_id: "cust-1",
      storage_path: "cust-1/doc-partial.jpg",
      deleted_at: null,
    },
    profileSelectError: { message: "profile_health_select_failed" },
  });
  const result = await softDeleteDocument(authUser, "doc-partial", {
    supabase,
    ensureCustomerContext,
    finalizeSoftDelete: makeFinalize(supabase, {
      storageRemove: async () => ({ ok: true }),
    }),
  });
  assert.equal(result.success, false);
  assert.equal(result.reason, DOCUMENT_DELETE_REASON.CLAIM_SCRUB_FAILED);
  assert.equal(result.clear_active_attachment, true);

  const nextActive = clearActiveAttachmentIfDocumentDeleted(active, result.documentId);
  assert.equal(nextActive, null, "deleted document_id cleared from active attachment");
  const nextRequestDocumentId = nextActive?.active_attachment_id ?? null;
  assert.equal(nextRequestDocumentId, null, "next request must not resend deleted document_id");
}

// --- soft-delete clears message metadata + sessionStorage tombstone (refresh survival) ---
{
  const messages = [
    {
      role: "user",
      content: "(첨부: 조무연 보험증권.jpg) 확인",
      metadata: {
        active_attachment_id: "doc-refresh",
        active_attachment_mime: "image/jpeg",
      },
    },
    { role: "assistant", content: "확인했습니다." },
  ];
  const scrubbed = scrubDeletedDocumentFromMessageActiveAttachments(messages, "doc-refresh");
  assert.equal(scrubbed[0].metadata?.active_attachment_id, undefined);
  assert.match(scrubbed[0].content, /첨부/);
  assert.equal(
    scrubDeletedDocumentFromMessageActiveAttachments(messages, "doc-other")[0].metadata
      .active_attachment_id,
    "doc-refresh",
  );

  const g = globalThis;
  const store = new Map();
  g.window = {
    sessionStorage: {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => {
        store.set(k, String(v));
      },
      removeItem: (k) => {
        store.delete(k);
      },
    },
  };
  rememberClearedActiveAttachmentId("cust-refresh", "doc-refresh");
  assert.deepEqual(readClearedActiveAttachmentIds("cust-refresh"), ["doc-refresh"]);
  assert.equal(
    clearedActiveAttachmentStorageKey("cust-refresh"),
    "lifeguard_cleared_active_attachment_ids:cust-refresh",
  );
  assert.equal(
    rejectClearedActiveAttachment(
      { active_attachment_id: "doc-refresh", active_attachment_mime: "image/jpeg" },
      "cust-refresh",
    ),
    null,
  );
  assert.equal(
    rejectClearedActiveAttachment(
      { active_attachment_id: "doc-keep", active_attachment_mime: "image/jpeg" },
      "cust-refresh",
    )?.active_attachment_id,
    "doc-keep",
  );
  delete g.window;
}

// --- policy retire failure after RPC → success=false (transaction completeness) ---
{
  const supabase = makeSoftDeleteSupabase({
    document: {
      id: "doc-retire-fail",
      customer_id: "cust-1",
      storage_path: "cust-1/doc-retire-fail.png",
      deleted_at: null,
    },
    policyUpdateError: { message: "policy_update_rls_denied" },
    policies: [
      {
        id: "pol-keep-visible",
        is_active: true,
        coverage_summary: { source_document_id: "doc-retire-fail" },
      },
    ],
  });
  const result = await softDeleteDocument(authUser, "doc-retire-fail", {
    supabase,
    ensureCustomerContext,
    finalizeSoftDelete: makeFinalize(supabase, {
      storageRemove: async () => ({ ok: true }),
    }),
  });
  assert.equal(result.success, false);
  assert.equal(result.reason, DOCUMENT_DELETE_REASON.POLICY_RETIRE_FAILED);
  assert.equal(result.clear_active_attachment, true);
  assert.equal(result.soft_delete_ok, true);
  assert.equal(result.policy_retire?.ok, false);
  assert.match(String(result.error_message ?? ""), /정리하지 못했습니다/);
}

// --- soft-delete retires KEY-confirmed policies by source_document_id (rail purge) ---
{
  const supabase = makeSoftDeleteSupabase({
    document: {
      id: "doc-hanwha",
      customer_id: "cust-1",
      storage_path: "cust-1/doc-hanwha.png",
      deleted_at: null,
    },
    // Sibling source still active — orphan retire must not touch pol-other.
    activeDocuments: [{ id: "doc-other" }],
    profileHealth: {
      customer_id: "cust-1",
      details_json: { key_active_claim_cases: [] },
    },
    policies: [
      {
        id: "pol-hanwha",
        is_active: true,
        coverage_summary: {
          source_document_id: "doc-hanwha",
          key_confirmed_source_facts: [{ fact_type: "insurer", literal_value: "한화생명" }],
        },
      },
      {
        id: "pol-other",
        is_active: true,
        coverage_summary: {
          source_document_id: "doc-other",
          key_confirmed_source_facts: [{ fact_type: "insurer", literal_value: "KB손해보험" }],
        },
      },
    ],
  });
  const result = await softDeleteDocument(authUser, "doc-hanwha", {
    supabase,
    ensureCustomerContext,
    finalizeSoftDelete: makeFinalize(supabase, {
      storageRemove: async () => ({ ok: true }),
    }),
  });
  assert.equal(result.success, true);
  assert.equal(result.policy_retire?.ok, true);
  assert.equal(result.policy_retire?.retired, 1);
  assert.deepEqual(result.retired_policy_ids, ["pol-hanwha"]);
  assert.equal(result.memory_scrub?.ok, true);
  const retired = supabase._state.policies.find((p) => p.id === "pol-hanwha");
  const kept = supabase._state.policies.find((p) => p.id === "pol-other");
  assert.equal(retired.is_active, false);
  assert.equal(retired.coverage_summary.retired_reason, "source_document_deleted");
  assert.equal(kept.is_active, true);
  assert.equal(
    String(kept.coverage_summary.retired_reason ?? ""),
    "",
    "other source policies must stay active",
  );

  const direct = await retirePoliciesForSourceDocument("cust-1", "doc-hanwha", supabase);
  assert.equal(direct.ok, true);
  assert.equal(direct.retired, 0, "idempotent when already retired");
}

// --- orphan prior_facts (source not in active docs) retire on soft-delete ---
{
  const supabase = makeSoftDeleteSupabase({
    document: {
      id: "doc-new",
      customer_id: "cust-1",
      storage_path: "cust-1/doc-new.png",
      deleted_at: null,
    },
    // Live Samsung source still visible; orphan Hanwha source already gone from active set.
    activeDocuments: [{ id: "doc-other-live" }],
    policies: [
      {
        id: "pol-orphan",
        is_active: true,
        coverage_summary: {
          source_document_id: "doc-orphan-src",
          key_confirmed_source_facts: [{ fact_type: "insurer", literal_value: "한화생명" }],
        },
      },
      {
        id: "pol-live",
        is_active: true,
        coverage_summary: {
          source_document_id: "doc-other-live",
          key_confirmed_source_facts: [{ fact_type: "insurer", literal_value: "삼성화재" }],
        },
      },
    ],
  });
  const result = await softDeleteDocument(authUser, "doc-new", {
    supabase,
    ensureCustomerContext,
    finalizeSoftDelete: makeFinalize(supabase, {
      storageRemove: async () => ({ ok: true }),
    }),
  });
  assert.equal(result.success, true);
  assert.equal(result.orphan_policy_retire?.ok, true);
  assert.ok(
    (result.orphan_policy_retire?.retired ?? 0) >= 1,
    "orphan Hanwha prior_facts must retire",
  );
  const orphan = supabase._state.policies.find((p) => p.id === "pol-orphan");
  const live = supabase._state.policies.find((p) => p.id === "pol-live");
  assert.equal(orphan.is_active, false);
  assert.equal(orphan.coverage_summary.retired_reason, "source_document_deleted_backfill");
  assert.equal(live.is_active, true);

  // Loader miss (null) must fail-closed — sourced prior_facts drop
  {
    const rows = [
      {
        id: "pol-src",
        coverage_summary: { source_document_id: "doc-x" },
      },
      { id: "pol-signup", coverage_summary: {} },
    ];
    const closed = filterPoliciesToActiveSourceDocuments(rows, null);
    assert.equal(closed.length, 1);
    assert.equal(closed[0].id, "pol-signup");
  }

  const filtered = filterPoliciesToActiveSourceDocuments(
    [
      { id: "pol-orphan", coverage_summary: { source_document_id: "doc-orphan-src" } },
      { id: "pol-live", coverage_summary: { source_document_id: "doc-other-live" } },
      { id: "pol-signup", coverage_summary: {} },
    ],
    ["doc-other-live"],
  );
  assert.deepEqual(
    filtered.map((p) => p.id),
    ["pol-live", "pol-signup"],
  );

  const orphanDirect = await retireOrphanSourceDeletedPoliciesForCustomer("cust-1", supabase);
  assert.equal(orphanDirect.ok, true);
  assert.equal(orphanDirect.retired, 0, "idempotent orphan retire");
}

// --- memory scrub fail after retire/storage → success=false (I-5) ---
{
  const supabase = makeSoftDeleteSupabase({
    document: {
      id: "doc-memory-fail",
      customer_id: "cust-1",
      storage_path: "cust-1/doc-memory-fail.pdf",
      deleted_at: null,
    },
    profileHealth: {
      customer_id: "cust-1",
      details_json: { key_active_claim_cases: [] },
    },
    policies: [
      {
        id: "pol-mem",
        is_active: true,
        coverage_summary: { source_document_id: "doc-memory-fail" },
      },
    ],
  });
  const result = await softDeleteDocument(authUser, "doc-memory-fail", {
    supabase,
    ensureCustomerContext,
    finalizeSoftDelete: makeFinalize(supabase, {
      storageRemove: async () => ({ ok: true }),
      scrubInsuranceMemory: async () => ({ ok: false, reason: "forced_memory_scrub_fail" }),
    }),
  });
  assert.equal(result.success, false);
  assert.equal(result.reason, DOCUMENT_DELETE_REASON.MEMORY_SCRUB_FAILED);
  assert.equal(result.clear_active_attachment, true);
  assert.deepEqual(result.retired_policy_ids, ["pol-mem"]);
}

// --- I-6: RLS hides soft-deleted row from customer SELECT; finalize by document_id still completes ---
{
  const admin = makeSoftDeleteSupabase({
    document: {
      id: "doc-rls-hidden",
      customer_id: "cust-1",
      storage_path: "cust-1/doc-rls-hidden.pdf",
      deleted_at: "2026-07-19T00:00:00.000Z",
    },
    profileHealth: {
      customer_id: "cust-1",
      details_json: {
        key_active_claim_cases: [
          {
            claim_case_key: "doc:doc-rls-hidden:date:2026-07-01",
            medical_event: { source_document_id: "doc-rls-hidden" },
          },
        ],
      },
    },
    policies: [
      {
        id: "pol-rls",
        is_active: true,
        coverage_summary: { source_document_id: "doc-rls-hidden" },
      },
    ],
  });
  // Customer JWT client cannot see soft-deleted row (RLS deleted_at IS NULL).
  const customerClient = makeSoftDeleteSupabase({ document: null });
  let storageCalls = 0;
  const result = await softDeleteDocument(authUser, "doc-rls-hidden", {
    supabase: customerClient,
    ensureCustomerContext,
    finalizeSoftDelete: makeFinalize(admin, {
      storageRemove: async (path) => {
        storageCalls += 1;
        assert.equal(path, "cust-1/doc-rls-hidden.pdf");
        return { ok: true };
      },
    }),
  });
  assert.equal(result.success, true);
  assert.equal(result.finalize_via, "service_role_document_id");
  assert.equal(customerClient._state.rpcCalls, 0, "hidden soft-deleted row → no RPC");
  assert.equal(storageCalls, 1, "service_role finalize removes storage without customer SELECT");
  assert.equal(result.claim_cases_scrub?.removed, 1);
  assert.equal(result.policy_retire?.retired, 1);
  assert.match(CUSTOMER_DOCS, /customer-document-soft-delete-finalize/);
  assert.match(CUSTOMER_DOCS, /finalizeSoftDelete|requestSoftDeleteFinalize/);
}

// UI: claim scrub fail copy + no success notice until success=true
assert.match(UI_LOCALE, /일부 관련 기록을 정리하지 못했습니다\. 다시 시도해 주세요\./);
assert.match(HOME_CHAT, /DOCUMENT_DELETE_REASON\.CLAIM_SCRUB_FAILED/);
assert.match(HOME_CHAT, /DOCUMENT_DELETE_REASON\.POLICY_RETIRE_FAILED/);
assert.match(HOME_CHAT, /DOCUMENT_DELETE_REASON\.MEMORY_SCRUB_FAILED/);
assert.match(HOME_CHAT, /clear_active_attachment/);
assert.match(HOME_CHAT, /result\?\.success \|\| result\?\.clear_active_attachment/);
assert.match(HOME_CHAT, /isReusableActiveAttachmentId/);
assert.match(HOME_CHAT, /finishDocumentDeleteResult/);
assert.match(HOME_CHAT, /document_soft_deleted/);
assert.match(HOME_CHAT, /rememberClearedActiveAttachmentId/);
assert.match(HOME_CHAT, /rejectClearedActiveAttachment/);
assert.match(HOME_CHAT, /scrubDeletedDocumentFromMessageActiveAttachments/);
// Upload must seed conversation active attach (not wait for a successful turn).
assert.match(HOME_CHAT, /setActiveAttachmentId\(documentId\)/);
assert.match(HOME_CHAT, /active_attachment_id: documentId/);
assert.match(DOCS_PANEL, /DOCUMENT_DELETE_REASON\.CLAIM_SCRUB_FAILED/);
assert.match(DOCS_PANEL, /DOCUMENT_DELETE_REASON\.POLICY_RETIRE_FAILED/);
assert.match(DOCS_PANEL, /DOCUMENT_DELETE_REASON\.MEMORY_SCRUB_FAILED/);
assert.match(DOCS_PANEL, /clear_active_attachment/);
assert.match(DOCS_PANEL, /rememberClearedActiveAttachmentId/);
assert.match(DOCS_PANEL, /scrubDeletedDocumentFromMessageActiveAttachments/);
// Delete UX must refresh unified/rail from DocumentsPanel the same way as HomeChat.
assert.match(DOCS_PANEL, /document_soft_deleted/);
assert.match(DOCS_PANEL, /refreshSession\(\{\s*event:\s*"document_soft_deleted"/);

// Claim reference helper stays aligned with scrub filter.
assert.equal(
  claimCaseReferencesSourceDocument(
    { medical_event: { source_document_id: "doc-x" } },
    "doc-x",
  ),
  true,
);

console.log("PASS customer-document-soft-delete-unit-test");

