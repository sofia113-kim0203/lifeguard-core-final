/**
 * Phase 26 Step 2B — Ensure customer analysis/document data flows into AI consultation Memory.
 * Phase 28 Step 1A — Delegates raw reads to unifiedCustomerState.
 */
import {
  buildStructuredMemoryProfile,
  loadCustomerMemorySnapshot,
} from "./customerMemorySnapshot.js";
import {
  rebuildCustomerMemoryFoundation,
  resolveServiceRoleKey,
  resolveSupabaseUrl,
} from "./customerMemoryFoundation.js";
import {
  buildSourceSummaryFromUnifiedState,
  loadUnifiedCustomerState,
  toSourceContext,
} from "./unifiedCustomerState.js";

export async function loadCustomerSourceContext(supabase, customerId) {
  const unified = await loadUnifiedCustomerState(supabase, customerId);
  return toSourceContext(unified);
}

export function assessMemorySyncNeed(sourceContext, snapshot) {
  const facts = snapshot?.facts ?? [];
  const factCount = facts.length;
  const hasSourceData =
    sourceContext.has_profile || sourceContext.has_health || sourceContext.has_policies;

  if (!hasSourceData) {
    return { needed: false, reason: "no_source_data" };
  }
  if (factCount === 0) {
    return { needed: true, reason: "memory_empty_but_source_exists" };
  }

  const healthFactCount = facts.filter((fact) => fact.fact_type === "health").length;
  const insuranceFactCount = facts.filter((fact) => fact.fact_type === "insurance").length;
  const identityFactCount = facts.filter((fact) => fact.fact_type === "identity").length;

  if (sourceContext.has_profile && identityFactCount === 0) {
    return { needed: true, reason: "profile_not_in_memory" };
  }
  if (sourceContext.has_health && healthFactCount === 0) {
    return { needed: true, reason: "health_not_in_memory" };
  }
  if (sourceContext.has_policies && insuranceFactCount === 0) {
    return { needed: true, reason: "policies_not_in_memory" };
  }

  return { needed: false, reason: "memory_ok" };
}

export function buildSourceContextSummary(sourceContext) {
  return buildSourceSummaryFromUnifiedState({
    profile: sourceContext?.profile ?? null,
    health_details: sourceContext?.health_details ?? {},
    policies: sourceContext?.policies ?? [],
    documents: sourceContext?.documents ?? [],
    memory_version: sourceContext?.profile?.memory_version ?? 0,
    state_hash: null,
  });
}

export async function ensureCustomerMemoryContext({
  supabase,
  customerId,
  supabaseUrl = null,
  serviceRoleKey = null,
  forceRebuild = false,
} = {}) {
  let unified = await loadUnifiedCustomerState(supabase, customerId);
  const sourceContext = toSourceContext(unified);
  let snapshot = unified.snapshot ?? (await loadCustomerMemorySnapshot(supabase, customerId));
  const syncAssessment = assessMemorySyncNeed(sourceContext, snapshot);
  let memorySynced = false;
  let rebuildSummary = null;

  const shouldRebuild = forceRebuild || syncAssessment.needed;
  const roleKey = serviceRoleKey ?? resolveServiceRoleKey();
  const sbUrl = supabaseUrl ?? resolveSupabaseUrl();

  if (shouldRebuild && roleKey && sbUrl) {
    try {
      const rebuild = await rebuildCustomerMemoryFoundation({
        supabase,
        supabaseUrl: sbUrl,
        serviceRoleKey: roleKey,
        customerId,
        includeConversation: true,
      });
      snapshot = rebuild.snapshot ?? snapshot;
      unified = await loadUnifiedCustomerState(supabase, customerId);
      memorySynced = true;
      rebuildSummary = {
        reason: syncAssessment.reason,
        profile_facts_changed: rebuild.profile_health_policy?.body?.facts_changed ?? 0,
        conversation_facts_changed: rebuild.customer_conversation?.body?.facts_changed ?? 0,
      };
    } catch (error) {
      rebuildSummary = {
        reason: syncAssessment.reason,
        error: error instanceof Error ? error.message : "memory_rebuild_failed",
      };
    }
  }

  const structured = buildStructuredMemoryProfile(snapshot);
  const refreshedContext = toSourceContext({ ...unified, snapshot });
  const sourceSummary = buildSourceSummaryFromUnifiedState({
    ...unified,
    snapshot,
    memory_version: snapshot?.memory_version ?? unified.memory_version,
  });

  return {
    unified_state: unified,
    snapshot,
    structured,
    sourceContext: refreshedContext,
    sourceSummary,
    memory_synced: memorySynced,
    sync_assessment: syncAssessment,
    rebuild_summary: rebuildSummary,
    data_available: {
      in_db:
        refreshedContext.has_profile ||
        refreshedContext.has_health ||
        refreshedContext.has_policies,
      in_memory: (snapshot.fact_count ?? 0) > 0,
      in_prompt:
        (snapshot.fact_count ?? 0) > 0 ||
        refreshedContext.has_profile ||
        refreshedContext.has_health ||
        refreshedContext.has_policies,
    },
  };
}
