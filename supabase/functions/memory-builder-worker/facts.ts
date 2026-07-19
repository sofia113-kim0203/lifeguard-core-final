import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import type { CandidateFact, FactUpsertAction, FactUpsertResult } from "./types.ts";

const RUNTIME_ONLY_METADATA_KEYS = new Set([
  "built_at",
  "extracted_at",
  "generated_at",
  "run_id",
  "worker_run_id",
]);

function normalizeMetadataValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => normalizeMetadataValue(entry));
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([key, entry]) => !RUNTIME_ONLY_METADATA_KEYS.has(key) && entry !== undefined)
        .sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey))
        .map(([key, entry]) => [key, normalizeMetadataValue(entry)]),
    );
  }

  return value;
}

function metadataEquivalent(
  left: Record<string, unknown> | null | undefined,
  right: Record<string, unknown>,
): boolean {
  return JSON.stringify(normalizeMetadataValue(left ?? {})) ===
    JSON.stringify(normalizeMetadataValue(right));
}

export async function upsertCandidateFact(
  admin: SupabaseClient,
  candidate: CandidateFact,
): Promise<FactUpsertResult> {
  const { data: existing, error: existingError } = await admin
    .from("customer_memory_facts")
    .select("id, fact_value, metadata_json")
    .eq("customer_id", candidate.customer_id)
    .eq("fact_key", candidate.fact_key)
    .is("superseded_at", null)
    .maybeSingle();

  if (existingError) {
    throw new Error(`fact_lookup_failed:${candidate.fact_key}: ${existingError.message}`);
  }

  if (
    existing &&
    existing.fact_value === candidate.fact_value &&
    metadataEquivalent(existing.metadata_json as Record<string, unknown>, candidate.metadata_json)
  ) {
    return {
      action: "no_op",
      fact_id: existing.id,
      fact_key: candidate.fact_key,
    };
  }

  if (existing) {
    const { error: supersedeError } = await admin
      .from("customer_memory_facts")
      .update({ superseded_at: new Date().toISOString() })
      .eq("id", existing.id);

    if (supersedeError) {
      throw new Error(`fact_supersede_failed:${candidate.fact_key}: ${supersedeError.message}`);
    }
  }

  const { data: inserted, error: insertError } = await admin
    .from("customer_memory_facts")
    .insert({
      customer_id: candidate.customer_id,
      fact_key: candidate.fact_key,
      fact_value: candidate.fact_value,
      confidence: candidate.confidence,
      provenance_type: "profile",
      provenance_ref: candidate.source_record_id,
      fact_type: candidate.fact_type,
      importance: candidate.importance,
      source_table: candidate.source_table,
      metadata_json: candidate.metadata_json,
    })
    .select("id")
    .single();

  if (insertError || !inserted) {
    throw new Error(
      `fact_insert_failed:${candidate.fact_key}: ${insertError?.message ?? "unknown"}`,
    );
  }

  return {
    action: existing ? "superseded_and_inserted" : "inserted",
    fact_id: inserted.id,
    fact_key: candidate.fact_key,
  };
}

export async function applyCandidateFacts(
  admin: SupabaseClient,
  candidates: CandidateFact[],
): Promise<{
  results: FactUpsertResult[];
  changed_count: number;
}> {
  const results: FactUpsertResult[] = [];
  let changedCount = 0;

  for (const candidate of candidates) {
    const result = await upsertCandidateFact(admin, candidate);
    results.push(result);
    if (result.action !== "no_op") {
      changedCount += 1;
    }
  }

  return { results, changed_count: changedCount };
}

export async function incrementMemoryVersion(
  admin: SupabaseClient,
  customerId: string,
): Promise<number | null> {
  const { data: profile, error: profileError } = await admin
    .from("customer_profiles")
    .select("memory_version")
    .eq("id", customerId)
    .is("deleted_at", null)
    .maybeSingle();

  if (profileError || !profile) {
    throw new Error(`memory_version_lookup_failed: ${profileError?.message ?? "not_found"}`);
  }

  const nextVersion = (profile.memory_version ?? 0) + 1;
  const { error: updateError } = await admin
    .from("customer_profiles")
    .update({ memory_version: nextVersion })
    .eq("id", customerId);

  if (updateError) {
    throw new Error(`memory_version_update_failed: ${updateError.message}`);
  }

  return nextVersion;
}

