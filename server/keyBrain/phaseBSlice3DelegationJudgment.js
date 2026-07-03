/**
 * Phase B Slice 3 — Delegation ("알아서 봐줘." / Decision takeover).
 * Tom: customer delegates decision — KEY leads with judgment, not questions.
 * Direction · Reason (Snapshot+Memory+Gap) · Limitation · First Action.
 */
import { extractFactBundleEvidence } from "../salesDirectorFormatter.js";
import { resolveMemoryFactsFromBundle } from "../keyJudgmentRules.js";
import { hasStructuredRiders } from "../../src/lib/policyExplorer.js";

export const DELEGATION_OPENER = "제가 먼저 이렇게 판단하겠습니다.";

export const DELEGATION_FORBIDDEN_RE =
  /어떤\s*(?:게|것).{0,8}걱정|무엇부터\s*도와|확인이\s*목적.{0,12}결정|제일\s*걸리(?:는)?\s*축.{0,8}무엇|한\s*가지만\s*여쭤|제일\s*불편한\s*게\s*뭐/;

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

function buildMemoryReasonLine(factBundle = {}) {
  const facts = resolveMemoryFactsFromBundle(factBundle);
  if (!facts.length) return "";
  const themes = facts
    .slice(0, 2)
    .map((fact) => fact.theme ?? fact.label ?? fact.summary ?? "")
    .filter(Boolean);
  if (!themes.length) return "이전 대화 맥락도 함께 보고 있습니다.";
  return `이전에 말씀하신 ${themes.join(", ")} 흐름도 함께 보고 있습니다.`;
}

function buildGapReasonLine(evidence = {}) {
  if (evidence.gap_shortages?.length) {
    const primary = evidence.gap_shortages[0];
    return `등록된 보험과 저장된 분석에서 ${primary.label} 축에 확인된 신호가 있습니다.`;
  }
  if (evidence.gap_maintained?.length) {
    return `등록된 보험과 저장된 분석에서 ${evidence.gap_maintained[0]} 축은 유지되는 쪽으로 보입니다.`;
  }
  if (evidence.gap_duplicates?.length) {
    return `등록된 보험에서 ${evidence.gap_duplicates[0]} 축 겹침 신호가 보입니다.`;
  }
  if (evidence.has_policies) {
    return "등록된 가입 보험과 현재 확인된 보장 범위를 기준으로 보고 있습니다.";
  }
  return "";
}

export function isDelegationIntentQuestion(question = "") {
  const q = normalizeQuestion(question);
  if (!q) return false;
  if (/(?:알아서|맡길|맡겨|전적으로)/.test(q) && /(?:봐|봐줘|해|해줘|보자|확인)/.test(q)) {
    return true;
  }
  if (/그냥\s*알아서/.test(q)) return true;
  if (/(?:제일\s*필요|나한테\s*제일).{0,16}(?:봐|보|확인)/.test(q)) return true;
  return false;
}

/**
 * @returns {{ judgment: string, evidence: string, limitation: string, nextAction: string } | null}
 */
