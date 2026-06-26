/**
 * P11-5 Step2 — Legacy ToolBrain active_policy_count contract unit tests.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolveActivePolicyCountFromUnified } from "../server/unifiedCustomerState.js";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

const eightPolicies = Array.from({ length: 8 }, (_, index) => ({
  id: `p${index + 1}`,
  insurer_name: "A",
  product_name: `상품${index + 1}`,
}));

function unifiedWithCount(count, { activeField = true } = {}) {
  return activeField
    ? {
        active_policy_count: count,
        policy_count: count,
        policy_ids: ["p1", "p2", "p3", "p4"],
      }
    : {
        policy_count: count,
        policy_ids: ["p1", "p2", "p3", "p4"],
      };
}

// 1 — SSOT count contract (unified.active_policy_count=4, bundle length would be 8)
{
  const fields = resolveActivePolicyCountFromUnified(unifiedWithCount(4));
  assert.equal(fields.active_policy_count, 4);
  assert.equal(fields.policy_count, 4);
  assert.equal(fields.active_policy_count_source, "unified_state");
  assert.deepEqual(fields.active_policy_ids, ["p1", "p2", "p3", "p4"]);
  console.log("1 PASS — active_policy_count=4 beats policies.length=8");
}

// 2 — unified.policy_count alias
{
  const fields = resolveActivePolicyCountFromUnified(unifiedWithCount(4, { activeField: false }));
  assert.equal(fields.active_policy_count, 4);
  assert.equal(fields.policy_count, 4);
  console.log("2 PASS — unified.policy_count alias=4");
}

// 3 — missing unified count stays null (policies.length=8 irrelevant)
{
  const fields = resolveActivePolicyCountFromUnified(null);
  assert.equal(fields.active_policy_count, null);
  assert.equal(fields.policy_count, null);
  assert.equal(fields.active_policy_count_source, null);
  void eightPolicies;
  console.log("3 PASS — missing SSOT count stays null");
}

// 4 — trace/factBundle wiring uses SSOT helper, not policies.length
{
  const toolBrainSource = readFileSync(`${repoRoot}/server/salesDirectorToolBrain.js`, "utf8");
  const loopSource = readFileSync(`${repoRoot}/server/salesDirectorLoop.js`, "utf8");
  assert.match(toolBrainSource, /resolveActivePolicyCountFromUnified/);
  assert.match(toolBrainSource, /policy_count_from_snapshot: policyFields\.active_policy_count/);
  assert.doesNotMatch(toolBrainSource, /policy_count:\s*policies\.length/);
  assert.doesNotMatch(toolBrainSource, /policy_count_from_snapshot:\s*customerContextBundle\?\.policies\?\.length/);
  assert.match(loopSource, /runSalesDirectorToolBrainSlice\([\s\S]*unified,/);
  assert.match(loopSource, /buildSnapshotToolTraceOnly\([\s\S]*unified/);
  console.log("4 PASS — trace/factBundle wired to SSOT helper, loop passes unified");
}

// 5 — empty branch avoids arbitrary zero in source
{
  const toolBrainSource = readFileSync(`${repoRoot}/server/salesDirectorToolBrain.js`, "utf8");
  assert.doesNotMatch(toolBrainSource, /policy_count:\s*0,/);
  assert.doesNotMatch(toolBrainSource, /policy_count:\s*hasSnapshotPolicies \? policies\.length : 0/);
  assert.doesNotMatch(toolBrainSource, /policy_count \?\? 0/);
  const emptyFields = resolveActivePolicyCountFromUnified(null);
  assert.equal(emptyFields.policy_count, null);
  console.log("5 PASS — empty branch avoids policy_count: 0");
}

// 6 — customer text unchanged, no N건 insertion in compose strings
{
  const toolBrainSource = readFileSync(`${repoRoot}/server/salesDirectorToolBrain.js`, "utf8");
  assert.match(toolBrainSource, /가입된 보험이 있는 것은 확인돼요\./);
  assert.doesNotMatch(toolBrainSource, /`\$\{[^}]+\}\s*건`/);
  assert.doesNotMatch(toolBrainSource, /\$\{policyCount\}\s*건/);
  console.log("6 PASS — customer text has no N건 insertion");
}

console.log("\nAll P11-5 legacy ToolBrain policy count unit tests passed.");