export function summarizeFactActions(results: FactUpsertResult[]): Record<FactUpsertAction, number> {
  const summary: Record<FactUpsertAction, number> = {
    inserted: 0,
    superseded_and_inserted: 0,
    no_op: 0,
  };

  for (const result of results) {
    summary[result.action] += 1;
  }

  return summary;
}

/** Aggregate insurance keys rewritten from active policies; absent ⇒ supersede. */
export const INSURANCE_AGGREGATE_FACT_KEYS = [
  "insurance.policy.count",
  "insurance.indemnity.held",
  "insurance.policies.active_summary",
  "insurance.carrier_product.summary",
] as const;

const POLICY_KEYED_INSURANCE_RE =
  /^insurance\.policy\.([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})\.(summary|riders)$/;

export function parsePolicyIdFromInsuranceFactKey(factKey: string): string | null {
  const match = String(factKey ?? "").trim().match(POLICY_KEYED_INSURANCE_RE);
  return match?.[1] ?? null;
}

export async function supersedeActiveFactKeys(
  admin: SupabaseClient,
  customerId: string,
  factKeys: string[],
): Promise<{ superseded_count: number; fact_keys: string[] }> {
  const keys = [...new Set(factKeys.map((key) => String(key).trim()).filter(Boolean))];
  if (keys.length === 0) {
    return { superseded_count: 0, fact_keys: [] };
  }

  const now = new Date().toISOString();
  const { data, error } = await admin
    .from("customer_memory_facts")
    .update({ superseded_at: now })
    .eq("customer_id", customerId)
    .is("superseded_at", null)
    .in("fact_key", keys)
    .select("id, fact_key");

  if (error) {
    throw new Error(`fact_supersede_keys_failed: ${error.message}`);
  }

  const rows = Array.isArray(data) ? data : [];
  return {
    superseded_count: rows.length,
    fact_keys: rows.map((row) => String(row.fact_key)),
  };
}

/**
 * I-5 — After insurance extract: supersede policy-keyed facts for retired/inactive
 * policies, and supersede aggregate keys missing from the new candidate set.
 */
export async function supersedeOrphanInsuranceMemoryFacts(
  admin: SupabaseClient,
  customerId: string,
  {
    activePolicyIds,
    presentCandidateKeys,
  }: {
    activePolicyIds: Iterable<string>;
    presentCandidateKeys: Iterable<string>;
  },
): Promise<{
  orphan_keyed_superseded: number;
  aggregate_superseded: number;
  fact_keys: string[];
}> {
  const active = new Set([...activePolicyIds].map((id) => String(id).trim()).filter(Boolean));
  const present = new Set([...presentCandidateKeys].map((key) => String(key).trim()).filter(Boolean));

  const { data: keyedRows, error: keyedError } = await admin
    .from("customer_memory_facts")
    .select("fact_key")
    .eq("customer_id", customerId)
    .is("superseded_at", null)
    .like("fact_key", "insurance.policy.%");

  if (keyedError) {
    throw new Error(`orphan_insurance_facts_load_failed: ${keyedError.message}`);
  }

  const orphanKeys = (Array.isArray(keyedRows) ? keyedRows : [])
    .map((row) => String(row.fact_key ?? "").trim())
    .filter((factKey) => {
      const policyId = parsePolicyIdFromInsuranceFactKey(factKey);
      return Boolean(policyId && !active.has(policyId));
    });

  const absentAggregates = INSURANCE_AGGREGATE_FACT_KEYS.filter((key) => !present.has(key));

  const orphanResult = await supersedeActiveFactKeys(admin, customerId, orphanKeys);
  const aggregateResult = await supersedeActiveFactKeys(admin, customerId, [...absentAggregates]);

  return {
    orphan_keyed_superseded: orphanResult.superseded_count,
    aggregate_superseded: aggregateResult.superseded_count,
    fact_keys: [...orphanResult.fact_keys, ...aggregateResult.fact_keys],
  };
}
