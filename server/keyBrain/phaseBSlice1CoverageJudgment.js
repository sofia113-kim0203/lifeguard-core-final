/**
 * Phase B Slice 1 — Coverage adequacy ("내 보험 괜찮아?" / JC-COVERAGE-ANXIETY-v1).
 * Frozen Phase B design: Customer Intent First → P0–P4 within Coverage → Direction · Reason · First Action.
 * Tom Slice 1: judgment first — no counselor empathy opener; customer-understandable reason.
 */
import { COVERAGE_ANXIETY_COMPANION_CLUSTER_ID } from "../intentGateLayer.js";
import { extractFactBundleEvidence } from "../salesDirectorFormatter.js";
import { hasStructuredRiders } from "../../src/lib/policyExplorer.js";

const EMPATHY_OPENER_RE = /걱정되시는|마음은\s*이해|뭔가\s*빠진\s*것\s*같/;

function normalizeQuestion(question = "") {
  return String(question ?? "")
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

export function shouldApplyPhaseBSlice1CoverageJudgment(factBundle = {}) {
  return factBundle.companion_cluster === COVERAGE_ANXIETY_COMPANION_CLUSTER_ID;
}

/**
 * @returns {{ judgment: string, evidence: string, limitation: string, nextAction: string } | null}
 */
export function buildPhaseBSlice1CoverageJudgment({ factBundle = {}, question: questionOverride } = {}) {
  if (!shouldApplyPhaseBSlice1CoverageJudgment(factBundle)) return null;

  const question = normalizeQuestion(questionOverride ?? factBundle.question ?? "");
  const signals = factBundle.companion_cluster_signals ?? [];
  const policyCount = resolvePolicyCount(factBundle);
  const policies = factBundle.policies ?? [];
  const evidence = extractFactBundleEvidence({ ...factBundle, question });

  if (policyCount === 0 || !evidence.has_policies) {
    return {
      judgment: "지금은 등록된 가입 정보가 없어서, 괜찮은지 판단하기 어렵습니다.",
      evidence: "",
      limitation: "보장 상태를 보려면 먼저 가입 정보를 확인해야 합니다.",
      nextAction: "보험 정보를 저장해 주시면, 그때부터 같이 확인해 보겠습니다.",
    };
  }

  if (!policiesHaveCoverageDetail(policies) && !hasCoverageAnalysis(factBundle, evidence)) {
    return {
      judgment:
        "지금 확인된 가입 보험은 있지만, 보장내역·특약 확인 전에는 충분한지 단정하기 어렵습니다.",
      evidence: `등록된 보험은 ${policyCount}건 확인됩니다.`,
      limitation: "확인된 보장 범위까지는 아직 이 자료만으로는 말씀드리기 어렵습니다.",
      nextAction: "이번에는 특약·보장내역부터 같이 맞춰 보겠습니다.",
    };
  }

  if (evidence.gap_shortages?.length) {
    const primary = evidence.gap_shortages[0];
    const statusWord = primary.status === "공백" ? "공백" : "부족";
    return {
      judgment: `지금 확인되는 범위에서는 ${primary.label} 보장 쪽 ${statusWord}이 먼저 짚을 부분으로 보입니다.`,
      evidence: "등록된 보험 내용을 보면 그 축에서 확인된 신호가 있습니다.",
      limitation: "다른 축은 이 자료 범위 밖이라, 한 번에 다 말씀드리기는 어렵습니다.",
      nextAction: `이번에는 ${primary.label} 보장부터 같이 확인해 보겠습니다.`,
    };
  }

  if (
    signals.includes("cancer_gap") ||
    (/암/.test(question) && evidence.policy_absent_categories.includes("암"))
  ) {
    return {
      judgment: "지금 확인되는 범위에서는 암 관련 계약은 아직 보이지 않습니다.",
      evidence: "등록된 보험 목록 기준입니다.",
      limitation:
        "다만 다른 계약에 암 특약이 있을 수 있어, 특약 확인 전에는 단정하지 않겠습니다.",
      nextAction: "이번에는 암 보장부터 같이 확인해 보겠습니다.",
    };
  }

  if (/암/.test(question) && evidence.policy_present_categories.includes("암")) {
    return {
      judgment: "지금 확인되는 범위에서는 암 보장 쪽 계약은 있습니다.",
      evidence: "등록된 보험 내용을 보면 그렇습니다.",
      limitation:
        "다만 한도·진단비까지는 특약 확인 전이라, 그 부분은 단정하지 않겠습니다.",
      nextAction: "이번에는 암 보장 한도부터 같이 확인해 보겠습니다.",
    };
  }

  if (evidence.gap_maintained?.length) {
    const label = evidence.gap_maintained[0];
    return {
      judgment: `지금 확인되는 범위에서는 ${label} 보장은 유지하는 쪽이 맞아 보입니다.`,
      evidence: "현재 자료에서는 큰 공백 신호는 보이지 않습니다.",
      limitation:
        "다만 특약까지는 아직 확인되지 않았기 때문에, 그 부분은 단정하지 않겠습니다.",
      nextAction: `이번에는 ${label} 보장부터 같이 확인해 보겠습니다.`,
    };
  }

  if (signals.includes("inadequacy_feel") || signals.includes("missing_piece")) {
    return {
      judgment: "지금 확인되는 범위에서는 눈에 띄는 공백 신호는 보이지 않습니다.",
      evidence: "등록된 보험 내용 기준입니다.",
      limitation:
        "다만 세부 특약까지는 아직 확인되지 않았기 때문에, 그 부분은 단정하지 않겠습니다.",
      nextAction: "이번에는 보장내역부터 같이 확인해 보겠습니다.",
    };
  }

  return {
    judgment:
      "지금 확인되는 범위에서는 큰 공백 신호는 보이지 않습니다. 전부 괜찮다고 단정하긴 어렵습니다.",
    evidence: "등록된 보험 내용과 현재 확인된 보장 범위 기준입니다.",
    limitation: "다만 특약·한도까지는 아직 확인되지 않았기 때문에, 그 부분은 단정하지 않겠습니다.",
    nextAction: "이번에는 등록된 보험 내용부터 같이 확인해 보겠습니다.",
  };
}

export { EMPATHY_OPENER_RE };
