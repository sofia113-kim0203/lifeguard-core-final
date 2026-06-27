/**
 * P11-8 Step2 — Output Layer active_policy_count contract unit tests.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { buildGapGuidance, buildFactBundleFromUnified } from "../server/guidanceLayer/guidanceBuilder.js";
import {
  buildConfirmedFactsSummary,
  extractFactBundleEvidence,
  resolveFactBundlePolicyCount,
} from "../server/salesDirectorFormatter.js";
import { hasOneBrainCoverageEvidence } from "../server/oneBrainResponseLayer.js";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

const eightPolicies = Array.from({ length: 8 }, (_, index) => ({
  id: `p${index + 1}`,
  insurer_name: "A",
  product_name: `상품${index + 1}`,
}));

function factBundleWithActiveCount(count) {
  return {
    active_policy_count: count,
    policy_count: count,
    active_policy_count_source: "unified_state",
    active_policy_ids: ["p1", "p2", "p3", "p4"],
    policies: eightPolicies,
    question: "내 보험 괜찮아?",
  };
}

// 1 — active_policy_count=4 beats policies.length=8
{
  assert.equal(resolveFactBundlePolicyCount(factBundleWithActiveCount(4)), 4);
  const guidanceBundle = buildFactBundleFromUnified(
    { active_policy_count: 4, policy_count: 4, policies: eightPolicies },
    "test",
  );
  assert.equal(guidanceBundle.active_policy_count, 4);
  assert.equal(guidanceBundle.policy_count, 4);
  console.log("1 PASS — active_policy_count=4 beats policies.length=8");
}

// 2 — policy_count alias=4
{
  assert.equal(
    resolveFactBundlePolicyCount({ policy_count: 4, policies: eightPolicies }),
    4,
  );
  console.log("2 PASS — policy_count alias=4");
}

// 3 — count null, policies.length=8 → no recalc to 8
{
  assert.equal(resolveFactBundlePolicyCount({ policies: eightPolicies }), null);
  const guidanceBundle = buildFactBundleFromUnified({ policies: eightPolicies }, "test");
  assert.equal(guidanceBundle.policy_count, null);
  assert.equal(guidanceBundle.active_policy_count, null);
  console.log("3 PASS — null SSOT stays null");
}

// 4 — guidance buildConfirmedFactsSlot skips N건 when null
{
  const guidance = buildGapGuidance({ policies: eightPolicies, question: "암보장 부족해?" });
  assert.doesNotMatch(guidance.message, /\d+\s*건의\s*보험/);
  const withCount = buildGapGuidance(factBundleWithActiveCount(4));
  assert.match(withCount.message, /4건의\s*보험/);
  console.log("4 PASS — guidance N건 only with SSOT count");
}

// 5 — formatter buildConfirmedFactsSummary skips N건 when null
{
  const summary = buildConfirmedFactsSummary({ policies: eightPolicies });
  assert.doesNotMatch(summary, /\d+\s*건/);
  const summaryWithCount = buildConfirmedFactsSummary(factBundleWithActiveCount(4));
  assert.match(summaryWithCount, /4건/);
  console.log("5 PASS — formatter summary N건 only with SSOT count");
}

// 6 — oneBrain hasCoverageEvidence ignores policies.length alone
{
  assert.equal(hasOneBrainCoverageEvidence({ policies: eightPolicies }), false);
  assert.equal(hasOneBrainCoverageEvidence(factBundleWithActiveCount(4)), true);
  console.log("6 PASS — oneBrain coverage evidence SSOT-only");
}

// 7 — active_policy_count=0 distinct from null
{
  assert.equal(resolveFactBundlePolicyCount({ active_policy_count: 0, policies: eightPolicies }), 0);
  assert.equal(extractFactBundleEvidence({ active_policy_count: 0 }).has_policies, false);
  assert.equal(extractFactBundleEvidence(factBundleWithActiveCount(4)).has_policies, true);
  console.log("7 PASS — count=0 vs null distinguished");
}

// 8 — source contract: no policies.length / ?? 0 recalc in scope files
{
  const gbSource = readFileSync(`${repoRoot}/server/guidanceLayer/guidanceBuilder.js`, "utf8");
  const fmtSource = readFileSync(`${repoRoot}/server/salesDirectorFormatter.js`, "utf8");
  const obSource = readFileSync(`${repoRoot}/server/oneBrainResponseLayer.js`, "utf8");

  assert.doesNotMatch(gbSource, /policy_count:\s*policies\.length/);
  assert.doesNotMatch(gbSource, /policy_count\s*\?\?\s*policies\.length/);
  assert.doesNotMatch(gbSource, /Number\(policy_count\s*\?\?\s*policies\.length/);
  assert.doesNotMatch(fmtSource, /factBundle\.policies\?\.length/);
  assert.doesNotMatch(fmtSource, /policy_count\s*\?\?\s*0/);
  assert.doesNotMatch(obSource, /factBundle\?\.policies\?\.length/);
  assert.doesNotMatch(obSource, /policy_count\s*\?\?\s*0/);
  assert.match(fmtSource, /resolveFactBundlePolicyCount/);
  assert.match(obSource, /resolveFactBundlePolicyCount/);
  console.log("8 PASS — source contract: SSOT read-only, no length/??0 fallback");
}

console.log("\nAll P11-8 Output Layer policy count unit tests passed.");
