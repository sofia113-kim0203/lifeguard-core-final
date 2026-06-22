/**
 * P5-BRAIN — state-aware answers for the 4 pilot questions only.
 */
import { computePremiumLookupStats } from "./intentGateLayer.js";
import { P5_BRAIN_PILOT_KEYS } from "./p5BrainPilotQuestions.js";

function joinTopics(topics = []) {
  const list = topics.filter(Boolean);
  if (list.length === 0) return "보험 관련 이야기";
  if (list.length === 1) return `${list[0]} 이야기`;
  if (list.length === 2) return `${list[0]}와 ${list[1]} 이야기`;
  return `${list.slice(0, -1).join(", ")}와 ${list[list.length - 1]} 이야기`;
}

function composePremiumBurdenAnswer(bundle) {
  const stats = computePremiumLookupStats(bundle.policies ?? []);
  if (stats.totalCount === 0) return { ok: false, reason: "no_policies" };

  const premiumLine =
    stats.premiumKnownCount > 0
      ? `월 보험료는 약 ${stats.premiumTotal.toLocaleString("ko-KR")}원으로 확인됩니다.`
      : `보험 ${stats.totalCount}건은 확인되지만 월 보험료 합계는 아직 확인되지 않았습니다.`;

  return {
    ok: true,
    text: [
      `현재 확인되는 보험은 ${stats.totalCount}건입니다.`,
      premiumLine,
      "부담을 느끼는 이유가 총액 때문인지 최근 인상 때문인지 알려주세요.",
    ].join("\n"),
  };
}

function composeCancerCoverageAnswer(bundle) {
  const policies = bundle.policies ?? [];
  const cancerPolicies = policies.filter((policy) =>
    /암|cancer/i.test(`${policy.product_name ?? ""} ${policy.policy_type ?? ""}`),
  );

  if (policies.length === 0 && (bundle.documentCount ?? 0) === 0) {
    return { ok: false, reason: "no_state" };
  }

  if (cancerPolicies.length > 0) {
    const names = cancerPolicies
      .slice(0, 3)
      .map((policy) => `${policy.insurer_name ?? "보험사"} ${policy.product_name ?? ""}`.trim())
      .join(", ");
    return {
      ok: true,
      text: [
        `현재 등록된 보험 중 암 관련 계약이 ${cancerPolicies.length}건 확인됩니다.`,
        names ? `확인된 상품: ${names}.` : "",
        "담보 한도와 실제 보장 공백은 증권·보장내역 기준으로 같이 볼게요. 특히 걱정되는 질병이나 가입 시기가 있으면 알려주세요.",
      ]
        .filter(Boolean)
        .join("\n"),
    };
  }

  if (policies.length > 0) {
    return {
      ok: true,
      text: [
        `현재 ${policies.length}건의 보험이 확인됩니다.`,
        "암보험 담보는 상품명만으로는 단정하기 어려워요. 보장내역서나 증권 기준으로 암 진단비·치료비 담보를 같이 확인해 볼게요.",
      ].join("\n"),
    };
  }

  return {
    ok: true,
    text: `업로드된 문서 ${bundle.documentCount}건이 확인됩니다. 문서 기준으로 암보장 여부를 같이 확인해 볼게요.`,
  };
}

function composeInsuranceAnalysisAnswer(bundle) {
  const policyCount = bundle.policies?.length ?? 0;
  const documentCount = bundle.documentCount ?? 0;

  if (policyCount === 0 && documentCount === 0) {
    return { ok: false, reason: "no_state" };
  }

  const parts = [];
  if (policyCount > 0) parts.push(`보험 ${policyCount}건`);
  if (documentCount > 0) parts.push(`문서 ${documentCount}건`);

  return {
    ok: true,
    text: [
      `현재 ${parts.join(", ")}이 확인됩니다.`,
      "어느 부분부터 같이 볼까요? 보험료, 보장 공백, 또는 최근 업로드 문서 중에서 말씀해 주세요.",
    ].join("\n"),
  };
}

function composeContinueConversationAnswer(bundle) {
  const recent = bundle.recentConversation ?? {};
  if (!recent.hasHistory) {
    return { ok: false, reason: "no_recent_conversation" };
  }

  return {
    ok: true,
    text: [
      `최근에는 ${joinTopics(recent.topics)}를 나눴어요.`,
      "어떤 부분을 이어서 보고 싶으세요?",
    ].join("\n"),
  };
}

/** @returns {{ ok: boolean, text?: string, reason?: string }} */
export function composeP5BrainStateAwareAnswer(pilotKey, _question, bundle) {
  switch (pilotKey) {
    case P5_BRAIN_PILOT_KEYS.PREMIUM_BURDEN:
      return composePremiumBurdenAnswer(bundle);
    case P5_BRAIN_PILOT_KEYS.CANCER_COVERAGE:
      return composeCancerCoverageAnswer(bundle);
    case P5_BRAIN_PILOT_KEYS.INSURANCE_ANALYSIS:
      return composeInsuranceAnalysisAnswer(bundle);
    case P5_BRAIN_PILOT_KEYS.CONTINUE_CONVERSATION:
      return composeContinueConversationAnswer(bundle);
    default:
      return { ok: false, reason: "unknown_pilot_key" };
  }
}
