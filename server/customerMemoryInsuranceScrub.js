/**
 * I-5 — After document soft-delete / policy retire: drop document-derived
 * insurance.* memory so KEY/Claude/RAG cannot reinject deleted-doc facts.
 * Writes require service_role (customer JWT is read-only on customer_memory_facts).
 */

export const INSURANCE_AGGREGATE_FACT_KEYS = Object.freeze([
  "insurance.policy.count",
  "insurance.indemnity.held",
  "insurance.policies.active_summary",
  "insurance.carrier_product.summary",
]);

const POLICY_KEYED_RE =
  /^insurance\.policy\.([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})\.(summary|riders)$/;

function isPresent(value) {
  if (value == null) return false;
  const trimmed = String(value).trim();
  if (!trimmed) return false;
  const lower = trimmed.toLowerCase();
  return !["unknown", "없음", "모름", "n/a", "-"].includes(lower);
}

function truncate(value, maxLength) {
  const trimmed = String(value ?? "").trim();
  if (trimmed.length <= maxLength) return trimmed;
  return `${trimmed.slice(0, maxLength - 1)}…`;
}

function isIndemnityPolicyType(policyType) {
  if (!isPresent(policyType)) return false;
  const normalized = String(policyType).trim().toLowerCase();
  return (
    normalized === "indemnity" ||
    normalized === "indemnity_medical" ||
    normalized.includes("실손")
  );
}

export function policyKeyedInsuranceFactKeys(policyId) {
  const id = String(policyId ?? "").trim();
  if (!id) return [];
  return [`insurance.policy.${id}.summary`, `insurance.policy.${id}.riders`];
}

export function parsePolicyIdFromInsuranceFactKey(factKey) {
  const match = String(factKey ?? "").trim().match(POLICY_KEYED_RE);
  return match?.[1] ?? null;
}

export async function supersedeActiveFactKeys(supabase, customerId, factKeys) {
  const cid = String(customerId ?? "").trim();
  const keys = [...new Set((Array.isArray(factKeys) ? factKeys : []).map((k) => String(k).trim()).filter(Boolean))];
  if (!supabase || !cid || keys.length === 0) {
    return { superseded_count: 0, fact_keys: [] };
  }

  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from("customer_memory_facts")
    .update({ superseded_at: now })
    .eq("customer_id", cid)
    .is("superseded_at", null)
    .in("fact_key", keys)
    .select("id, fact_key");

  if (error) {
    throw new Error(`insurance_memory_supersede_failed: ${error.message}`);
  }

  const rows = Array.isArray(data) ? data : [];
  return {
    superseded_count: rows.length,
    fact_keys: rows.map((row) => row.fact_key),
  };
}

async function loadActiveInsurancePolicies(supabase, customerId) {
  const { data, error } = await supabase
    .from("active_profile_insurance_policies")
    .select("id, insurer_name, product_name, policy_type, monthly_premium, effective_from, coverage_summary, is_active")
    .eq("customer_id", customerId);

  if (error) {
    throw new Error(`active_policies_load_failed: ${error.message}`);
  }
  return Array.isArray(data) ? data : [];
}

async function listActivePolicyKeyedFactKeys(supabase, customerId) {
  const { data, error } = await supabase
    .from("customer_memory_facts")
    .select("fact_key")
    .eq("customer_id", customerId)
    .is("superseded_at", null)
    .like("fact_key", "insurance.policy.%");

  if (error) {
    throw new Error(`insurance_keyed_facts_load_failed: ${error.message}`);
  }
  return (Array.isArray(data) ? data : []).map((row) => String(row.fact_key ?? "").trim()).filter(Boolean);
}

function summarizeActivePolicies(policies) {
  if (!policies.length) return null;
  const parts = policies.slice(0, 5).map((policy) => {
    const insurer = isPresent(policy.insurer_name) ? String(policy.insurer_name) : "보험사 미기재";
    const product = isPresent(policy.product_name) ? String(policy.product_name) : "상품 미기재";
    const typeLabel = isPresent(policy.policy_type) ? String(policy.policy_type) : "유형 미기재";
    return `${insurer}/${product}(${typeLabel})`;
  });
  return truncate(parts.join("; "), 200);
}

function summarizeCarrierProducts(policies) {
  const structured = policies
    .filter((policy) => isPresent(policy.insurer_name) && isPresent(policy.product_name))
    .map((policy) => `${policy.insurer_name}:${policy.product_name}`);
  if (structured.length === 0) return null;
  return truncate(structured.slice(0, 5).join("; "), 200);
}

