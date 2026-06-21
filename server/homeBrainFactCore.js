/**
 * P2-A / P3 — Home Tom brain (JWT/RLS read-only, 3-way route + inventory guard).
 */
import { classifyConsultationIntent, computePremiumLookupStats } from "./intentGateLayer.js";
import { loadUnifiedCustomerState, loadRawCustomerRecords } from "./unifiedCustomerState.js";
import {
  finalizeOneBrainResponse,
  ONE_BRAIN_SURFACES,
} from "./oneBrainResponseLayer.js";
import { buildFactBundleFromUnified } from "./guidanceLayer/guidanceBuilder.js";
import { runTomGapLightVoiceTurn, shouldUseTomGapLightPath } from "./tomGapLightPath.js";
import { buildCasualChatResponse } from "./fastResponseLayer.js";
import { violatesHomeInventoryDump } from "./tomThinkingLoop.js";
import {
  HOME_BRAIN_ROUTES,
  HOME_BRAIN_SUPPORTED_INTENTS,
  HOME_HIGH_STAKES_DEFER_MESSAGE,
  classifyHomeBrainIntent,
  composeHomeHighStakesDeferMessage,
  resolveHomeBrainRoute,
} from "./homeBrainRouter.js";

export {
  HOME_BRAIN_SUPPORTED_INTENTS,
  classifyHomeBrainIntent,
  HOME_HIGH_STAKES_DEFER_MESSAGE,
};

export const HOME_BRAIN_UNSUPPORTED_MESSAGE = HOME_HIGH_STAKES_DEFER_MESSAGE;

const HOME_INVENTORY_BLOCKED_FALLBACK =
  "잠깐 볼게요. 지금은 숫자나 건수를 바로 말씀드리기 어려워요. 보험 관련 질문이면 보장내역서를 주시면 같이 볼게요.";

function normalizeQuestion(question) {
  return String(question ?? "").replace(/\s+/g, " ").trim();
}

function joinLabels(labels) {
  const list = (labels ?? []).filter(Boolean);
  if (list.length === 0) return "";
  if (list.length === 1) return list[0];
  if (list.length === 2) return `${list[0]}과 ${list[1]}`;
  return `${list.slice(0, -1).join(", ")}과 ${list[list.length - 1]}`;
}

function formatWonAmount(amount) {
  return `${Number(amount).toLocaleString("ko-KR")}`.replace(/,/g, "");
}

export function applyHomeInventoryHardGuard(text = "") {
  if (violatesHomeInventoryDump(text)) {
    return HOME_INVENTORY_BLOCKED_FALLBACK;
  }
  return String(text ?? "").trim();
}

export function buildHomeBrainFactsUsed(unified, stats) {
  return {
    portfolioSource: "unified_state.policies",
    totalCount: stats.totalCount,
    premiumKnownCount: stats.premiumKnownCount,
    premiumUnknownCount: stats.premiumUnknownCount,
    premiumTotal: stats.premiumTotal,
    memoryStatus: unified?.memory_status ?? null,
    memoryFactCount: unified?.memory_fact_count ?? 0,
  };
}

function customerLabel(unified) {
  const name = unified?.profile?.display_name;
  return name ? `${name}님` : "고객님";
}

