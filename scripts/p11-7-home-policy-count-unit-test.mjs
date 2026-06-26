/**
 * P11-7 Step2 — Home active_policy_count contract unit tests.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolveActivePolicyCountFromUnified } from "../server/unifiedCustomerState.js";
import {
  buildHomeBrainFactsUsed,
  formatHomeBrainAnswer,
} from "../server/homeBrainFactCore.js";
import { computePremiumLookupStats } from "../server/intentGateLayer.js";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

const eightPolicies = Array.from({ length: 8 }, (_, index) => ({
  id: `p${index + 1}`,
  insurer_name: "A",
  product_name: `상품${index + 1}`,
  monthly_premium: 10000,
}));

function unifiedWithActiveCount(count) {
  return {
    profile: { display_name: "테스트" },
    active_policy_count: count,
    policy_count: count,
    policy_ids: ["p1", "p2", "p3", "p4"],
    policies: eightPolicies,
  };
}

function unifiedWithPolicyCountAlias(count) {
  return {
    profile: { display_name: "테스트" },
    policy_count: count,
    policy_ids: ["p1", "p2", "p3", "p4"],
    policies: eightPolicies,
  };
}

// 1 — unified.active_policy_count=4 beats policies.length=8
{
  const fields = resolveActivePolicyCountFromUnified(unifiedWithActiveCount(4));
  assert.equal(fields.active_policy_count, 4);
  assert.equal(fields.policy_count, 4);
  void eightPolicies;
  console.log("1 PASS — unified.active_policy_count=4 beats policies.length=8");
}

// 2 — unified.policy_count alias=4
{
  const fields = resolveActivePolicyCountFromUnified(unifiedWithPolicyCountAlias(4));
  assert.equal(fields.active_policy_count, 4);
  assert.equal(fields.policy_count, 4);
  console.log("2 PASS — unified.policy_count alias=4");
}

// 3 — missing SSOT count stays null (no policies.length recalc)
{
  const fields = resolveActivePolicyCountFromUnified({ policies: eightPolicies });
  assert.equal(fields.active_policy_count, null);
  assert.equal(fields.policy_count, null);
  console.log("3 PASS — missing SSOT count stays null");
}

// 4 — DEFER / CHAT branches do not hardcode policy_count: 0
{
  const tomSource = readFileSync(`${repoRoot}/server/homeAgentTom.js`, "utf8");
  assert.match(tomSource, /resolveActivePolicyCountFromUnified\(unified\)/);
  assert.doesNotMatch(tomSource, /policy_count:\s*customerContext\.policies\?\.length/);
  assert.doesNotMatch(tomSource, /policy_count:\s*0,/);
  assert.match(readFileSync(`${repoRoot}/server/salesDirectorLoop.js`, "utf8"), /runHomeAgentTomTurn\([\s\S]*unified,/);
  console.log("4 PASS — DEFER/CHAT/P5 use SSOT helper, loop passes unified");
}

// 5 — formatHomeBrainAnswer outputs N개 only when SSOT count is a number
{
  const stats = computePremiumLookupStats(eightPolicies);
  const answer = formatHomeBrainAnswer("policy_count", unifiedWithActiveCount(4), stats);
  assert.match(answer, /4개예요/);
  assert.doesNotMatch(answer, /8개/);
  console.log("5 PASS — formatHomeBrainAnswer uses SSOT count=4 for N개");
}

// 6 — SSOT null → no numeric N개 output
{
  const stats = computePremiumLookupStats(eightPolicies);
  const answer = formatHomeBrainAnswer("policy_count", { policies: eightPolicies }, stats);
  assert.doesNotMatch(answer, /\d+\s*개/);
  assert.match(answer, /확인 중/);
  console.log("6 PASS — SSOT null avoids numeric N개 output");
}

// 7 — buildHomeBrainFactsUsed uses active_policy_count, not stats.totalCount
{
  const stats = computePremiumLookupStats(eightPolicies);
  assert.equal(stats.totalCount, 8);
  const factsUsed = buildHomeBrainFactsUsed(unifiedWithActiveCount(4), stats);
  assert.equal(factsUsed.totalCount, 4);
  assert.equal(factsUsed.active_policy_count, 4);
  const nullFacts = buildHomeBrainFactsUsed({ policies: eightPolicies }, stats);
  assert.equal(nullFacts.totalCount, null);
  assert.equal(nullFacts.active_policy_count, null);
  const coreSource = readFileSync(`${repoRoot}/server/homeBrainFactCore.js`, "utf8");
  assert.doesNotMatch(coreSource, /totalCount:\s*stats\.totalCount/);
  assert.doesNotMatch(coreSource, /unified\?\.policies\?\.length/);
  assert.doesNotMatch(coreSource, /policy_count:\s*0,/);
  console.log("7 PASS — buildHomeBrainFactsUsed reads SSOT, not stats.totalCount");
}

console.log("\nAll P11-7 Home policy count unit tests passed.");
