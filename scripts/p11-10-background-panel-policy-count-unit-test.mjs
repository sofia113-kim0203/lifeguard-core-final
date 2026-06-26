/**
 * P11-10 Step2 — Background / Panel active_policy_count contract unit tests.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  buildClaudeExplanationEntry,
  resolvePanelHydrationPolicySummary,
} from "../server/panelClaudeExplanationHydration.js";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

const eightPolicies = Array.from({ length: 8 }, (_, index) => ({
  id: `p${index + 1}`,
  insurer_name: "A",
  product_name: `상품${index + 1}`,
}));

function unifiedWithCount(count, { useAlias = false, includeIds = true } = {}) {
  return {
    policies: eightPolicies,
    ...(useAlias
      ? { policy_count: count }
      : {
          active_policy_count: count,
          active_policy_count_source: "unified_state",
        }),
    ...(includeIds ? { active_policy_ids: ["p1", "p2", "p3", "p4"] } : {}),
  };
}

function buildCasualChatFactBundleMirror(question) {
  return {
    question,
    active_policy_count: null,
    active_policy_count_source: null,
    active_policy_ids: [],
    policy_count: null,
    policies: [],
  };
}

// 1 — panel hydration: active_policy_count=4, policies.length=8 → policy_count=4
{
  const summary = resolvePanelHydrationPolicySummary(unifiedWithCount(4));
  assert.equal(summary.policy_count, 4);
  assert.equal(summary.active_policy_count, 4);
  assert.notEqual(summary.policy_count, eightPolicies.length);
  console.log("1 PASS — panel hydration SSOT=4 beats policies.length=8");
}

// 2 — panel hydration: policy_count alias=4 only
{
  const summary = resolvePanelHydrationPolicySummary(unifiedWithCount(4, { useAlias: true }));
  assert.equal(summary.policy_count, 4);
  assert.equal(summary.active_policy_count, 4);
  console.log("2 PASS — panel hydration policy_count alias=4");
}

// 3 — panel hydration: count null, policies.length=8 → null (not 8)
{
  const summary = resolvePanelHydrationPolicySummary({ policies: eightPolicies });
  assert.equal(summary.policy_count, null);
  assert.equal(summary.active_policy_count, null);
  assert.notEqual(summary.policy_count, 8);
  console.log("3 PASS — panel hydration null SSOT stays null");
}

// 4 — attachPolicyMeta meta policy_count is SSOT/null via buildClaudeExplanationEntry
{
  const withCount = buildClaudeExplanationEntry({
    meta: { panel: "underwriting" },
    policies: eightPolicies,
    countContract: unifiedWithCount(4),
  });
  assert.equal(withCount.meta.policy_count, 4);
  assert.equal(withCount.meta.active_policy_count, 4);

  const withoutCount = buildClaudeExplanationEntry({
    meta: { panel: "underwriting" },
    policies: eightPolicies,
    countContract: { policies: eightPolicies },
  });
  assert.equal(withoutCount.meta.policy_count, null);
  assert.notEqual(withoutCount.meta.policy_count, 8);
  console.log("4 PASS — attachPolicyMeta meta policy_count SSOT/null");
}

// 5 — conversationalBackgroundAnalysisCore casual factBundle has no policy_count: 0
{
  const convBgSource = readFileSync(
    `${repoRoot}/server/conversationalBackgroundAnalysisCore.js`,
    "utf8",
  );
  assert.doesNotMatch(convBgSource, /policy_count:\s*0/);
  const bundle = buildCasualChatFactBundleMirror("안녕");
  assert.equal(bundle.policy_count, null);
  assert.equal(bundle.active_policy_count, null);
  assert.deepEqual(bundle.active_policy_ids, []);
  console.log("5 PASS — casual chat factBundle null contract, no policy_count: 0");
}

// 6 — source regex: no policy_count: policies.length
{
  const hydrationSource = readFileSync(
    `${repoRoot}/server/panelClaudeExplanationHydration.js`,
    "utf8",
  );
  const convBgSource = readFileSync(
    `${repoRoot}/server/conversationalBackgroundAnalysisCore.js`,
    "utf8",
  );
  assert.doesNotMatch(hydrationSource, /policy_count:\s*policies\.length/);
  assert.doesNotMatch(convBgSource, /policy_count:\s*policies\.length/);
  assert.match(hydrationSource, /resolveActivePolicyCountFromUnified/);
  console.log("6 PASS — source contract: no policy_count: policies.length");
}

// 7 — source regex: no policy_count: 0 hardcode in modified files
{
  const hydrationSource = readFileSync(
    `${repoRoot}/server/panelClaudeExplanationHydration.js`,
    "utf8",
  );
  const convBgSource = readFileSync(
    `${repoRoot}/server/conversationalBackgroundAnalysisCore.js`,
    "utf8",
  );
  assert.doesNotMatch(hydrationSource, /policy_count:\s*0/);
  assert.doesNotMatch(convBgSource, /policy_count:\s*0/);
  console.log("7 PASS — source contract: no policy_count: 0 hardcode");
}

console.log("\nAll P11-10 Background / Panel policy count unit tests passed.");
