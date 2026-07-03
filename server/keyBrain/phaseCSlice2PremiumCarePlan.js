/**
 * Phase C Slice 2 — Premium Care Plan ("보험료 부담돼." / JC-PREMIUM-BURDEN-v1).
 * Tom v1.1: plan not conclusion · customer-language Why · Companion voice (함께/같이).
 */
import { PREMIUM_BURDEN_COMPANION_CLUSTER_ID } from "../intentGateLayer.js";
import { extractFactBundleEvidence } from "../salesDirectorFormatter.js";
import {
  shouldApplyPhaseBSlice2PremiumBurdenJudgment,
  buildPhaseBSlice2PremiumBurdenJudgment,
} from "./phaseBSlice2PremiumBurdenJudgment.js";
import { CARE_PLAN_TRANSITION } from "./phaseCSlice1CoverageCarePlan.js";
import { resolvePolicyPremium } from "../../src/lib/resolvePolicyPremium.js";

export { CARE_PLAN_TRANSITION };

export const PREMIUM_CARE_PLAN_FORBIDDEN_RE =
  /(?:가입(?:하(?:세요|시|는|실)|권)|추천(?:드|해)|리모델링|설계(?:안|해\s*드)|(?:이|해)?보세요|들(?:어|으)세요|줄이(?:세요|시|라)|갈아타|해지(?:하(?:세요|시|라)|(?:해|하)\s*드)|이\s*상품)/;

export const INTERNAL_WHY_RE = /statistics|premium_stats|OCR|field_count|내부|시스템/i;

const STEP_MARKERS = ["①", "②", "③", "④"];

