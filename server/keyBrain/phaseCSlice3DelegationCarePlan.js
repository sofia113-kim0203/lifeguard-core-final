/**
 * Phase C Slice 3 — Delegation Care Plan ("알아서 봐줘." / decision delegation).
 * Tom v1.2: Care Leadership — KEY leads order first, shared decision last; not "다 맡겨 주세요".
 */
import { extractFactBundleEvidence } from "../salesDirectorFormatter.js";
import {
  buildPhaseBSlice3DelegationJudgment,
  isDelegationIntentQuestion,
} from "./phaseBSlice3DelegationJudgment.js";
import { hasStructuredRiders } from "../../src/lib/policyExplorer.js";

export const DELEGATION_CARE_PLAN_TRANSITION =
  "그럼 앞으로는 제가 이런 순서로 같이 진행하겠습니다.";

export const DELEGATION_CARE_PLAN_FORBIDDEN_RE =
  /(?:다\s*맡겨|맡겨\s*주|전부\s*맡|가입(?:하(?:세요|시|는|실)|권)|해지(?:하(?:세요|시|라)|(?:해|하)\s*드)|청구\s*확정|추천(?:드|해)|(?:이|해)?보세요|들(?:어|으)세요)/;

export const INTERNAL_WHY_RE = /statistics|OCR|field_count|내부|시스템/i;

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

function policiesHaveCoverageDetail(policies = []) {
  return policies.some((policy) => {
    if (hasStructuredRiders(policy)) return true;
    const riders = policy.coverage_summary?.riders;
    return Array.isArray(riders) && riders.length > 0;
  });
}

function hasCoverageAnalysis(factBundle = {}, evidence = {}) {
  return (
    factBundle.coverage_gap_used === true ||
    factBundle.has_stored_coverage_analysis === true ||
    evidence.has_coverage_analysis === true
  );
}

function leadershipWhat(subject, tail = "같이 결과를 보겠습니다") {
  const topic = String(subject).trim();
  if (/하고$/.test(topic)) {
    return `제가 먼저 ${topic}, ${tail}`;
  }
  return `제가 먼저 ${topic} 확인하고, ${tail}`;
}

export function formatDelegationCarePlanSteps(steps = []) {
  return steps
    .filter((step) => step?.when && step?.what)
    .map((step, index) => {
      const whyClause = step.why ? ` (${step.why})` : "";
      return `${STEP_MARKERS[index] ?? `${index + 1}.`} ${step.when} ${step.what}${whyClause}`;
    })
    .join(" ");
}

export function shouldApplyPhaseCSlice3DelegationCarePlan(factBundle = {}, question = "") {
  return isDelegationIntentQuestion(question || factBundle.question || "");
}

/**
 * @returns {{ transition: string, steps: Array<{ when: string, what: string, why?: string }> } | null}
 */
