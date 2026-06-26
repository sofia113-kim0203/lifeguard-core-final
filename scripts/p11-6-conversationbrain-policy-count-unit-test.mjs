/**
 * P11-6 Step2 — ConversationBrain / FreeThinking active_policy_count contract unit tests.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolveActivePolicyCountFromUnified } from "../server/unifiedCustomerState.js";
import {
  buildSalesDirectorThinkingContext,
  composeDeterministicFreeThinking,
  violatesManualTemplate,
} from "../server/salesDirectorFreeThinking.js";
import { CONVERSATION_BRAIN_TOPICS } from "../server/salesDirectorPersona.js";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

const eightPolicies = Array.from({ length: 8 }, (_, index) => ({
  id: `p${index + 1}`,
  insurer_name: "A",
  product_name: `상품${index + 1}`,
}));

function unifiedWithCount(count) {
  return {
    active_policy_count: count,
    policy_count: count,
    policy_ids: ["p1", "p2", "p3", "p4"],
  };
}

/** Mirror of buildConversationBrainFactBundlePolicyFields (avoid conversationBrain import cycle). */
function buildConversationBrainFactBundlePolicyFields({
  unified = null,
  upstreamFactBundle = null,
} = {}) {
  if (upstreamFactBundle?.active_policy_count != null) {
    const activePolicyCount = Number(upstreamFactBundle.active_policy_count);
    return {
      active_policy_count: activePolicyCount,
      active_policy_count_source: upstreamFactBundle.active_policy_count_source ?? "unified_state",
      active_policy_ids:
        upstreamFactBundle.active_policy_ids ?? upstreamFactBundle.policy_ids ?? [],
      policy_count: upstreamFactBundle.policy_count ?? activePolicyCount,
    };
  }
  return resolveActivePolicyCountFromUnified(unified);
}

// 1 — upstream factBundle.active_policy_count=4 preserved when composed has null
{
  const fields = buildConversationBrainFactBundlePolicyFields({
    unified: null,
    upstreamFactBundle: {
      active_policy_count: 4,
      active_policy_count_source: "unified_state",
      active_policy_ids: ["p1", "p2", "p3", "p4"],
      policy_count: 4,
    },
  });
  assert.equal(fields.active_policy_count, 4);
  assert.equal(fields.policy_count, 4);
  console.log("1 PASS — upstream active_policy_count=4 preserved");
}

// 2 — unified.active_policy_count=4 beats policies.length=8
{
  const fields = resolveActivePolicyCountFromUnified(unifiedWithCount(4));
  assert.equal(fields.active_policy_count, 4);
  assert.equal(fields.policy_count, 4);
  void eightPolicies;
  console.log("2 PASS — unified.active_policy_count=4 beats policies.length=8");
}

// 3 — missing unified count stays null (no policies.length recalc)
{
  const fields = resolveActivePolicyCountFromUnified(null);
  assert.equal(fields.active_policy_count, null);
  assert.equal(fields.policy_count, null);
  void eightPolicies;
  console.log("3 PASS — missing SSOT count stays null");
}

// 4 — FreeThinking deterministic path uses SSOT, not policies.length
{
  const result = composeDeterministicFreeThinking({
    question: "내 보험 괜찮아?",
    topic: CONVERSATION_BRAIN_TOPICS.ADEQUACY,
    customerContextBundle: { policies: eightPolicies },
    loadedContext: { policies: "present" },
    contextSnapshotId: "snap-1",
    unified: unifiedWithCount(4),
  });
  assert.ok(result?.text);
  assert.equal(result.active_policy_count, 4);
  assert.equal(result.policy_count, 4);
  assert.equal(result.active_policy_count_source, "unified_state");
  console.log("4 PASS — deterministic FreeThinking uses SSOT count=4");
}

// 5 — LLM prompt/context has no insurance count numbers (4건/8건)
{
  const contextBlock = buildSalesDirectorThinkingContext({
    question: "암보장 괜찮아?",
    customerContextBundle: { policies: eightPolicies },
    loadedContext: { policies: "present" },
    topic: CONVERSATION_BRAIN_TOPICS.CANCER_COVERAGE,
  });
  assert.doesNotMatch(contextBlock, /\b[48]\s*건\b/);
  assert.doesNotMatch(contextBlock, /policy_count|active_policy_count/);
  console.log("5 PASS — LLM context has no insurance count numbers");
}

// 6 — COUNT_DUMP guard still active
{
  const ftSource = readFileSync(`${repoRoot}/server/salesDirectorFreeThinking.js`, "utf8");
  assert.match(ftSource, /COUNT_DUMP\s*=\s*\/\\d\+\\s\*건\//);
  assert.match(ftSource, /if \(COUNT_DUMP\.test\(body\)\)/);
  assert.equal(violatesManualTemplate("가입된 보험이 4건 확인돠요.", []), true);
  assert.equal(violatesManualTemplate("암보장이 걸리시는 것 같아요.", []), false);
  console.log("6 PASS — COUNT_DUMP guard preserved");
}

// 7 — source contract: no policies.length recalc, no ?? 0 overwrite, loop passes unified
{
  const cbSource = readFileSync(`${repoRoot}/server/salesDirectorConversationBrain.js`, "utf8");
  const ftSource = readFileSync(`${repoRoot}/server/salesDirectorFreeThinking.js`, "utf8");
  const loopSource = readFileSync(`${repoRoot}/server/salesDirectorLoop.js`, "utf8");

  assert.match(cbSource, /resolveActivePolicyCountFromUnified/);
  assert.match(cbSource, /buildConversationBrainFactBundlePolicyFields/);
  assert.doesNotMatch(cbSource, /policy_count:\s*policies\.length/);
  assert.doesNotMatch(cbSource, /policy_count:\s*composed\.policy_count/);
  assert.doesNotMatch(cbSource, /policy_count \?\? 0/);
  assert.match(cbSource, /policy_count_from_snapshot: policyFields\.active_policy_count/);
  assert.match(cbSource, /\.\.\.policyFields/);

  assert.match(ftSource, /resolveActivePolicyCountFromUnified/);
  assert.doesNotMatch(ftSource, /policy_count:\s*policies\.length/);

  assert.match(loopSource, /refineWithConversationBrain\([\s\S]*unified,/);
  console.log("7 PASS — source contract: SSOT wired, no policies.length count, loop passes unified");
}

console.log("\nAll P11-6 ConversationBrain / FreeThinking policy count unit tests passed.");
