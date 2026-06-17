/**
 * Shared monthly premium resolver for profile_insurance_policies rows (TS port).
 * Read-time only — does not parse amount_text or fallback non-sheet sidecars.
 */

type PolicyPremiumInput = {
  monthly_premium?: number | string | null;
  premium_amount?: number | string | null;
  coverage_summary?: Record<string, unknown> | null;
};

function positiveFiniteNumber(value: unknown): number | null {
  if (value == null || value === "") return null;
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return null;
  return numeric;
}

export function resolvePolicyPremium(policy: PolicyPremiumInput | null | undefined): number | null {
  if (!policy || typeof policy !== "object") return null;

  const fromMonthly = positiveFiniteNumber(policy.monthly_premium);
  if (fromMonthly != null) return fromMonthly;

  const fromPremiumAmount = positiveFiniteNumber(policy.premium_amount);
  if (fromPremiumAmount != null) return fromPremiumAmount;

  const summary = policy.coverage_summary;
  if (!summary || typeof summary !== "object" || Array.isArray(summary)) return null;

  if (summary.record_kind !== "coverage_sheet_row") return null;
  if (summary.amount_unit !== "won") return null;

  return positiveFiniteNumber(summary.amount_value);
}