export function buildPhaseCSlice3DelegationCarePlan({
  factBundle = {},
  question: questionOverride,
  phaseBJudgment = null,
} = {}) {
  const question = normalizeQuestion(questionOverride ?? factBundle.question ?? "");
  if (!shouldApplyPhaseCSlice3DelegationCarePlan(factBundle, question)) return null;

  const phaseB = phaseBJudgment ?? buildPhaseBSlice3DelegationJudgment({ factBundle, question });
  if (!phaseB) return null;

  const policyCount = resolvePolicyCount(factBundle);
  const policies = factBundle.policies ?? [];
  const evidence = extractFactBundleEvidence({ ...factBundle, question });

  if (policyCount === 0 || !evidence.has_policies) {
    return {
      transition: DELEGATION_CARE_PLAN_TRANSITION,
      steps: [
        {
          when: "이번 달",
          what: leadershipWhat("가입 정보를 정리하고", "같이 시작점을 보겠습니다"),
          why: "점검 순서를 잡으려면 먼저 등록된 계약이 필요하기 때문입니다",
        },
        {
          when: "정리 후",
          what: leadershipWhat("등록된 보장 구조부터", "순서를 같이 잡겠습니다"),
          why: "어디부터 볼지는 구조가 잡혀야 정하기 때문입니다",
        },
      ],
    };
  }

  if (!policiesHaveCoverageDetail(policies) && !hasCoverageAnalysis(factBundle, evidence)) {
    return {
      transition: DELEGATION_CARE_PLAN_TRANSITION,
      steps: [
        {
          when: "이번 달",
          what: leadershipWhat("등록된 보험 목록과 보장내역을", "같이 맞춰 보겠습니다"),
          why: "순서를 정하려면 먼저 구조를 봐야 하기 때문입니다",
        },
        {
          when: "다음",
          what: "확인한 내용을 바탕으로 우선 순서를 함께 정하겠습니다",
          why: "무엇이 먼저인지는 자료가 맞춰진 뒤에야 하기 때문입니다",
        },
      ],
    };
  }

  if (evidence.gap_shortages?.length) {
    const primary = evidence.gap_shortages[0];
    return {
      transition: DELEGATION_CARE_PLAN_TRANSITION,
      steps: [
        {
          when: "이번 달",
          what: leadershipWhat(`${primary.label} 보장 축부터`, "같이 결과를 보겠습니다"),
          why: "지금 자료에서 이 축 신호가 먼저 보이기 때문입니다",
        },
        {
          when: "다음",
          what: "확인한 내용을 바탕으로 다음 순서를 함께 정하겠습니다",
          why: "한 번에 다 단정하지 않으려면 순서가 필요하기 때문입니다",
        },
        {
          when: "그다음",
          what: "필요한 조정이 있으면 그때 함께 결정하겠습니다",
          why: "최종 선택은 확인 후에 함께 하려는 것입니다",
        },
      ],
    };
  }

  if (evidence.gap_duplicates?.length) {
    const label = evidence.gap_duplicates[0];
    return {
      transition: DELEGATION_CARE_PLAN_TRANSITION,
      steps: [
        {
          when: "이번 달",
          what: leadershipWhat(`겹치는 ${label} 보장부터`, "같이 정리해 보겠습니다"),
          why: "겹침을 먼저 보면 다음 판단이 수월하기 때문입니다",
        },
        {
          when: "다음",
          what: "정리한 내용을 바탕으로 유지·조정을 함께 판단하겠습니다",
          why: "어느 계약을 줄일지는 확인 후에 함께 정하려는 것입니다",
        },
      ],
    };
  }

  if (evidence.gap_maintained?.length) {
    const label = evidence.gap_maintained[0];
    return {
      transition: DELEGATION_CARE_PLAN_TRANSITION,
      steps: [
        {
          when: "이번 달",
          what: leadershipWhat(`${label} 축과 전체 구조부터`, "같이 확인해 보겠습니다"),
          why: "유지되는 축을 먼저 보면 전체 순서가 잡히기 때문입니다",
        },
        {
          when: "다음",
          what: leadershipWhat("실손·암·중대질병 순서로 남은 축을", "같이 점검하겠습니다"),
          why: "한 축만 보고 끝내지 않으려는 것입니다",
        },
        {
          when: "그다음",
          what: "확인한 내용을 바탕으로 함께 결정하겠습니다",
          why: "최종 선택은 자료 확인 후에 함께 하려는 것입니다",
        },
      ],
    };
  }

  return {
    transition: DELEGATION_CARE_PLAN_TRANSITION,
    steps: [
      {
        when: "이번 달",
        what: leadershipWhat("실손 구조부터", "같이 결과를 보겠습니다"),
        why: "전체 점검은 실손부터 보는 순서가 자연스럽기 때문입니다",
      },
      {
        when: "다음",
        what: leadershipWhat("암·중대질병 축을 순서대로", "같이 점검하겠습니다"),
        why: "한 번에 다 단정하지 않으려면 순서가 필요하기 때문입니다",
      },
      {
        when: "그다음",
        what: "확인한 내용을 바탕으로 함께 결정하겠습니다",
        why: "리드는 제가 하고, 최종 선택은 함께 하려는 것입니다",
      },
    ],
  };
}

export function buildPhaseCSlice3DelegationCarePlanText(ctx = {}) {
  const plan = buildPhaseCSlice3DelegationCarePlan(ctx);
  if (!plan?.steps?.length) return null;
  return normalizeText(`${plan.transition} ${formatDelegationCarePlanSteps(plan.steps)}`);
}

export function buildPhaseCSlice3DelegationResponseWithCarePlan({
  factBundle = {},
  question = "",
} = {}) {
  const q = normalizeQuestion(question || factBundle.question || "");
  const phaseB = buildPhaseBSlice3DelegationJudgment({ factBundle, question: q });
  if (!phaseB) return null;

  const carePlanText = buildPhaseCSlice3DelegationCarePlanText({
    factBundle,
    question: q,
    phaseBJudgment: phaseB,
  });

  return normalizeText(
    [phaseB.judgment, phaseB.evidence, phaseB.limitation, carePlanText ? null : phaseB.nextAction, carePlanText]
      .filter(Boolean)
      .join(" "),
  );
}
