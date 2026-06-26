/**
 * P11-9 Step2 — Remaining policy count contract unit tests.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  buildCustomerFacingContext,
  buildDirectFactualAnswer,
  resolvePolicyCountFromSummary,
} from "../server/customerConversationalTone.js";
import {
  buildPoliciesPromptBlock,
  resolvePanelPolicyCountFields,
} from "../server/panelClaudePoliciesContext.js";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

const eightPolicies = Array.from({ length: 8 }, (_, index) => ({
  id: `p${index + 1}`,
  insurer_name: "A",
  product_name: `상품${index + 1}`,
}));

function workingContextWithCount(count, { useAlias = false } = {}) {
  const sourceSummary = {
    insurance: eightPolicies,
    ...(useAlias ? { policy_count: count } : { active_policy_count: count }),
  };
  return { sourceSummary, sourceContext: { policies: eightPolicies } };
}

function extractPromptJson(block) {
  const jsonStart = block.indexOf("{");
  return JSON.parse(block.slice(jsonStart));
}

function resolveKeyFactBundlePolicyCountMirror(factBundle = {}) {
  if (factBundle.active_policy_count != null) {
    return Number(factBundle.active_policy_count);
  }
  if (factBundle.policy_count != null) {
    return Number(factBundle.policy_count);
  }
  return null;
}

function buildTrustAssertionBundleMirror(factBundle = {}, humanFrame = {}) {
  return {
    question: factBundle.question ?? humanFrame.surface_question,
    active_policy_count: factBundle.active_policy_count ?? null,
    active_policy_count_source: factBundle.active_policy_count_source ?? null,
    active_policy_ids: factBundle.active_policy_ids ?? null,
    policy_count: resolveKeyFactBundlePolicyCountMirror(factBundle),
    policies: [],
  };
}

// 1 — customerTone: active_policy_count=4, policies.length=8 → N건 is 4
{
  const ctx = workingContextWithCount(4);
  const answer = buildDirectFactualAnswer("내 보험 몇 건이야?", ctx);
  assert.match(answer ?? "", /4건/);
  assert.doesNotMatch(answer ?? "", /8건/);

  const facing = buildCustomerFacingContext(ctx);
  assert.match(facing.situation_summary.join(" "), /4건/);
  assert.doesNotMatch(facing.situation_summary.join(" "), /8건/);
  console.log("1 PASS — customerTone SSOT=4 beats policies.length=8");
}

// 2 — customerTone: count null, 8 policies/descriptions → no N건
{
  const ctx = {
    sourceSummary: { insurance: eightPolicies },
    sourceContext: { policies: eightPolicies },
  };
  const answer = buildDirectFactualAnswer("내 보험 몇 건이야?", ctx);
  assert.doesNotMatch(answer ?? "", /\d+\s*건/);

  const facing = buildCustomerFacingContext(ctx);
  const summaryText = facing.situation_summary.join(" ");
  assert.doesNotMatch(summaryText, /\d+\s*건/);
  assert.equal(facing.policy_count, null);
  assert.equal(facing.policy_descriptions.length, 8);
  console.log("2 PASS — customerTone null SSOT: no N건 despite 8 policies");
}

// 3 — customerTone: policy_count alias=4
{
  const ctx = workingContextWithCount(4, { useAlias: true });
  assert.equal(resolvePolicyCountFromSummary(ctx.sourceSummary), 4);
  const answer = buildDirectFactualAnswer("가입 보험 수 알려줘", ctx);
  assert.match(answer ?? "", /4건/);
  console.log("3 PASS — customerTone policy_count alias=4");
}

// 4 — panelClaudePoliciesContext: SSOT=4, formatted.length=8 → prompt JSON policy_count=4
{
  const block = buildPoliciesPromptBlock(eightPolicies, { active_policy_count: 4 });
  const payload = extractPromptJson(block);
  assert.equal(payload.policy_count, 4);
  assert.equal(payload.active_policy_count, 4);
  assert.equal(payload.policies.length, 8);
  console.log("4 PASS — panel prompt policy_count=4 with 8 formatted policies");
}

// 5 — panelClaudePoliciesContext: count null, formatted.length=8 → policy_count null (not 8)
{
  const block = buildPoliciesPromptBlock(eightPolicies);
  const payload = extractPromptJson(block);
  assert.equal(payload.policy_count, null);
  assert.equal(payload.active_policy_count, null);
  assert.equal(payload.policies.length, 8);
  assert.notEqual(payload.policy_count, 8);
  console.log("5 PASS — panel prompt null SSOT stays null");
}

// 6 — HUL trust assertionBundle: no policy_count: 0 hardcode
{
  const hulSource = readFileSync(`${repoRoot}/server/humanUnderstandingLoop.js`, "utf8");
  assert.doesNotMatch(hulSource, /policy_count:\s*0,\s*policies:\s*\[\]/);

  const bundle = buildTrustAssertionBundleMirror(
    { active_policy_count: 4, policy_count: 4, question: "믿을 수 있어?" },
    { surface_question: "믿을 수 있어?" },
  );
  assert.equal(bundle.policy_count, 4);
  assert.equal(bundle.active_policy_count, 4);
  assert.deepEqual(bundle.policies, []);

  const nullBundle = buildTrustAssertionBundleMirror({}, { surface_question: "믿을 수 있어?" });
  assert.equal(nullBundle.policy_count, null);
  assert.equal(nullBundle.active_policy_count, null);
  console.log("6 PASS — HUL trust assertionBundle preserves SSOT or null");
}

// 7 — active_policy_count=0 vs null distinguished
{
  const zeroCtx = workingContextWithCount(0);
  const nullCtx = {
    sourceSummary: { insurance: eightPolicies },
    sourceContext: { policies: eightPolicies },
  };

  assert.equal(resolvePolicyCountFromSummary(zeroCtx.sourceSummary), 0);
  assert.equal(resolvePolicyCountFromSummary(nullCtx.sourceSummary), null);

  const zeroAnswer = buildDirectFactualAnswer("내 보험 몇 건?", zeroCtx);
  assert.doesNotMatch(zeroAnswer ?? "", /0건/);
  assert.match(zeroAnswer ?? "", /찾지 못했/);

  const panelZero = resolvePanelPolicyCountFields({ active_policy_count: 0 });
  assert.equal(panelZero.policy_count, 0);
  assert.equal(panelZero.active_policy_count, 0);

  const panelNull = resolvePanelPolicyCountFields(null);
  assert.equal(panelNull.policy_count, null);

  assert.equal(resolveKeyFactBundlePolicyCountMirror({ active_policy_count: 0 }), 0);
  assert.equal(resolveKeyFactBundlePolicyCountMirror({ policies: eightPolicies }), null);
  console.log("7 PASS — count=0 vs null distinguished");
}

// 8 — source contract: no forbidden recalc patterns in scope files
{
  const toneSource = readFileSync(`${repoRoot}/server/customerConversationalTone.js`, "utf8");
  const panelSource = readFileSync(`${repoRoot}/server/panelClaudePoliciesContext.js`, "utf8");
  const hulSource = readFileSync(`${repoRoot}/server/humanUnderstandingLoop.js`, "utf8");

  assert.doesNotMatch(toneSource, /policy_count:\s*0/);
  assert.doesNotMatch(toneSource, /policyCount\s*=\s*policyDescriptions\.length/);
  assert.doesNotMatch(toneSource, /policyDescriptions\.length\s*\?\?\s*0/);
  assert.doesNotMatch(
    toneSource,
    /const lines = \[\];\r?\n\r?\n  if \(situation\.policyDescriptions\.length\)/,
  );
  assert.match(toneSource, /hasSsotPolicyCount\(situation\.policyCount\)/);

  assert.doesNotMatch(panelSource, /policy_count:\s*formatted\.length/);
  assert.match(panelSource, /resolvePanelPolicyCountFields/);

  assert.doesNotMatch(hulSource, /policy_count:\s*0,\s*policies:\s*\[\]/);
  assert.match(hulSource, /resolveKeyFactBundlePolicyCount\(factBundle\)/);
  console.log("8 PASS — source contract: no forbidden recalc in 3 scope files");
}

console.log("\nAll P11-9 remaining policy count unit tests passed.");
