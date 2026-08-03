/**
 * Shared detector: insurer/product identity fields polluted by OCR/sheet coverage dumps.
 * No customer/insurer/product allowlists. No rewrite.
 */

/**
 * Reject insurer/product values that are clearly OCR body / table / JSON / coverage dumps,
 * not contract identity fields.
 */
export function isPollutedPolicyIdentityField(value = "") {
  const s = String(value ?? "").trim();
  if (!s) return false;
  if (/[\r\n]/.test(s)) return true;
  if (/```/.test(s)) return true;
  if (/(?:\|[\t ]*[-:]+[\t ]*){2,}\|/.test(s)) return true;
  if ((s.match(/\|/g) || []).length >= 3) return true;
  if (/^\s*[{\[]/.test(s) && /[}\]]/.test(s) && /["']?\w+["']?\s*:/.test(s)) return true;

  const labelHits = [
    /계약번호/,
    /피보험자/,
    /계약자/,
    /보험기간/,
    /월보험료/,
    /납입기간/,
    /상품명/,
    /보장내용/,
    /가입금액/,
    /담보명/,
    /보험\/납입기간/,
    /policy\s*number/i,
    /premium/i,
  ].filter((re) => re.test(s)).length;
  if (labelHits >= 2) return true;

  // Coverage-sheet / 담보 dump shaped as a "product" line.
  if (/보장내용/.test(s) && s.length >= 24) return true;
  if (/가입금액/.test(s) && /(수술비|진단비|입원|통원|장해|사망)/.test(s)) {
    return true;
  }

  // Long packed OCR dump (observed Hanwha polluted row ~240–250 chars, single line).
  if (s.length >= 80) {
    if (/\d{4}[-./]\d{1,2}[-./]\d{1,2}/.test(s)) return true;
    if (/\d{1,3}(?:,\d{3}){2,}/.test(s)) return true;
    if ((s.match(/[.!?。]/g) || []).length >= 2) return true;
    if ((s.match(/\s+/g) || []).length >= 12) return true;
  }
  return false;
}

export function hasInvalidPolicyIdentityFields(fact = {}) {
  return (
    isPollutedPolicyIdentityField(fact?.insurer ?? fact?.insurer_name) ||
    isPollutedPolicyIdentityField(fact?.product_name)
  );
}

function policySummary(policy = {}) {
  return policy?.coverage_summary && typeof policy.coverage_summary === "object"
    ? policy.coverage_summary
    : {};
}

/** True when KEY already confirmed source facts on this row (verified promotion path). */
export function hasKeyConfirmedPolicyFacts(policy = {}) {
  const summary = policySummary(policy);
  const facts = summary.key_confirmed_source_facts ?? policy?.key_confirmed_source_facts;
  if (Array.isArray(facts) && facts.length > 0) return true;
  const source = String(
    summary.confirmation_source ?? policy?.confirmation_source ?? "",
  )
    .trim()
    .toLowerCase();
  if (source.startsWith("key_") || source === "key_confirmed") return true;
  return false;
}

/** Pending factory rows are evidence candidates, never confirmed customer contracts. */
export function hasPendingPolicyVerification(policy = {}) {
  if (hasKeyConfirmedPolicyFacts(policy)) return false;
  const summary = policySummary(policy);
  return [
    policy?.evidence_state,
    policy?.factory_analysis_status,
    policy?.factory_verification_status,
    summary.evidence_state,
    summary.factory_analysis_status,
    summary.factory_verification_status,
  ].some((value) => {
    const status = String(value ?? "").trim().toLowerCase();
    return status === "pending" || status === "pending_unverified";
  });
}

/**
 * Customer-confirmed contract boundary.
 * Never promote OCR pollution, pending factory rows, or unnamed products into a card.
 * KEY-confirmed facts win over factory pending_unverified labels.
 */
export function isEligibleConfirmedContractCard(policy = {}) {
  if (isNonContractPolicyRow(policy)) return false;
  if (hasPendingPolicyVerification(policy)) return false;
  return Boolean(String(policy?.product_name ?? policySummary(policy).product_name ?? "").trim());
}

/** True when a policy/card row must not be treated as a selectable contract. */
export function isNonContractPolicyRow(policy = {}) {
  if (hasInvalidPolicyIdentityFields(policy)) return true;
  const product = String(policy?.product_name ?? "").trim();
  const insurer = String(policy?.insurer_name ?? "").trim();
  if (!insurer && !product) return true;
  // Sheet rows that only carry coverage_name-shaped identity and no clean product.
  if (!product && String(policy?.coverage_name ?? "").trim()) return true;
  return false;
}
