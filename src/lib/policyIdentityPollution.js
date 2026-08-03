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
