import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { buildConsentSnapshot } from "./consent.ts";
import { applyCandidateFacts, incrementMemoryVersion, summarizeFactActions } from "./facts.ts";
import { extractConversationFacts } from "./extract-conversation.ts";
import { extractHealthFacts } from "./extract-health.ts";
import { extractInsuranceFacts } from "./extract-insurance.ts";
import { extractProfileFacts } from "./extract-profile.ts";
import type { ExtractRebuildResult } from "./types.ts";

async function currentMemoryVersion(admin: SupabaseClient, customerId: string): Promise<number> {
  const { data: profileRow } = await admin
    .from("customer_profiles")
    .select("memory_version")
    .eq("id", customerId)
    .maybeSingle();
  return profileRow?.memory_version ?? 0;
}

async function applyFactsAndVersion(
  admin: SupabaseClient,
  customerId: string,
  candidates: Parameters<typeof applyCandidateFacts>[1],
): Promise<{
  results: Awaited<ReturnType<typeof applyCandidateFacts>>["results"];
  changedCount: number;
  memoryVersion: number | null;
}> {
  const { results, changed_count: changedCount } = await applyCandidateFacts(admin, candidates);
  const memoryVersion = changedCount > 0
    ? await incrementMemoryVersion(admin, customerId)
    : await currentMemoryVersion(admin, customerId);

  return { results, changedCount, memoryVersion };
}

export async function runProfileHealthPolicyExtract(
  admin: SupabaseClient,
  customerId: string,
): Promise<ExtractRebuildResult> {
  const consentSnapshot = await buildConsentSnapshot(admin, customerId);

  const profile = await extractProfileFacts(admin, customerId);
  const health = await extractHealthFacts(admin, customerId);
  const insurance = await extractInsuranceFacts(admin, customerId);

  const candidates = [...profile.facts, ...health.facts, ...insurance.facts];
  const { results, changedCount, memoryVersion } = await applyFactsAndVersion(
    admin,
    customerId,
    candidates,
  );

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

export async function runConversationMemoryExtract(
  admin: SupabaseClient,
  customerId: string,
): Promise<ExtractRebuildResult> {
  const consentSnapshot = await buildConsentSnapshot(admin, customerId);
  const conversation = await extractConversationFacts(admin, customerId);

  const { results, changedCount, memoryVersion } = await applyFactsAndVersion(
    admin,
    customerId,
    conversation.facts,
  );

  return {
    consent_snapshot: consentSnapshot,
    extractors: {
      conversation: {
        skipped: conversation.skipped,
        skip_reason: conversation.skip_reason,
        candidate_count: conversation.facts.length,
      },
    },
    fact_results: results,
    fact_action_summary: summarizeFactActions(results),
    facts_changed: changedCount,
    memory_version: memoryVersion,
    fact_keys: results.map((result) => result.fact_key),
  };
}
