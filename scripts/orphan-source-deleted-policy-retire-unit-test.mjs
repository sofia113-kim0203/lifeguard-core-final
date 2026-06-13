/**
 * PR-D1-CLEANUP unit tests — orphan source-deleted policy backfill retire planning (no Supabase).
 */
import { readFileSync } from "node:fs";

export const RETIRE_REASON_SOURCE_DOCUMENT_DELETED_BACKFILL = "source_document_deleted_backfill";

export function hasSourceDocumentIdKey(coverageSummary = {}) {
  return (
    coverageSummary != null &&
    typeof coverageSummary === "object" &&
    Object.prototype.hasOwnProperty.call(coverageSummary, "source_document_id")
  );
}

export function isActivePolicyRow(row = {}) {
  return row.is_active !== false;
}

export function isDeletedDocument(doc = {}) {
  return doc.deleted_at != null && doc.deleted_at !== "";
}

export function matchesOrphanSourceDeletedPolicyRow(policy = {}, document = null) {
  if (!policy || !document) return false;
  if (policy.deleted_at != null) return false;
  if (!isActivePolicyRow(policy)) return false;
  if (!hasSourceDocumentIdKey(policy.coverage_summary)) return false;
  const sourceId = String(policy.coverage_summary.source_document_id ?? "").trim();
  if (!sourceId) return false;
  if (String(policy.customer_id ?? "") !== String(document.customer_id ?? "")) return false;
  if (String(document.id ?? "") !== sourceId) return false;
  return isDeletedDocument(document);
}

export function planOrphanPolicyIdsToRetire(policies = [], documents = []) {
  const docsById = new Map((documents ?? []).map((doc) => [String(doc.id), doc]));
  return (policies ?? [])
    .filter((policy) => {
      const sourceId = String(policy.coverage_summary?.source_document_id ?? "").trim();
      const doc = sourceId ? docsById.get(sourceId) : null;
      return matchesOrphanSourceDeletedPolicyRow(policy, doc);
    })
    .map((policy) => policy.id);
}

export function buildBackfillRetiredCoverageSummary(existing = {}) {
  return {
    ...(existing ?? {}),
    retired_at: new Date().toISOString(),
    retired_reason: RETIRE_REASON_SOURCE_DOCUMENT_DELETED_BACKFILL,
  };
}

