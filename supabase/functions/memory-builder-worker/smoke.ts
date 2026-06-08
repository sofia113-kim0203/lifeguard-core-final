import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { SMOKE_FACT_KEY, SMOKE_FACT_VALUE, WORKER_PHASE } from "./config.ts";
import type { MemoryBuilderScope, SmokeFactResult } from "./types.ts";

function buildSmokeMetadata(params: {
  scope: MemoryBuilderScope;
  jobId: string | null;
}): Record<string, unknown> {
  return {
    phase: WORKER_PHASE,
    mode: "smoke",
    no_customer_data_extracted: true,
    scope: params.scope,
    ...(params.jobId ? { worker_job_id: params.jobId } : {}),
  };
}

function metadataEquivalent(
  left: Record<string, unknown> | null | undefined,
  right: Record<string, unknown>,
): boolean {
  const normalize = (metadata: Record<string, unknown> | null | undefined) =>
    Object.fromEntries(
      Object.entries(metadata ?? {})
        .filter(([key]) => key !== "worker_job_id")
        .sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey)),
    );

  return JSON.stringify(normalize(left)) === JSON.stringify(normalize(right));
}

export async function upsertSmokeFact(
  admin: SupabaseClient,
  params: {
    customerId: string;
    jobId: string | null;
    scope: MemoryBuilderScope;
  },
): Promise<SmokeFactResult> {
  const metadata = buildSmokeMetadata({
    scope: params.scope,
    jobId: params.jobId,
  });
  const sourceTable = params.jobId ? "worker_jobs" : "system";

  const { data: existing, error: existingError } = await admin
    .from("customer_memory_facts")
    .select("id, fact_value, metadata_json")
    .eq("customer_id", params.customerId)
    .eq("fact_key", SMOKE_FACT_KEY)
    .is("superseded_at", null)
    .maybeSingle();

  if (existingError) {
    throw new Error(`smoke_fact_lookup_failed: ${existingError.message}`);
  }

  if (
    existing &&
    existing.fact_value === SMOKE_FACT_VALUE &&
    metadataEquivalent(existing.metadata_json as Record<string, unknown>, metadata)
  ) {
    return {
      action: "no_op",
      fact_id: existing.id,
      fact_key: SMOKE_FACT_KEY,
    };
  }

  if (existing) {
    const { error: supersedeError } = await admin
      .from("customer_memory_facts")
      .update({ superseded_at: new Date().toISOString() })
      .eq("id", existing.id);

    if (supersedeError) {
      throw new Error(`smoke_fact_supersede_failed: ${supersedeError.message}`);
    }
  }

  const { data: inserted, error: insertError } = await admin
    .from("customer_memory_facts")
    .insert({
      customer_id: params.customerId,
      fact_key: SMOKE_FACT_KEY,
      fact_value: SMOKE_FACT_VALUE,
      confidence: 1.0,
      provenance_type: "system",
      provenance_ref: params.jobId,
      fact_type: "system",
      importance: "low",
      source_table: sourceTable,
      metadata_json: metadata,
    })
    .select("id")
    .single();

  if (insertError || !inserted) {
    throw new Error(`smoke_fact_insert_failed: ${insertError?.message ?? "unknown"}`);
  }

  return {
    action: existing ? "superseded_and_inserted" : "inserted",
    fact_id: inserted.id,
    fact_key: SMOKE_FACT_KEY,
  };
}
