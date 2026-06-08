import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import type { CandidateFact, FactUpsertAction, FactUpsertResult } from "./types.ts";

function metadataEquivalent(
  left: Record<string, unknown> | null | undefined,
  right: Record<string, unknown>,
): boolean {
  return JSON.stringify(left ?? {}) === JSON.stringify(right);
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