export function formatHomeBrainAnswer(intent, unified, stats) {
  const label = customerLabel(unified);

  if (stats.totalCount === 0 && intent !== "memory_recall_lookup") {
    return `${label}, 지금은 등록된 가입 보험 정보를 찾지 못했어요. 보험 정보를 저장해 주시면 같이 확인해 볼게요.`;
  }

  switch (intent) {
    case "premium_lookup": {
      if (stats.premiumKnownCount === 0) {
        return `${label}, 지금 확인된 납입 보험료가 있는 계약은 없어요.`;
      }
      const lines = [`확인된 납입 보험료 합계는 ${formatWonAmount(stats.premiumTotal)}원이에요.`];
      if (stats.premiumUnknownCount > 0) {
        lines.push(`아직 확인되지 않은 계약도 있어요.`);
      }
      return lines.join("\n");
    }
    case "policy_count":
      return `${label}, 지금 확인된 가입 보험은 ${stats.totalCount}개예요.`;
    case "insurer_lookup": {
      const insurers = Array.from(
        new Set((unified?.policies ?? []).map((policy) => policy.insurer_name).filter(Boolean)),
      );
      if (!insurers.length) {
        return `${label}, 지금은 가입 보험사 정보를 확인하지 못했어요.`;
      }
      return `${label}, 가입하신 보험사는 ${joinLabels(insurers)}이에요.`;
    }
    case "premium_unknown_lookup":
      if (stats.premiumUnknownCount === 0) {
        return `${label}, 지금 확인된 계약은 모두 납입 보험료가 확인됐어요.`;
      }
      return `${label}, 아직 납입 보험료가 확인되지 않은 계약이 있어요.`;
    case "memory_recall_lookup": {
      const factCount = unified?.memory_fact_count ?? 0;
      const status = unified?.memory_status ?? "ready";
      if (factCount > 0) {
        return `${label}, 기억해 둔 정보가 있어요. 필요하시면 말씀해 주세요.`;
      }
      if (status === "degraded") {
        return `${label}, 기억한 정보가 일부만 있어요.`;
      }
      if (status === "failed") {
        return `${label}, 최근에 기억 정보를 갱신하지 못했어요.`;
      }
      return `${label}, 아직 기억할 정보가 많지 않아요.`;
    }
    default:
      return HOME_HIGH_STAKES_DEFER_MESSAGE;
  }
}

export function composeHomeBrainFactAnswer(unified, question) {
  const intent = classifyHomeBrainIntent(question);
  if (!HOME_BRAIN_SUPPORTED_INTENTS.has(intent)) {
    return {
      ok: true,
      answerText: HOME_HIGH_STAKES_DEFER_MESSAGE,
      intent: "unsupported",
      factsUsed: buildHomeBrainFactsUsed(unified ?? {}, {
        totalCount: unified?.policy_count ?? unified?.policies?.length ?? 0,
        premiumKnownCount: 0,
        premiumUnknownCount: 0,
        premiumTotal: 0,
      }),
    };
  }

  const policies = unified?.policies ?? [];
  const stats = computePremiumLookupStats(policies);
  return {
    ok: true,
    answerText: formatHomeBrainAnswer(intent, unified, stats),
    intent,
    factsUsed: buildHomeBrainFactsUsed(unified, stats),
  };
}

function finalizeHomeTomResponse({
  text,
  question,
  intent,
  homeBrainIntent = null,
  factBundle = {},
  homeRoute = null,
  tomGapVoiceHandled = false,
}) {
  const finalized = finalizeOneBrainResponse({
    text,
    question,
    intent,
    surface: ONE_BRAIN_SURFACES.HOME,
    factBundle,
    homeBrainIntent,
    homeRoute,
    tomGapVoiceHandled,
  });
  return applyHomeInventoryHardGuard(finalized);
}

