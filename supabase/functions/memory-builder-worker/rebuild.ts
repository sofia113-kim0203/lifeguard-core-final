import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { buildConsentSnapshot } from "./consent.ts";
import {
  applyCandidateFacts,
  incrementMemoryVersion,
  parsePolicyIdFromInsuranceFactKey,
  summarizeFactActions,
  supersedeOrphanInsuranceMemoryFacts,
} from "./facts.ts";
import { extractConversationFacts } from "./extract-conversation.ts";
import { extractCustomerConversationFacts } from "./extract-customer-conversation.ts";
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
  const { results, changedCount, memoryVersion: versionAfterUpsert } = await applyFactsAndVersion(
    admin,
    customerId,
    candidates,
  );

  // I-5: retire/orphan policy-keyed insurance facts + absent aggregates must not linger.
  let orphanCleanup: {
    orphan_keyed_superseded: number;
    aggregate_superseded: number;
    fact_keys: string[];
  } | null = null;
  let memoryVersion = versionAfterUpsert;
  let factsChanged = changedCount;

  if (!insurance.skipped) {
    const { data: activePolicyRows, error: activePolicyError } = await admin
      .from("active_profile_insurance_policies")
      .select("id")
      .eq("customer_id", customerId);
    if (activePolicyError) {
      throw new Error(`active_policies_load_failed: ${activePolicyError.message}`);
    }
    const activePolicyIds = (Array.isArray(activePolicyRows) ? activePolicyRows : [])
      .map((row) => String(row.id ?? "").trim())
      .filter(Boolean);
    // Also accept policy ids referenced by this extract (belt for view lag).
    for (const fact of insurance.facts) {
      const fromKey = parsePolicyIdFromInsuranceFactKey(fact.fact_key);
      if (fromKey) activePolicyIds.push(fromKey);
    }

    orphanCleanup = await supersedeOrphanInsuranceMemoryFacts(admin, customerId, {
      activePolicyIds,
      presentCandidateKeys: insurance.facts.map((fact) => fact.fact_key),
    });

    const orphanChanged =
      (orphanCleanup.orphan_keyed_superseded ?? 0) + (orphanCleanup.aggregate_superseded ?? 0);
    if (orphanChanged > 0) {
      factsChanged += orphanChanged;
      if (changedCount === 0) {
        memoryVersion = await incrementMemoryVersion(admin, customerId);
      } else {
        memoryVersion = versionAfterUpsert;
      }
    }
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
    facts_changed: factsChanged,
    memory_version: memoryVersion,
    fact_keys: results.map((result) => result.fact_key),
    orphan_insurance_cleanup: orphanCleanup,
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


export async function runCustomerConversationMemoryExtract(
  admin: SupabaseClient,
  customerId: string,
): Promise<ExtractRebuildResult> {
  const consentSnapshot = await buildConsentSnapshot(admin, customerId);
  const conversation = await extractCustomerConversationFacts(admin, customerId);

  const { results, changedCount, memoryVersion } = await applyFactsAndVersion(
    admin,
    customerId,
    conversation.facts,
  );

  return {
    consent_snapshot: consentSnapshot,
    extractors: {
      customer_conversation: {
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
