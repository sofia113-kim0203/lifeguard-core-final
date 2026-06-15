import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { checkSourceConsent } from "./consent.ts";
import { EXTRACTOR_VERSION } from "./config.ts";
import type { CandidateFact } from "./types.ts";
import { isIndemnityPolicyType, isPresent, truncate } from "./utils.ts";

const COVERAGE_SHEET_EXTRACTOR_ORIGIN = "coverage_sheet_l1";

function isCoverageSheetBridgePolicy(policy: PolicyRow): boolean {
  const coverage = policy.coverage_summary;
  if (!coverage || typeof coverage !== "object") return false;
  return coverage.extractor_origin === COVERAGE_SHEET_EXTRACTOR_ORIGIN;
}

function countCoverageSheetBridgePolicies(policies: PolicyRow[]): number {
  return policies.filter(isCoverageSheetBridgePolicy).length;
}

type PolicyRow = {
  id: string;
  insurer_name: string | null;
  product_name: string | null;
  policy_type: string | null;
  monthly_premium: number | null;
  effective_from: string | null;
  coverage_summary: Record<string, unknown> | null;
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

function collectNamedList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => cleanValue(typeof entry === "string" ? entry : riderLabelFromItem(entry)))
    .filter(Boolean);
}

function riderLabelFromItem(item: unknown): string {
  if (item == null) return "";
  if (typeof item === "string") return cleanValue(item);
  if (typeof item === "object") {
    const record = item as Record<string, unknown>;
    return cleanValue(
      record.rider_name ??
        record.normalized_name ??
        record.name ??
        record.label ??
        record.coverage_line ??
        record.coverage_name ??
        "",
    );
  }
  return "";
}

