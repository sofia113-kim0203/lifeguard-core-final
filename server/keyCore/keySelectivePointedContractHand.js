/**
 * KEY Selective C1 Pointer Hand — owned-contract adoption only.
 * No insurer-name guess. No full-data fallback. No KEY termination conclusion.
 */

/**
 * Normalize client pointed ids to v1 contract: length 0 or 1.
 * Extra ids are dropped (never used for multi-guess).
 */
export function normalizePointedContractIdsInput(raw) {
  if (!Array.isArray(raw)) return [];
  const first = raw
    .map((id) => String(id ?? "").trim())
    .find((id) => id.length > 0);
  return first ? [first] : [];
}

/**
 * Internal contract ids owned by the authenticated customer's chart/ledger authority.
 * Does not accept external policy numbers as authority — only ids already on these surfaces.
 */
export function collectCustomerOwnedContractIds({ chart = null, policyTruthContext = null } = {}) {
  const owned = new Set();
  const ledger =
    policyTruthContext?.verified_policy_ledger ||
    policyTruthContext?.VERIFIED_POLICY_LEDGER ||
    policyTruthContext ||
    null;

  const confirmed = Array.isArray(ledger?.confirmed_contracts)
    ? ledger.confirmed_contracts
    : Array.isArray(policyTruthContext?.confirmed_contracts)
      ? policyTruthContext.confirmed_contracts
      : [];

  for (const row of confirmed) {
    const id = String(row?.contract_id ?? row?.id ?? "").trim();
    if (id) owned.add(id);
  }

  const coverages = Array.isArray(chart?.verified_document_coverages)
    ? chart.verified_document_coverages
    : [];
  for (const cov of coverages) {
    const id = String(cov?.contract_id ?? cov?.linked_contract_id ?? "").trim();
    if (id) owned.add(id);
  }

  return owned;
}

/**
 * Adopt pointed_contract_ids[0] only when it is an owned internal contract id.
 * Missing / not owned → empty list (selective keeps empty packets; no dump).
 */
export function resolveOwnedPointedContractIds({
  pointedContractIds = null,
  chart = null,
  policyTruthContext = null,
} = {}) {
  const normalized = normalizePointedContractIdsInput(pointedContractIds);
  if (!normalized.length) {
    return {
      pointed_contract_ids: [],
      adoption: "absent",
    };
  }

  const candidate = normalized[0];
  const owned = collectCustomerOwnedContractIds({ chart, policyTruthContext });
  if (!owned.has(candidate)) {
    return {
      pointed_contract_ids: [],
      adoption: "not_owned",
    };
  }

  return {
    pointed_contract_ids: [candidate],
    adoption: "owned",
  };
}
