/**
 * Phase 26 Step 2B — Ensure customer analysis/document data flows into AI consultation Memory.
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

export async function loadCustomerSourceContext(supabase, customerId) {
  const [profileResult, healthResult, policiesResult, documentsResult] = await Promise.all([
    supabase
      .from("customer_profiles")
      .select(
        "id, display_name, birth_date, gender, job_category, marital_status, family_composition, insurance_goal, monthly_insurance_budget, memory_version, status",
      )
      .eq("id", customerId)
      .is("deleted_at", null)
      .maybeSingle(),
    supabase
      .from("profile_health")
      .select("customer_id, source, details_json")
      .eq("customer_id", customerId)
      .maybeSingle(),
    supabase
      .from("profile_insurance_policies")
      .select("id, insurer_name, product_name, policy_type, coverage_summary, is_active, policy_status")
      .eq("customer_id", customerId)
      .is("deleted_at", null)
      .order("created_at", { ascending: false }),
    supabase
      .from("customer_documents")
      .select("id, doc_class, ingest_status, original_filename, created_at")
      .eq("customer_id", customerId)
      .order("created_at", { ascending: false })
      .limit(10),
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
    customer_id: customerId,
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
    profile,
    health,
    policies,
    documents,
    health_details: healthDetails,
  };
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
  const profile = sourceContext.profile ?? {};
  const health = sourceContext.health_details ?? {};
  const policies = sourceContext.policies ?? [];

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
    })),
    documents: (sourceContext.documents ?? []).slice(0, 3).map((doc) => ({
      type: doc.doc_class,
      status: doc.ingest_status,
      filename: doc.original_filename,
    })),
  };
}

export async function ensureCustomerMemoryContext({
  supabase,
  customerId,
  supabaseUrl = null,
  serviceRoleKey = null,
  forceRebuild = false,
} = {}) {
  const sourceContext = await loadCustomerSourceContext(supabase, customerId);
  let snapshot = await loadCustomerMemorySnapshot(supabase, customerId);
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
  const sourceSummary = buildSourceContextSummary(sourceContext);

  return {
    snapshot,
    structured,
    sourceContext,
    sourceSummary,
    memory_synced: memorySynced,
    sync_assessment: syncAssessment,
    rebuild_summary: rebuildSummary,
    data_available: {
      in_db: sourceContext.has_profile || sourceContext.has_health || sourceContext.has_policies,
      in_memory: (snapshot.fact_count ?? 0) > 0,
      in_prompt:
        (snapshot.fact_count ?? 0) > 0 ||
        sourceContext.has_profile ||
        sourceContext.has_health ||
        sourceContext.has_policies,
    },
  };
}
