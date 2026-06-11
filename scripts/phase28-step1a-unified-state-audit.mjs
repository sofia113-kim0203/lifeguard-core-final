/**
 * Phase 28 Step 1A — Unified Customer State audit (김진우 production customer).
 *
 * Verifies all major consumers see the same policy set and memory version.
 *
 * Usage:
 *   SUPABASE_URL=... SERVICE_ROLE_KEY=... node scripts/phase28-step1a-unified-state-audit.mjs
 */
import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";
import {
  buildDashboardPolicyView,
  extractPolicyIds,
  getInsurancePolicyCountFact,
  loadUnifiedCustomerState,
} from "../server/unifiedCustomerState.js";
import { ensureCustomerMemoryContext } from "../server/customerMemoryContextSync.js";
import { loadCoverageAnalysisContext } from "../server/customerCoverageGapCore.js";
import { buildDirectFactualAnswer } from "../server/customerConversationalTone.js";
import { resolveAuditCustomerId } from "./lib/sandboxAuthGuard.js";

const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
const serviceRoleKey = process.env.SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
const CUSTOMER_ID = resolveAuditCustomerId(process.env.AUDIT_CUSTOMER_ID);
const EXPECTED_POLICY_COUNT = Number(process.env.AUDIT_EXPECTED_POLICY_COUNT ?? "8");
const MIN_DOCUMENT_COUNT = Number(process.env.AUDIT_MIN_DOCUMENT_COUNT ?? "2");

if (!url || !serviceRoleKey) {
  console.error("Missing SUPABASE_URL or SERVICE_ROLE_KEY");
  process.exit(1);
}

const supabase = createClient(url, serviceRoleKey, { auth: { persistSession: false } });

function printRow(label, { policyCount, policyIds, memoryVersion, stateHash, extra = "" }) {
  console.log(
    `${label.padEnd(28)} | policies=${String(policyCount).padStart(2)} | memory_v=${String(memoryVersion ?? "-").padStart(2)} | hash=${stateHash ?? "-"} ${extra}`,
  );
  console.log(`  ids: ${policyIds.join(", ")}`);
}

function assertSamePolicyIds(label, baselineIds, candidateIds) {
  assert.deepEqual(
    candidateIds,
    baselineIds,
    `${label} policy id mismatch\n  expected: ${baselineIds.join(", ")}\n  actual:   ${candidateIds.join(", ")}`,
  );
}

const { data: dbPolicies, error: dbError } = await supabase
  .from("profile_insurance_policies")
  .select("id")
  .eq("customer_id", CUSTOMER_ID)
  .is("deleted_at", null)
  .order("created_at", { ascending: false });

if (dbError) {
  console.error("DB policy lookup failed:", dbError.message);
  process.exit(1);
}

const baselineIds = extractPolicyIds(dbPolicies ?? []);
const baselineCount = baselineIds.length;

console.log(`\nPhase 28 Step 1A — Unified Customer State Audit`);
console.log(`Customer: ${CUSTOMER_ID}`);
console.log(`Baseline DB policies: ${baselineCount}`);
printRow("db.profile_insurance_policies", {
  policyCount: baselineCount,
  policyIds: baselineIds,
  memoryVersion: "-",
  stateHash: "-",
});

assert.equal(
  baselineCount,
  EXPECTED_POLICY_COUNT,
  `Expected ${EXPECTED_POLICY_COUNT} DB policies, found ${baselineCount}`,
);

const unified = await loadUnifiedCustomerState(supabase, CUSTOMER_ID);
printRow("loadUnifiedCustomerState", {
  policyCount: unified.policy_count,
  policyIds: unified.policy_ids,
  memoryVersion: unified.memory_version,
  stateHash: unified.state_hash,
});
assertSamePolicyIds("unified", baselineIds, unified.policy_ids);
assert.equal(unified.policy_count, EXPECTED_POLICY_COUNT);

const memoryContext = await ensureCustomerMemoryContext({ supabase, customerId: CUSTOMER_ID });
const memoryPolicyIds = extractPolicyIds(memoryContext.sourceContext?.policies ?? []);
printRow("ensureCustomerMemoryContext", {
  policyCount: memoryPolicyIds.length,
  policyIds: memoryPolicyIds,
  memoryVersion: memoryContext.snapshot?.memory_version ?? 0,
  stateHash: memoryContext.unified_state?.state_hash ?? "-",
});
assertSamePolicyIds("memory_context", baselineIds, memoryPolicyIds);
assert.equal(
  memoryContext.sourceSummary?.insurance?.length ?? 0,
  EXPECTED_POLICY_COUNT,
  "sourceSummary.insurance must include all policies",
);

const coverageContext = await loadCoverageAnalysisContext(supabase, CUSTOMER_ID);
const gapPolicyIds = extractPolicyIds(coverageContext.policies ?? []);
printRow("loadCoverageAnalysisContext", {
  policyCount: gapPolicyIds.length,
  policyIds: gapPolicyIds,
  memoryVersion: coverageContext.snapshot?.memory_version ?? 0,
  stateHash: unified.state_hash,
});
assertSamePolicyIds("coverage_gap", baselineIds, gapPolicyIds);

const dashboardView = buildDashboardPolicyView(unified);
printRow("dashboardPolicyView", {
  policyCount: dashboardView.insurancePolicyCount,
  policyIds: dashboardView.insurancePolicyIds,
  memoryVersion: dashboardView.memoryVersion,
  stateHash: dashboardView.stateHash,
});
assertSamePolicyIds("dashboard", baselineIds, dashboardView.insurancePolicyIds);

const countFact = getInsurancePolicyCountFact(memoryContext.snapshot);
console.log(`\ninsurance.policy.count fact = ${countFact ?? "(missing)"}`);
assert.equal(String(countFact), String(EXPECTED_POLICY_COUNT), "insurance.policy.count fact mismatch");

const workingContext = {
  snapshot: memoryContext.snapshot,
  sourceContext: memoryContext.sourceContext,
  sourceSummary: memoryContext.sourceSummary,
};
const countAnswer = buildDirectFactualAnswer("나의 보험 총 건수는?", workingContext);
console.log(`buildDirectFactualAnswer = ${countAnswer}`);
assert.match(countAnswer, new RegExp(`총\\s*${EXPECTED_POLICY_COUNT}\\s*건`), "direct factual answer mismatch");

const { count: documentCount, error: documentError } = await supabase
  .from("customer_documents")
  .select("id", { count: "exact", head: true })
  .eq("customer_id", CUSTOMER_ID)
  .is("deleted_at", null);

if (documentError) {
  throw new Error(`document_count_failed: ${documentError.message}`);
}

console.log(`\nDocuments (non-deleted): ${documentCount ?? 0}`);
assert.ok(
  (documentCount ?? 0) >= MIN_DOCUMENT_COUNT,
  `Expected at least ${MIN_DOCUMENT_COUNT} documents, found ${documentCount ?? 0}`,
);

const hashSet = new Set(
  [
    unified.state_hash,
    memoryContext.unified_state?.state_hash,
    dashboardView.stateHash,
  ].filter(Boolean),
);
assert.equal(hashSet.size, 1, `state_hash mismatch across consumers: ${[...hashSet].join(" vs ")}`);

console.log("\n✅ Phase 28 Step 1A audit PASSED — unified customer state is consistent.\n");
