/**
 * Phase 28 Step 1C — Full insurance policy context for panel Claude prompts.
 */

import { resolvePolicyPremium } from "../src/lib/resolvePolicyPremium.js";

export function formatPoliciesForClaudePrompt(policies = []) {
  return (policies ?? []).map((policy) => ({
    id: policy.id,
    insurer_name: policy.insurer_name ?? null,
    product_name: policy.product_name ?? null,
    policy_type: policy.policy_type ?? null,
    monthly_premium: resolvePolicyPremium(policy),
    coverage_summary: policy.coverage_summary ?? null,
    effective_from: policy.effective_from ?? policy.contract_date ?? null,
    is_active: policy.is_active ?? null,
    policy_status: policy.policy_status ?? null,
    source: policy.source ?? null,
  }));
}

/** P11-9 — Read-only policy count for panel prompts (no formatted.length). */
export function resolvePanelPolicyCountFields(countContract = null) {
  if (countContract?.active_policy_count != null) {
    const activePolicyCount = Number(countContract.active_policy_count);
    return {
      active_policy_count: activePolicyCount,
      active_policy_count_source: countContract.active_policy_count_source ?? "unified_state",
      active_policy_ids: countContract.active_policy_ids ?? countContract.policy_ids ?? null,
      policy_count:
        countContract.policy_count != null ? Number(countContract.policy_count) : activePolicyCount,
    };
  }
  if (countContract?.policy_count != null) {
    const activePolicyCount = Number(countContract.policy_count);
    return {
      active_policy_count: activePolicyCount,
      active_policy_count_source: countContract.active_policy_count_source ?? "unified_state",
      active_policy_ids: countContract.active_policy_ids ?? countContract.policy_ids ?? null,
      policy_count: activePolicyCount,
    };
  }
  return {
    active_policy_count: null,
    active_policy_count_source: null,
    active_policy_ids: null,
    policy_count: null,
  };
}

export function buildPoliciesPromptBlock(policies = [], countContract = null) {
  const formatted = formatPoliciesForClaudePrompt(policies);
  const policyFields = resolvePanelPolicyCountFields(countContract);
  return [
    "customer_insurance_policies (full list — include every policy, do not truncate):",
    JSON.stringify(
      {
        active_policy_count: policyFields.active_policy_count,
        policy_count: policyFields.policy_count,
        policies: formatted,
      },
      null,
      2,
    ),
  ].join("\n");
}

export function attachPolicyMeta(meta = {}, policies = [], countContract = null) {
  const formatted = formatPoliciesForClaudePrompt(policies);
  const policyFields = resolvePanelPolicyCountFields(countContract);
  return {
    ...meta,
    active_policy_count: policyFields.active_policy_count,
    active_policy_count_source: policyFields.active_policy_count_source,
    active_policy_ids:
      policyFields.active_policy_ids ?? formatted.map((policy) => String(policy.id)),
    policy_count: policyFields.policy_count,
    policy_ids: formatted.map((policy) => String(policy.id)),
  };
}
