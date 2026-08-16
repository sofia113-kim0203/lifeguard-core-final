/**
 * S3-MEMORY-SCRUB-FAILCLOSED-RETRY
 * Finalize success ↔ KEY doc-memory supersede + Ready invalidate.
 * Delete failure / scrub failure must not look like a clean delete.
 */
import assert from "node:assert/strict";
import {
  keyDocumentMemoryReferencesDocument,
  supersedeKeyDocumentMemoryForDeletedDocument,
} from "../server/keyCore/keyDocumentMemoryCommit.js";
import {
  DOCUMENT_SOFT_DELETE_FINALIZE_REASON,
  finalizeCustomerDocumentSoftDelete,
} from "../server/documentSoftDeleteFinalize.js";
import {
  invalidateReadyCardCacheForCustomer,
  readyCardCacheSizeForTests,
  writeReadyCardCache,
} from "../server/keyCore/keyReadyCardCache.js";

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

async function testAsync(name, fn) {
  try {
    await fn();
    console.log(`PASS ${name}`);
  } catch (err) {
    console.error(`FAIL ${name}`);
    console.error(err);
    process.exitCode = 1;
  }
}

const DOC_A = "11111111-1111-1111-1111-111111111111";
const DOC_B = "22222222-2222-2222-2222-222222222222";
const CID = "cust-s3-1";

test("S3-T1 reference matcher: primary / document_ids / neither", () => {
  assert.equal(
    keyDocumentMemoryReferencesDocument(
      { primary_document_id: DOC_A, document_ids: [] },
      DOC_A,
    ),
    true,
  );
  assert.equal(
    keyDocumentMemoryReferencesDocument(
      { primary_document_id: DOC_B, document_ids: [DOC_A] },
      DOC_A,
    ),
    true,
  );
  assert.equal(
    keyDocumentMemoryReferencesDocument(
      { primary_document_id: DOC_B, document_ids: [DOC_B] },
      DOC_A,
    ),
    false,
  );
});

function thenableResult(payload) {
  const chain = {
    select() {
      return chain;
    },
    eq() {
      return chain;
    },
    is() {
      return chain;
    },
    in(col, vals) {
      chain._in = { col, vals };
      return chain;
    },
    update(body) {
      chain._update = body;
      return chain;
    },
    maybeSingle() {
      return Promise.resolve(payload);
    },
    then(resolve, reject) {
      return Promise.resolve(payload).then(resolve, reject);
    },
  };
  return chain;
}

await testAsync("S3-T2 supersede only matching active rows", async () => {
  const activeRows = [
    {
      id: "r1",
      memory_commit_id: "m1",
      primary_document_id: DOC_A,
      document_ids: [DOC_A],
      focus_status: "active",
      commit_status: "committed",
    },
    {
      id: "r2",
      memory_commit_id: "m2",
      primary_document_id: DOC_B,
      document_ids: [DOC_B],
      focus_status: "active",
      commit_status: "committed",
    },
  ];
  let updatePayload = null;
  let updateIds = null;
  let phase = "select";
  const supabase = {
    from(table) {
      assert.equal(table, "key_document_memory_commits");
      if (phase === "select") {
        phase = "update";
        return thenableResult({ data: activeRows, error: null });
      }
      return {
        update(payload) {
          updatePayload = payload;
          const chain = thenableResult({
            data: [{ id: "r1", memory_commit_id: "m1" }],
            error: null,
          });
          const origIn = chain.in.bind(chain);
          chain.in = (col, vals) => {
            updateIds = vals;
            return origIn(col, vals);
          };
          return chain.update(payload);
        },
      };
    },
  };

  const result = await supersedeKeyDocumentMemoryForDeletedDocument({
    supabase,
    customerId: CID,
    documentId: DOC_A,
  });
  assert.equal(result.ok, true);
  assert.equal(result.superseded, 1);
  assert.deepEqual(result.memory_commit_ids, ["m1"]);
  assert.equal(updatePayload?.focus_status, "superseded");
  assert.deepEqual(updateIds, ["r1"]);
});