async function upsertInsuranceFact(supabase, candidate) {
  const { data: existing, error: existingError } = await supabase
    .from("customer_memory_facts")
    .select("id, fact_value")
    .eq("customer_id", candidate.customer_id)
    .eq("fact_key", candidate.fact_key)
    .is("superseded_at", null)
    .maybeSingle();

  if (existingError) {
    throw new Error(`fact_lookup_failed:${candidate.fact_key}: ${existingError.message}`);
  }

  if (existing && existing.fact_value === candidate.fact_value) {
    return { action: "no_op", fact_key: candidate.fact_key };
  }

  if (existing) {
    const { error: supersedeError } = await supabase
      .from("customer_memory_facts")
      .update({ superseded_at: new Date().toISOString() })
      .eq("id", existing.id);
    if (supersedeError) {
      throw new Error(`fact_supersede_failed:${candidate.fact_key}: ${supersedeError.message}`);
    }
  }

  const { error: insertError } = await supabase.from("customer_memory_facts").insert({
    customer_id: candidate.customer_id,
    fact_key: candidate.fact_key,
    fact_value: candidate.fact_value,
    confidence: 1.0,
    provenance_type: "profile",
    provenance_ref: candidate.source_record_id,
    fact_type: "insurance",
    importance: candidate.importance,
    source_table: "profile_insurance_policies",
    metadata_json: {
      extractor_scope: "insurance_memory_scrub",
      source_table: "profile_insurance_policies",
      source_record_id: candidate.source_record_id,
      field: candidate.field,
      no_llm_generated: true,
    },
  });

  if (insertError) {
    throw new Error(`fact_insert_failed:${candidate.fact_key}: ${insertError.message}`);
  }

  return {
    action: existing ? "superseded_and_inserted" : "inserted",
    fact_key: candidate.fact_key,
  };
}

async function refreshInsuranceAggregateFacts(supabase, customerId, policies) {
  const sourceRecordId = policies[0]?.id ?? customerId;

  if (policies.length === 0) {
    return supersedeActiveFactKeys(supabase, customerId, INSURANCE_AGGREGATE_FACT_KEYS);
  }

  const candidates = [
    {
      customer_id: customerId,
      fact_key: "insurance.policy.count",
      fact_value: String(policies.length),
      importance: "medium",
      source_record_id: sourceRecordId,
      field: "maintained_policy_count",
    },
  ];

  const indemnity = policies.filter((policy) => isIndemnityPolicyType(policy.policy_type));
  if (indemnity.length > 0) {
    candidates.push({
      customer_id: customerId,
      fact_key: "insurance.indemnity.held",
      fact_value: "yes",
      importance: "high",
      source_record_id: indemnity[0].id,
      field: "policy_type",
    });
  } else {
    await supersedeActiveFactKeys(supabase, customerId, ["insurance.indemnity.held"]);
  }

  const activeSummary = summarizeActivePolicies(policies);
  if (activeSummary) {
    candidates.push({
      customer_id: customerId,
      fact_key: "insurance.policies.active_summary",
      fact_value: activeSummary,
      importance: "medium",
      source_record_id: sourceRecordId,
      field: "active_policies_summary",
    });
  }

  const carrierSummary = summarizeCarrierProducts(policies);
  if (carrierSummary) {
    candidates.push({
      customer_id: customerId,
      fact_key: "insurance.carrier_product.summary",
      fact_value: carrierSummary,
      importance: "medium",
      source_record_id: sourceRecordId,
      field: "carrier_product_summary",
    });
  }

  let changed = 0;
  const factKeys = [];
  for (const candidate of candidates) {
    const result = await upsertInsuranceFact(supabase, candidate);
    if (result.action !== "no_op") changed += 1;
    factKeys.push(result.fact_key);
  }

  return { superseded_count: changed, fact_keys: factKeys, upserted: true };
}

async function bumpMemoryVersionIfNeeded(supabase, customerId, changed) {
  if (!changed) return null;
  const { data: profile, error } = await supabase
    .from("customer_profiles")
    .select("memory_version")
    .eq("id", customerId)
    .is("deleted_at", null)
    .maybeSingle();
  if (error || !profile) {
    throw new Error(`memory_version_lookup_failed: ${error?.message ?? "not_found"}`);
  }
  const nextVersion = (profile.memory_version ?? 0) + 1;
  const { error: updateError } = await supabase
    .from("customer_profiles")
    .update({ memory_version: nextVersion })
    .eq("id", customerId);
  if (updateError) {
    throw new Error(`memory_version_update_failed: ${updateError.message}`);
  }
  return nextVersion;
}

