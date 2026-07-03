/**
 * Phase B Slice 2 — Premium burden ("보험료 부담돼." / JC-PREMIUM-BURDEN-v1).
 * Frozen Phase B design: Premium Intent (Value) → P0–P4 → Direction · Reason · First Action.
 * Tom: judgment-first direction — not empathy, not premium calculation opener.
 */
import { PREMIUM_BURDEN_COMPANION_CLUSTER_ID } from "../intentGateLayer.js";
import { extractFactBundleEvidence } from "../salesDirectorFormatter.js";
import { resolvePolicyPremium } from "../../src/lib/resolvePolicyPremium.js";
import { hasStructuredRiders } from "../../src/lib/policyExplorer.js";

const EMPATHY_OPENER_RE = /느껴지시는|느껴지|마음은\s*이해|걱정되시는/;

function normalizeQuestion(question = "") {
  return String(question ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

function resolvePolicyCount(factBundle = {}) {
  if (typeof factBundle.policy_count === "number") return factBundle.policy_count;
  return Array.isArray(factBundle.policies) ? factBundle.policies.length : 0;
}

function resolvePremiumStats(factBundle = {}) {
  return factBundle.premium_stats ?? {};
}

function resolveHeaviestPolicy(policies = []) {
  let heaviest = null;
  let heaviestPremium = 0;
  for (const policy of policies) {
    const premium = resolvePolicyPremium(policy);
    if (premium != null && premium > heaviestPremium) {
      heaviestPremium = premium;
      heaviest = policy;
    }
  }
  if (!heaviest) return null;
  const label = String(heaviest.product_name ?? heaviest.product ?? "해당 계약").trim();
  return { label, premium: heaviestPremium };
}

function premiumShareDominates(stats = {}, heaviest = null) {
  const total = stats.premiumTotal ?? 0;
  if (!heaviest || total <= 0) return false;
  return heaviest.premium / total >= 0.45;
}

function policiesHaveCoverageDetail(policies = []) {
  return policies.some((policy) => {
    if (hasStructuredRiders(policy)) return true;
    const riders = policy.coverage_summary?.riders;
    return Array.isArray(riders) && riders.length > 0;
  });
}

export function shouldApplyPhaseBSlice2PremiumBurdenJudgment(factBundle = {}) {
  return factBundle.companion_cluster === PREMIUM_BURDEN_COMPANION_CLUSTER_ID;
}

/**
 * @returns {{ judgment: string, evidence: string, limitation: string, nextAction: string } | null}
 */
export function buildPhaseBSlice2PremiumBurdenJudgment({ factBundle = {}, question: questionOverride } = {}) {
  if (!shouldApplyPhaseBSlice2PremiumBurdenJudgment(factBundle)) return null;

  const question = normalizeQuestion(questionOverride ?? factBundle.question ?? "");
  const signals = factBundle.companion_cluster_signals ?? [];
  const policyCount = resolvePolicyCount(factBundle);
  const policies = factBundle.policies ?? [];
  const stats = resolvePremiumStats(factBundle);
  const evidenceBundle = extractFactBundleEvidence({ ...factBundle, question });
  const premiumKnown =
    (stats.premiumKnownCount ?? 0) > 0 && (stats.premiumTotal ?? 0) > 0;
  const premiumPartial =
    policyCount > 0 &&
    ((stats.premiumKnownCount ?? 0) > 0 || (stats.premiumUnknownCount ?? 0) > 0) &&
    !premiumKnown;
  const heaviest = resolveHeaviestPolicy(policies);
  const hasCoverageDetail = policiesHaveCoverageDetail(policies);
  const wantsReduction = signals.includes("reduction") || /줄이|낮추|절감/.test(question);

  if (policyCount === 0 || !evidenceBundle.has_policies) {
    return {
      judgment: "지금은 등록된 가입 정보가 없어서, 보험료 부담을 판단하기 어렵습니다.",
      evidence: "",
      limitation: "보장 가치 대비 적절한지 보려면 먼저 가입 정보를 확인해야 합니다.",
      nextAction: "보험 정보를 저장해 주시면, 그때부터 같이 확인해 보겠습니다.",
    };
  }

  if (!premiumKnown) {
    return {
      judgment: "현재 자료에서는 급하게 줄이기보다 구조를 먼저 보는 것이 맞아 보입니다.",
      evidence: premiumPartial
        ? "등록된 보험은 있지만, 월 납입액은 아직 전부 확인되지 않았습니다."
        : "등록된 보험은 확인되지만, 납입액과 보장내역을 함께 봐야 합니다.",
      limitation: "보험료 숫자만으로는, 지금 받는 보장 가치까지는 단정하기 어렵습니다.",
      nextAction: "이번에는 납입액과 보장내역부터 같이 맞춰 보겠습니다.",
    };
  }

  if (evidenceBundle.gap_duplicates?.length) {
    return {
      judgment: "현재는 보험료를 줄이기보다, 겹치는 보장부터 정리하는 것이 우선입니다.",
      evidence: "같은 축 보장이 여러 계약에 걸려 있으면, 내는 보험료 대비 가치가 줄어들 수 있습니다.",
      limitation: "어느 계약을 줄일지는 보장내역 확인 전에는 단정하지 않겠습니다.",
      nextAction: "이번에는 겹치는 보장부터 같이 짚어 보겠습니다.",
    };
  }

  if (wantsReduction && premiumShareDominates(stats, heaviest)) {
    return {
      judgment: "현재는 보험료를 줄이는 것보다 부담이 큰 계약부터 확인하는 것이 우선입니다.",
      evidence: "등록된 계약 중 한 곳에 납입이 많이 몰려 있는 쪽이 보입니다.",
      limitation: "그 계약의 보장 가치까지는 특약 확인 전이라, 바로 줄이라고 말씀드리기는 어렵습니다.",
      nextAction: "이번에는 부담이 큰 계약부터 같이 확인해 보겠습니다.",
    };
  }

  if (wantsReduction) {
    return {
      judgment: "지금은 줄이는 것보다, 어디가 부담인지부터 보는 것이 맞아 보입니다.",
      evidence: "보험료를 줄이려면, 지금 받는 보장 가치부터 함께 봐야 합니다.",
      limitation: "해지·축소 전에는 보장 공백이 생길 수 있어, 그 부분은 단정하지 않겠습니다.",
      nextAction: "이번에는 부담이 큰 항목부터 같이 확인해 보겠습니다.",
    };
  }

  if (premiumShareDominates(stats, heaviest)) {
    return {
      judgment: "현재는 보험료를 줄이는 것보다 부담이 큰 계약부터 확인하는 것이 우선입니다.",
      evidence: "등록된 계약 중 납입이 한쪽에 몰려 있는 쪽이 보입니다.",
      limitation: "그 계약이 꼭 줄여야 할지는 보장 가치 확인 전에는 단정하지 않겠습니다.",
      nextAction: "이번에는 부담이 큰 계약부터 같이 확인해 보겠습니다.",
    };
  }

  if (hasCoverageDetail && evidenceBundle.gap_maintained?.length) {
    return {
      judgment: "지금은 줄이는 것보다 유지하는 쪽이 맞아 보입니다.",
      evidence: "현재 자료에서는 핵심 보장은 유지되는 쪽으로 보입니다.",
      limitation: "다만 특약·한도까지는 아직 확인되지 않았기 때문에, 그 부분은 단정하지 않겠습니다.",
      nextAction: "이번에는 납입과 보장 가치를 함께 맞춰 보겠습니다.",
    };
  }

  if (hasCoverageDetail) {
    return {
      judgment: "현재 자료에서는 급하게 해지하기보다 구조를 먼저 보는 것이 맞아 보입니다.",
      evidence: "등록된 보험과 확인된 보장 범위 기준입니다.",
      limitation: "보험료가 보장 가치에 비해 과한지는, 특약·한도 확인 전에는 단정하지 않겠습니다.",
      nextAction: "이번에는 보험료와 보장 구조부터 같이 확인해 보겠습니다.",
    };
  }

  return {
    judgment: "현재 자료에서는 급하게 줄이기보다 구조를 먼저 보는 것이 맞아 보입니다.",
    evidence: `등록된 보험은 ${policyCount}건 확인됩니다.`,
    limitation: "납입액 대비 보장 가치는 보장내역 확인 전에는 단정하기 어렵습니다.",
    nextAction: "이번에는 납입과 보장내역부터 같이 맞춰 보겠습니다.",
  };
}

export { EMPATHY_OPENER_RE };
