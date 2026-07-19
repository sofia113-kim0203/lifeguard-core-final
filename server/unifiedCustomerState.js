/**
 * Phase 28 Step 1A — Single customer state contract for all engines and UI loaders.
 */
import {
  countCoverageSheetBridgePolicies,
  COVERAGE_SHEET_EXTRACTOR_ORIGIN,
  extractCoverageSheetBridgePolicyIds,
  isCoverageSheetBridgePolicy,
} from "./coverageSheetBridge.js";
import {
  buildStructuredMemoryProfile,
  loadCustomerMemorySnapshot,
} from "./customerMemorySnapshot.js";
import {
  assessMemorySyncNeed,
  resolveMemoryDisplayStatus,
} from "./memoryObservability.js";
import {
  filterPoliciesToActiveSourceDocuments,
  loadActiveSourceDocumentIds,
} from "../src/lib/policySourceDocumentFilter.js";
import { resolvePolicyPremium } from "../src/lib/resolvePolicyPremium.js";

export {
  COVERAGE_SHEET_EXTRACTOR_ORIGIN,
  countCoverageSheetBridgePolicies,
  extractCoverageSheetBridgePolicyIds,
  isCoverageSheetBridgePolicy,
};

export const UNIFIED_STATE_VERSION = "phase28-1b";
export const DOCUMENT_PREVIEW_LIMIT = 20;

export const POLICY_LIST_SELECT =
  "id, insurer_name, product_name, policy_type, monthly_premium, premium_amount, coverage_summary, effective_from, contract_date, is_active, policy_status, source, created_at";

export const DOCUMENT_LIST_SELECT =
  "id, doc_class, ingest_status, original_filename, customer_hint_type, metadata_json, created_at";

export const PROFILE_SELECT =
  "id, user_id, display_name, birth_date, gender, job_category, marital_status, family_composition, insurance_goal, monthly_insurance_budget, memory_version, status";