/**
 * Immediate scrub after soft-delete policy retire.
 * - supersede retired policy keyed summary/riders
 * - supersede any other orphan policy-keyed insurance facts
 * - refresh aggregate 4 keys from active policies (or supersede when none)
 */
export async function scrubInsuranceMemoryAfterPolicyRetire({
  supabase,
  customerId,
  retiredPolicyIds = [],
} = {}) {
  if (!supabase) throw new Error("supabase_required");
  const cid = String(customerId ?? "").trim();
  if (!cid) throw new Error("customer_id_required");

  const retiredIds = [
    ...new Set(
      (Array.isArray(retiredPolicyIds) ? retiredPolicyIds : [])
        .map((id) => String(id ?? "").trim())
        .filter(Boolean),
    ),
  ];

  const retiredKeys = retiredIds.flatMap((id) => policyKeyedInsuranceFactKeys(id));
  const retiredSupersede = await supersedeActiveFactKeys(supabase, cid, retiredKeys);

  const policies = await loadActiveInsurancePolicies(supabase, cid);
  const activeIds = new Set(policies.map((row) => String(row.id)));

  const keyedKeys = await listActivePolicyKeyedFactKeys(supabase, cid);
  const orphanKeys = keyedKeys.filter((factKey) => {
    const policyId = parsePolicyIdFromInsuranceFactKey(factKey);
    return policyId && !activeIds.has(policyId);
  });
  const orphanSupersede = await supersedeActiveFactKeys(supabase, cid, orphanKeys);

  const aggregateRefresh = await refreshInsuranceAggregateFacts(supabase, cid, policies);

  const changed =
    (retiredSupersede.superseded_count ?? 0) +
      (orphanSupersede.superseded_count ?? 0) +
      (aggregateRefresh.superseded_count ?? 0) >
    0;

  const memoryVersion = await bumpMemoryVersionIfNeeded(supabase, cid, changed);

  return {
    ok: true,
    retired_policy_ids: retiredIds,
    retired_keyed_superseded: retiredSupersede.superseded_count,
    orphan_keyed_superseded: orphanSupersede.superseded_count,
    aggregate_refresh: aggregateRefresh,
    memory_version: memoryVersion,
    active_policy_count: policies.length,
  };
}

/**
 * Rebuild safety net: drop policy-keyed insurance facts whose policy is not active,
 * and drop aggregate keys absent from the current insurance candidate set.
 */
export async function scrubOrphanInsuranceMemoryAfterRebuild({
  supabase,
  customerId,
  insuranceCandidateFactKeys = [],
  insuranceSkipped = false,
} = {}) {
  if (!supabase) throw new Error("supabase_required");
  const cid = String(customerId ?? "").trim();
  if (!cid) throw new Error("customer_id_required");
  if (insuranceSkipped) {
    return { ok: true, skipped: true, reason: "insurance_extractor_skipped" };
  }

  const policies = await loadActiveInsurancePolicies(supabase, cid);
  const activeIds = new Set(policies.map((row) => String(row.id)));
  const keyedKeys = await listActivePolicyKeyedFactKeys(supabase, cid);
  const orphanKeys = keyedKeys.filter((factKey) => {
    const policyId = parsePolicyIdFromInsuranceFactKey(factKey);
    return policyId && !activeIds.has(policyId);
  });
  const orphanSupersede = await supersedeActiveFactKeys(supabase, cid, orphanKeys);

  const present = new Set(
    (Array.isArray(insuranceCandidateFactKeys) ? insuranceCandidateFactKeys : []).map((k) =>
      String(k).trim(),
    ),
  );
  const absentAggregates = INSURANCE_AGGREGATE_FACT_KEYS.filter((key) => !present.has(key));
  const aggregateSupersede = await supersedeActiveFactKeys(supabase, cid, absentAggregates);

  const changed =
    (orphanSupersede.superseded_count ?? 0) + (aggregateSupersede.superseded_count ?? 0) > 0;
  const memoryVersion = await bumpMemoryVersionIfNeeded(supabase, cid, changed);

  return {
    ok: true,
    skipped: false,
    orphan_keyed_superseded: orphanSupersede.superseded_count,
    aggregate_superseded: aggregateSupersede.superseded_count,
    memory_version: memoryVersion,
    active_policy_count: policies.length,
  };
}
