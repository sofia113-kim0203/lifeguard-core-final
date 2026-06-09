/**
 * Phase 28 Step 1A — Single customer state contract for all engines and UI loaders.
 */
import {
  buildStructuredMemoryProfile,
  loadCustomerMemorySnapshot,
} from "./customerMemorySnapshot.js";

export const UNIFIED_STATE_VERSION = "phase28-1a";

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
  health = null,
  profile = null,
} = {}) {
  const payload = {
    customer_id: customerId,
    memory_version: memoryVersion,
    policy_ids: extractPolicyIds(policies),
    document_ids: (documents ?? []).map((doc) => String(doc.id)).sort(),
    profile_updated_at: profile?.updated_at ?? profile?.memory_version ?? null,
    health_source: health?.source ?? null,
  };
  return hashString(stableSerialize(payload));
}

export function buildUnifiedProvenance({ policies = [], documents = [], snapshot = null } = {}) {
  return {
    policies: {
      source_table: "profile_insurance_policies",
      count: policies.length,
      ids: extractPolicyIds(policies),
    },
    documents: {
      source_table: "customer_documents",
      count: documents.length,
      ids: (documents ?? []).map((doc) => String(doc.id)).sort(),
    },
    memory: {
      source_table: "customer_memory_facts",
      memory_version: snapshot?.memory_version ?? 0,
      fact_count: snapshot?.fact_count ?? 0,
      insurance_policy_count_fact: getInsurancePolicyCountFact(snapshot),
    },
  };
}

export async function loadRawCustomerRecords(supabase, customerId) {
  if (!supabase) throw new Error("supabase_required");
  if (!customerId) throw new Error("customer_id_required");

  const [profileResult, healthResult, policiesResult, documentsResult] = await Promise.all([
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
      .from("profile_insurance_policies")
      .select(POLICY_LIST_SELECT)
      .eq("customer_id", customerId)
      .is("deleted_at", null)
      .order("created_at", { ascending: false }),
    supabase
      .from("customer_documents")
      .select(DOCUMENT_LIST_SELECT)
      .eq("customer_id", customerId)
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(20),
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
  if (documentsResult.error) {
    throw new Error(`document_lookup_failed: ${documentsResult.error.message}`);
  }

  const profile = profileResult.data ?? null;
  const health = healthResult.data ?? null;
  const policies = policiesResult.data ?? [];
  const documents = documentsResult.data ?? [];
  const healthDetails = health?.details_json ?? {};

  return {
    profile,
    health,
    health_details: healthDetails,
    policies,
    documents,
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
      has_documents: documents.length > 0,
    },
  };
}

export async function loadUnifiedCustomerState(
  supabase,
  customerId,
  { includeSnapshot = true, lastEvent = null } = {},
) {
  const raw = await loadRawCustomerRecords(supabase, customerId);
  const snapshot = includeSnapshot ? await loadCustomerMemorySnapshot(supabase, customerId) : null;
  const structuredMemory = snapshot ? buildStructuredMemoryProfile(snapshot) : null;
  const memoryVersion = snapshot?.memory_version ?? raw.profile?.memory_version ?? 0;
  const policyIds = extractPolicyIds(raw.policies);

  const state = {
    contract_version: UNIFIED_STATE_VERSION,
    customer_id: customerId,
    memory_version: memoryVersion,
    state_hash: buildUnifiedStateHash({
      customerId,
      memoryVersion,
      policies: raw.policies,
      documents: raw.documents,
      health: raw.health,
      profile: raw.profile,
    }),
    loaded_at: new Date().toISOString(),
    last_event: lastEvent,
    profile: raw.profile,
    health: raw.health,
    health_details: raw.health_details,
    policies: raw.policies,
    policy_count: raw.policies.length,
    policy_ids: policyIds,
    documents: raw.documents,
    document_count: raw.documents.length,
    snapshot,
    structured_memory: structuredMemory,
    memory_fact_count: snapshot?.fact_count ?? 0,
    insurance_policy_count_fact: getInsurancePolicyCountFact(snapshot),
    provenance: buildUnifiedProvenance({
      policies: raw.policies,
      documents: raw.documents,
      snapshot,
    }),
    flags: raw.flags,
  };

  return state;
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
    })),
    documents: (unifiedState?.documents ?? []).slice(0, 3).map((doc) => ({
      id: doc.id,
      type: doc.doc_class,
      status: doc.ingest_status,
      filename: doc.original_filename,
    })),
    policy_count: policies.length,
    memory_version: unifiedState?.memory_version ?? 0,
    state_hash: unifiedState?.state_hash ?? null,
  };
}

export function buildDashboardPolicyView(unifiedState) {
  const policies = unifiedState?.policies ?? [];
  return {
    insurancePolicies: policies,
    insurancePolicyCount: policies.length,
    insurancePolicyIds: extractPolicyIds(policies),
    insurancePolicy: policies[0] ?? null,
    memoryVersion: unifiedState?.memory_version ?? 0,
    stateHash: unifiedState?.state_hash ?? null,
  };
}
