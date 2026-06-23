/**
 * P3 v4 — Home brain helpers + Agent Tom request handler.
 */
import { computePremiumLookupStats } from "./intentGateLayer.js";
import { applyLifeguardCustomerOutputGuard, polishLifeguardCustomerText } from "./lifeguardOutputGuard.js";
import {
  HOME_BRAIN_SUPPORTED_INTENTS,
  HOME_HIGH_STAKES_DEFER_MESSAGE,
  classifyHomeBrainIntent,
} from "./homeBrainRouter.js";
import { TOM_INTERNAL_ROUTES } from "./homeAgentTom.js";
import { finalizeOneBrainResponse, ONE_BRAIN_SURFACES } from "./oneBrainResponseLayer.js";
import {
  buildSalesDirectorFactsUsed,
  buildSalesDirectorLoopObservability,
  runSalesDirectorLoopTurn,
} from "./salesDirectorLoop.js";
import {
  buildGuardResult,
  isSalesDirectorPilotResponseSource,
} from "./customerObservability.js";

export {
  HOME_BRAIN_SUPPORTED_INTENTS,
  HOME_HIGH_STAKES_DEFER_MESSAGE,
  classifyHomeBrainIntent,
  TOM_INTERNAL_ROUTES,
};

export const HOME_BRAIN_UNSUPPORTED_MESSAGE = HOME_HIGH_STAKES_DEFER_MESSAGE;

export const P5_BRAIN_RESPONSE_SOURCES = new Set([
  "p5_brain_customer_state",
  "p5_brain_state_guarded",
]);

export function isP5BrainResponseSource(responseSource) {
  return P5_BRAIN_RESPONSE_SOURCES.has(responseSource);
}

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
  return applyLifeguardCustomerOutputGuard(text);
}

/** P5-BRAIN customer text: polish only; do not apply engine-term/deflection guard on state topics. */
export function applyP5BrainCustomerTextGuard(text = "") {
  return polishLifeguardCustomerText(text);
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

/** Legacy compose helper — kept for unit tests; home runtime uses Sales Director Loop. */
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
  responseSource = null,
  salesDirectorResponseSource = null,
}) {
  const originalText = text;
  const pilotSource = salesDirectorResponseSource ?? responseSource;

  if (isP5BrainResponseSource(responseSource) || isSalesDirectorPilotResponseSource(pilotSource)) {
    const finalText = applyP5BrainCustomerTextGuard(text);
    return {
      text: finalText,
      guardResult: buildGuardResult({
        responseSource: pilotSource,
        originalText,
        afterFinalizeText: originalText,
        finalText,
        p5BrainGuarded:
          responseSource === "p5_brain_state_guarded" ||
          salesDirectorResponseSource === "sales_director_pilot_guarded",
      }),
    };
  }

  const homeRoute =
    tomInternalRoute === TOM_INTERNAL_ROUTES.GAP_TOOL
      ? "gap_grounded"
      : tomInternalRoute === TOM_INTERNAL_ROUTES.CHAT
        ? "casual_chat"
        : "high_stakes_defer";

  const afterFinalize = finalizeOneBrainResponse({
    text,
    question,
    intent,
    surface: ONE_BRAIN_SURFACES.HOME,
    factBundle,
    homeBrainIntent: "unsupported",
    homeRoute,
    tomGapVoiceHandled,
  });
  const finalText = applyHomeInventoryHardGuard(afterFinalize);

  return {
    text: finalText,
    guardResult: buildGuardResult({
      responseSource: salesDirectorResponseSource ?? responseSource,
      originalText,
      afterFinalizeText: afterFinalize,
      finalText,
    }),
  };
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

  const loopResult = await runSalesDirectorLoopTurn({
    userSupabase,
    customerId,
    question: trimmedQuestion,
    history,
    env,
    fetchImpl,
    startedAt,
  });

  if (!loopResult.ok) return loopResult;

  const {
    agentTurn,
    modeDecision,
    loadedContext,
    reconciliationWarning,
    contextSnapshot,
    salesDirectorTrace,
    truthGate,
    latency: loopLatency,
    loopStartedAt,
  } = loopResult;

  const intent = agentTurn.consultationIntent?.intent ?? "general_consultation";

  const composeStart = Date.now();
  const observabilityPreview = buildSalesDirectorLoopObservability({
    modeDecision,
    agentTurn,
    loadedContext,
    guardResult: null,
    contextSnapshotId: contextSnapshot.context_snapshot_id,
    reconciliationWarning,
    factsUsed: null,
    loadedContextContradictions: null,
    salesDirectorTrace,
  });

  const finalized = finalizeHomeAgentResponse({
    text: agentTurn.text,
    question: trimmedQuestion,
    intent,
    factBundle: agentTurn.factBundle ?? { question: trimmedQuestion, policy_count: 0, policies: [] },
    tomGapVoiceHandled: agentTurn.tomGapVoiceHandled === true,
    tomInternalRoute: agentTurn.tomInternalRoute,
    responseSource: agentTurn.responseSource ?? null,
    salesDirectorResponseSource: observabilityPreview.response_source,
  });
  const answerText = finalized.text;

  const { factsUsed, loadedContextContradictions } = buildSalesDirectorFactsUsed({
    agentTurn,
    customerContextBundle: loopResult.customerContextBundle,
    loadedContext,
    computeStats: computePremiumLookupStats,
    buildFactsUsed: buildHomeBrainFactsUsed,
  });

  const observability = buildSalesDirectorLoopObservability({
    modeDecision,
    agentTurn,
    loadedContext,
    guardResult: finalized.guardResult,
    contextSnapshotId: contextSnapshot.context_snapshot_id,
    reconciliationWarning,
    factsUsed,
    loadedContextContradictions,
    salesDirectorTrace: {
      ...salesDirectorTrace,
      truth_gate: truthGate,
      latency: {
        ...(loopLatency ?? {}),
        compose_ms: Date.now() - composeStart,
        total_ms: Date.now() - startedAt,
      },
    },
  });

  return {
    ok: true,
    answerText,
    intent,
    home_route: agentTurn.tomInternalRoute,
    tom_internal_route: agentTurn.tomInternalRoute,
    tool_used: agentTurn.toolUsed,
    agent: "sales_director_loop",
    sales_director_loop: true,
    sales_director_mode: observability.sales_director_mode,
    response_source: observability.response_source,
    selected_route: observability.selected_route,
    loaded_context: observability.loaded_context,
    factory_called: observability.factory_called,
    guard_result: observability.guard_result,
    context_snapshot_id: observability.context_snapshot_id,
    reconciliation_warning: observability.reconciliation_warning,
    loaded_context_contradictions: observability.loaded_context_contradictions,
    sales_director_trace: observability.sales_director_trace,
    tom_voice_trace: agentTurn.tomVoiceTrace ?? agentTurn.trace,
    tom_gap_light_path: agentTurn.tomGapLightPath === true,
    tom_turn_ms: agentTurn.tomTurnMs ?? null,
    skipped_stages: agentTurn.skippedStages ?? null,
    factsUsed,
    response_latency_ms: Date.now() - startedAt,
  };
}
