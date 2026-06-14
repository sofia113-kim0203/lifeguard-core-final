/**
 * Advisor Brain P1 — Per-turn shared context.
 * loadUnifiedCustomerState() is called exactly once per runner turn.
 */
import { loadUnifiedCustomerState } from "../unifiedCustomerState.js";

export async function createAdvisorBrainContext({ supabase, customerId }) {
  if (!supabase || !customerId) {
    throw new Error("advisor_brain_context_requires_supabase_and_customer_id");
  }

  const unified = await loadUnifiedCustomerState(supabase, customerId);

  return {
    customerId,
    unified,
    policies: unified.policies ?? [],
    policyCount: Number(unified.policy_count ?? unified.policies?.length ?? 0),
    snapshot: unified.snapshot ?? null,
    structuredMemory: unified.structured_memory ?? null,
    loadedAt: unified.loaded_at ?? new Date().toISOString(),
    _unifiedLoaded: true,
  };
}
