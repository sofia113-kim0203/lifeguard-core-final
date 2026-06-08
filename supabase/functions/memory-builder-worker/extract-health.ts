import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { checkSourceConsent } from "./consent.ts";
import { EXTRACTOR_VERSION } from "./config.ts";
import type { CandidateFact } from "./types.ts";
import { isPresent, normalizeFlag, truncate } from "./utils.ts";

type HealthRow = {
  customer_id: string;
  smoking: string | null;
  hospital_5y: string | null;
  surgery_5y: string | null;
  medication: string | null;
  family_history: string | null;
  updated_at: string;
};

function buildMetadata(params: {
  consentType: string;
  consentGranted: boolean;
  sourceRecordId: string;
  field?: string;
}): Record<string, unknown> {
  return {
    consent_type: params.consentType,
    consent_granted: params.consentGranted,
    extractor_version: EXTRACTOR_VERSION,
    source_table: "profile_health",
    source_record_id: params.sourceRecordId,
    no_llm_generated: true,
    ...(params.field ? { field: params.field } : {}),
  };
}

export async function extractHealthFacts(
  admin: SupabaseClient,
  customerId: string,
): Promise<{ facts: CandidateFact[]; skipped: boolean; skip_reason?: string }> {
  const consent = await checkSourceConsent(admin, customerId, "profile_health");
  if (!consent.consent_granted) {
    return {
      facts: [],
      skipped: true,
      skip_reason: `consent_missing:${consent.consent_type}`,
    };
  }

  const { data: row, error } = await admin
    .from("profile_health")
    .select(
      "customer_id, smoking, hospital_5y, surgery_5y, medication, family_history, updated_at",
    )
    .eq("customer_id", customerId)
    .maybeSingle();

  if (error) {
    throw new Error(`health_load_failed: ${error.message}`);
  }

  if (!row) {
    return { facts: [], skipped: false };
  }

  const health = row as HealthRow;
  const facts: CandidateFact[] = [];
  const sourceRecordId = health.customer_id;

  if (isPresent(health.smoking)) {
    facts.push({
      customer_id: customerId,
      fact_key: "health.smoking.status",
      fact_value: truncate(String(health.smoking), 40),
      fact_type: "health",
      importance: "high",
      source_table: "profile_health",
      source_record_id: sourceRecordId,
      confidence: 1.0,
      metadata_json: buildMetadata({
        consentType: consent.consent_type,
        consentGranted: consent.consent_granted,
        sourceRecordId,
        field: "smoking",
      }),
    });
  }

  if (isPresent(health.medication)) {
    facts.push({
      customer_id: customerId,
      fact_key: "health.medication.summary",
      fact_value: truncate(String(health.medication), 120),
      fact_type: "health",
      importance: "high",
      source_table: "profile_health",
      source_record_id: sourceRecordId,
      confidence: 1.0,
      metadata_json: buildMetadata({
        consentType: consent.consent_type,
        consentGranted: consent.consent_granted,
        sourceRecordId,
        field: "medication",
      }),
    });
  }

  const surgeryFlag = normalizeFlag(health.surgery_5y);
  if (surgeryFlag) {
    facts.push({
      customer_id: customerId,
      fact_key: "health.surgery_5y.flag",
      fact_value: surgeryFlag,
      fact_type: "health",
      importance: surgeryFlag === "yes" ? "critical" : "high",
      source_table: "profile_health",
      source_record_id: sourceRecordId,
      confidence: 1.0,
      metadata_json: buildMetadata({
        consentType: consent.consent_type,
        consentGranted: consent.consent_granted,
        sourceRecordId,
        field: "surgery_5y",
      }),
    });
  }

  const hospitalFlag = normalizeFlag(health.hospital_5y);
  if (hospitalFlag) {
    facts.push({
      customer_id: customerId,
      fact_key: "health.hospital_5y.flag",
      fact_value: hospitalFlag,
      fact_type: "health",
      importance: hospitalFlag === "yes" ? "critical" : "high",
      source_table: "profile_health",
      source_record_id: sourceRecordId,
      confidence: 1.0,
      metadata_json: buildMetadata({
        consentType: consent.consent_type,
        consentGranted: consent.consent_granted,
        sourceRecordId,
        field: "hospital_5y",
      }),
    });
  }

  if (isPresent(health.family_history)) {
    facts.push({
      customer_id: customerId,
      fact_key: "health.family_history.summary",
      fact_value: truncate(String(health.family_history), 120),
      fact_type: "health",
      importance: "high",
      source_table: "profile_health",
      source_record_id: sourceRecordId,
      confidence: 1.0,
      metadata_json: buildMetadata({
        consentType: consent.consent_type,
        consentGranted: consent.consent_granted,
        sourceRecordId,
        field: "family_history",
      }),
    });
  }

  return { facts, skipped: false };
}
