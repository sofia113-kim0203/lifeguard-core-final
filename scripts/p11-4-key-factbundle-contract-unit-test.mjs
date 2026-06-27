/**
 * P11-4 Step2 — KEY FactBundle active_policy_count contract unit tests.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  buildKeyFactBundlePolicyFields,
  resolveKeyActivePolicyCount,
} from "../server/salesDirectorKeyToolRegistry.js";
import {
  buildKeyStructuredResponse,
  keyToolBrainSliceHasPolicies,
  resolveKeyFactBundlePolicyCount,
} from "../server/humanUnderstandingLoop.js";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

const eightPolicies = Array.from({ length: 8 }, (_, index) => ({
  id: `p${index + 1}`,
  insurer_name: "A",
  product_name: `상품${index + 1}`,
}));

// 1 — unified.active_policy_count wins over policies array length
{
  const fields = buildKeyFactBundlePolicyFields({
    unified: {
      active_policy_count: 4,
      policy_count: 4,
      policy_ids: ["p1", "p2", "p3", "p4"],
    },
    customerContextBundle: { policies: eightPolicies },
  });
  assert.equal(fields.active_policy_count, 4);
  assert.equal(fields.policy_count, 4);
  assert.equal(fields.active_policy_count_source, "unified_state");
  assert.deepEqual(fields.active_policy_ids, ["p1", "p2", "p3", "p4"]);
  console.log("1 PASS — unified.active_policy_count=4 beats policies.length=8");
}

// 2 — unified.policy_count alias when active_policy_count missing
{
  const resolved = resolveKeyActivePolicyCount({
    unified: { policy_count: 4, policy_ids: ["p1", "p2", "p3", "p4"] },
    customerContextBundle: { policies: eightPolicies },
  });
  assert.equal(resolved.active_policy_count, 4);
  assert.equal(resolved.active_policy_count_source, "unified_state");
  console.log("2 PASS — unified.policy_count alias=4");
}

// 3 — no unified count → null, never policies.length
{
  const resolved = resolveKeyActivePolicyCount({
    unified: null,
    customerContextBundle: { policies: eightPolicies },
  });
  assert.equal(resolved.active_policy_count, null);
  assert.equal(resolved.active_policy_count_source, null);
  console.log("3 PASS — missing SSOT count stays null");
}

// 4 — HUL does not use policies.length fallback for hasPolicies
{
  const factBundle = {
    policies: eightPolicies,
    snapshot_tool_used: true,
  };
  assert.equal(resolveKeyFactBundlePolicyCount(factBundle), null);
  assert.equal(keyToolBrainSliceHasPolicies(factBundle), true);
  const source = readFileSync(`${repoRoot}/server/humanUnderstandingLoop.js`, "utf8");
  assert.doesNotMatch(source, /factBundle\.policies\?\.length/);
  console.log("4 PASS — null count uses snapshot signal, not policies.length");
}

// 5 — null count must not trigger zero/absence judgment paths
{
  const factBundle = {
    policies: eightPolicies,
    snapshot_tool_used: true,
    tool_brain_slice: "insurance_presence",
    key_orchestrator: true,
  };
  const text = buildKeyStructuredResponse({}, {}, factBundle, { resolvedIntent: null });
  assert.match(text, /가입된 보험이 있는 것은 확인돼요/);
  assert.doesNotMatch(text, /찾지 못했어요|아직 없습니다/);

  const nullCountJudgmentFactBundle = {
    policies: [],
    snapshot_tool_used: true,
    tool_brain_slice: "insurance_presence",
    key_orchestrator: true,
  };
  assert.equal(resolveKeyFactBundlePolicyCount(nullCountJudgmentFactBundle), null);
  assert.equal(keyToolBrainSliceHasPolicies(nullCountJudgmentFactBundle), false);
  const emptyPresenceText = buildKeyStructuredResponse({}, {}, nullCountJudgmentFactBundle, {
    resolvedIntent: null,
  });
  assert.match(emptyPresenceText, /등록된 가입 보험 정보를 찾지 못했어요/);
  assert.doesNotMatch(emptyPresenceText, /가입된 보험이 있는 것은 확인돼요/);
  console.log("5 PASS — empty policies never affirm insurance_presence");
}

console.log("\nAll P11-4 KEY factBundle contract unit tests passed.");