function stableSerialize(value) {
  return JSON.stringify(value, (_key, nested) => {
    if (Array.isArray(nested)) {
      return nested.map((item) => item);
    }
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

export function extractPolicyIds(policies = []) {
  return (policies ?? []).map((policy) => String(policy.id)).sort();
}

/** P11-5 — Read-only active policy count contract from Unified State (no recalculation). */
export function resolveActivePolicyCountFromUnified(unified = null) {
  if (unified?.active_policy_count != null) {
    const activePolicyCount = Number(unified.active_policy_count);
    return {
      active_policy_count: activePolicyCount,
      active_policy_count_source: "unified_state",
      active_policy_ids: unified.active_policy_ids ?? unified.policy_ids ?? [],
      policy_count: activePolicyCount,
    };
  }
  if (unified?.policy_count != null) {
    const activePolicyCount = Number(unified.policy_count);
    return {
      active_policy_count: activePolicyCount,
      active_policy_count_source: "unified_state",
      active_policy_ids: unified.active_policy_ids ?? unified.policy_ids ?? [],
      policy_count: activePolicyCount,
    };
  }
  return {
    active_policy_count: null,
    active_policy_count_source: null,
    active_policy_ids: unified?.active_policy_ids ?? unified?.policy_ids ?? [],
    policy_count: null,
  };
}

export function getInsurancePolicyCountFact(snapshot) {
  const facts = snapshot?.facts ?? [];
  const countFact = facts.find((fact) => fact.fact_key === "insurance.policy.count");
  return countFact?.fact_value != null ? String(countFact.fact_value).trim() : null;
}

export function buildUnifiedStateHash({
  customerId,
  memoryVersion = 0,
  policies = [],
  documents = [],
  documentCount = 0,
  health = null,
  profile = null,
} = {}) {
  const payload = {
    customer_id: customerId,
    memory_version: memoryVersion,
    policy_ids: extractPolicyIds(policies),
    document_count: documentCount,
    document_preview_ids: (documents ?? []).map((doc) => String(doc.id)).sort(),
    profile_updated_at: profile?.updated_at ?? profile?.memory_version ?? null,
    health_source: health?.source ?? null,
  };
  return hashString(stableSerialize(payload));
}

export function buildUnifiedProvenance({
  policies = [],
  activePolicyCount = null,
  documents = [],
  documentCount = 0,
  documentsPreviewCount = 0,
  snapshot = null,
} = {}) {
  const resolvedPolicyCount =
    activePolicyCount ?? null;

  return {
    policies: {
      source_table: "profile_insurance_policies",
      count: resolvedPolicyCount,
      ids: extractPolicyIds(policies),
      coverage_sheet_bridge_policy_count: countCoverageSheetBridgePolicies(policies),
      coverage_sheet_bridge_policy_ids: extractCoverageSheetBridgePolicyIds(policies),
    },
    documents: {
      source_table: "customer_documents",
      count: documentCount,
      preview_count: documentsPreviewCount,
      ids: (documents ?? []).map((doc) => String(doc.id)).sort(),
    },
    memory: {
      source_table: "customer_memory_facts",
      memory_version: snapshot?.memory_version ?? 0,
      fact_count: snapshot?.fact_count ?? 0,
      snapshot_facts_count: snapshot?.snapshot_facts_count ?? snapshot?.facts?.length ?? 0,
      insurance_policy_count_fact: getInsurancePolicyCountFact(snapshot),
    },
  };
}

export async function loadSalesDirectorMinimalRawRecords(supabase, customerId) {
  if (!supabase) throw new Error("supabase_required");
  if (!customerId) throw new Error("customer_id_required");

  const [profileResult, policiesResult] = await Promise.all([
    supabase
      .from("customer_profiles")
      .select(PROFILE_SELECT)
      .eq("id", customerId)
      .is("deleted_at", null)
      .maybeSingle(),
    supabase
      .from("active_profile_insurance_policies")
      .select(POLICY_LIST_SELECT)
      .eq("customer_id", customerId)
      .order("created_at", { ascending: false }),
  ]);

  if (profileResult.error) {
    throw new Error(`profile_lookup_failed: ${profileResult.error.message}`);
  }
  if (policiesResult.error) {
    throw new Error(`policy_lookup_failed: ${policiesResult.error.message}`);
  }

  const profile = profileResult.data ?? null;
  const activeSourceIds = await loadActiveSourceDocumentIds(customerId, supabase);
  const policies = filterPoliciesToActiveSourceDocuments(
    policiesResult.data ?? [],
    activeSourceIds,
  );

  return {
    profile,
    health: null,
    health_details: {},
    policies,
    documents: [],
    document_count: 0,
    documents_preview_count: 0,
    flags: {
      has_profile: Boolean(
        profile?.display_name || profile?.birth_date || profile?.gender || profile?.job_category,
      ),
      has_health: false,
      has_policies: policies.length > 0,
      has_documents: false,
    },
  };
}

export async function loadRawCustomerRecords(supabase, customerId) {
  if (!supabase) throw new Error("supabase_required");
  if (!customerId) throw new Error("customer_id_required");

  const [profileResult, healthResult, policiesResult, documentsCountResult, documentsResult] =
    await Promise.all([
    supabase
      .from("customer_profiles")
      .select(PROFILE_SELECT)
      .eq("id", customerId)
      .is("deleted_at", null)
      .maybeSingle(),
    supabase
      .from("profile_health")
      .select("customer_id, source, details_json, updated_at")
      .eq("customer_id", customerId)
      .maybeSingle(),
    supabase
      .from("active_profile_insurance_policies")
      .select(POLICY_LIST_SELECT)
      .eq("customer_id", customerId)
      .order("created_at", { ascending: false }),
    supabase
      .from("customer_documents")
      .select("id", { count: "exact", head: true })
      .eq("customer_id", customerId)
      .is("deleted_at", null),
    supabase
      .from("customer_documents")
      .select(DOCUMENT_LIST_SELECT)
      .eq("customer_id", customerId)
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(DOCUMENT_PREVIEW_LIMIT),
  ]);

  if (profileResult.error) {
    throw new Error(`profile_lookup_failed: ${profileResult.error.message}`);
  }
  if (healthResult.error) {
    throw new Error(`health_lookup_failed: ${healthResult.error.message}`);
  }
  if (policiesResult.error) {
    throw new Error(`policy_lookup_failed: ${policiesResult.error.message}`);
  }
  if (documentsCountResult.error) {
    throw new Error(`document_count_failed: ${documentsCountResult.error.message}`);
  }
  if (documentsResult.error) {
    throw new Error(`document_lookup_failed: ${documentsResult.error.message}`);
  }

  const profile = profileResult.data ?? null;
  const health = healthResult.data ?? null;
  // Full active id set (preview list is capped — do not use it for prior_facts filter).
  const activeIdsForFilter = await loadActiveSourceDocumentIds(customerId, supabase);
  const policies = filterPoliciesToActiveSourceDocuments(
    policiesResult.data ?? [],
    activeIdsForFilter,
  );
  const documents = documentsResult.data ?? [];
  const documentCount = documentsCountResult.count ?? 0;
  const documentsPreviewCount = documents.length;
  const healthDetails = health?.details_json ?? {};

  return {
    profile,
    health,
    health_details: healthDetails,
    policies,
    documents,
    document_count: documentCount,
    documents_preview_count: documentsPreviewCount,
    flags: {
      has_profile: Boolean(
        profile?.display_name || profile?.birth_date || profile?.gender || profile?.job_category,
      ),
      has_health: Boolean(
        health &&
          (Object.keys(healthDetails).length > 0 ||
            health.source ||
            healthDetails.medication ||
            healthDetails.smoking_status),
      ),
      has_policies: policies.length > 0,
      has_documents: documentCount > 0,
    },
  };
}

export function buildUnifiedCustomerStateFromRecords(
  raw,
  memorySnapshot = null,
  { customerId, lastEvent = null } = {},
) {
  if (!raw) throw new Error("raw_records_required");
  if (!customerId) throw new Error("customer_id_required");

  const structuredMemory = memorySnapshot ? buildStructuredMemoryProfile(memorySnapshot) : null;
  const memoryVersion = memorySnapshot?.memory_version ?? raw.profile?.memory_version ?? 0;
  const policyIds = extractPolicyIds(raw.policies);
  const memorySyncAssessment = assessMemorySyncNeed(
    {
      has_profile: raw.flags.has_profile,
      has_health: raw.flags.has_health,
      has_policies: raw.flags.has_policies,
    },
    memorySnapshot,
  );
  const memoryStatus = resolveMemoryDisplayStatus({ syncAssessment: memorySyncAssessment });
  const activePolicyCount = raw.policies.length;

  return {
    contract_version: UNIFIED_STATE_VERSION,
    customer_id: customerId,
    memory_version: memoryVersion,
    state_hash: buildUnifiedStateHash({
      customerId,
      memoryVersion,
      policies: raw.policies,
      documents: raw.documents,
      documentCount: raw.document_count,
      health: raw.health,
      profile: raw.profile,
    }),
    loaded_at: new Date().toISOString(),
    last_event: lastEvent,
    profile: raw.profile,
    health: raw.health,
    health_details: raw.health_details,
    policies: raw.policies,
    active_policy_count: activePolicyCount,
    policy_count: activePolicyCount,
    policy_ids: policyIds,
    documents: raw.documents,
    document_count: raw.document_count,
    documents_preview_count: raw.documents_preview_count,
    snapshot: memorySnapshot,
    structured_memory: structuredMemory,
    memory_fact_count: memorySnapshot?.fact_count ?? 0,
    insurance_policy_count_fact: getInsurancePolicyCountFact(memorySnapshot),
    memory_status: memoryStatus,
    memory_sync_assessment: memorySyncAssessment,
    provenance: buildUnifiedProvenance({
      policies: raw.policies,
      activePolicyCount,
      documents: raw.documents,
      documentCount: raw.document_count,
      documentsPreviewCount: raw.documents_preview_count,
      snapshot: memorySnapshot,
    }),
    flags: raw.flags,
  };
}

export async function loadUnifiedCustomerState(
  supabase,
  customerId,
  { includeSnapshot = true, lastEvent = null } = {},
) {
  const raw = await loadRawCustomerRecords(supabase, customerId);
  const snapshot = includeSnapshot ? await loadCustomerMemorySnapshot(supabase, customerId) : null;
  return buildUnifiedCustomerStateFromRecords(raw, snapshot, { customerId, lastEvent });
}

export function toSourceContext(unifiedState) {
  if (!unifiedState) return null;
  return {
    customer_id: unifiedState.customer_id,
    has_profile: unifiedState.flags?.has_profile ?? false,
    has_health: unifiedState.flags?.has_health ?? false,
    has_policies: unifiedState.flags?.has_policies ?? false,
    has_documents: unifiedState.flags?.has_documents ?? false,
    profile: unifiedState.profile ?? null,
    health: unifiedState.health ?? null,
    policies: unifiedState.policies ?? [],
    documents: unifiedState.documents ?? [],
    health_details: unifiedState.health_details ?? {},
  };
}

export function buildSourceSummaryFromUnifiedState(unifiedState) {
  const profile = unifiedState?.profile ?? {};
  const health = unifiedState?.health_details ?? {};
  const policies = unifiedState?.policies ?? [];
  const activePolicyCount =
    unifiedState?.active_policy_count ?? unifiedState?.policy_count ?? null;

  return {
    profile: {
      name: profile.display_name ?? null,
      birth_date: profile.birth_date ?? null,
      gender: profile.gender ?? null,
      occupation: profile.job_category ?? null,
      marital_status: profile.marital_status ?? null,
      family_composition: profile.family_composition ?? null,
      insurance_goal: profile.insurance_goal ?? null,
      monthly_budget: profile.monthly_insurance_budget ?? null,
    },
    health: {
      medication: health.medication ?? health.medications ?? null,
      smoking_status: health.smoking_status ?? health.smoking ?? null,
      surgery_history: health.surgery_history ?? health.surgery_5y ?? null,
      hospitalization_history: health.hospitalization_history ?? health.hospital_5y ?? null,
      family_history: health.family_history ?? null,
    },
    insurance: policies.map((policy) => ({
      id: policy.id,
      insurer: policy.insurer_name,
      product: policy.product_name,
      type: policy.policy_type,
      coverage_summary: policy.coverage_summary,
      is_active: policy.is_active,
      source: policy.source ?? null,
      monthly_premium: resolvePolicyPremium(policy),
      premium_amount: policy.premium_amount ?? null,
      extractor_origin: policy.coverage_summary?.extractor_origin ?? null,
      is_coverage_sheet_bridge: isCoverageSheetBridgePolicy(policy),
    })),
    documents: (unifiedState?.documents ?? []).slice(0, 3).map((doc) => ({
      id: doc.id,
      type: doc.doc_class,
      status: doc.ingest_status,
      filename: doc.original_filename,
    })),
    policy_count: activePolicyCount,
    active_policy_count: activePolicyCount,
    memory_version: unifiedState?.memory_version ?? 0,
    state_hash: unifiedState?.state_hash ?? null,
  };
}

export function buildDashboardPolicyView(unifiedState) {
  const policies = unifiedState?.policies ?? [];
  const activePolicyCount =
    unifiedState?.active_policy_count ?? unifiedState?.policy_count ?? null;
  return {
    insurancePolicies: policies,
    insurancePolicyCount: activePolicyCount,
    insurancePolicyIds: extractPolicyIds(policies),
    insurancePolicy: policies[0] ?? null,
    memoryVersion: unifiedState?.memory_version ?? 0,
    stateHash: unifiedState?.state_hash ?? null,
  };
}