export function buildBackfillPolicyRetireUpdateRow(existingRow = {}) {
  return {
    is_active: false,
    coverage_summary: buildBackfillRetiredCoverageSummary(existingRow.coverage_summary ?? {}),
    updated_at: new Date().toISOString(),
  };
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function runCase(name, fn) {
  try {
    fn();
    console.log(`PASS ${name}`);
    return true;
  } catch (error) {
    console.log(`FAIL ${name}: ${error instanceof Error ? error.message : String(error)}`);
    return false;
  }
}

console.log("orphan-source-deleted-policy-retire-unit-test");

const docDeletedA = {
  id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
  customer_id: "cust-1",
  deleted_at: "2026-06-13T10:00:00.000Z",
};
const docActiveB = {
  id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
  customer_id: "cust-1",
  deleted_at: null,
};
const docDeletedOtherCustomer = {
  id: "cccccccc-cccc-cccc-cccc-cccccccccccc",
  customer_id: "cust-2",
  deleted_at: "2026-06-13T11:00:00.000Z",
};

const policies = [
  {
    id: "policy-orphan-active",
    customer_id: "cust-1",
    is_active: true,
    deleted_at: null,
    coverage_summary: { source_document_id: docDeletedA.id, upload_extract_key: "a|1" },
  },
  {
    id: "policy-active-source",
    customer_id: "cust-1",
    is_active: true,
    deleted_at: null,
    coverage_summary: { source_document_id: docActiveB.id },
  },
  {
    id: "policy-no-source",
    customer_id: "cust-1",
    is_active: true,
    deleted_at: null,
    coverage_summary: { upload_extract_key: "legacy" },
  },
  {
    id: "policy-customer-mismatch",
    customer_id: "cust-1",
    is_active: true,
    deleted_at: null,
    coverage_summary: { source_document_id: docDeletedOtherCustomer.id },
  },
  {
    id: "policy-inactive-orphan",
    customer_id: "cust-1",
    is_active: false,
    deleted_at: null,
    coverage_summary: { source_document_id: docDeletedA.id },
  },
  {
    id: "policy-second-orphan",
    customer_id: "cust-1",
    is_active: true,
    deleted_at: null,
    coverage_summary: { source_document_id: docDeletedA.id, extractor_origin: "coverage_sheet_l1" },
  },
];

const documents = [docDeletedA, docActiveB, docDeletedOtherCustomer];

let passed = 0;
let failed = 0;

const tests = [
  ["deleted source document linked active policy is retire target", () => {
    const ids = planOrphanPolicyIdsToRetire(policies, documents);
    assert(ids.includes("policy-orphan-active"), "orphan active included");
    assert(ids.includes("policy-second-orphan"), "second orphan on same deleted doc included");
    assert(ids.length === 2, `expected 2 orphan rows, got ${ids.length}`);
  }],
  ["active source document policy is excluded", () => {
    const ids = planOrphanPolicyIdsToRetire(policies, documents);
    assert(!ids.includes("policy-active-source"), "active source doc excluded");
  }],
  ["row without source_document_id key is excluded", () => {
    const ids = planOrphanPolicyIdsToRetire(policies, documents);
    assert(!ids.includes("policy-no-source"), "missing source_document_id excluded");
  }],
  ["customer mismatch with deleted document is excluded", () => {
    const ids = planOrphanPolicyIdsToRetire(policies, documents);
    assert(!ids.includes("policy-customer-mismatch"), "customer mismatch excluded");
  }],
  ["already inactive row is excluded", () => {
    const ids = planOrphanPolicyIdsToRetire(policies, documents);
    assert(!ids.includes("policy-inactive-orphan"), "inactive excluded");
  }],
  ["retire shape is soft retire not hard delete", () => {
    const update = buildBackfillPolicyRetireUpdateRow(policies[0]);
    assert(update.is_active === false, "is_active false");
    assert(update.coverage_summary.retired_reason === RETIRE_REASON_SOURCE_DOCUMENT_DELETED_BACKFILL, "backfill reason");
    assert(typeof update.coverage_summary.retired_at === "string", "retired_at set");
    assert(update.coverage_summary.source_document_id === docDeletedA.id, "preserves source_document_id");
    assert(!("deleted_at" in update), "no policy hard delete field");
  }],
  ["non-UUID source_document_id is excluded without error", () => {
    const badPolicies = [
      ...policies,
      {
        id: "policy-bad-source-id",
        customer_id: "cust-1",
        is_active: true,
        deleted_at: null,
        coverage_summary: { source_document_id: "not-a-valid-uuid" },
      },
    ];
    const ids = planOrphanPolicyIdsToRetire(badPolicies, documents);
    assert(!ids.includes("policy-bad-source-id"), "non-UUID source_document_id excluded");
    assert(ids.length === 2, `still only 2 valid orphan rows, got ${ids.length}`);
  }],
  ["migration SQL has no auto-invocation SELECT", () => {
    const sql = readFileSync("supabase/migrations/028_retire_orphaned_source_deleted_policies.sql", "utf8");
    assert(!/SELECT\s+public\.lifeguard_retire_orphaned_source_deleted_policies\s*\(/i.test(sql), "no auto SELECT invoke");
    assert(!/PERFORM\s+public\.lifeguard_retire_orphaned_source_deleted_policies\s*\(/i.test(sql), "no PERFORM invoke");
  }],
  ["migration SQL includes REVOKE ALL FROM PUBLIC", () => {
    const sql = readFileSync("supabase/migrations/028_retire_orphaned_source_deleted_policies.sql", "utf8");
    assert(sql.includes("REVOKE ALL ON FUNCTION public.lifeguard_retire_orphaned_source_deleted_policies() FROM PUBLIC"), "revoke public");
    assert(!/GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+public\.lifeguard_retire_orphaned_source_deleted_policies/i.test(sql), "no authenticated grant");
  }],
  ["migration SQL scopes all customers with customer_id join and deleted source docs", () => {
    const sql = readFileSync("supabase/migrations/028_retire_orphaned_source_deleted_policies.sql", "utf8");
    assert(sql.includes("p.customer_id = d.customer_id"), "customer_id match required");
    assert(sql.includes("d.deleted_at IS NOT NULL"), "deleted source doc only");
    assert(sql.includes("p.coverage_summary ? 'source_document_id'"), "source_document_id key required");
    assert(sql.includes("p.is_active IS DISTINCT FROM FALSE"), "active rows only");
    assert(sql.includes("p.deleted_at IS NULL"), "non-deleted policies only");
    assert(sql.includes("d.id::text = p.coverage_summary->>'source_document_id'"), "text comparison join");
    assert(!/coverage_summary->>'source_document_id'\)::uuid/i.test(sql), "no uuid cast on source_document_id");
    assert(sql.includes("'source_document_deleted_backfill'"), "backfill retired_reason");
    assert(!/\bDELETE\s+FROM\s+public\.profile_insurance_policies/i.test(sql), "no hard delete");
  }],
];

for (const [name, fn] of tests) {
  if (runCase(name, fn)) passed += 1;
  else failed += 1;
}

console.log(`\nResult: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
