/**
 * P6-1 — CustomerContextSnapshot: single JWT/RLS read path for every customer-facing turn.
 */
import { loadCustomerMemoryFactsOnly } from "./customerMemorySnapshot.js";
import {
  buildUnifiedCustomerStateFromRecords,
  loadRawCustomerRecords,
  loadSalesDirectorMinimalRawRecords,
} from "./unifiedCustomerState.js";
import {
  readSalesDirectorTurnContextCache,
  writeSalesDirectorTurnContextCache,
} from "./salesDirectorTurnContextCache.js";
import { resolvePolicyPremium } from "../src/lib/resolvePolicyPremium.js";
import {
  buildMergedRecentConversationSummary,
  normalizeRequestHistoryForSnapshot,
} from "./customerConversationHistory.js";

export const CUSTOMER_CONTEXT_SNAPSHOT_VERSION = "p6-1";

const RECENT_CONVERSATION_SCAN_LIMIT = 80;

function stableSerialize(value) {
  return JSON.stringify(value, (_key, nested) => {
    if (Array.isArray(nested)) return nested.map((item) => item);
    if (nested && typeof nested === "object" && nested !== null) {
      return Object.keys(nested)
        .sort()
        .reduce((acc, key) => {
          acc[key] = nested[key];
          return acc;
        }, {});
    }
    return nested;
  });
}

function hashString(value) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function presenceStatus(hasValue) {
  return hasValue ? "present" : "empty";
}

async function loadRecentConversationRows(supabase, customerId) {
  const { data, error } = await supabase
    .from("customer_conversations")
    .select("id, role, message, metadata_json, created_at")
    .eq("customer_id", customerId)
    .order("created_at", { ascending: false })
    .limit(RECENT_CONVERSATION_SCAN_LIMIT);

  if (error) {
    throw new Error(`recent_conversation_lookup_failed: ${error.message}`);
  }

  return data ?? [];
}

async function loadCustomerConsents(supabase, customerId) {
  const { data, error } = await supabase
    .from("customer_consents")
    .select("id, consent_type, granted, revoked_at, consent_version")
    .eq("customer_id", customerId);

  if (error) {
    throw new Error(`customer_consents_lookup_failed: ${error.message}`);
  }

  return data ?? [];
}

export function buildContextSnapshotId({
  customerId,
  flags = {},
  conversations = {},
  memoryVersion = 0,
} = {}) {
  return hashString(
    stableSerialize({
      customer_id: customerId,
      flags,
      conversation_sources: conversations.source ?? [],
      phase_filter_applied: conversations.phase_filter_applied ?? false,
      memory_version: memoryVersion,
      version: CUSTOMER_CONTEXT_SNAPSHOT_VERSION,
    }),
  );
}

export function snapshotToContextBundle(snapshot) {
  if (!snapshot?.bundle) return null;
  return snapshot.bundle;
}

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {string} customerId
 * @param {{ requestHistory?: Array<{ role?: string, content?: string, message?: string }> }} [options]
 */
