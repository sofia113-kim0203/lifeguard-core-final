import {
  buildStructuredMemoryProfile,
  loadCustomerMemorySnapshot,
} from "./customerMemorySnapshot.js";

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
  return { status: response.status, body };
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

  const snapshot = await loadCustomerMemorySnapshot(supabase, customerId);
  const structured = buildStructuredMemoryProfile(snapshot);

  return {
    customer_id: customerId,
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

  let rebuildResult = null;
  if (rebuild && (serviceRoleKey ?? resolveServiceRoleKey())) {
    try {
      rebuildResult = await rebuildCustomerMemoryFoundation({
        supabase,
        supabaseUrl,
        serviceRoleKey,
        customerId,
        includeConversation: true,
      });
    } catch {
      rebuildResult = null;
    }
  }

  const snapshot = rebuildResult?.snapshot ?? (await loadCustomerMemorySnapshot(supabase, customerId));
  const structured = buildStructuredMemoryProfile(snapshot);

  return {
    customer_id: customerId,
    memory_version: snapshot.memory_version,
    fact_count: snapshot.fact_count,
    structured,
    facts: snapshot.facts,
    prompt_block: snapshot.prompt_block,
    rebuilt: Boolean(rebuildResult),
    rebuild_summary: rebuildResult
      ? {
          profile_facts_changed: rebuildResult.profile_health_policy?.body?.facts_changed ?? 0,
          conversation_facts_changed: rebuildResult.customer_conversation?.body?.facts_changed ?? 0,
        }
      : null,
  };
}
