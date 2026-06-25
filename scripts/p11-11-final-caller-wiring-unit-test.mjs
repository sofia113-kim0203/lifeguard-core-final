/**
 * P11-11 Step2 — Final Caller Wiring unit tests.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolveActivePolicyCountFromUnified } from "../server/unifiedCustomerState.js";
import { buildUnderwritingExplanationPrompt } from "../server/customerUnderwritingRiskCore.js";
import { buildRecommendationExplanationPrompt } from "../server/customerRecommendationCore.js";
import { attachPolicyMeta, buildPoliciesPromptBlock } from "../server/panelClaudePoliciesContext.js";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

const eightPolicies = Array.from({ length: 8 }, (_, index) => ({
  id: `p${index + 1}`,
  insurer_name: "A",
  product_name: `상품${index + 1}`,
}));

function unifiedWithCount(count, { useAlias = false } = {}) {
  return {
    policies: eightPolicies,
    snapshot: { fact_count: 1, memory_version: 1, facts: [] },
    ...(useAlias
      ? { policy_count: count }
      : {
          active_policy_count: count,
          active_policy_count_source: "unified_state",
          active_policy_ids: ["p1", "p2", "p3", "p4"],
        }),
  };
}

function mirrorCoverageContextPolicyFields(unified) {
  return resolveActivePolicyCountFromUnified(unified);
}

function extractPoliciesPromptJson(block) {
  const jsonStart = block.indexOf("{");
  return JSON.parse(block.slice(jsonStart));
}

function countContractFromContext(context) {
  return {
    active_policy_count: context.active_policy_count ?? null,
    active_policy_count_source: context.active_policy_count_source ?? null,
    active_policy_ids: context.active_policy_ids ?? null,
    policy_count: context.policy_count ?? null,
  };
}

function mockRecommendationContext(unified) {
  const policyFields = mirrorCoverageContextPolicyFields(unified);
  return {
    structuredMemory: { profile: { name: "테스트" } },
    recommendationResult: {
      customer_visible_top2: [],
      keep_existing: [],
      recommendations: [],
    },
    coverageGapResult: { overall_risk: "medium", gap_score: 1, top_gaps: [] },
    underwritingResult: {
      overall_underwriting_risk: "medium",
      likely_surcharge: [],
      likely_standard: [],
    },
    policies: eightPolicies,
    ...policyFields,
  };
}

function mockUnderwritingContext(unified) {
  const policyFields = mirrorCoverageContextPolicyFields(unified);
  return {
    structuredMemory: { profile: { name: "테스트" } },
    coverageGapResult: { overall_risk: "medium" },
    underwritingResult: {
      coverage_gap_reference: {},
      overall_underwriting_risk: "medium",
    },
    policies: eightPolicies,
    ...policyFields,
  };
}

// 1 — loadCoverageAnalysisContext preserves unified.active_policy_count=4
{
  const fields = mirrorCoverageContextPolicyFields(unifiedWithCount(4));
  assert.equal(fields.active_policy_count, 4);
  assert.equal(fields.policy_count, 4);
  const gapSource = readFileSync(`${repoRoot}/server/customerCoverageGapCore.js`, "utf8");
  assert.match(gapSource, /resolveActivePolicyCountFromUnified\(unified\)/);
  assert.match(gapSource, /active_policy_count: policyFields\.active_policy_count/);
  console.log("1 PASS — coverage context preserves active_policy_count=4");
}

// 2 — context.policy_count alias=4
{
  const fields = mirrorCoverageContextPolicyFields(unifiedWithCount(4, { useAlias: true }));
  assert.equal(fields.policy_count, 4);
  assert.equal(fields.active_policy_count, 4);
  console.log("2 PASS — coverage context policy_count alias=4");
}

// 3 — policies.length=8 but context policy_count stays 4
{
  const fields = mirrorCoverageContextPolicyFields(unifiedWithCount(4));
  assert.equal(eightPolicies.length, 8);
  assert.equal(fields.policy_count, 4);
  assert.notEqual(fields.policy_count, eightPolicies.length);
  console.log("3 PASS — SSOT=4 beats policies.length=8 in context fields");
}

// 4 — UW prompt JSON policy_count=4
{
  const context = mockUnderwritingContext(unifiedWithCount(4));
  const countContract = countContractFromContext(context);
  const prompt = buildUnderwritingExplanationPrompt(
    context.structuredMemory,
    context.coverageGapResult,
    context.underwritingResult,
    context.policies,
    countContract,
  );
  assert.match(prompt.user, /"policy_count": 4/);
  assert.match(prompt.user, /"active_policy_count": 4/);
  const blockPayload = extractPoliciesPromptJson(
    buildPoliciesPromptBlock(context.policies, countContract),
  );
  assert.equal(blockPayload.policy_count, 4);
  console.log("4 PASS — UW prompt JSON policy_count=4");
}

// 5 — Rec prompt JSON policy_count=4
{
  const context = mockRecommendationContext(unifiedWithCount(4));
  const countContract = countContractFromContext(context);
  const prompt = buildRecommendationExplanationPrompt(
    context.structuredMemory,
    context.recommendationResult,
    context.coverageGapResult,
    context.underwritingResult,
    context.policies,
    countContract,
  );
  assert.match(prompt.user, /"policy_count": 4/);
  const blockPayload = extractPoliciesPromptJson(
    buildPoliciesPromptBlock(context.policies, countContract),
  );
  assert.equal(blockPayload.policy_count, 4);
  console.log("5 PASS — Rec prompt JSON policy_count=4");
}

// 6 — UW attachPolicyMeta meta.policy_count=4
{
  const countContract = mirrorCoverageContextPolicyFields(unifiedWithCount(4));
  const meta = attachPolicyMeta({ panel: "underwriting" }, eightPolicies, countContract);
  assert.equal(meta.policy_count, 4);
  assert.equal(meta.active_policy_count, 4);
  console.log("6 PASS — UW attachPolicyMeta meta.policy_count=4");
}

// 7 — Rec attachPolicyMeta meta.policy_count=4
{
  const countContract = mirrorCoverageContextPolicyFields(unifiedWithCount(4));
  const meta = attachPolicyMeta({ panel: "recommendation" }, eightPolicies, countContract);
  assert.equal(meta.policy_count, 4);
  console.log("7 PASS — Rec attachPolicyMeta meta.policy_count=4");
}

// 8 — count null → prompt/meta null, not 8
{
  const nullUnified = { policies: eightPolicies, snapshot: { fact_count: 0, facts: [] } };
  const fields = mirrorCoverageContextPolicyFields(nullUnified);
  assert.equal(fields.policy_count, null);

  const uwPrompt = buildUnderwritingExplanationPrompt(
    {},
    {},
    { coverage_gap_reference: {} },
    eightPolicies,
    fields,
  );
  assert.match(uwPrompt.user, /"policy_count": null/);
  assert.doesNotMatch(uwPrompt.user, /"policy_count": 8/);

  const recPrompt = buildRecommendationExplanationPrompt(
    {},
    { customer_visible_top2: [], keep_existing: [], recommendations: [] },
    {},
    {},
    eightPolicies,
    fields,
  );
  assert.match(recPrompt.user, /"policy_count": null/);

  const nullBlock = extractPoliciesPromptJson(buildPoliciesPromptBlock(eightPolicies, fields));
  assert.equal(nullBlock.policy_count, null);

  const meta = attachPolicyMeta({ panel: "underwriting" }, eightPolicies, fields);
  assert.equal(meta.policy_count, null);
  console.log("8 PASS — null SSOT stays null in prompt/meta");
}

// 9 — source regex: no forbidden recalc in 3 modified files
{
  const gapSource = readFileSync(`${repoRoot}/server/customerCoverageGapCore.js`, "utf8");
  const uwSource = readFileSync(`${repoRoot}/server/customerUnderwritingRiskCore.js`, "utf8");
  const recSource = readFileSync(`${repoRoot}/server/customerRecommendationCore.js`, "utf8");

  for (const source of [gapSource, uwSource, recSource]) {
    assert.doesNotMatch(source, /policy_count:\s*policies\.length/);
    assert.doesNotMatch(source, /policy_count:\s*0/);
    assert.doesNotMatch(source, /policy_count:\s*formatted\.length/);
  }

  assert.match(uwSource, /buildPoliciesPromptBlock\(policies, countContract\)/);
  assert.match(recSource, /buildPoliciesPromptBlock\(policies, countContract\)/);
  assert.match(uwSource, /attachPolicyMeta\([\s\S]*countContract/);
  assert.match(recSource, /attachPolicyMeta\([\s\S]*countContract/);
  console.log("9 PASS — source contract: wired callers, no forbidden recalc");
}

console.log("\nAll P11-11 Final Caller Wiring unit tests passed.");
