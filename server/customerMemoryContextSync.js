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
  assessMemorySyncNeed,
  MemoryBuilderRebuildError,
  resolveMemoryDisplayStatus,
} from "./memoryObservability.js";
import {
  buildSourceSummaryFromUnifiedState,
  loadUnifiedCustomerState,
  toSourceContext,
} from "./unifiedCustomerState.js";

export { assessMemorySyncNeed } from "./memoryObservability.js";

export async function loadCustomerSourceContext(supabase, customerId) {
  const unified = await loadUnifiedCustomerState(supabase, customerId);
  return toSourceContext(unified);
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
  let memorySyncStatus = "ready";
  let memorySyncError = null;

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
      memorySyncStatus = "ready";
      rebuildSummary = {
        ok: true,
        reason: syncAssessment.reason,
        profile_facts_changed: rebuild.profile_health_policy?.body?.facts_changed ?? 0,
        conversation_facts_changed: rebuild.customer_conversation?.body?.facts_changed ?? 0,
      };
    } catch (error) {
      if (error instanceof MemoryBuilderRebuildError) {
        memorySyncStatus = error.partial ? "degraded" : "failed";
        memorySyncError = error.code;
        if (error.snapshot) {
          snapshot = error.snapshot;
        }
        rebuildSummary = {
          ok: false,
          reason: syncAssessment.reason,
          error: error.code,
          partial: error.partial,
          profile_health_policy: error.profile_health_policy,
          customer_conversation: error.customer_conversation,
        };
      } else {
        memorySyncStatus = "failed";
        memorySyncError = error instanceof Error ? error.message : "memory_rebuild_failed";
        rebuildSummary = {
          ok: false,
          reason: syncAssessment.reason,
          error: memorySyncError,
        };
      }
    }
  } else if (shouldRebuild && (!roleKey || !sbUrl)) {
    memorySyncStatus = "failed";
    memorySyncError = "service_role_not_configured";
    rebuildSummary = {
      ok: false,
      reason: syncAssessment.reason,
      error: memorySyncError,
    };
  } else {
    memorySyncStatus = resolveMemoryDisplayStatus({ syncAssessment });
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
    memory_sync_status: memorySyncStatus,
    memory_sync_error: memorySyncError,
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