function normalizeQuestion(question = "") {
  return String(question ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeText(text = "") {
  return String(text ?? "")
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
  return heaviest;
}

function premiumShareDominates(stats = {}, heaviestPolicy = null) {
  const total = stats.premiumTotal ?? 0;
  if (!heaviestPolicy || total <= 0) return false;
  const premium = resolvePolicyPremium(heaviestPolicy);
  return premium != null && premium / total >= 0.45;
}

function companionWhat(action = "") {
  const text = String(action).trim();
  if (/함께|같이/.test(text)) return text;
  if (/합니다$/.test(text)) return text.replace(/합니다$/, "하겠습니다");
  if (/해요$/.test(text)) return text.replace(/해요$/, "하겠습니다");
  return `${text} 함께 진행하겠습니다`;
}

export function formatPremiumCarePlanSteps(steps = []) {
  return steps
    .filter((step) => step?.when && step?.what)
    .map((step, index) => {
      const whyClause = step.why ? ` (${step.why})` : "";
      return `${STEP_MARKERS[index] ?? `${index + 1}.`} ${step.when} ${step.what}${whyClause}`;
    })
    .join(" ");
}

export function shouldApplyPhaseCSlice2PremiumCarePlan(factBundle = {}) {
  return (
    factBundle.companion_cluster === PREMIUM_BURDEN_COMPANION_CLUSTER_ID &&
    shouldApplyPhaseBSlice2PremiumBurdenJudgment(factBundle)
  );
}

function defaultPremiumPlan() {
  return [
    {
      when: "이번 달",
      what: companionWhat("부담이 큰 계약부터 함께 확인하겠습니다"),
      why: "어디에서 부담이 생기는지 먼저 알아야 하기 때문입니다",
    },
    {
      when: "다음",
      what: companionWhat("중복되거나 효율이 낮은 보장이 있는지 함께 살펴보겠습니다"),
      why: "줄일 수 있는 부분이 있는지 판단하기 위해서입니다",
    },
    {
      when: "그다음",
      what: companionWhat("필요한 보장은 유지하고, 조정이 필요한 부분만 함께 다시 판단하겠습니다"),
      why: "보장을 유지하면서 조정할 수 있는지 확인하기 위해서입니다",
    },
  ];
}

/**
 * @returns {{ transition: string, steps: Array<{ when: string, what: string, why?: string }> } | null}
 */
export function buildPhaseCSlice2PremiumCarePlan({
  factBundle = {},
  question: questionOverride,
  phaseBJudgment = null,
} = {}) {
  if (!shouldApplyPhaseCSlice2PremiumCarePlan(factBundle)) return null;

  const question = normalizeQuestion(questionOverride ?? factBundle.question ?? "");
  const phaseB = phaseBJudgment ?? buildPhaseBSlice2PremiumBurdenJudgment({ factBundle, question });
  if (!phaseB) return null;

  const policyCount = resolvePolicyCount(factBundle);
  const policies = factBundle.policies ?? [];
  const stats = resolvePremiumStats(factBundle);
  const evidence = extractFactBundleEvidence({ ...factBundle, question });
  const premiumKnown =
    (stats.premiumKnownCount ?? 0) > 0 && (stats.premiumTotal ?? 0) > 0;
  const heaviest = resolveHeaviestPolicy(policies);
  const wantsReduction = (factBundle.companion_cluster_signals ?? []).includes("reduction") || /줄이|낮추|절감/.test(question);

  if (policyCount === 0 || !evidence.has_policies) {
    return {
      transition: CARE_PLAN_TRANSITION,
      steps: [
        {
          when: "이번 달",
          what: companionWhat("가입 정보를 함께 저장하겠습니다"),
          why: "부담을 보려면 먼저 등록된 계약이 필요하기 때문입니다",
        },
        {
          when: "저장 후",
          what: companionWhat("납입과 보장 구조를 함께 확인하겠습니다"),
          why: "숫자만으로는 가치 판단이 어렵기 때문입니다",
        },
      ],
    };
  }

  if (!premiumKnown) {
    return {
      transition: CARE_PLAN_TRANSITION,
      steps: [
        {
          when: "이번 달",
          what: companionWhat("납입액과 보장내역을 함께 맞춰 보겠습니다"),
          why: "급하게 줄이기 전에 구조를 봐야 하기 때문입니다",
        },
        {
          when: "다음",
          what: companionWhat("부담이 큰 항목부터 함께 확인하겠습니다"),
          why: "어디에서 부담이 생기는지 먼저 알아야 하기 때문입니다",
        },
      ],
    };
  }

  if (evidence.gap_duplicates?.length) {
    return {
      transition: CARE_PLAN_TRANSITION,
      steps: [
        {
          when: "이번 달",
          what: companionWhat("겹치는 보장부터 함께 정리하겠습니다"),
          why: "중복을 먼저 보면 줄이기 전에 순서가 잡히기 때문입니다",
        },
        {
          when: "다음",
          what: companionWhat("유지·조정이 필요한 부분만 함께 다시 판단하겠습니다"),
          why: "보장 공백 없이 조정하려면 순서가 필요하기 때문입니다",
        },
      ],
    };
  }

  if ((wantsReduction || premiumShareDominates(stats, heaviest)) && heaviest) {
    return {
      transition: CARE_PLAN_TRANSITION,
      steps: [
        {
          when: "이번 달",
          what: companionWhat("부담이 큰 계약부터 함께 확인하겠습니다"),
          why: "납입이 한쪽에 몰려 있을 수 있기 때문입니다",
        },
        {
          when: "다음",
          what: companionWhat("그 계약의 보장 가치를 함께 살펴보겠습니다"),
          why: "줄일지 유지할지는 가치 확인 후에야 하기 때문입니다",
        },
        {
          when: "갱신 시기",
          what: companionWhat("유지·조정을 함께 다시 판단하겠습니다"),
          why: "그때 변경 여지를 함께 보면 되기 때문입니다",
        },
      ],
    };
  }

  return {
    transition: CARE_PLAN_TRANSITION,
    steps: defaultPremiumPlan(),
  };
}

export function buildPhaseCSlice2PremiumCarePlanText(ctx = {}) {
  const plan = buildPhaseCSlice2PremiumCarePlan(ctx);
  if (!plan?.steps?.length) return null;
  return normalizeText(`${plan.transition} ${formatPremiumCarePlanSteps(plan.steps)}`);
}
