import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";

export type SourceTable =
  | "customer_profiles"
  | "profile_health"
  | "profile_insurance_policies";

export const SOURCE_CONSENT_TYPE: Record<SourceTable, string> = {
  customer_profiles: "privacy_collection",
  profile_health: "sensitive_health_processing",
  profile_insurance_policies: "insurance_data_processing",
};

export type ConsentGateResult = {
  consent_type: string;
  consent_granted: boolean;
};

export async function checkSourceConsent(
  admin: SupabaseClient,
  customerId: string,
  sourceTable: SourceTable,
): Promise<ConsentGateResult> {
  const consentType = SOURCE_CONSENT_TYPE[sourceTable];
  const { data, error } = await admin.rpc("lifeguard_has_consent", {
    p_customer_id: customerId,
    p_consent_type: consentType,
  });

  return {
    consent_type: consentType,
    consent_granted: !error && data === true,
  };
}

export async function buildConsentSnapshot(
  admin: SupabaseClient,
  customerId: string,
): Promise<Record<string, boolean>> {
  const types = [
    "privacy_collection",
    "sensitive_health_processing",
    "insurance_data_processing",
    "memory_retention",
    "ai_consultation",
  ] as const;

  const snapshot: Record<string, boolean> = {};
  for (const consentType of types) {
    const { data, error } = await admin.rpc("lifeguard_has_consent", {
      p_customer_id: customerId,
      p_consent_type: consentType,
    });
    snapshot[consentType] = !error && data === true;
  }

  return snapshot;
}
