/**
 * Phase C Slice 1 — Care Plan Next Step (coverage anxiety follow-on).
 * Tom: Judge ends → transition → numbered timeline plan (not product design).
 * Phase C design principle (all slices): What · When · Why — Why/voice evolve in later slices.
 */
import { COVERAGE_ANXIETY_COMPANION_CLUSTER_ID } from "../intentGateLayer.js";
import { extractFactBundleEvidence } from "../salesDirectorFormatter.js";
import {
  shouldApplyPhaseBSlice1CoverageJudgment,
  buildPhaseBSlice1CoverageJudgment,
} from "./phaseBSlice1CoverageJudgment.js";
import { hasStructuredRiders } from "../../src/lib/policyExplorer.js";

export const CARE_PLAN_TRANSITION = "그럼 앞으로는 이렇게 진행하면 됩니다.";

export const CARE_PLAN_FORBIDDEN_RE =
  /(?:가입(?:하(?:세요|시|는|실)|권)|추천(?:드|해)|리모델링|설계(?:안|해\s*드)|(?:이|해)?보세요|들(?:어|으)세요)/;

const STEP_MARKERS = ["①", "②", "③", "④"];
const AUTO_POLICY_RE = /자동차|운전자|교통사고/i;
const CANCER_AXIS_RE = /암/;

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

function policiesHaveCoverageDetail(policies = []) {
  return policies.some((policy) => {
    if (hasStructuredRiders(policy)) return true;
    const riders = policy.coverage_summary?.riders;
    return Array.isArray(riders) && riders.length > 0;
  });
}

function hasAutoPolicySignal(policies = []) {
  return policies.some((policy) => {
    const name = String(policy.product_name ?? policy.product ?? "");
    if (AUTO_POLICY_RE.test(name)) return true;
    const riders = policy.coverage_summary?.riders ?? [];
    return riders.some((rider) => {
      const label = String(rider?.rider_name ?? rider?.normalized_name ?? rider?.name ?? "");
      return AUTO_POLICY_RE.test(label);
    });
  });
}

function hasCancerCoverageSignal(policies = [], evidence = {}) {
  if (evidence.policy_present_categories.some((label) => CANCER_AXIS_RE.test(label))) {
    return true;
  }
  return policies.some((policy) => {
    const riders = policy.coverage_summary?.riders ?? [];
    return riders.some((rider) => {
      const label = String(rider?.rider_name ?? rider?.normalized_name ?? rider?.name ?? "");
      return CANCER_AXIS_RE.test(label);
    });
  });
}

function axisNeedsLaterCheck(label = "") {
  return label && !CANCER_AXIS_RE.test(label);
}

export function formatCarePlanSteps(steps = []) {
  return steps
    .filter((step) => step?.timeframe && step?.action)
    .map((step, index) => `${STEP_MARKERS[index] ?? `${index + 1}.`} ${step.timeframe} ${step.action}`)
    .join(" ");
}

export function shouldApplyPhaseCSlice1CoverageCarePlan(factBundle = {}) {
  return (
    factBundle.companion_cluster === COVERAGE_ANXIETY_COMPANION_CLUSTER_ID &&
    shouldApplyPhaseBSlice1CoverageJudgment(factBundle)
  );
}

/**
 * @returns {{ transition: string, steps: Array<{ timeframe: string, action: string }> } | null}
 */
export function buildPhaseCSlice1CoverageCarePlan({
  factBundle = {},
  question: questionOverride,
  phaseBJudgment = null,
} = {}) {
  if (!shouldApplyPhaseCSlice1CoverageCarePlan(factBundle)) return null;

  const question = normalizeQuestion(questionOverride ?? factBundle.question ?? "");
  const phaseB = phaseBJudgment ?? buildPhaseBSlice1CoverageJudgment({ factBundle, question });
  if (!phaseB) return null;

  const policyCount = resolvePolicyCount(factBundle);
  const policies = factBundle.policies ?? [];
  const evidence = extractFactBundleEvidence({ ...factBundle, question });
  const signals = factBundle.companion_cluster_signals ?? [];
  const hasAuto = hasAutoPolicySignal(policies);
  const hasCancer = hasCancerCoverageSignal(policies, evidence);

  const withAuto = (steps) => {
    if (hasAuto) {
      steps.push({ timeframe: "갱신 시기", action: "자동차 보험 확인" });
    }
    return { transition: CARE_PLAN_TRANSITION, steps };
  };

  if (policyCount === 0 || !evidence.has_policies) {
    return {
      transition: CARE_PLAN_TRANSITION,
      steps: [
        { timeframe: "이번 달", action: "가입 정보 저장" },
        { timeframe: "저장 후", action: "보장 구조 순서대로 점검" },
      ],
    };
  }

  if (!policiesHaveCoverageDetail(policies) && !evidence.has_coverage_analysis) {
    return {
      transition: CARE_PLAN_TRANSITION,
      steps: [
        { timeframe: "이번 달", action: "특약·보장내역 맞추기" },
        { timeframe: "정리 후", action: "축별 순서 잡기" },
      ],
    };
  }

  if (evidence.gap_shortages?.length) {
    const primary = evidence.gap_shortages[0];
    const steps = [{ timeframe: "이번 달", action: `${primary.label} 보장 확인` }];
    if (evidence.gap_maintained?.length && axisNeedsLaterCheck(evidence.gap_maintained[0])) {
      steps.push({ timeframe: "그다음", action: `${evidence.gap_maintained[0]} 구조 점검` });
    } else {
      steps.push({ timeframe: "그다음", action: "다른 보장 축 점검" });
    }
    return withAuto(steps);
  }

  if (
    signals.includes("cancer_gap") ||
    (/암/.test(question) && evidence.policy_absent_categories.includes("암"))
  ) {
    const steps = [{ timeframe: "이번 달", action: "암 보장 축 점검" }];
    steps.push({
      timeframe: "그다음",
      action: evidence.gap_maintained?.length
        ? `${evidence.gap_maintained[0]} 구조 점검`
        : "실손 등 다른 축 점검",
    });
    return withAuto(steps);
  }

  if (/암/.test(question) && hasCancer) {
    const steps = [{ timeframe: "이번 달", action: "암 보장 한도 확인" }];
    steps.push({
      timeframe: "올해 안",
      action: evidence.gap_maintained?.length
        ? `${evidence.gap_maintained[0]} 구조 점검`
        : "다른 보장 축 점검",
    });
    return withAuto(steps);
  }

  if (evidence.gap_maintained?.length) {
    const primary = evidence.gap_maintained[0];
    const steps = [{ timeframe: "이번 달", action: `${primary} 구조 확인` }];
    if (!hasCancer || axisNeedsLaterCheck(primary)) {
      steps.push({ timeframe: "올해 안", action: "암 보장 점검" });
    }
    return withAuto(steps);
  }

  if (signals.includes("inadequacy_feel") || signals.includes("missing_piece")) {
    return withAuto([
      { timeframe: "이번 달", action: "등록된 보험 구조 확인" },
      { timeframe: "올해 안", action: "암·실손 축 순서대로 점검" },
    ]);
  }

  return withAuto([
    { timeframe: "이번 달", action: "등록된 보험 구조 확인" },
    { timeframe: "올해 안", action: "암 보장 점검" },
  ]);
}

export function buildPhaseCSlice1CoverageCarePlanText(ctx = {}) {
  const plan = buildPhaseCSlice1CoverageCarePlan(ctx);
  if (!plan?.steps?.length) return null;
  return normalizeText(`${plan.transition} ${formatCarePlanSteps(plan.steps)}`);
}
