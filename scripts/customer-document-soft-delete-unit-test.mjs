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
} = await import("../src/lib/customerDocuments.js");
const {
  clearActiveAttachmentIfDocumentDeleted,
  normalizeActiveAttachment,
} = await import("../src/lib/chatActiveAttachment.js");

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
assert.equal(DOCUMENT_DELETE_REASON.CLAIM_SCRUB_FAILED, "claim_scrub_failed");
assert.equal(DOCUMENT_DELETE_REASON.STORAGE_REMOVE_FAILED, "storage_remove_failed");

assert.equal(isStorageRemoveAlreadyGoneError({ message: "Object not found" }), true);
assert.equal(isStorageRemoveAlreadyGoneError({ message: "permission denied" }), false);

function makeSoftDeleteSupabase({
  document,
  rpcResult = null,
  rpcError = null,
  profileHealth = null,
  profileSelectError = null,
  profileUpdateError = null,
}) {
  let rpcCalls = 0;
  let profileUpdates = 0;
  let docReads = 0;
  const state = {
    document: document ? { ...document } : null,
    profileHealth: profileHealth
      ? {
          customer_id: profileHealth.customer_id,
          details_json: structuredClone(profileHealth.details_json ?? {}),
        }
      : null,
    rpcCalls: 0,
    profileUpdates: 0,
    docReads: 0,
  };

  const client = {
    from(table) {
      if (table === "customer_documents") {
        return {
          select() {
            return this;
          },
          eq() {
            return this;
          },
          maybeSingle: async () => {
            state.docReads += 1;
            docReads += 1;
            return { data: state.document, error: null };
          },
        };
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
    storageRemove: async () => {
      storageCalls += 1;
      return { ok: true };
    },
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
  const first = await softDeleteDocument(authUser, "doc-retry", {
    supabase,
    ensureCustomerContext,
    storageRemove: async () => {
      storageCalls += 1;
      return { ok: true, already_gone: true };
    },
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
    storageRemove: async () => {
      storageCalls += 1;
      return { ok: true, already_gone: true };
    },
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
    storageRemove: async () => ({ ok: false, error: { message: "storage_timeout" } }),
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
    storageRemove: async () => ({ ok: true }),
  });
  assert.equal(result.success, false);
  assert.equal(result.reason, DOCUMENT_DELETE_REASON.CLAIM_SCRUB_FAILED);
  assert.equal(result.clear_active_attachment, true);

  const nextActive = clearActiveAttachmentIfDocumentDeleted(active, result.documentId);
  assert.equal(nextActive, null, "deleted document_id cleared from active attachment");
  const nextRequestDocumentId = nextActive?.active_attachment_id ?? null;
  assert.equal(nextRequestDocumentId, null, "next request must not resend deleted document_id");
}

// UI: claim scrub fail copy + no success notice until success=true
assert.match(UI_LOCALE, /일부 관련 기록을 정리하지 못했습니다\. 다시 시도해 주세요\./);
assert.match(HOME_CHAT, /DOCUMENT_DELETE_REASON\.CLAIM_SCRUB_FAILED/);
assert.match(HOME_CHAT, /clear_active_attachment/);
assert.match(HOME_CHAT, /finishDocumentDeleteResult/);
assert.match(DOCS_PANEL, /DOCUMENT_DELETE_REASON\.CLAIM_SCRUB_FAILED/);
assert.match(DOCS_PANEL, /clear_active_attachment/);

// Claim reference helper stays aligned with scrub filter.
assert.equal(
  claimCaseReferencesSourceDocument(
    { medical_event: { source_document_id: "doc-x" } },
    "doc-x",
  ),
  true,
);

console.log("PASS customer-document-soft-delete-unit-test");

