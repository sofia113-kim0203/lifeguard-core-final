/**
 * P2-B-1 — Premium distribution stats from unified policies (read-only, deterministic).
 */
import { resolvePolicyPremium } from "../src/lib/resolvePolicyPremium.js";

function resolveUnavailableReason(policy) {
  const summary = policy?.coverage_summary;
  if (
    summary &&
    typeof summary === "object" &&
    !Array.isArray(summary) &&
    summary.amount_unit === "premium_unavailable"
  ) {
    return "보험료미제공";
  }
  return "확인 필요";
}

function roundSharePct(premium, total) {
  if (!total || total <= 0) return 0;
  return Math.round((premium / total) * 1000) / 10;
}

export function buildPremiumDistributionStats(policies = []) {
  const list = policies ?? [];
  const insurerMap = new Map();
  const unavailableMap = new Map();

  let premiumKnownCount = 0;
  let premiumUnknownCount = 0;
  let premiumTotal = 0;

  for (const policy of list) {
    const premium = resolvePolicyPremium(policy);
    const insurer = policy?.insurer_name || "미확인";

    if (premium != null) {
      premiumKnownCount += 1;
      premiumTotal += premium;
      const entry = insurerMap.get(insurer) ?? { premium: 0, policyCount: 0 };
      entry.premium += premium;
      entry.policyCount += 1;
      insurerMap.set(insurer, entry);
      continue;
    }

    premiumUnknownCount += 1;
    const reason = resolveUnavailableReason(policy);
    const unavailable = unavailableMap.get(insurer) ?? { reason, policyCount: 0 };
    unavailable.policyCount += 1;
    unavailableMap.set(insurer, unavailable);
  }

  const insurers = Array.from(insurerMap.entries())
    .map(([insurer, data]) => ({
      insurer,
      premium: data.premium,
      sharePct: roundSharePct(data.premium, premiumTotal),
      policyCount: data.policyCount,
    }))
    .sort((a, b) => b.premium - a.premium);

  const topInsurer =
    insurers.length > 0
      ? {
          insurer: insurers[0].insurer,
          premium: insurers[0].premium,
          sharePct: insurers[0].sharePct,
        }
      : null;

  const unavailablePolicies = Array.from(unavailableMap.entries()).map(
    ([insurer, data]) => ({
      insurer,
      reason: data.reason,
      policyCount: data.policyCount,
    }),
  );

  return {
    premiumTotal,
    premiumKnownCount,
    premiumUnknownCount,
    insurers,
    topInsurer,
    unavailablePolicies,
  };
}
