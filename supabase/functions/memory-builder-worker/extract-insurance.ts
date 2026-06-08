import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { checkSourceConsent } from "./consent.ts";
import { EXTRACTOR_VERSION } from "./config.ts";
import type { CandidateFact } from "./types.ts";
import { isIndemnityPolicyType, isPresent, truncate } from "./utils.ts";

type PolicyRow = {
  id: string;
  insurer_name: string | null;
  product_name: string | null;
  policy_type: string | null;
  is_active: boolean;
};

function buildMetadata(params: {
  consentType: string;
  consentGranted: boolean;
  sourceRecordId: string;
  field?: string;
  extra?: Record<string, unknown>;
}): Record<string, unknown> {
  return {
    consent_type: params.consentType,
    consent_granted: params.consentGranted,
    extractor_version: EXTRACTOR_VERSION,
    source_table: "profile_insurance_policies",
    source_record_id: params.sourceRecordId,
    no_llm_generated: true,
    ...(params.field ? { field: params.field } : {}),
    ...(params.extra ?? {}),
  };
}

function summarizeActivePolicies(policies: PolicyRow[]): string | null {
  if (policies.length === 0) return null;

  const parts = policies.slice(0, 5).map((policy) => {
    const insurer = isPresent(policy.insurer_name) ? String(policy.insurer_name) : "보험사 미기재";
    const product = isPresent(policy.product_name) ? String(policy.product_name) : "상품 미기재";
    const typeLabel = isPresent(policy.policy_type) ? String(policy.policy_type) : "유형 미기재";
    return `${insurer}/${product}(${typeLabel})`;
  });

  const summary = parts.join("; ");
  return truncate(summary, 200);
}

function summarizeCarrierProducts(policies: PolicyRow[]): string | null {
  const structured = policies
    .filter((policy) => isPresent(policy.insurer_name) && isPresent(policy.product_name))
    .map((policy) => `${policy.insurer_name}:${policy.product_name}`);

  if (structured.length === 0) return null;
  return truncate(structured.slice(0, 5).join("; "), 200);
}

export async function extractInsuranceFacts(
  admin: SupabaseClient,
  customerId: string,
): Promise<{ facts: CandidateFact[]; skipped: boolean; skip_reason?: string }> {
  const consent = await checkSourceConsent(admin, customerId, "profile_insurance_policies");
  if (!consent.consent_granted) {
    return {
      facts: [],
      skipped: true,
      skip_reason: `consent_missing:${consent.consent_type}`,
    };
  }

  const { data: policies, error } = await admin
    .from("profile_insurance_policies")
    .select("id, insurer_name, product_name, policy_type, is_active")
    .eq("customer_id", customerId)
    .eq("is_active", true)
    .is("deleted_at", null);

  if (error) {
    throw new Error(`insurance_load_failed: ${error.message}`);
  }

  const activePolicies = (policies ?? []) as PolicyRow[];
  const facts: CandidateFact[] = [];
  const sourceRecordId = activePolicies[0]?.id ?? customerId;

  if (activePolicies.length > 0) {
    facts.push({
      customer_id: customerId,
      fact_key: "insurance.policy.count",
      fact_value: String(activePolicies.length),
      fact_type: "insurance",
      importance: "medium",
      source_table: "profile_insurance_policies",
      source_record_id: sourceRecordId,
      confidence: 1.0,
      metadata_json: buildMetadata({
        consentType: consent.consent_type,
        consentGranted: consent.consent_granted,
        sourceRecordId,
        field: "active_policy_count",
        extra: { active_policy_count: activePolicies.length },
      }),
    });
  }

  const indemnityPolicies = activePolicies.filter((policy) =>
    isIndemnityPolicyType(policy.policy_type)
  );
  if (indemnityPolicies.length > 0) {
    const primary = indemnityPolicies[0];
    facts.push({
      customer_id: customerId,
      fact_key: "insurance.indemnity.held",
      fact_value: "yes",
      fact_type: "insurance",
      importance: "high",
      source_table: "profile_insurance_policies",
      source_record_id: primary.id,
      confidence: 1.0,
      metadata_json: buildMetadata({
        consentType: consent.consent_type,
        consentGranted: consent.consent_granted,
        sourceRecordId: primary.id,
        field: "policy_type",
        extra: {
          indemnity_policy_count: indemnityPolicies.length,
          policy_ids: indemnityPolicies.slice(0, 5).map((policy) => policy.id),
        },
      }),
    });
  }

  const activeSummary = summarizeActivePolicies(activePolicies);
  if (activeSummary) {
    facts.push({
      customer_id: customerId,
      fact_key: "insurance.policies.active_summary",
      fact_value: activeSummary,
      fact_type: "insurance",
      importance: "medium",
      source_table: "profile_insurance_policies",
      source_record_id: sourceRecordId,
      confidence: 1.0,
      metadata_json: buildMetadata({
        consentType: consent.consent_type,
        consentGranted: consent.consent_granted,
        sourceRecordId,
        field: "active_policies_summary",
      }),
    });
  }

  const carrierSummary = summarizeCarrierProducts(activePolicies);
  if (carrierSummary) {
    facts.push({
      customer_id: customerId,
      fact_key: "insurance.carrier_product.summary",
      fact_value: carrierSummary,
      fact_type: "insurance",
      importance: "medium",
      source_table: "profile_insurance_policies",
      source_record_id: sourceRecordId,
      confidence: 1.0,
      metadata_json: buildMetadata({
        consentType: consent.consent_type,
        consentGranted: consent.consent_granted,
        sourceRecordId,
        field: "carrier_product_summary",
      }),
    });
  }

  return { facts, skipped: false };
}
