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
  finalizeSalesDirectorResponse,
  resolveSalesDirectorJudgmentIntent,
  shouldApplySalesDirectorFormatter,
} from "./salesDirectorFormatter.js";
import {
  buildSalesDirectorFactsUsed,
  buildSalesDirectorLoopObservability,
  runSalesDirectorLoopTurn,
} from "./salesDirectorLoop.js";
import {
  buildSalesDirectorFactoryAudit,
  probeStoredFactoryRecords,
} from "./salesDirectorFactoryAudit.js";
import { buildSalesDirectorJudgmentAudit } from "./salesDirectorJudgmentAudit.js";
import { buildKeyPathRuntimeTrace } from "./keyPathRuntimeTrace.js";
import {
  buildGuardResult,
  isSalesDirectorPilotResponseSource,
} from "./customerObservability.js";
import { resolveActivePolicyCountFromUnified } from "./unifiedCustomerState.js";
import { buildKeyWaitAck } from "./keyWaitAck.js";

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

function resolveHomeBrainPolicyCount(unified = null) {
  const fields = resolveActivePolicyCountFromUnified(unified);
  return fields.active_policy_count;
}

export function buildHomeBrainFactsUsed(unified, stats) {
  const policyCount = resolveHomeBrainPolicyCount(unified);
  return {
    portfolioSource: "unified_state.policies",
    totalCount: policyCount,
    active_policy_count: policyCount,
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
  const policyCount = resolveHomeBrainPolicyCount(unified);

  if (policyCount === 0 && intent !== "memory_recall_lookup") {
    return `${label}, 지금은 등록된 가입 보험 정보를 찾지 못했어요. 보험 정보를 저장해 주시면 같이 확인해 볼게요.`;
  }

  switch (intent) {
    case "premium_lookup": {
      if (stats.premiumKnownCount === 0) {
        return `${label}, 지금 확인된 납입 보험료가 있는 계약은 없어요.`;
      }
      return `확인된 납입 보험료 합계는 ${formatWonAmount(stats.premiumTotal)}원이에요.`;
    }
    case "policy_count": {
      if (typeof policyCount === "number" && policyCount > 0) {
        return `${label}, 지금 확인된 가입 보험은 ${policyCount}개예요.`;
      }
      return `${label}, 지금 가입 보험 개수는 확인 중이에요. 보험 정보를 저장해 주시면 같이 확인해 볼게요.`;
    }
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

function resolveHomeBrainRoute(tomInternalRoute = null) {
  if (tomInternalRoute === TOM_INTERNAL_ROUTES.GAP_TOOL) return "gap_grounded";
  if (tomInternalRoute === TOM_INTERNAL_ROUTES.CHAT) return "casual_chat";
  return "high_stakes_defer";
}

function isHomeKeyOrchestratorFinalize({
  factBundle = {},
  customerState = null,
  responseSource = null,
  salesDirectorResponseSource = null,
} = {}) {
  if (factBundle?.key_orchestrator === true) return true;
  if (customerState?.keyOrchestrator === true) return true;
  const source = salesDirectorResponseSource ?? responseSource;
  return source === "sales_director_key";
}

function finalizeHomeKeyOrchestratorResponse({
  text,
  question,
  intent,
  factBundle = {},
  customerState = null,
  tomInternalRoute = null,
  responseSource = null,
  freeThinking = null,
  history = [],
}) {
  const homeRoute = resolveHomeBrainRoute(tomInternalRoute);
  const keyFactBundle = {
    ...factBundle,
    key_orchestrator: true,
    question: factBundle.question ?? question,
  };
  return finalizeSalesDirectorResponse({
    rawText: text,
    intent: resolveSalesDirectorJudgmentIntent(intent, question),
    classificationIntent: intent,
    surface: ONE_BRAIN_SURFACES.HOME,
    factBundle: keyFactBundle,
    customerState: {
      ...(customerState ?? {}),
      question: customerState?.question ?? question,
      keyOrchestrator: true,
    },
    homeBrainIntent: "unsupported",
    homeRoute,
    conversationContext: {
      freeThinking,
      responseSource,
      history,
    },
  });
}

function applyHomeSalesDirectorFormatter({
  text,
  question,
  intent,
  factBundle = {},
  customerState = null,
  tomInternalRoute = null,
  responseSource = null,
  freeThinking = null,
  history = [],
}) {
  const homeRoute = resolveHomeBrainRoute(tomInternalRoute);

  if (
    !shouldApplySalesDirectorFormatter(intent, question, {
      surface: ONE_BRAIN_SURFACES.HOME,
      homeBrainIntent: "unsupported",
      homeRoute,
    })
  ) {
    return text;
  }

  return finalizeSalesDirectorResponse({
    rawText: text,
    intent: resolveSalesDirectorJudgmentIntent(intent, question),
    classificationIntent: intent,
    surface: ONE_BRAIN_SURFACES.HOME,
    factBundle,
    customerState,
    responseSource,
    conversationContext: {
      freeThinking,
      responseSource,
      history,
    },
  });
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
  customerState = null,
  history = [],
}) {
  const originalText = text;
  const pilotSource = salesDirectorResponseSource ?? responseSource;

  if (
    isHomeKeyOrchestratorFinalize({
      factBundle,
      customerState,
      responseSource,
      salesDirectorResponseSource: pilotSource,
    })
  ) {
    const finalized = finalizeHomeKeyOrchestratorResponse({
      text,
      question,
      intent,
      factBundle,
      customerState,
      tomInternalRoute,
      responseSource,
      freeThinking: customerState?.freeThinking ?? null,
      history,
    });
    const finalText = applyP5BrainCustomerTextGuard(finalized.text);
    return {
      text: finalText,
      preserveGateTrace: finalized.preserve_gate_trace ?? null,
      finalizeTrace: finalized,
      guardResult: buildGuardResult({
        responseSource: pilotSource ?? "sales_director_key",
        originalText,
        afterFinalizeText: finalized.text,
        finalText,
      }),
    };
  }

  if (isP5BrainResponseSource(responseSource) || isSalesDirectorPilotResponseSource(pilotSource)) {
    const finalized = applyHomeSalesDirectorFormatter({
      text,
      question,
      intent,
      factBundle,
      customerState,
      tomInternalRoute,
      responseSource,
      freeThinking: customerState?.freeThinking ?? null,
      history,
    });
    const formatted = finalized.text;
    const finalText = applyP5BrainCustomerTextGuard(formatted);
    return {
      text: finalText,
      preserveGateTrace: finalized.preserve_gate_trace ?? null,
      finalizeTrace: finalized,
      guardResult: buildGuardResult({
        responseSource: pilotSource,
        originalText,
        afterFinalizeText: formatted,
        finalText,
        p5BrainGuarded:
          responseSource === "p5_brain_state_guarded" ||
          salesDirectorResponseSource === "sales_director_pilot_guarded",
      }),
    };
  }

  const homeRoute = resolveHomeBrainRoute(tomInternalRoute);

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
  streamHandlers = null,
  requestStartedAt = null,
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

  const startedAt = requestStartedAt ?? Date.now();

  const sseTrace = {
    delta_count: 0,
    replace_count: 0,
    first_delta_preview: "",
    replace_preview: "",
    key_wait_ack_text: "",
    key_wait_ack_ms: null,
  };
  let activeStreamHandlers = streamHandlers;
  if (streamHandlers) {
    activeStreamHandlers = {
      ...streamHandlers,
      onDelta(text) {
        sseTrace.delta_count += 1;
        if (!sseTrace.first_delta_preview) {
          sseTrace.first_delta_preview = String(text ?? "").slice(0, 300);
        }
        streamHandlers.onDelta?.(text);
      },
      onReplace(text) {
        sseTrace.replace_count += 1;
        sseTrace.replace_preview = String(text ?? "").slice(0, 300);
        streamHandlers.onReplace?.(text);
      },
      onFirstToken: streamHandlers.onFirstToken,
      get _emitted() {
        return streamHandlers._emitted;
      },
      set _emitted(value) {
        streamHandlers._emitted = value;
      },
    };
  }

  if (activeStreamHandlers?.onKeyWaitAck) {
    const ackText = buildKeyWaitAck(trimmedQuestion);
    sseTrace.key_wait_ack_text = ackText;
    sseTrace.key_wait_ack_ms = Math.max(0, Date.now() - startedAt);
    activeStreamHandlers.onKeyWaitAck(ackText);
  }

  const [loopResult, storedFactoryProbe] = await Promise.all([
    runSalesDirectorLoopTurn({
      userSupabase,
      customerId,
      question: trimmedQuestion,
      history,
      env,
      fetchImpl,
      startedAt,
      streamHandlers: activeStreamHandlers,
      requestStartedAt: startedAt,
    }),
    probeStoredFactoryRecords(userSupabase, customerId),
  ]);

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
  let factoryAudit = buildSalesDirectorFactoryAudit({
    customerContextBundle: loopResult.customerContextBundle,
    loadedContext,
    agentTurn,
    salesDirectorTrace,
    storedProbe: storedFactoryProbe,
  });

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
    factBundle: agentTurn.factBundle ?? {
      question: trimmedQuestion,
      ...resolveActivePolicyCountFromUnified(null),
      policies: [],
    },
    tomGapVoiceHandled: agentTurn.tomGapVoiceHandled === true,
    tomInternalRoute: agentTurn.tomInternalRoute,
    responseSource: agentTurn.responseSource ?? null,
    salesDirectorResponseSource: observabilityPreview.response_source,
    history,
    customerState: {
      question: trimmedQuestion,
      coverageGapContext: loopResult.customerContextBundle?.coverageGapContext ?? null,
      recommendationContext: loopResult.customerContextBundle?.recommendationContext ?? null,
      underwritingRiskContext: loopResult.customerContextBundle?.underwritingRiskContext ?? null,
      designContext: loopResult.customerContextBundle?.designContext ?? null,
      keyOrchestrator: loopResult.modeDecision?.key_orchestrator === true,
      freeThinking: salesDirectorTrace?.conversation_brain?.free_thinking ?? null,
    },
  });
  const answerText = finalized.text;

  factoryAudit = buildSalesDirectorFactoryAudit({
    customerContextBundle: loopResult.customerContextBundle,
    loadedContext,
    agentTurn,
    salesDirectorTrace,
    storedProbe: storedFactoryProbe,
    keyComposeTrace: finalized.finalizeTrace?.key_compose_trace ?? null,
  });

  if (activeStreamHandlers?.onDelta && !activeStreamHandlers._emitted) {
    activeStreamHandlers.onDelta(answerText);
    activeStreamHandlers._emitted = true;
    activeStreamHandlers.onFirstToken?.(Math.max(0, Date.now() - startedAt));
  } else if (
    activeStreamHandlers?.onReplace &&
    activeStreamHandlers._emitted &&
    answerText !== agentTurn.text
  ) {
    activeStreamHandlers.onReplace(answerText);
  }

  const { factsUsed, loadedContextContradictions } = buildSalesDirectorFactsUsed({
    agentTurn,
    customerContextBundle: loopResult.customerContextBundle,
    loadedContext,
    computeStats: computePremiumLookupStats,
    buildFactsUsed: buildHomeBrainFactsUsed,
  });

  const judgmentAudit = buildSalesDirectorJudgmentAudit({
    answerText,
    customerContextBundle: loopResult.customerContextBundle,
    factoryAudit,
    answerEvidence: factoryAudit.answer_evidence,
  });

  const keyPathTrace = buildKeyPathRuntimeTrace({
    question: trimmedQuestion,
    customerId,
    consultationIntent: agentTurn.consultationIntent ?? modeDecision.consultationIntent,
    env,
    modeDecision,
    agentTurn,
    salesDirectorTrace,
    keyLoop: salesDirectorTrace?.key_loop_trace ?? null,
    finalizeTrace: finalized.finalizeTrace ?? null,
    observability: observabilityPreview,
    answerText,
    sseTrace,
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
      sales_director_factory_audit: factoryAudit,
      sales_director_judgment_audit: judgmentAudit,
      answer_evidence: factoryAudit.answer_evidence,
      p10_3e_preserve_gate: finalized.preserveGateTrace ?? null,
      finalize_trace: finalized.finalizeTrace ?? null,
      p10_4_key_path_trace: keyPathTrace,
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
    sales_director_factory_audit: factoryAudit,
    sales_director_judgment_audit: judgmentAudit,
    answer_evidence: factoryAudit.answer_evidence,
    factory_hypothesis: factoryAudit.hypothesis,
    factory_primary_disconnect: factoryAudit.primary_disconnect,
    tom_voice_trace: agentTurn.tomVoiceTrace ?? agentTurn.trace,
    tom_gap_light_path: agentTurn.tomGapLightPath === true,
    tom_turn_ms: agentTurn.tomTurnMs ?? null,
    skipped_stages: agentTurn.skippedStages ?? null,
    factsUsed,
    response_latency_ms: Date.now() - startedAt,
  };
}
