/**
 * Phase 28 Step 1C — Generate and persist panel-level Claude explanations for analysis jobs.
 */
import { loadUnifiedCustomerState, resolveActivePolicyCountFromUnified } from "./unifiedCustomerState.js";
import { attachPolicyMeta } from "./panelClaudePoliciesContext.js";

export const PANEL_CLAUDE_KEYS = ["underwriting", "recommendation", "insurance_design"];

export function buildClaudeExplanationEntry({
  explanation = null,
  meta = {},
  policies = [],
  countContract = null,
} = {}) {
  return {
    explanation,
    meta: attachPolicyMeta(meta, policies, countContract),
  };
}

function resolvePanelHydrationPolicyIds(unified = null, policies = []) {
  const policyFields = resolveActivePolicyCountFromUnified(unified);
  if (Array.isArray(policyFields.active_policy_ids) && policyFields.active_policy_ids.length > 0) {
    return policyFields.active_policy_ids.map(String);
  }
  return policies.map((policy) => String(policy.id));
}

export function resolvePanelHydrationPolicySummary(unified = null) {
  const policies = unified?.policies ?? [];
  const policyFields = resolveActivePolicyCountFromUnified(unified);
  return {
    active_policy_count: policyFields.active_policy_count,
    active_policy_count_source: policyFields.active_policy_count_source,
    policy_count: policyFields.policy_count,
    policy_ids: resolvePanelHydrationPolicyIds(unified, policies),
  };
}

export async function generatePanelClaudeExplanations({
  supabase,
  customerId,
  workingContext = {},
  fetchImpl = fetch,
  env = process.env,
} = {}) {
  const startedAt = Date.now();
  const unified = await loadUnifiedCustomerState(supabase, customerId);
  const policies = unified.policies ?? [];
  const policyFields = resolveActivePolicyCountFromUnified(unified);

  // G8: panel prose is not independently hydrated. Structured results return to KEY.
  const explanations = {};

  const policySummary = resolvePanelHydrationPolicySummary(unified);

  return {
    explanations,
    active_policy_count: policySummary.active_policy_count,
    active_policy_count_source: policySummary.active_policy_count_source,
    policy_count: policySummary.policy_count,
    policy_ids: policySummary.policy_ids,
    duration_ms: Date.now() - startedAt,
  };
}
