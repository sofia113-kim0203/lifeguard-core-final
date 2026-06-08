import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { buildConsentSnapshot } from "./consent.ts";
import { applyCandidateFacts, incrementMemoryVersion, summarizeFactActions } from "./facts.ts";
import { extractHealthFacts } from "./extract-health.ts";
import { extractInsuranceFacts } from "./extract-insurance.ts";
import { extractProfileFacts } from "./extract-profile.ts";
import type { ExtractRebuildResult } from "./types.ts";

export async function runProfileHealthPolicyExtract(
  admin: SupabaseClient,
  customerId: string,
): Promise<ExtractRebuildResult> {
  const consentSnapshot = await buildConsentSnapshot(admin, customerId);

  const profile = await extractProfileFacts(admin, customerId);
  const health = await extractHealthFacts(admin, customerId);
  const insurance = await extractInsuranceFacts(admin, customerId);

  const candidates = [...profile.facts, ...health.facts, ...insurance.facts];
  const { results, changed_count: changedCount } = await applyCandidateFacts(admin, candidates);

  let memoryVersion: number | null = null;
  if (changedCount > 0) {
    memoryVersion = await incrementMemoryVersion(admin, customerId);
  } else {
    const { data: profileRow } = await admin
      .from("customer_profiles")
      .select("memory_version")
      .eq("id", customerId)
      .maybeSingle();
    memoryVersion = profileRow?.memory_version ?? 0;
  }

  return {
    consent_snapshot: consentSnapshot,
    extractors: {
      profile: {
        skipped: profile.skipped,
        skip_reason: profile.skip_reason,
        candidate_count: profile.facts.length,
      },
      health: {
        skipped: health.skipped,
        skip_reason: health.skip_reason,
        candidate_count: health.facts.length,
      },
      insurance: {
        skipped: insurance.skipped,
        skip_reason: insurance.skip_reason,
        candidate_count: insurance.facts.length,
      },
    },
    fact_results: results,
    fact_action_summary: summarizeFactActions(results),
    facts_changed: changedCount,
    memory_version: memoryVersion,
    fact_keys: results.map((result) => result.fact_key),
  };
}
