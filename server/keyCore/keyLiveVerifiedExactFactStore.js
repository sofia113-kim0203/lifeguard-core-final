/**
 * Live verified customer fact store for request_key_fact.
 * Canonical read: active_profile_insurance_policies
 *   (view over profile_insurance_policies — the persist SSOT).
 * Same-ledger cells only:
 *   coverage_summary.key_coverage_baseline_facts (status=verified)
 *   coverage_summary.key_confirmed_source_facts (KEY-confirmed, existing pair bind)
 * selectedInternalCard / chart / READY CARD are not truth sources here.
 * Numeric/jamo maps are not used.
 */
import {
  filterPoliciesToActiveSourceDocuments,
  loadActiveSourceDocumentIds,
} from "../../src/lib/policySourceDocumentFilter.js";
import { bindAdjacentCoverageRelations } from "./keyCoverageTruth.js";

export const LIVE_VERIFIED_FACT_SOURCE_KIND = "live_verified_customer_store";
export const LIVE_VERIFIED_FACT_STORE = "active_profile_insurance_policies";
export const LIVE_VERIFIED_FACT_HELPER = "loadLiveVerifiedExactFactRows";
export const LIVE_VERIFIED_FACT_FIELD_PATH =
  "coverage_summary.key_coverage_baseline_facts|key_confirmed_source_facts";

const LIVE_POLICY_FACT_SELECT =
  "id, customer_id, insurer_name, product_name, coverage_summary";

function asId(v) {
  return v == null ? "" : String(v).trim();
}

function isVerifiedStatus(v) {
  return String(v ?? "").trim().toLowerCase() === "verified";
}

function emptyProvenance() {
  return {
    source_kind: LIVE_VERIFIED_FACT_SOURCE_KIND,
    store: LIVE_VERIFIED_FACT_STORE,
    helper: LIVE_VERIFIED_FACT_HELPER,
    live_store_read: false,
  };
}

/**
 * Sync extract from already-loaded live policy rows.
 * Exact identifiers only. No semantic similarity. No other-customer rows.
 */
export function collectExactFactRowsFromLiveVerifiedPolicies({
  customerId,
  policies = [],
} = {}) {
  const cid = asId(customerId);
  if (!cid) return [];
  const rows = [];
  const seen = new Set();

  for (const policy of Array.isArray(policies) ? policies : []) {
    if (!policy || typeof policy !== "object") continue;
    const rowCustomer = asId(policy.customer_id);
    if (rowCustomer && rowCustomer !== cid) continue;

    const contractId = asId(policy.id ?? policy.policy_id ?? policy.contract_id);
    const summary =
      policy.coverage_summary && typeof policy.coverage_summary === "object"
        ? policy.coverage_summary
        : {};
    const insurer = asId(policy.insurer_name);
    const product = asId(policy.product_name);

    const pushCell = (coverageName, amount, extraId = "") => {
      const name = asId(coverageName);
      if (!name) return;
      const contract = contractId || asId(extraId);
      const key = `${cid}|${contract}|${name}|${amount ?? ""}`;
      if (seen.has(key)) return;
      seen.add(key);
      rows.push({
        customer_id: cid,
        contract_id: contract,
        coverage_name: name,
        coverage_amount: amount,
        ...(insurer ? { insurer_name: insurer } : {}),
        ...(product ? { product_name: product } : {}),
      });
    };

    const baseline = Array.isArray(summary.key_coverage_baseline_facts)
      ? summary.key_coverage_baseline_facts
      : [];
    for (const fact of baseline) {
      if (!fact || typeof fact !== "object") continue;
      if (!isVerifiedStatus(fact.status)) continue;
      const amount =
        fact.coverage_amount != null && String(fact.coverage_amount).trim() !== ""
          ? fact.coverage_amount
          : fact.amount != null && String(fact.amount).trim() !== ""
            ? fact.amount
            : null;
      pushCell(
        fact.original_coverage_name ?? fact.coverage_name ?? fact.rider_name,
        amount,
        fact.source_document_id,
      );
    }

    const confirmed = Array.isArray(summary.key_confirmed_source_facts)
      ? summary.key_confirmed_source_facts
      : [];
    for (const fact of bindAdjacentCoverageRelations(confirmed)) {
      if (!fact || typeof fact !== "object") continue;
      const name = fact.coverage_name ?? fact.original_coverage_name ?? null;
      const amount =
        fact.coverage_amount != null && String(fact.coverage_amount).trim() !== ""
          ? fact.coverage_amount
          : fact.amount != null && String(fact.amount).trim() !== ""
            ? fact.amount
            : null;
      pushCell(name, amount, fact.source_document_id);
    }
  }
  return rows;
}

export async function loadLiveVerifiedExactFactRows({
  supabase = null,
  customerId = null,
} = {}) {
  const cid = asId(customerId);
  const provenance = emptyProvenance();
  if (!supabase || !cid) {
    return { rows: [], provenance };
  }
  try {
    const { data, error } = await supabase
      .from(LIVE_VERIFIED_FACT_STORE)
      .select(LIVE_POLICY_FACT_SELECT)
      .eq("customer_id", cid);
    if (error) return { rows: [], provenance };
    const activeSourceIds = await loadActiveSourceDocumentIds(cid, supabase);
    const policies = filterPoliciesToActiveSourceDocuments(
      Array.isArray(data) ? data : [],
      activeSourceIds,
    );
    return {
      rows: collectExactFactRowsFromLiveVerifiedPolicies({
        customerId: cid,
        policies,
      }),
      provenance: { ...provenance, live_store_read: true },
    };
  } catch {
    return { rows: [], provenance };
  }
}

export function attachLiveFactProvenance(
  result,
  liveProvenance,
  { contractId = null, coverageName = null, field = "amount" } = {},
) {
  if (!result || !liveProvenance || liveProvenance.live_store_read !== true) {
    return result;
  }
  const fact0 =
    result?.facts?.[0] && typeof result.facts[0] === "object" ? result.facts[0] : null;
  return {
    ...result,
    metadata: {
      source_kind: LIVE_VERIFIED_FACT_SOURCE_KIND,
      store: LIVE_VERIFIED_FACT_STORE,
      helper: LIVE_VERIFIED_FACT_HELPER,
      contract_ref: asId(contractId) || asId(fact0?.contract_id) || null,
      coverage_ref: asId(coverageName) || asId(fact0?.coverage_name) || null,
      field: asId(field) || "amount",
      result_status: result.status ?? null,
    },
  };
}
