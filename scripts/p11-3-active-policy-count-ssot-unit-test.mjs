/**
 * P11-3 Step2 — active_policy_count SSOT contract unit tests.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  extractCustomerSituation,
  resolveUnifiedPolicyView,
} from "../server/customerConversationalTone.js";
import {
  buildDashboardPolicyView,
  buildSourceSummaryFromUnifiedState,
  buildUnifiedCustomerStateFromRecords,
  buildUnifiedProvenance,
} from "../server/unifiedCustomerState.js";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

const mockRaw = {
  profile: { display_name: "김진우", memory_version: 1 },
  health: null,
  health_details: {},
  policies: [
    { id: "p1", insurer_name: "A", product_name: "X", is_active: true },
    { id: "p2", insurer_name: "B", product_name: "Y", is_active: true },
    { id: "p3", insurer_name: "C", product_name: "Z", is_active: false },
  ],
  documents: [],
  document_count: 0,
  documents_preview_count: 0,
  flags: {
    has_profile: true,
    has_health: false,
    has_policies: true,
    has_documents: false,
  },
};

// 1 — unified state exposes active_policy_count (SSOT calc once)
{
  const unified = buildUnifiedCustomerStateFromRecords(mockRaw, null, {
    customerId: "cust-1",
  });
  assert.equal(unified.active_policy_count, 3);
  assert.equal(unified.policy_count, 3);
  assert.equal(unified.active_policy_count, unified.policy_count);

  const summary = buildSourceSummaryFromUnifiedState(unified);
  assert.equal(summary.active_policy_count, 3);
  assert.equal(summary.policy_count, 3);

  const dashboard = buildDashboardPolicyView(unified);
  assert.equal(dashboard.insurancePolicyCount, 3);

  const provenance = buildUnifiedProvenance({
    policies: unified.policies,
    activePolicyCount: unified.active_policy_count,
  });
  assert.equal(provenance.policies.count, 3);
  console.log("1 PASS — unified active_policy_count SSOT");
}

// 2 — salesDirector factsUsed does not derive count from policies.length (source contract)
{
  const source = readFileSync(
    `${repoRoot}/server/salesDirectorLoop.js`,
    "utf8",
  );
  assert.match(source, /function resolveFactsUsedActivePolicyCount/);
  assert.match(source, /active_policy_count: activePolicyCount/);
  assert.doesNotMatch(source, /policy_count:\s*policies\.length/);
  assert.doesNotMatch(source, /policies\.length\s*\|\|\s*agentTurn/);
  console.log("2 PASS — salesDirectorFactsUsed source contract");
}

// 3 — chat factual path does not infer count from policyDescriptions.length
{
  const workingContext = {
    sourceSummary: {
      insurance: [
        { insurer: "A", product: "1" },
        { insurer: "B", product: "2" },
        { insurer: "C", product: "3" },
      ],
    },
  };
  const view = resolveUnifiedPolicyView(workingContext);
  assert.equal(view.policyCount, null);
  assert.equal(view.policyDescriptions.length, 3);

  const situation = extractCustomerSituation(workingContext);
  assert.equal(situation.policyCount, null);
  assert.equal(situation.policyDescriptions.length, 3);
  console.log("3 PASS — chat path no description-length fallback");
}

// 4 — chat path still reads explicit SSOT fields
{
  const workingContext = {
    sourceSummary: {
      active_policy_count: 8,
      policy_count: 8,
      insurance: [{ insurer: "A", product: "1" }],
    },
  };
  const view = resolveUnifiedPolicyView(workingContext);
  assert.equal(view.policyCount, 8);
  console.log("4 PASS — chat path reads active_policy_count");
}

console.log("\nAll P11-3 active_policy_count SSOT unit tests passed.");
