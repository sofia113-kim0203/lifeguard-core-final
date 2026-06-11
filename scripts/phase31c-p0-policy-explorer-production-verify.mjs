/**
 * Phase 31-C-P0 — Policy Explorer production data verification (김진우).
 */
import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";
import {
  computePolicyExplorerStats,
  formatInsurerName,
  formatProductName,
  hasStructuredRiders,
  mergePolicyRecords,
} from "../src/lib/policyExplorer.js";
import { resolveAuditCustomerId } from "./lib/sandboxAuthGuard.js";

const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const serviceRoleKey = process.env.SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
const TEST_CUSTOMER_ID = resolveAuditCustomerId(process.env.PHASE28_TEST_CUSTOMER_ID);

if (!url || !serviceRoleKey) {
  console.error(JSON.stringify({ phase: "31c-p0-policy-explorer-production", pass: false, reason: "MISSING_ENV" }));
  process.exit(1);
}

const supabase = createClient(url, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const { data: policies, error } = await supabase
  .from("profile_insurance_policies")
  .select(
    "id, insurer_name, product_name, coverage_summary, policy_type, is_active, policy_status, source, monthly_premium, premium_amount",
  )
  .eq("customer_id", TEST_CUSTOMER_ID)
  .is("deleted_at", null)
  .order("created_at", { ascending: false });

if (error) {
  console.error(JSON.stringify({ phase: "31c-p0-policy-explorer-production", pass: false, error: error.message }));
  process.exit(1);
}

const merged = mergePolicyRecords(policies ?? [], []);
const stats = computePolicyExplorerStats(merged);

assert.equal(stats.totalCount, 8, `expected 8 policies, got ${stats.totalCount}`);
assert.ok(stats.premiumKnownCount >= 1, "expected at least one policy with monthly_premium");
assert.equal(stats.riderStructuredCount, 0, "expected 0 structured riders in current data");

const namedPolicies = merged.filter(
  (policy) => formatInsurerName(policy) !== "확인 필요" && formatProductName(policy) !== "확인 필요",
);
assert.ok(namedPolicies.length >= 6, `expected most policies to have names, got ${namedPolicies.length}`);

for (const policy of merged) {
  assert.equal(hasStructuredRiders(policy), false);
}

console.log(
  JSON.stringify(
    {
      phase: "31c-p0-policy-explorer-production",
      pass: true,
      customer_id: TEST_CUSTOMER_ID,
      policy_count: stats.totalCount,
      premium_known_count: stats.premiumKnownCount,
      premium_unknown_count: stats.premiumUnknownCount,
      rider_structured_count: stats.riderStructuredCount,
      premium_total: stats.premiumTotal,
      sample_products: merged.slice(0, 3).map((policy) => ({
        insurer: policy.insurer_name,
        product: policy.product_name,
        monthly_premium: policy.monthly_premium,
      })),
    },
    null,
    2,
  ),
);
