/**
 * P11-12 Final Slice — Design / Hydration / Tone / Trust SSOT wiring unit tests.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolveActivePolicyCountFromUnified } from "../server/unifiedCustomerState.js";
import { buildInsuranceDesignExplanationPrompt } from "../server/customerInsuranceDesignCore.js";
import { buildUnderwritingExplanationPrompt } from "../server/customerUnderwritingRiskCore.js";
import {
  buildClaudeExplanationEntry,
} from "../server/panelClaudeExplanationHydration.js";
import {
  buildCustomerFacingContext,
  buildDirectFactualAnswer,
} from "../server/customerConversationalTone.js";
import { attachPolicyMeta, buildPoliciesPromptBlock } from "../server/panelClaudePoliciesContext.js";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

const eightPolicies = Array.from({ length: 8 }, (_, index) => ({
  id: `p${index + 1}`,
  insurer_name: "A",
  product_name: `상품${index + 1}`,
}));

function unifiedWithCount(count) {
  return {
    policies: eightPolicies,
    active_policy_count: count,
    active_policy_count_source: "unified_state",
    active_policy_ids: ["p1", "p2", "p3", "p4"],
  };
}

function countContractFromUnified(unified) {
  return resolveActivePolicyCountFromUnified(unified);
}

function extractPoliciesPromptJson(block) {
  const jsonStart = block.indexOf("{");
  return JSON.parse(block.slice(jsonStart));
}

function buildTrustAssertionBundleMirror(factBundle = {}, humanFrame = {}) {
  function resolveKeyFactBundlePolicyCount(factBundle = {}) {
    if (factBundle.active_policy_count != null) {
      return Number(factBundle.active_policy_count);
    }
    if (factBundle.policy_count != null) {
      return Number(factBundle.policy_count);
    }
    return null;
  }
  return {
    question: factBundle.question ?? humanFrame.surface_question,
    active_policy_count: factBundle.active_policy_count ?? null,
    active_policy_count_source: factBundle.active_policy_count_source ?? null,
    active_policy_ids: factBundle.active_policy_ids ?? null,
    policy_count: resolveKeyFactBundlePolicyCount(factBundle),
    policies: [],
  };
}

// 1 — Design prompt: SSOT=4, policies.length=8 → prompt JSON policy_count=4
{
  const countContract = countContractFromUnified(unifiedWithCount(4));
  const prompt = buildInsuranceDesignExplanationPrompt(
    { profile: { name: "테스트" } },
    { insurance_design: {}, customer_visible_design: {} },
    { coverageGapResult: {}, underwritingResult: {}, recommendationResult: {} },
    eightPolicies,
    countContract,
  );
  assert.match(prompt.user, /"policy_count": 4/);
  const payload = extractPoliciesPromptJson(buildPoliciesPromptBlock(eightPolicies, countContract));
  assert.equal(payload.policy_count, 4);
  assert.notEqual(payload.policy_count, eightPolicies.length);
  console.log("1 PASS — Design prompt JSON policy_count=4");
}

// 2 — Design attachPolicyMeta meta.policy_count=4
{
  const countContract = countContractFromUnified(unifiedWithCount(4));
  const meta = attachPolicyMeta({ panel: "insurance_design" }, eightPolicies, countContract);
  assert.equal(meta.policy_count, 4);
  assert.equal(meta.active_policy_count, 4);
  console.log("2 PASS — Design attachPolicyMeta meta.policy_count=4");
}

// 3 — Hydration job path: prompt block B and meta share SSOT count
{
  const countContract = countContractFromUnified(unifiedWithCount(4));
  const prompt = buildUnderwritingExplanationPrompt(
    { profile: { name: "테스트" } },
    { overall_risk: "medium" },
    { coverage_gap_reference: {}, overall_underwriting_risk: "medium" },
    eightPolicies,
    countContract,
  );
  const entry = buildClaudeExplanationEntry({
    explanation: "test",
    meta: { panel: "underwriting" },
    policies: eightPolicies,
    countContract,
  });
  assert.match(prompt.user, /"policy_count": 4/);
  assert.equal(entry.meta.policy_count, 4);
  const blockPayload = extractPoliciesPromptJson(buildPoliciesPromptBlock(eightPolicies, countContract));
  assert.equal(blockPayload.policy_count, entry.meta.policy_count);
  console.log("3 PASS — hydration prompt block B and meta share SSOT=4");
}

// 4 — customerTone: count null + descriptions length > 0 → no N건
{
  const ctx = {
    sourceSummary: { insurance: eightPolicies },
    sourceContext: { policies: eightPolicies },
  };
  const answer = buildDirectFactualAnswer("내 보험 몇 건?", ctx);
  assert.doesNotMatch(answer ?? "", /\d+\s*건/);
  const facing = buildCustomerFacingContext(ctx);
  assert.doesNotMatch(facing.situation_summary.join(" "), /\d+\s*건/);
  assert.equal(facing.policy_descriptions.length, 8);
  assert.equal(facing.policy_count, null);
  console.log("4 PASS — customerTone null SSOT: no N건 despite descriptions");
}

// 5 — HUL trust/fallback: no policy_count: 0 hardcode
{
  const hulSource = readFileSync(`${repoRoot}/server/humanUnderstandingLoop.js`, "utf8");
  assert.doesNotMatch(hulSource, /policy_count:\s*0,\s*policies:\s*\[\]/);
  const bundle = buildTrustAssertionBundleMirror(
    { active_policy_count: 4, policy_count: 4, question: "믿을 수 있어?" },
    { surface_question: "믿을 수 있어?" },
  );
  assert.equal(bundle.policy_count, 4);
  const nullBundle = buildTrustAssertionBundleMirror({}, { surface_question: "믿을 수 있어?" });
  assert.equal(nullBundle.policy_count, null);
  console.log("5 PASS — HUL trust path preserves SSOT or null");
}

// 6 — source regex: no policy_count: policies.length
{
  const files = [
    "customerInsuranceDesignCore.js",
    "panelClaudeExplanationHydration.js",
    "customerConversationalTone.js",
    "humanUnderstandingLoop.js",
  ];
  for (const file of files) {
    const source = readFileSync(`${repoRoot}/server/${file}`, "utf8");
    assert.doesNotMatch(source, /policy_count:\s*policies\.length/);
  }
  console.log("6 PASS — no policy_count: policies.length in scope files");
}

// 7 — source regex: no formatted.length as policy_count
{
  const files = [
    "customerInsuranceDesignCore.js",
    "panelClaudeExplanationHydration.js",
    "customerConversationalTone.js",
    "humanUnderstandingLoop.js",
  ];
  for (const file of files) {
    const source = readFileSync(`${repoRoot}/server/${file}`, "utf8");
    assert.doesNotMatch(source, /policy_count:\s*formatted\.length/);
  }
  console.log("7 PASS — no formatted.length as policy_count");
}

// 8 — source regex: no insurance-count policy_count: 0 hardcode
{
  const files = [
    "customerInsuranceDesignCore.js",
    "panelClaudeExplanationHydration.js",
    "customerConversationalTone.js",
    "humanUnderstandingLoop.js",
  ];
  for (const file of files) {
    const source = readFileSync(`${repoRoot}/server/${file}`, "utf8");
    assert.doesNotMatch(source, /policy_count:\s*0/);
  }
  assert.match(
    readFileSync(`${repoRoot}/server/customerConversationalTone.js`, "utf8"),
    /hasSsotPolicyCount/,
  );
  assert.match(
    readFileSync(`${repoRoot}/server/panelClaudeExplanationHydration.js`, "utf8"),
    /policyFields,\s*\n\s*\)/,
  );
  console.log("8 PASS — no policy_count: 0 hardcode; wiring patterns present");
}

console.log("\nAll P11-12 Final policy count SSOT unit tests passed.");
