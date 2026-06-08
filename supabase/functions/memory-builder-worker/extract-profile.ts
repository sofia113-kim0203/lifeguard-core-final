import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { checkSourceConsent } from "./consent.ts";
import { EXTRACTOR_VERSION } from "./config.ts";
import type { CandidateFact } from "./types.ts";
import { computeAgeBand, isPresent, truncate } from "./utils.ts";

type ProfileRow = {
  id: string;
  display_name: string | null;
  birth_date: string | null;
  gender: string | null;
  job_category: string | null;
  marital_status: string | null;
  family_composition: string | null;
  insurance_goal: string | null;
  monthly_insurance_budget: number | null;
  updated_at: string;
};

function buildMetadata(params: {
  consentType: string;
  consentGranted: boolean;
  sourceRecordId: string;
}): Record<string, unknown> {
  return {
    consent_type: params.consentType,
    consent_granted: params.consentGranted,
    extractor_version: EXTRACTOR_VERSION,
    source_table: "customer_profiles",
    source_record_id: params.sourceRecordId,
    no_llm_generated: true,
  };
}

export async function extractProfileFacts(
  admin: SupabaseClient,
  customerId: string,
): Promise<{ facts: CandidateFact[]; skipped: boolean; skip_reason?: string }> {
  const consent = await checkSourceConsent(admin, customerId, "customer_profiles");
  if (!consent.consent_granted) {
    return {
      facts: [],
      skipped: true,
      skip_reason: `consent_missing:${consent.consent_type}`,
    };
  }

  const { data: row, error } = await admin
    .from("customer_profiles")
    .select("id, display_name, birth_date, gender, job_category, marital_status, family_composition, insurance_goal, monthly_insurance_budget, updated_at")
    .eq("id", customerId)
    .is("deleted_at", null)
    .maybeSingle();

  if (error) {
    throw new Error(`profile_load_failed: ${error.message}`);
  }

  if (!row) {
    return { facts: [], skipped: false };
  }

  const profile = row as ProfileRow;
  const facts: CandidateFact[] = [];
  const metadataBase = buildMetadata({
    consentType: consent.consent_type,
    consentGranted: consent.consent_granted,
    sourceRecordId: profile.id,
  });

  if (isPresent(profile.display_name)) {
    facts.push({
      customer_id: customerId,
      fact_key: "profile.name",
      fact_value: truncate(String(profile.display_name), 80),
      fact_type: "identity",
      importance: "low",
      source_table: "customer_profiles",
      source_record_id: profile.id,
      confidence: 1.0,
      metadata_json: { ...metadataBase, field: "display_name" },
    });
  }

  if (isPresent(profile.birth_date)) {
    const ageBand = computeAgeBand(String(profile.birth_date));
    if (ageBand) {
      facts.push({
        customer_id: customerId,
        fact_key: "profile.age_band",
        fact_value: ageBand,
        fact_type: "identity",
        importance: "medium",
        source_table: "customer_profiles",
        source_record_id: profile.id,
        confidence: 1.0,
        metadata_json: { ...metadataBase, field: "birth_date" },
      });
    }
  }

  if (isPresent(profile.gender)) {
    facts.push({
      customer_id: customerId,
      fact_key: "profile.gender",
      fact_value: truncate(String(profile.gender), 40),
      fact_type: "identity",
      importance: "low",
      source_table: "customer_profiles",
      source_record_id: profile.id,
      confidence: 1.0,
      metadata_json: { ...metadataBase, field: "gender" },
    });
  }

  if (isPresent(profile.job_category)) {
    facts.push({
      customer_id: customerId,
      fact_key: "profile.occupation",
      fact_value: truncate(String(profile.job_category), 80),
      fact_type: "identity",
      importance: "medium",
      source_table: "customer_profiles",
      source_record_id: profile.id,
      confidence: 1.0,
      metadata_json: { ...metadataBase, field: "job_category" },
    });
  }


  if (isPresent(profile.marital_status)) {
    facts.push({
      customer_id: customerId,
      fact_key: "profile.marital_status",
      fact_value: truncate(String(profile.marital_status), 40),
      fact_type: "identity",
      importance: "medium",
      source_table: "customer_profiles",
      source_record_id: profile.id,
      confidence: 1.0,
      metadata_json: { ...metadataBase, field: "marital_status" },
    });
  }

  if (isPresent(profile.family_composition)) {
    facts.push({
      customer_id: customerId,
      fact_key: "family.composition.summary",
      fact_value: truncate(String(profile.family_composition), 120),
      fact_type: "family",
      importance: "medium",
      source_table: "customer_profiles",
      source_record_id: profile.id,
      confidence: 1.0,
      metadata_json: { ...metadataBase, field: "family_composition" },
    });
  }

  if (isPresent(profile.insurance_goal)) {
    facts.push({
      customer_id: customerId,
      fact_key: "preference.insurance_goal",
      fact_value: truncate(String(profile.insurance_goal), 120),
      fact_type: "preference",
      importance: "high",
      source_table: "customer_profiles",
      source_record_id: profile.id,
      confidence: 1.0,
      metadata_json: { ...metadataBase, field: "insurance_goal" },
    });
  }

  if (profile.monthly_insurance_budget != null && Number(profile.monthly_insurance_budget) > 0) {
    facts.push({
      customer_id: customerId,
      fact_key: "preference.monthly_budget",
      fact_value: `월 보험 예산 ${profile.monthly_insurance_budget}원`,
      fact_type: "preference",
      importance: "high",
      source_table: "customer_profiles",
      source_record_id: profile.id,
      confidence: 1.0,
      metadata_json: { ...metadataBase, field: "monthly_insurance_budget" },
    });
  }

  return { facts, skipped: false };
}