export function buildCustomerContextSnapshotFromRecords({
  customerId,
  raw,
  memorySnapshot,
  conversationRows = [],
  consents = [],
  normalizedHistory = [],
} = {}) {
  if (!customerId) throw new Error("customer_id_required");
  if (!raw) throw new Error("raw_records_required");

  const policies = (raw.policies ?? []).map((policy) => ({
    ...policy,
    monthly_premium: resolvePolicyPremium(policy),
  }));
  const memoryFacts = memorySnapshot?.facts ?? [];
  const memoryFactCount = memorySnapshot?.fact_count ?? memoryFacts.length;
  const recentConversation = buildMergedRecentConversationSummary(conversationRows, normalizedHistory);

  const hasProfile = Boolean(
    raw.profile?.display_name ||
      raw.profile?.birth_date ||
      raw.profile?.gender ||
      raw.profile?.job_category,
  );
  const hasPolicies = policies.length > 0;
  const hasDocuments = (raw.document_count ?? 0) > 0 || (raw.documents ?? []).length > 0;
  const hasMemory = memoryFactCount > 0 || memoryFacts.length > 0;
  const hasRecentConversation = recentConversation.hasHistory === true;
  const hasConsents = consents.length > 0;

  const conversationSources = [];
  if (conversationRows.length > 0) conversationSources.push("db");
  if (normalizedHistory.length > 0) conversationSources.push("request_history");

  const flags = {
    has_policies: hasPolicies,
    has_documents: hasDocuments,
    has_memory: hasMemory,
    has_recent_conversation: hasRecentConversation,
    has_consents: hasConsents,
    has_profile: hasProfile,
  };

  const conversations = {
    status: presenceStatus(hasRecentConversation),
    source: conversationSources,
    phase_filter_applied: false,
  };

  const snapshot = {
    contract_version: CUSTOMER_CONTEXT_SNAPSHOT_VERSION,
    customer_id: customerId,
    profile: { status: presenceStatus(hasProfile) },
    policies: { status: presenceStatus(hasPolicies) },
    documents: { status: presenceStatus(hasDocuments) },
    memory: { status: presenceStatus(hasMemory) },
    conversations,
    consents: { status: presenceStatus(hasConsents) },
    flags,
    memory_version: memorySnapshot?.memory_version ?? raw.profile?.memory_version ?? 0,
    bundle: {
      customerId,
      profile: raw.profile ?? null,
      policies,
      documents: raw.documents ?? [],
      documentCount: raw.document_count ?? 0,
      memoryFacts,
      memoryFactCount,
      consents,
      recentConversation,
    },
  };

  snapshot.context_snapshot_id = buildContextSnapshotId({
    customerId,
    flags,
    conversations,
    memoryVersion: snapshot.memory_version,
  });

  return snapshot;
}

async function loadSnapshotSourceRecords(
  supabase,
  customerId,
  { requestHistory = [], salesDirectorFast = false } = {},
) {
  const normalizedHistory = normalizeRequestHistoryForSnapshot(requestHistory);
  const skipConversationDb = salesDirectorFast || normalizedHistory.length > 0;
  const skipConsents = salesDirectorFast;

  const rawLoader = salesDirectorFast
    ? loadSalesDirectorMinimalRawRecords(supabase, customerId)
    : loadRawCustomerRecords(supabase, customerId);

  const [raw, memoryPartial, conversationRows, consents] = await Promise.all([
    rawLoader,
    loadCustomerMemoryFactsOnly(supabase, customerId),
    skipConversationDb ? Promise.resolve([]) : loadRecentConversationRows(supabase, customerId),
    skipConsents ? Promise.resolve([]) : loadCustomerConsents(supabase, customerId),
  ]);

  const memorySnapshot = {
    ...memoryPartial,
    profile: raw.profile ?? null,
    memory_version: raw.profile?.memory_version ?? memoryPartial.memory_version ?? 0,
  };

  return { raw, memorySnapshot, conversationRows, consents, normalizedHistory };
}

export async function loadCustomerContextSnapshot(
  supabase,
  customerId,
  { requestHistory = [] } = {},
) {
  if (!supabase) throw new Error("supabase_required");
  if (!customerId) throw new Error("customer_id_required");

  const { raw, memorySnapshot, conversationRows, consents, normalizedHistory } =
    await loadSnapshotSourceRecords(supabase, customerId, {
      requestHistory,
      salesDirectorFast: false,
    });

  return buildCustomerContextSnapshotFromRecords({
    customerId,
    raw,
    memorySnapshot,
    conversationRows,
    consents,
    normalizedHistory,
  });
}

/**
 * P6-2B-5/6a — Single DB round-trip for snapshot + unified (no duplicate raw/memory queries).
 */