export async function handleHomeBrainFactRequest({
  userSupabase,
  customerId,
  question,
  env = process.env,
  fetchImpl = fetch,
}) {
  const trimmedQuestion = normalizeQuestion(question);
  if (!trimmedQuestion) {
    return {
      ok: false,
      reason: "INVALID_BODY",
      error_message: "질문을 입력해 주세요.",
    };
  }
  if (!userSupabase || !customerId) {
    return {
      ok: false,
      reason: "UNAUTHORIZED",
      error_message: "Authentication required.",
    };
  }

  const startedAt = Date.now();
  const consultationIntent = classifyConsultationIntent(trimmedQuestion);
  const homeRoute = resolveHomeBrainRoute(trimmedQuestion, consultationIntent);

  if (
    homeRoute === HOME_BRAIN_ROUTES.GAP_GROUNDED &&
    shouldUseTomGapLightPath(consultationIntent, env)
  ) {
    const raw = await loadRawCustomerRecords(userSupabase, customerId);
    const policies = raw?.policies ?? [];
    const lightTurn = await runTomGapLightVoiceTurn({
      question: trimmedQuestion,
      intentClassification: consultationIntent,
      surface: ONE_BRAIN_SURFACES.HOME,
      policies,
      fetchImpl,
      env,
      handler: "handleHomeBrainFactRequest.tom_gap_light",
      startedAt,
    });
    const factBundle = lightTurn.factBundle;
    const answerText = finalizeHomeTomResponse({
      text: lightTurn.tomApply.text,
      question: trimmedQuestion,
      intent: consultationIntent.intent,
      factBundle,
      homeBrainIntent: "unsupported",
      homeRoute,
      tomGapVoiceHandled: true,
    });
    return {
      ok: true,
      answerText,
      intent: consultationIntent.intent,
      home_route: homeRoute,
      factsUsed: buildHomeBrainFactsUsed(
        { policies, policy_count: policies.length, memory_fact_count: 0, memory_status: "ready" },
        { totalCount: policies.length, premiumKnownCount: 0, premiumUnknownCount: 0, premiumTotal: 0 },
      ),
      tom_voice_trace: lightTurn.tomApply.trace,
      tom_gap_light_path: true,
      tom_turn_ms: lightTurn.elapsed_ms,
      response_latency_ms: Date.now() - startedAt,
      skipped_stages: lightTurn.skipped_stages,
    };
  }

  if (homeRoute === HOME_BRAIN_ROUTES.HIGH_STAKES_DEFER) {
    const answerText = finalizeHomeTomResponse({
      text: composeHomeHighStakesDeferMessage(),
      question: trimmedQuestion,
      intent: consultationIntent.intent,
      homeBrainIntent: "unsupported",
      homeRoute,
      factBundle: { question: trimmedQuestion, policy_count: 0, policies: [] },
    });
    return {
      ok: true,
      answerText,
      intent: consultationIntent.intent,
      home_route: homeRoute,
      factsUsed: buildHomeBrainFactsUsed(
        {},
        { totalCount: 0, premiumKnownCount: 0, premiumUnknownCount: 0, premiumTotal: 0 },
      ),
      response_latency_ms: Date.now() - startedAt,
    };
  }

  if (homeRoute === HOME_BRAIN_ROUTES.CASUAL_CHAT) {
    const casualResult = await buildCasualChatResponse({
      question: trimmedQuestion,
      history: [],
      fetchImpl,
      env,
    });
    const answerText = finalizeHomeTomResponse({
      text: casualResult.text,
      question: trimmedQuestion,
      intent: "casual_chat",
      homeRoute,
      factBundle: { question: trimmedQuestion, policy_count: 0, policies: [] },
    });
    return {
      ok: true,
      answerText,
      intent: "casual_chat",
      home_route: homeRoute,
      response_source: casualResult.response_source ?? null,
      factsUsed: buildHomeBrainFactsUsed(
        {},
        { totalCount: 0, premiumKnownCount: 0, premiumUnknownCount: 0, premiumTotal: 0 },
      ),
      response_latency_ms: Date.now() - startedAt,
    };
  }

  const unified = await loadUnifiedCustomerState(userSupabase, customerId);
  const composed = composeHomeBrainFactAnswer(unified, trimmedQuestion);
  const factBundle = buildFactBundleFromUnified(unified, trimmedQuestion);
  const answerText = finalizeHomeTomResponse({
    text: composed.answerText,
    question: trimmedQuestion,
    intent: consultationIntent.intent,
    homeBrainIntent: composed.intent,
    homeRoute: HOME_BRAIN_ROUTES.FACTUAL_GROUNDED,
    factBundle,
  });
  return {
    ...composed,
    answerText,
    home_route: HOME_BRAIN_ROUTES.FACTUAL_GROUNDED,
    response_latency_ms: Date.now() - startedAt,
  };
}
