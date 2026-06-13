/**
 * Phase 26 Step 2A/2B — Fast conversational response from real analysis + source data state.
 * Phase 27 — Advisor-tone customer-facing responses.
 */

import {
  buildDirectFactualAnswer,
  detectDirectAnswerIntent,
  extractCustomerSituation,
} from "./customerConversationalTone.js";
import { buildClaimFastResponse } from "./claimBridgeLayer.js";
import {
  buildCoverageReviewFastAnswer,
  buildFactualLookupAnswer,
  buildPolicyDetailAnswer,
} from "./intentGateLayer.js";
import { generateCasualChatResponse } from "./casualChatResponseCore.js";

export { generateCasualChatResponse, CASUAL_CHAT_FALLBACK } from "./casualChatResponseCore.js";

const STAGE_LABELS = {
  coverage_gap: "보장 공백",
  underwriting_risk: "인수 위험",
  recommendation: "보험 추천",
  insurance_design: "보험설계안",
};

function pendingStageLabels(cachePayload) {
  const refreshTypes = cachePayload?.background_refresh_types ?? [];
  return refreshTypes.map((type) => STAGE_LABELS[type] ?? type);
}

function buildWorkingContextFromFastInput({ memorySnapshot, sourceContext, sourceSummary }) {
  return {
    snapshot: memorySnapshot,
    sourceContext,
    sourceSummary,
  };
}

export function buildFastConversationalResponse({
  question,
  memorySnapshot,
  cachePayload,
  sourceContext = null,
  sourceSummary = null,
  intentGate = null,
} = {}) {
  const trimmedQuestion = String(question ?? "").trim();
  const workingContext = buildWorkingContextFromFastInput({ memorySnapshot, sourceContext, sourceSummary });

  if (intentGate?.intent === "casual_chat") {
    throw new Error("casual_chat_must_use_buildCasualChatResponse");
  }

  const situation = extractCustomerSituation(workingContext);
  const pending = pendingStageLabels(cachePayload);
  const allFresh = cachePayload?.cache_status === "fresh";
  const hasAnyCustomerData =
    (memorySnapshot?.fact_count ?? 0) > 0 ||
    Boolean(sourceContext?.has_profile || sourceContext?.has_health || sourceContext?.has_policies);

  if (intentGate?.intent === "claim_eligibility_check") {
    return buildClaimFastResponse(trimmedQuestion, workingContext, intentGate);
  }

  if (intentGate?.intent === "coverage_review_request") {
    return buildCoverageReviewFastAnswer(trimmedQuestion, workingContext);
  }

  if (intentGate?.intent === "policy_detail") {
    return buildPolicyDetailAnswer(trimmedQuestion, workingContext);
  }

  if (intentGate?.intent === "factual_lookup") {
    const factualAnswer = buildFactualLookupAnswer(trimmedQuestion, workingContext, intentGate);
    if (factualAnswer) {
      return factualAnswer;
    }
  }

  const directAnswer = buildDirectFactualAnswer(trimmedQuestion, workingContext);
  if (directAnswer) {
    const lines = [directAnswer];
    if (!allFresh && pending.length > 0) {
      lines.push(
        `정밀 분석도 함께 진행 중이니, 잠시 후 더 자세한 안내를 이어서 드리겠습니다.`,
      );
    }
    return lines.join("\n\n");
  }

  const lines = [];
  lines.push(`${situation.customerLabel}, 말씀해 주신 내용 잘 확인했습니다.`);

  if (situation.policyDescriptions.length) {
    lines.push(
      `현재 ${situation.policyDescriptions.join(", ")}를 보유하고 계신 것으로 확인됩니다.`,
    );
  } else if (situation.policyCount > 0) {
    lines.push(`등록된 가입 보험이 ${situation.policyCount}건 확인됩니다.`);
  } else if (hasAnyCustomerData) {
    lines.push("고객님의 프로필·건강·보험 정보를 바탕으로 상담을 이어가겠습니다.");
  } else {
    lines.push(
      "고객 분석 화면에서 프로필·건강·보험 정보를 먼저 저장해 주시면 더 정확한 안내가 가능합니다.",
    );
  }

  if (situation.medication) {
    lines.push(
      `건강 정보에 ${situation.medication} 이력이 있어, 가입 심사 시 추가 확인이 필요할 수 있습니다.`,
    );
  }

  if (situation.keepLabels.length) {
    lines.push(`기존 ${situation.keepLabels.join(", ")} 보장은 유지하시는 것이 좋습니다.`);
  }

  if (allFresh) {
    lines.push("최근 분석 결과를 바로 반영해 질문에 맞춰 안내해 드리겠습니다.");
  } else if (pending.length > 0) {
    lines.push(
      `보장 상태와 인수 심사, 추천·설계안을 차례로 분석하고 있으니 잠시만 기다려 주세요.`,
    );
  }

  if (/약|병력|건강|질환/.test(trimmedQuestion) && !situation.medication) {
    lines.push("추가 복용 약이나 병력이 있으시면 알려주시면 더 정확히 안내해 드리겠습니다.");
  }

  lines.push("분석이 완료되면 결과가 화면에 자동으로 연결됩니다.");

  return lines.join("\n\n");
}

export async function buildCasualChatResponse({ question, fetchImpl = fetch, env = process.env } = {}) {
  return generateCasualChatResponse({ question, fetchImpl, env });
}

export function buildStageProgressLabel(stageKey, status = "completed") {
  const label = STAGE_LABELS[stageKey] ?? stageKey;
  if (status === "processing") return `${label} 분석 중…`;
  if (status === "completed") return `${label} 분석 완료`;
  if (status === "failed") return `${label} 분석 실패`;
  return `${label} 대기`;
}

export { STAGE_LABELS, detectDirectAnswerIntent };
