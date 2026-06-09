/**
 * Phase 28 Step 1C — Full insurance policy context for panel Claude prompts.
 */

export function formatPoliciesForClaudePrompt(policies = []) {
  return (policies ?? []).map((policy) => ({
    id: policy.id,
    insurer_name: policy.insurer_name ?? null,
    product_name: policy.product_name ?? null,
    policy_type: policy.policy_type ?? null,
    monthly_premium: policy.monthly_premium ?? policy.premium_amount ?? null,
    coverage_summary: policy.coverage_summary ?? null,
    effective_from: policy.effective_from ?? policy.contract_date ?? null,
    is_active: policy.is_active ?? null,
    policy_status: policy.policy_status ?? null,
    source: policy.source ?? null,
  }));
}

export function buildPoliciesPromptBlock(policies = []) {
  const formatted = formatPoliciesForClaudePrompt(policies);
  return [
    "customer_insurance_policies (full list — include every policy, do not truncate):",
    JSON.stringify(
      {
        policy_count: formatted.length,
        policies: formatted,
      },
      null,
      2,
    ),
  ].join("\n");
}

export function attachPolicyMeta(meta = {}, policies = []) {
  const formatted = formatPoliciesForClaudePrompt(policies);
  return {
    ...meta,
    policy_count: formatted.length,
    policy_ids: formatted.map((policy) => String(policy.id)),
  };
}
