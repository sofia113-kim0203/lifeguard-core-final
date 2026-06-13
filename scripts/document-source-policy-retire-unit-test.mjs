/**
 * PR-D1 unit tests — source document delete policy retire planning (no Supabase).
 */
import { readFileSync } from "node:fs";
import {
  RETIRE_REASON_SOURCE_DOCUMENT_DELETED,
  buildPolicyRetireUpdateRow,
  buildRetiredCoverageSummary,
  isActivePolicyRow,
  matchesSourceDocumentPolicyRow,
  planPolicyIdsToRetireForSourceDocumentDelete,
} from "../server/documentSourcePolicyRetire.js";

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

console.log("document-source-policy-retire-unit-test");

const docA = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const docB = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

const policies = [
  {
    id: "policy-active-a1",
    customer_id: "cust-1",
    is_active: true,
    coverage_summary: { source_document_id: docA, upload_extract_key: "a|1" },
  },
  {
    id: "policy-active-a2",
    customer_id: "cust-1",
    is_active: true,
    coverage_summary: { source_document_id: docA, extractor_origin: "coverage_sheet_l1" },
  },
  {
    id: "policy-inactive-a",
    customer_id: "cust-1",
    is_active: false,
    coverage_summary: { source_document_id: docA },
  },
  {
    id: "policy-active-b",
    customer_id: "cust-1",
    is_active: true,
    coverage_summary: { source_document_id: docB },
  },
  {
    id: "policy-no-source",
    customer_id: "cust-1",
    is_active: true,
    coverage_summary: { upload_extract_key: "legacy" },
  },
];

let passed = 0;
let failed = 0;

const tests = [
  ["matchesSourceDocumentPolicyRow uses JSONB source_document_id", () => {
    assert(matchesSourceDocumentPolicyRow(policies[0], docA), "docA should match");
    assert(!matchesSourceDocumentPolicyRow(policies[0], docB), "docB should not match");
    assert(!matchesSourceDocumentPolicyRow(policies[4], docA), "missing source should not match");
  }],
  ["isActivePolicyRow excludes is_active=false", () => {
    assert(isActivePolicyRow(policies[0]), "active true");
    assert(!isActivePolicyRow(policies[2]), "inactive false");
    assert(isActivePolicyRow({ is_active: null }), "null treated as active");
  }],
  ["planPolicyIdsToRetireForSourceDocumentDelete scopes by document only", () => {
    const retireIds = planPolicyIdsToRetireForSourceDocumentDelete(policies, docA);
    assert(retireIds.length === 2, `expected 2 active docA rows, got ${retireIds.length}`);
    assert(retireIds.includes("policy-active-a1"), "a1 included");
    assert(retireIds.includes("policy-active-a2"), "a2 included");
    assert(!retireIds.includes("policy-inactive-a"), "inactive excluded");
    assert(!retireIds.includes("policy-active-b"), "other document excluded");
    assert(!retireIds.includes("policy-no-source"), "no source excluded");
  }],
  ["buildRetiredCoverageSummary sets required PR-D1 fields", () => {
    const summary = buildRetiredCoverageSummary(
      { source_document_id: docA, upload_extract_key: "k" },
      RETIRE_REASON_SOURCE_DOCUMENT_DELETED,
    );
    assert(summary.source_document_id === docA, "preserves existing keys");
    assert(summary.retired_reason === "source_document_deleted", "retired_reason required");
    assert(typeof summary.retired_at === "string" && summary.retired_at.includes("T"), "retired_at ISO");
  }],
  ["buildPolicyRetireUpdateRow matches pipeline retire shape", () => {
    const update = buildPolicyRetireUpdateRow(policies[0]);
    assert(update.is_active === false, "is_active false");
    assert(update.coverage_summary.retired_reason === "source_document_deleted", "reason");
    assert(update.coverage_summary.source_document_id === docA, "summary merge");
    assert(typeof update.updated_at === "string", "updated_at set");
  }],
  ["customer isolation — planner only receives rows for one customer scope", () => {
    const mixed = [
      ...policies,
      {
        id: "policy-other-customer",
        customer_id: "cust-2",
        is_active: true,
        coverage_summary: { source_document_id: docA },
      },
    ];
    const retireIds = planPolicyIdsToRetireForSourceDocumentDelete(
      mixed.filter((row) => row.customer_id === "cust-1"),
      docA,
    );
    assert(!retireIds.includes("policy-other-customer"), "caller must scope by customer_id");
    assert(retireIds.length === 2, "cust-1 docA active rows only");
  }],
  ["migration SQL path uses coverage_summary->>source_document_id", () => {
    const sql = readFileSync("supabase/migrations/027_document_delete_source_policy_retire.sql", "utf8");
    assert(sql.includes("coverage_summary->>'source_document_id'"), "JSONB path in migration");
    assert(sql.includes("'source_document_deleted'"), "retired_reason in migration");
    assert(sql.includes("is_active = FALSE"), "is_active retire in migration");
    assert(sql.includes("is_active IS DISTINCT FROM FALSE"), "only active rows retired");
  }],
];

for (const [name, fn] of tests) {
  if (runCase(name, fn)) passed += 1;
  else failed += 1;
}

console.log(`\nResult: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