export function buildPhaseBSlice3DelegationJudgment({ factBundle = {}, question: questionOverride } = {}) {
  if (!isDelegationIntentQuestion(questionOverride ?? factBundle.question ?? "")) return null;

  const question = normalizeQuestion(questionOverride ?? factBundle.question ?? "");
  const policyCount = resolvePolicyCount(factBundle);
  const policies = factBundle.policies ?? [];
  const evidence = extractFactBundleEvidence({ ...factBundle, question });
  const memoryReason = buildMemoryReasonLine(factBundle);
  const gapReason = buildGapReasonLine(evidence);

  if (policyCount === 0 || !evidence.has_policies) {
    return {
      judgment: `${DELEGATION_OPENER} 지금은 등록된 가입 정보가 없어서, 점검 순서부터 잡기 어렵습니다.`,
      evidence: memoryReason,
      limitation: "어디가 비어 있는지는 가입 정보 확인 전에는 단정할 수 없습니다.",
      nextAction: "보험 정보를 저장해 주시면, 이번에는 그 자료부터 같이 확인해 보겠습니다.",
    };
  }

  if (!policiesHaveCoverageDetail(policies) && !hasCoverageAnalysis(factBundle, evidence)) {
    return {
      judgment: `${DELEGATION_OPENER} 현재 자료에서는 등록된 보험 구조부터 순서를 잡고 보는 것이 맞겠습니다.`,
      evidence: [gapReason, memoryReason].filter(Boolean).join(" ") || `등록된 보험은 ${policyCount}건 확인됩니다.`,
      limitation: "보장내역·특약 확인 전에는 어디가 우선인지 단정하기 어렵습니다.",
      nextAction: "이번에는 등록된 보험 목록과 보장내역부터 같이 맞춰 보겠습니다.",
    };
  }

  if (evidence.gap_shortages?.length) {
    const primary = evidence.gap_shortages[0];
    const statusWord = primary.status === "공백" ? "공백" : "부족";
    return {
      judgment: `${DELEGATION_OPENER} 현재 자료에서는 ${primary.label} 보장 축부터 확인하는 것이 우선입니다.`,
      evidence: [gapReason, memoryReason].filter(Boolean).join(" ") || `그 축에 ${statusWord} 신호가 보입니다.`,
      limitation: "다른 축까지는 이 자료 범위 밖이라, 한 번에 다 단정하지 않겠습니다.",
      nextAction: `이번에는 ${primary.label} 보장부터 같이 확인해 보겠습니다.`,
    };
  }

  if (evidence.gap_duplicates?.length) {
    const label = evidence.gap_duplicates[0];
    return {
      judgment: `${DELEGATION_OPENER} 현재 자료에서는 겹치는 ${label} 보장부터 정리하는 것이 우선입니다.`,
      evidence: [gapReason, memoryReason].filter(Boolean).join(" ") || "같은 축 보장이 여러 계약에 걸려 있습니다.",
      limitation: "어느 계약을 줄일지는 보장 가치 확인 전에는 단정하지 않겠습니다.",
      nextAction: `이번에는 ${label} 겹침부터 같이 짚어 보겠습니다.`,
    };
  }

  if (evidence.gap_maintained?.length) {
    const label = evidence.gap_maintained[0];
    return {
      judgment: `${DELEGATION_OPENER} 현재 자료에서는 ${label} 보장은 유지하는 쪽으로 보이고, 전체 구조를 순서대로 점검하는 것이 맞겠습니다.`,
      evidence: [gapReason, memoryReason].filter(Boolean).join(" ") || "등록된 보험과 저장된 분석 기준입니다.",
      limitation: "특약·한도까지는 아직 확인되지 않았기 때문에, 그 부분은 단정하지 않겠습니다.",
      nextAction: `이번에는 ${label} 축과 전체 구조부터 같이 확인해 보겠습니다.`,
    };
  }

  return {
    judgment: `${DELEGATION_OPENER} 현재 자료에서는 등록된 보험 전체를 실손·암·중대질병 순으로 점검하는 것이 맞겠습니다.`,
    evidence: [gapReason, memoryReason].filter(Boolean).join(" ") || `등록된 보험은 ${policyCount}건 확인됩니다.`,
    limitation: "세부 특약·한도까지는 이 자료만으로는 단정하기 어렵습니다.",
    nextAction: "이번에는 등록된 보험 구조부터 같이 확인해 보겠습니다.",
  };
}

export function buildPhaseBSlice3DelegationResponse({ factBundle = {}, question = "" } = {}) {
  const parts = buildPhaseBSlice3DelegationJudgment({ factBundle, question });
  if (!parts) return null;
  return normalizeText(
    [parts.judgment, parts.evidence, parts.limitation, parts.nextAction].filter(Boolean).join(" "),
  );
}
