import {
  buildStructuredMemoryProfile,
  loadCustomerMemorySnapshot,
} from "./customerMemorySnapshot.js";
import {
  assessMemoryBuilderInvoke,
  formatMemoryBuilderFailure,
  MemoryBuilderRebuildError,
  resolveMemoryDisplayStatus,
} from "./memoryObservability.js";

export const MEMORY_BUILDER_WORKER_URL = "/functions/v1/memory-builder-worker";

export function resolveSupabaseUrl(env = process.env) {
  return String(env.SUPABASE_URL ?? env.VITE_SUPABASE_URL ?? "").trim();
}

export function resolveServiceRoleKey(env = process.env) {
  return String(env.SERVICE_ROLE_KEY ?? env.SUPABASE_SERVICE_ROLE_KEY ?? "").trim();
}

export async function invokeMemoryBuilderWorker({
  supabaseUrl,
  serviceRoleKey,
  customerId,
  scope = "profile_health_policy",
  mode = "rebuild",
} = {}) {
  if (!supabaseUrl || !serviceRoleKey) throw new Error("supabaseUrl_and_serviceRoleKey_required");
  if (!customerId) throw new Error("customer_id_required");

  const response = await fetch(`${supabaseUrl}${MEMORY_BUILDER_WORKER_URL}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${serviceRoleKey}`,
      apikey: serviceRoleKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ customer_id: customerId, scope, mode }),
  });

  const body = await response.json().catch(() => ({}));
  const assessed = assessMemoryBuilderInvoke({ status: response.status, body });

  return {
    scope,
    mode,
    ...assessed,
  };
}

export async function rebuildCustomerMemoryFoundation({
  supabase,
  supabaseUrl,
  serviceRoleKey,
  customerId,
  includeConversation = true,
} = {}) {
  if (!supabase) throw new Error("supabase_required");
  if (!customerId) throw new Error("customer_id_required");

  const profileResult = await invokeMemoryBuilderWorker({
    supabaseUrl: supabaseUrl ?? resolveSupabaseUrl(),
    serviceRoleKey: serviceRoleKey ?? resolveServiceRoleKey(),
    customerId,
    scope: "profile_health_policy",
    mode: "rebuild",
  });

  let conversationResult = null;
  if (includeConversation) {
    conversationResult = await invokeMemoryBuilderWorker({
      supabaseUrl: supabaseUrl ?? resolveSupabaseUrl(),
      serviceRoleKey: serviceRoleKey ?? resolveServiceRoleKey(),
      customerId,
      scope: "customer_conversation",
      mode: "rebuild",
    });
  }

  const profileOk = profileResult.ok;
  const conversationOk = !includeConversation || Boolean(conversationResult?.ok);

  if (!profileOk || !conversationOk) {
    const snapshot = await loadCustomerMemorySnapshot(supabase, customerId);
    const structured = buildStructuredMemoryProfile(snapshot);
    const partial = profileOk || conversationOk;
    throw new MemoryBuilderRebuildError(partial ? "memory_builder_partial_failure" : "memory_builder_invoke_failed", {
      partial,
      profile_health_policy: profileResult,
      customer_conversation: conversationResult,
      snapshot,
      structured,
    });
  }

  const snapshot = await loadCustomerMemorySnapshot(supabase, customerId);
  const structured = buildStructuredMemoryProfile(snapshot);

  return {
    customer_id: customerId,
    ok: true,
    profile_health_policy: profileResult,
    customer_conversation: conversationResult,
    snapshot,
    structured,
  };
}

export async function loadCustomerMemoryOnLogin({
  supabase,
  supabaseUrl,
  serviceRoleKey,
  customerId,
  rebuild = true,
} = {}) {
  if (!supabase) throw new Error("supabase_required");
  if (!customerId) throw new Error("customer_id_required");

  const resolvedServiceRoleKey = String(serviceRoleKey ?? resolveServiceRoleKey() ?? "").trim();
  const rebuildRequested = Boolean(rebuild);
  const shouldRebuild = rebuildRequested && Boolean(resolvedServiceRoleKey);

  let rebuildResult = null;
  let rebuildError = null;

  if (shouldRebuild) {
    try {
      rebuildResult = await rebuildCustomerMemoryFoundation({
        supabase,
        supabaseUrl,
        serviceRoleKey: resolvedServiceRoleKey,
        customerId,
        includeConversation: true,
      });
    } catch (error) {
      if (error instanceof MemoryBuilderRebuildError) {
        rebuildError = {
          code: error.code,
          partial: error.partial,
          failures: formatMemoryBuilderFailure(error.profile_health_policy, error.customer_conversation),
          profile_health_policy: error.profile_health_policy,
          customer_conversation: error.customer_conversation,
        };
        if (error.snapshot) {
          rebuildResult = {
            snapshot: error.snapshot,
            structured: error.structured,
            profile_health_policy: error.profile_health_policy,
            customer_conversation: error.customer_conversation,
          };
        }
      } else {
        rebuildError = {
          code: "memory_rebuild_failed",
          partial: false,
          error: error instanceof Error ? error.message : "memory_rebuild_failed",
        };
      }
    }
  } else if (rebuildRequested && !resolvedServiceRoleKey) {
    rebuildError = {
      code: "service_role_not_configured",
      partial: false,
      error: "service_role_not_configured",
    };
  }

  const snapshot =
    rebuildResult?.snapshot ?? (await loadCustomerMemorySnapshot(supabase, customerId));
  const structured = rebuildResult?.structured ?? buildStructuredMemoryProfile(snapshot);
  const memoryStatus = resolveMemoryDisplayStatus({
    rebuildError,
    rebuildSucceeded: Boolean(rebuildResult?.ok),
    serviceRoleConfigured: Boolean(resolvedServiceRoleKey),
    rebuildRequested,
  });

  return {
    customer_id: customerId,
    memory_version: snapshot.memory_version,
    fact_count: snapshot.fact_count,
    structured,
    facts: snapshot.facts,
    prompt_block: snapshot.prompt_block,
    memory_status: memoryStatus,
    rebuilt: Boolean(rebuildResult?.ok),
    rebuild_error: rebuildError,
    rebuild_summary: rebuildResult?.ok
      ? {
          ok: true,
          profile_facts_changed: rebuildResult.profile_health_policy?.body?.facts_changed ?? 0,
          conversation_facts_changed: rebuildResult.customer_conversation?.body?.facts_changed ?? 0,
        }
      : rebuildError
        ? {
            ok: false,
            ...rebuildError,
          }
        : null,
  };
}