export async function loadSalesDirectorTurnContext(
  supabase,
  customerId,
  { requestHistory = [] } = {},
) {
  if (!supabase) throw new Error("supabase_required");
  if (!customerId) throw new Error("customer_id_required");

  const cached = readSalesDirectorTurnContextCache(customerId);
  if (cached) return cached;

  const { raw, memorySnapshot, conversationRows, consents, normalizedHistory } =
    await loadSnapshotSourceRecords(supabase, customerId, {
      requestHistory,
      salesDirectorFast: true,
    });

  const snapshot = buildCustomerContextSnapshotFromRecords({
    customerId,
    raw,
    memorySnapshot,
    conversationRows,
    consents,
    normalizedHistory,
  });
  const unifiedState = buildUnifiedCustomerStateFromRecords(raw, memorySnapshot, { customerId });

  writeSalesDirectorTurnContextCache(customerId, snapshot, unifiedState);

  return { snapshot, unifiedState, from_cache: false };
}

export function buildLoadedContextFromSnapshot(snapshot) {
  if (!snapshot) return null;
  return {
    profile: snapshot.profile?.status ?? "empty",
    policies: snapshot.policies?.status ?? "empty",
    documents: snapshot.documents?.status ?? "empty",
    memory: snapshot.memory?.status ?? "empty",
    conversations: {
      status: snapshot.conversations?.status ?? "empty",
      source: snapshot.conversations?.source ?? [],
      phase_filter_applied: snapshot.conversations?.phase_filter_applied === true,
    },
    consents: snapshot.consents?.status ?? "empty",
    flags: snapshot.flags ?? {},
  };
}

export function compareSnapshotExistence(unifiedState, snapshot) {
  const unifiedHasPolicies = (unifiedState?.policies?.length ?? unifiedState?.policy_count ?? 0) > 0;
  const snapshotHasPolicies = snapshot?.flags?.has_policies === true;
  const unifiedHasDocuments =
    (unifiedState?.document_count ?? 0) > 0 || (unifiedState?.documents?.length ?? 0) > 0;
  const snapshotHasDocuments = snapshot?.flags?.has_documents === true;
  const unifiedHasMemory = (unifiedState?.memory_fact_count ?? 0) > 0;
  const snapshotHasMemory = snapshot?.flags?.has_memory === true;
  const snapshotHasRecentConversation = snapshot?.flags?.has_recent_conversation === true;

  return {
    policiesMatch: unifiedHasPolicies === snapshotHasPolicies,
    documentsMatch: unifiedHasDocuments === snapshotHasDocuments,
    memoryMatch: unifiedHasMemory === snapshotHasMemory,
    sidebar: {
      has_policies: unifiedHasPolicies,
      has_documents: unifiedHasDocuments,
      has_memory: unifiedHasMemory,
    },
    snapshot: {
      has_policies: snapshotHasPolicies,
      has_documents: snapshotHasDocuments,
      has_memory: snapshotHasMemory,
      has_recent_conversation: snapshotHasRecentConversation,
    },
  };
}

export function buildReconciliationWarning(unifiedState, snapshot) {
  const comparison = compareSnapshotExistence(unifiedState, snapshot);
  const warnings = [];

  if (!comparison.policiesMatch) {
    warnings.push({
      field: "policies",
      sidebar_has_policies: comparison.sidebar.has_policies,
      snapshot_has_policies: comparison.snapshot.has_policies,
    });
  }
  if (!comparison.documentsMatch) {
    warnings.push({
      field: "documents",
      sidebar_has_documents: comparison.sidebar.has_documents,
      snapshot_has_documents: comparison.snapshot.has_documents,
      note: "sidebar panel may also use listDocuments(); compare unified-state vs snapshot in dev",
    });
  }
  if (!comparison.memoryMatch) {
    warnings.push({
      field: "memory",
      sidebar_has_memory: comparison.sidebar.has_memory,
      snapshot_has_memory: comparison.snapshot.has_memory,
    });
  }

  if (warnings.length === 0) return null;

  return {
    warnings,
    comparison,
  };
}