function cleanValue(value: unknown): string {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

function serializePolicyRiders(coverageSummary: Record<string, unknown> | null | undefined) {
  if (!coverageSummary || typeof coverageSummary !== "object" || Array.isArray(coverageSummary)) {
    return {
      names: [] as string[],
      structured: [] as Record<string, unknown>[],
      text: "",
      status: "unknown" as const,
      hasStructuredRiders: false,
    };
  }

  const names: string[] = [];
  const nameSeen = new Set<string>();
  if (Array.isArray(coverageSummary.riders)) {
    for (const entry of coverageSummary.riders) {
      const label = typeof entry === "string" ? cleanValue(entry) : riderLabelFromItem(entry);
      if (!label || nameSeen.has(label)) continue;
      nameSeen.add(label);
      names.push(label);
    }
  }

  const structured: Record<string, unknown>[] = Array.isArray(coverageSummary.rider_details)
    ? (coverageSummary.rider_details as Record<string, unknown>[])
        .map((entry) => {
          const rider_name = riderLabelFromItem(entry);
          if (!rider_name) return null;
          return {
            rider_name,
            coverage_amount: entry.coverage_amount ?? entry.amount ?? null,
            category: entry.category ?? null,
            source_line: entry.source_line ?? entry.notes ?? null,
            source_kind: entry.source_kind ?? "detail",
          };
        })
        .filter((entry): entry is Record<string, unknown> => entry != null)
    : names.map((rider_name) => ({ rider_name, source_kind: "string" }));

  const supplementalLabels = [
    ...collectNamedList(coverageSummary.detected_coverages),
    ...collectNamedList(coverageSummary.coverage_categories),
  ].filter(Boolean);

  const textParts: string[] = [];
  const textSeen = new Set<string>();
  for (const label of [...names, ...supplementalLabels]) {
    const text = cleanValue(label);
    if (!text || textSeen.has(text)) continue;
    textSeen.add(text);
    textParts.push(text);
  }

  const text = textParts.join(", ");
  const hasStructuredRiders = names.length > 0 || supplementalLabels.length > 0;

  return {
    names,
    structured,
    text,
    status: hasStructuredRiders ? ("structured" as const) : ("unknown" as const),
    hasStructuredRiders,
  };
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
    .from("active_profile_insurance_policies")
    .select("id, insurer_name, product_name, policy_type, monthly_premium, effective_from, coverage_summary, is_active")
    .eq("customer_id", customerId);

  if (error) {
    throw new Error(`insurance_load_failed: ${error.message}`);
  }

  const maintainedPolicies = (policies ?? []) as PolicyRow[];
  const facts: CandidateFact[] = [];
  const sourceRecordId = maintainedPolicies[0]?.id ?? customerId;

  if (maintainedPolicies.length > 0) {
    facts.push({
      customer_id: customerId,
      fact_key: "insurance.policy.count",
      fact_value: String(maintainedPolicies.length),
      fact_type: "insurance",
      importance: "medium",
      source_table: "profile_insurance_policies",
      source_record_id: sourceRecordId,
      confidence: 1.0,
      metadata_json: buildMetadata({
        consentType: consent.consent_type,
        consentGranted: consent.consent_granted,
        sourceRecordId,
        field: "maintained_policy_count",
        extra: {
          maintained_policy_count: maintainedPolicies.length,
          coverage_sheet_bridge_policy_count: countCoverageSheetBridgePolicies(maintainedPolicies),
        },
      }),
    });
  }

  const indemnityPolicies = maintainedPolicies.filter((policy) =>
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

  const activeSummary = summarizeActivePolicies(maintainedPolicies);
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

  const carrierSummary = summarizeCarrierProducts(maintainedPolicies);
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


  for (const pol of maintainedPolicies.slice(0, 10)) {
    const insurer = isPresent(pol.insurer_name) ? String(pol.insurer_name) : "보험사 미기재";
    const product = isPresent(pol.product_name) ? String(pol.product_name) : "상품 미기재";
    const statusLabel = pol.is_active ? "유지" : "비활성";
    let value = `${insurer}/${product}(${statusLabel})`;
    if (pol.effective_from) value += `, 가입일 ${pol.effective_from}`;
    if (pol.monthly_premium != null && Number(pol.monthly_premium) > 0) {
      value += `, 월 ${pol.monthly_premium}원`;
    }
    const riderBundle = serializePolicyRiders(
      pol.coverage_summary && typeof pol.coverage_summary === "object"
        ? (pol.coverage_summary as Record<string, unknown>)
        : null,
    );
    if (riderBundle.text) {
      value += `, 특약 ${truncate(riderBundle.text, 80)}`;
    }

    facts.push({
      customer_id: customerId,
      fact_key: `insurance.policy.${pol.id}.summary`,
      fact_value: truncate(value, 200),
      fact_type: "insurance",
      importance: "high",
      source_table: "profile_insurance_policies",
      source_record_id: pol.id,
      confidence: 1.0,
      metadata_json: buildMetadata({
        consentType: consent.consent_type,
        consentGranted: consent.consent_granted,
        sourceRecordId: pol.id,
        field: "policy_detail",
        extra: {
          extractor_origin:
            pol.coverage_summary && typeof pol.coverage_summary === "object"
              ? (pol.coverage_summary as Record<string, unknown>).extractor_origin ?? null
              : null,
          is_coverage_sheet_bridge: isCoverageSheetBridgePolicy(pol),
          riders: riderBundle.names,
          rider_details: riderBundle.structured,
          riders_text: riderBundle.text || null,
          riders_status: riderBundle.status,
          has_structured_riders: riderBundle.hasStructuredRiders,
        },
      }),
    });

    if (riderBundle.hasStructuredRiders && riderBundle.text) {
      facts.push({
        customer_id: customerId,
        fact_key: `insurance.policy.${pol.id}.riders`,
        fact_value: truncate(riderBundle.text, 200),
        fact_type: "insurance",
        importance: "high",
        source_table: "profile_insurance_policies",
        source_record_id: pol.id,
        confidence: 1.0,
        metadata_json: buildMetadata({
          consentType: consent.consent_type,
          consentGranted: consent.consent_granted,
          sourceRecordId: pol.id,
          field: "policy_riders",
          extra: {
            riders: riderBundle.names,
            rider_details: riderBundle.structured,
            riders_status: riderBundle.status,
          },
        }),
      });
    }
  }

  return { facts, skipped: false };
}