await testAsync("S3-T3 query failure → ok:false fail-closed", async () => {
  const supabase = {
    from() {
      return thenableResult({ data: null, error: { message: "boom" } });
    },
  };
  const result = await supersedeKeyDocumentMemoryForDeletedDocument({
    supabase,
    customerId: CID,
    documentId: DOC_A,
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "query_failed");
});

function makeFinalizeAdmin({ deletedAt = "2026-08-12T00:00:00.000Z" } = {}) {
  let customerDocReads = 0;
  return {
    from(table) {
      if (table === "customer_documents") {
        customerDocReads += 1;
        // 1) ownership/tombstone probe (maybeSingle)
        // 2+) orphan retire active-doc list (.is → await)
        if (customerDocReads === 1) {
          return {
            select() {
              return this;
            },
            eq() {
              return this;
            },
            maybeSingle: async () => ({
              data: {
                id: DOC_A,
                customer_id: CID,
                storage_path: null,
                deleted_at: deletedAt,
              },
              error: null,
            }),
          };
        }
        return thenableResult({ data: [], error: null });
      }
      if (table === "profile_insurance_policies") {
        return thenableResult({ data: [], error: null });
      }
      if (table === "profile_health") {
        return {
          select() {
            return this;
          },
          eq() {
            return this;
          },
          maybeSingle: async () => ({ data: null, error: null }),
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
  };
}

await testAsync(
  "S3-T4 not soft-deleted → fail; KEY scrub/invalidate never run",
  async () => {
    let keyCalls = 0;
    let invCalls = 0;
    const result = await finalizeCustomerDocumentSoftDelete({
      admin: makeFinalizeAdmin({ deletedAt: null }),
      customerId: CID,
      documentId: DOC_A,
      scrubInsuranceMemory: async () => {
        throw new Error("insurance scrub must not run");
      },
      scrubKeyDocumentMemory: async () => {
        keyCalls += 1;
        return { ok: true };
      },
      invalidateReadyCard: () => {
        invCalls += 1;
      },
    });
    assert.equal(result.success, false);
    assert.equal(
      result.reason,
      DOCUMENT_SOFT_DELETE_FINALIZE_REASON.DOCUMENT_NOT_SOFT_DELETED,
    );
    assert.equal(keyCalls, 0);
    assert.equal(invCalls, 0);
  },
);

await testAsync(
  "S3-T5 KEY memory scrub fail → MEMORY_SCRUB_FAILED (not success)",
  async () => {
    let invCalls = 0;
    const result = await finalizeCustomerDocumentSoftDelete({
      admin: makeFinalizeAdmin(),
      customerId: CID,
      documentId: DOC_A,
      scrubInsuranceMemory: async () => ({ ok: true, scrubbed: 0 }),
      scrubKeyDocumentMemory: async () => ({
        ok: false,
        reason: "supersede_failed",
      }),
      invalidateReadyCard: () => {
        invCalls += 1;
      },
    });
    assert.equal(result.success, false);
    assert.equal(
      result.reason,
      DOCUMENT_SOFT_DELETE_FINALIZE_REASON.MEMORY_SCRUB_FAILED,
    );
    assert.equal(result.key_document_memory_scrub?.ok, false);
    assert.equal(invCalls, 0);
  },
);

await testAsync(
  "S3-T6 Ready invalidate fail → MEMORY_SCRUB_FAILED",
  async () => {
    const result = await finalizeCustomerDocumentSoftDelete({
      admin: makeFinalizeAdmin(),
      customerId: CID,
      documentId: DOC_A,
      scrubInsuranceMemory: async () => ({ ok: true }),
      scrubKeyDocumentMemory: async () => ({
        ok: true,
        superseded: 1,
        reason: "superseded",
      }),
      invalidateReadyCard: () => {
        throw new Error("cache_down");
      },
    });
    assert.equal(result.success, false);
    assert.equal(
      result.reason,
      DOCUMENT_SOFT_DELETE_FINALIZE_REASON.MEMORY_SCRUB_FAILED,
    );
    assert.equal(result.ready_card_invalidate?.ok, false);
  },
);

await testAsync(
  "S3-T7 finalize success binds insurance + KEY scrub + Ready invalidate",
  async () => {
    const before = readyCardCacheSizeForTests();
    assert.equal(
      writeReadyCardCache(CID, "sess-1", {
        customer_id: CID,
        kind: "ready",
        stale: true,
      }),
      true,
    );
    assert.ok(readyCardCacheSizeForTests() > before);

    let keyArgs = null;
    const result = await finalizeCustomerDocumentSoftDelete({
      admin: makeFinalizeAdmin(),
      customerId: CID,
      documentId: DOC_A,
      scrubInsuranceMemory: async () => ({ ok: true, scrubbed: 1 }),
      scrubKeyDocumentMemory: async (args) => {
        keyArgs = args;
        return { ok: true, superseded: 1, reason: "superseded" };
      },
      invalidateReadyCard: invalidateReadyCardCacheForCustomer,
    });
    assert.equal(result.success, true);
    assert.equal(result.reason, null);
    assert.deepEqual(keyArgs, { customerId: CID, documentId: DOC_A });
    assert.equal(result.key_document_memory_scrub?.ok, true);
    assert.equal(result.ready_card_invalidate?.ok, true);
    assert.equal(readyCardCacheSizeForTests(), before);
  },
);

await testAsync(
  "S3-T8 unrelated memory miss path still success (no broad wipe required)",
  async () => {
    const result = await finalizeCustomerDocumentSoftDelete({
      admin: makeFinalizeAdmin(),
      customerId: CID,
      documentId: DOC_A,
      scrubInsuranceMemory: async () => ({ ok: true }),
      scrubKeyDocumentMemory: async () => ({
        ok: true,
        superseded: 0,
        reason: "no_active_document_memory",
      }),
      invalidateReadyCard: () => {},
    });
    assert.equal(result.success, true);
    assert.equal(result.key_document_memory_scrub?.superseded, 0);
  },
);

if (process.exitCode) {
  console.error("S3 unit FAILED");
  process.exit(1);
}
console.log("S3-MEMORY-SCRUB-FAILCLOSED-RETRY unit PASS");
