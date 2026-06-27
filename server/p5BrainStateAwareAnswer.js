/**
 * P5-BRAIN — state-aware answers for pilot questions only.
 * Customer-facing text: verified facts only; no inventory dumps or unverified numbers.
 */
import { P5_BRAIN_PILOT_KEYS } from "./p5BrainPilotQuestions.js";

function formatRecentTurnExcerpt(recent = {}) {
  const excerpt = String(
    recent.latestUserMessageExcerpt ?? recent.latestUserMessages?.[0] ?? "",
  ).trim();
  if (!excerpt) return null;
  return excerpt.length > 60 ? `${excerpt.slice(0, 60)}…` : excerpt;
}

function hasPolicies(bundle) {
  return (bundle.policies ?? []).length > 0;
}

function hasDocuments(bundle) {
  return (bundle.documentCount ?? 0) > 0 || (bundle.documents ?? []).length > 0;
}

function composePremiumBurdenAnswer(bundle) {
  if (!hasPolicies(bundle)) return { ok: false, reason: "no_policies" };

  return {
    ok: true,
    text: [
      "가입된 보험이 있는 것은 확인돼요.",
      "다만 총 보험료는 현재 검증이 필요합니다.",
      "부담이 총액 때문인지, 최근 인상 때문인지 알려주시면 그 기준으로 같이 판단해볼게요.",
    ].join("\n"),
  };
}

function composeCancerCoverageAnswer(bundle) {
  if (!hasPolicies(bundle) && !hasDocuments(bundle)) {
    return { ok: false, reason: "no_state" };
  }

  const policies = bundle.policies ?? [];
  const cancerPolicies = policies.filter((policy) =>
    /암|cancer/i.test(`${policy.product_name ?? ""} ${policy.policy_type ?? ""}`),
  );

  if (policies.length > 0 && cancerPolicies.length > 0) {
    return {
      ok: true,
      text: [
        "가입된 보험 중 암 관련 상품이 보이긴 해요.",
        "다만 담보 범위와 한도는 증권·보장내역 기준으로 확인이 필요해요.",
        "특히 걱정되는 질병이나 가입 시기가 있으면 알려주세요.",
      ].join("\n"),
    };
  }

  if (policies.length > 0) {
    return {
      ok: true,
      text: [
        "가입된 보험이 확인돼요.",
        "암보험 담보는 상품명만으로는 단정하기 어려워요. 보장내역서나 증권 기준으로 암 진단비·치료비 담보를 같이 확인해 볼게요.",
      ].join("\n"),
    };
  }

  return {
    ok: true,
    text: "업로드된 문서가 있어요. 문서 기준으로 암보장 여부를 같이 확인해 볼게요.",
  };
}

function composeInsuranceAnalysisAnswer(bundle) {
  if (!hasPolicies(bundle) && !hasDocuments(bundle)) {
    return { ok: false, reason: "no_state" };
  }

  const parts = [];
  if (hasPolicies(bundle)) parts.push("가입된 보험");
  if (hasDocuments(bundle)) parts.push("업로드된 문서");

  return {
    ok: true,
    text: [
      `${parts.join("과 ")}가 확인돼요.`,
      "어느 부분부터 같이 볼까요? 보험료, 보장 공백, 또는 최근 문서 중에서 말씀해 주세요.",
    ].join("\n"),
  };
}

function composeContinueConversationAnswer(bundle) {
  const recent = bundle.recentConversation ?? {};
  if (!recent.hasHistory) {
    return { ok: false, reason: "no_recent_conversation" };
  }

  const excerpt = formatRecentTurnExcerpt(recent);
  const lead = excerpt
    ? `최근에 "${excerpt}" 이야기를 나눴어요.`
    : "최근 대화가 확인돼요.";

  return {
    ok: true,
    text: [lead, "어떤 부분을 이어서 보고 싶으세요?"].join("\n"),
  };
}

function composeDocumentCancerContentAnswer(bundle) {
  if (hasDocuments(bundle)) {
    return {
      ok: true,
      text: [
        "업로드된 문서가 있는 것은 확인돼요.",
        "다만 암 관련 내용 확정은 문서 내용 확인이 필요합니다.",
      ].join("\n"),
    };
  }

  return {
    ok: true,
    text: "현재 확인되는 업로드 문서가 없어 판단할 수 없습니다.",
    guarded: true,
  };
}

function composeP5BrainGuardedAnswer(pilotKey, bundle, reason = null) {
  switch (pilotKey) {
    case P5_BRAIN_PILOT_KEYS.PREMIUM_BURDEN:
      return {
        text: [
          "현재 확인되는 가입 보험이 없어요.",
          "보험 정보를 저장해 주시면 보험료 부담을 같이 보면 됩니다.",
        ].join("\n"),
        guarded: true,
        reason: reason ?? "no_policies",
      };
    case P5_BRAIN_PILOT_KEYS.CANCER_COVERAGE:
      return {
        text: [
          "현재 확인되는 가입 보험이나 업로드 문서가 없어요.",
          "암보장 여부는 보험 정보나 문서가 확인되면 같이 볼게요.",
        ].join("\n"),
        guarded: true,
        reason: reason ?? "no_state",
      };
    case P5_BRAIN_PILOT_KEYS.INSURANCE_ANALYSIS:
      return {
        text: [
          "현재 확인되는 가입 보험이나 업로드 문서가 없어요.",
          "궁금하신 주제를 말씀해 주시면 거기서부터 같이 볼게요.",
        ].join("\n"),
        guarded: true,
        reason: reason ?? "no_state",
      };
    case P5_BRAIN_PILOT_KEYS.CONTINUE_CONVERSATION:
      return {
        text: [
          "아직 이어갈 최근 대화가 확인되지 않아요.",
          "지금 궁금하신 주제를 말씀해 주시면 거기서부터 같이 볼게요.",
        ].join("\n"),
        guarded: true,
        reason: reason ?? "no_recent_conversation",
      };
    case P5_BRAIN_PILOT_KEYS.DOCUMENT_CANCER_CONTENT:
      return composeDocumentCancerContentAnswer(bundle);
    default:
      return {
        text: "지금은 고객 상태를 확인하는 중이에요. 궁금하신 내용을 조금 더 알려주시면 같이 볼게요.",
        guarded: true,
        reason: reason ?? "unknown_pilot_key",
      };
  }
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
    case P5_BRAIN_PILOT_KEYS.DOCUMENT_CANCER_CONTENT:
      return composeDocumentCancerContentAnswer(bundle);
    default:
      return { ok: false, reason: "unknown_pilot_key" };
  }
}

/**
 * Always returns a pilot answer; never falls through to legacy chat.
 * @returns {{ text: string, guarded: boolean, reason?: string|null }}
 */
export function resolveP5BrainPilotAnswer(pilotKey, _question, bundle) {
  const composed = composeP5BrainStateAwareAnswer(pilotKey, _question, bundle);
  if (composed.ok && composed.text) {
    return {
      text: composed.text,
      guarded: composed.guarded === true,
      reason: composed.reason ?? null,
    };
  }

  const guarded = composeP5BrainGuardedAnswer(pilotKey, bundle, composed.reason ?? null);
  return {
    text: guarded.text,
    guarded: guarded.guarded !== false,
    reason: guarded.reason ?? composed.reason ?? null,
  };
}
