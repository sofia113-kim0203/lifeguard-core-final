/**
 * P3 v4 — Home brain helpers + Agent Tom request handler.
 */
import { computePremiumLookupStats } from "./intentGateLayer.js";
import { violatesHomeInventoryDump } from "./tomThinkingLoop.js";
import {
  HOME_BRAIN_SUPPORTED_INTENTS,
  HOME_HIGH_STAKES_DEFER_MESSAGE,
  classifyHomeBrainIntent,
} from "./homeBrainRouter.js";
import { runHomeAgentTomTurn, TOM_INTERNAL_ROUTES } from "./homeAgentTom.js";
import { finalizeOneBrainResponse, ONE_BRAIN_SURFACES } from "./oneBrainResponseLayer.js";

export {
  HOME_BRAIN_SUPPORTED_INTENTS,
  HOME_HIGH_STAKES_DEFER_MESSAGE,
  classifyHomeBrainIntent,
  TOM_INTERNAL_ROUTES,
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
      return `확인된 납입 보험료 합계는 ${formatWonAmount(stats.premiumTotal)}원이에요.`;
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
      return stats.premiumUnknownCount === 0
        ? `${label}, 지금 확인된 계약은 모두 납입 보험료가 확인됐어요.`
        : `${label}, 아직 납입 보험료가 확인되지 않은 계약이 있어요.`;
    case "memory_recall_lookup":
      return `${label}, 기억해 둔 정보가 있어요. 필요하시면 말씀해 주세요.`;
    default:
      return HOME_HIGH_STAKES_DEFER_MESSAGE;
  }
}

/** Legacy compose helper — kept for unit tests; home runtime uses Agent Tom only. */
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

function finalizeHomeAgentResponse({
  text,
  question,
  intent,
  factBundle = {},
  tomGapVoiceHandled = false,
  tomInternalRoute = null,
}) {
  const homeRoute =
    tomInternalRoute === TOM_INTERNAL_ROUTES.GAP_TOOL
      ? "gap_grounded"
      : tomInternalRoute === TOM_INTERNAL_ROUTES.CHAT
        ? "casual_chat"
        : "high_stakes_defer";

  const finalized = finalizeOneBrainResponse({
    text,
    question,
    intent,
    surface: ONE_BRAIN_SURFACES.HOME,
    factBundle,
    homeBrainIntent: "unsupported",
    homeRoute,
    tomGapVoiceHandled,
  });
  return applyHomeInventoryHardGuard(finalized);
}

export async function handleHomeBrainFactRequest({
  userSupabase,
  customerId,
  question,
  history = [],
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
  const agentTurn = await runHomeAgentTomTurn({
    question: trimmedQuestion,
    history,
    userSupabase,
    customerId,
    env,
    fetchImpl,
    startedAt,
  });

  const intent = agentTurn.consultationIntent?.intent ?? "general_consultation";
  const answerText = finalizeHomeAgentResponse({
    text: agentTurn.text,
    question: trimmedQuestion,
    intent,
    factBundle: agentTurn.factBundle ?? { question: trimmedQuestion, policy_count: 0, policies: [] },
    tomGapVoiceHandled: agentTurn.tomGapVoiceHandled === true,
    tomInternalRoute: agentTurn.tomInternalRoute,
  });

  const policies = agentTurn.factBundle?.policies ?? [];
  return {
    ok: true,
    answerText,
    intent,
    home_route: agentTurn.tomInternalRoute,
    tom_internal_route: agentTurn.tomInternalRoute,
    tool_used: agentTurn.toolUsed,
    agent: "home_agent_tom",
    response_source: agentTurn.responseSource ?? null,
    tom_voice_trace: agentTurn.tomVoiceTrace ?? agentTurn.trace,
    tom_gap_light_path: agentTurn.tomGapLightPath === true,
    tom_turn_ms: agentTurn.tomTurnMs ?? null,
    skipped_stages: agentTurn.skippedStages ?? null,
    factsUsed: buildHomeBrainFactsUsed(
      {
        policies,
        policy_count: policies.length || agentTurn.factBundle?.policy_count || 0,
        memory_fact_count: 0,
        memory_status: "ready",
      },
      {
        totalCount: policies.length || agentTurn.factBundle?.policy_count || 0,
        premiumKnownCount: 0,
        premiumUnknownCount: 0,
        premiumTotal: 0,
      },
    ),
    response_latency_ms: Date.now() - startedAt,
  };
}
