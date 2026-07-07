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
import {
  buildSalesDirectorFactsUsed,
  buildSalesDirectorLoopObservability,
} from "./salesDirectorLoop.js";
import {
  buildSalesDirectorFactoryAudit,
  probeStoredFactoryRecords,
} from "./salesDirectorFactoryAudit.js";
import { buildSalesDirectorJudgmentAudit } from "./salesDirectorJudgmentAudit.js";
import { resolveActivePolicyCountFromUnified } from "./unifiedCustomerState.js";
import { buildKeyWaitAck } from "./keyWaitAck.js";
import { resolveOneKeyCoreS1Env, runOneKeyCoreTurn } from "./keyCore/oneKeyCoreTurn.js";
import { buildKeyCustomerTextFailureEnvelope } from "./keyCore/keyCustomerMonopoly.js";
import { enforceKeyCustomerTextIntegrity } from "./keyCore/keyCustomerTextSeal.js";
import { ONE_KEY_CORE_RESPONSE_SOURCE } from "./keyCore/oneKeyCoreFlags.js";

export {
  HOME_BRAIN_SUPPORTED_INTENTS,
  HOME_HIGH_STAKES_DEFER_MESSAGE,
  classifyHomeBrainIntent,
  TOM_INTERNAL_ROUTES,
};

export const HOME_BRAIN_UNSUPPORTED_MESSAGE = HOME_HIGH_STAKES_DEFER_MESSAGE;

function passThroughKeyCustomerText(coreResult) {
  const keySpeakOriginal = coreResult.keySpeakOriginal ?? coreResult.customerText ?? "";
  const responseSource =
    coreResult.agentTurn?.responseSource ?? ONE_KEY_CORE_RESPONSE_SOURCE.QUESTION;
  const answerText = keySpeakOriginal;
  const integrity = enforceKeyCustomerTextIntegrity({
    keySpeakOriginal,
    finalCustomerText: answerText,
    responseSource,
    postMutators: [],
  });
  return {
    answerText,
    responseSource,
    keySpeakOriginal,
    key_text_integrity: integrity,
  };
}

function buildKeyCustomerFactReturn({
  coreResult,
  answerText,
  responseSource,
  keySpeakOriginal,
  keyTextIntegrity,
  startedAt,
  extras = {},
}) {
  enforceKeyCustomerTextIntegrity({
    keySpeakOriginal,
    finalCustomerText: answerText,
    responseSource,
    postMutators: [],
  });
  return {
    ok: true,
    answerText,
    response_source: responseSource,
    key_speak_original: keySpeakOriginal,
    key_text_equal: keySpeakOriginal === answerText,
    key_text_integrity: keyTextIntegrity,
    key_customer_monopoly: true,
    response_latency_ms: Date.now() - startedAt,
    ...extras,
  };
}

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
      onReplace(_text) {
        // KEY monopoly — post-KEY replace forbidden on customer stream
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

  const keyEnv = resolveOneKeyCoreS1Env(env);
  const coreResult = await runOneKeyCoreTurn({
    userSupabase,
    customerId,
    question: trimmedQuestion,
    history,
    env: keyEnv,
    fetchImpl,
    startedAt,
  });

  if (!coreResult.ok) {
    const failureEnvelope = buildKeyCustomerTextFailureEnvelope({
      reason: coreResult.reason ?? "one_key_core_failed",
      trace: coreResult.oneKeyCoreTrace ?? null,
    });
    const keyPass = passThroughKeyCustomerText(failureEnvelope);
    if (activeStreamHandlers?.onDelta) {
      activeStreamHandlers.onDelta(keyPass.answerText);
      activeStreamHandlers._emitted = true;
      activeStreamHandlers.onFirstToken?.(Math.max(0, Date.now() - startedAt));
    }
    return buildKeyCustomerFactReturn({
      coreResult: failureEnvelope,
      answerText: keyPass.answerText,
      responseSource: keyPass.responseSource,
      keySpeakOriginal: keyPass.keySpeakOriginal,
      keyTextIntegrity: keyPass.key_text_integrity,
      startedAt,
      extras: {
        intent: "general_consultation",
        agent: "one_key_core_s1",
        key_monopoly_failure: true,
        failure_reason: coreResult.reason ?? "one_key_core_failed",
        one_key_core_trace: coreResult.oneKeyCoreTrace ?? null,
      },
    });
  }

  const keyPass = passThroughKeyCustomerText(coreResult);
  const answerText = keyPass.answerText;
  const responseSource = keyPass.responseSource;
  const keySpeakOriginal = keyPass.keySpeakOriginal;

  const {
    agentTurn,
    modeDecision,
    loadedContext,
    contextSnapshot,
    salesDirectorTrace,
    truthGate,
    latency: loopLatency,
    customerContextBundle,
  } = coreResult;

  if (activeStreamHandlers?.onDelta && !activeStreamHandlers._emitted) {
    activeStreamHandlers.onDelta(answerText);
    activeStreamHandlers._emitted = true;
    activeStreamHandlers.onFirstToken?.(Math.max(0, Date.now() - startedAt));
  }

  if (coreResult.key_monopoly_failure === true) {
    return buildKeyCustomerFactReturn({
      coreResult,
      answerText,
      responseSource,
      keySpeakOriginal,
      keyTextIntegrity: keyPass.key_text_integrity,
      startedAt,
      extras: {
        intent: agentTurn.consultationIntent?.intent ?? "general_consultation",
        agent: "one_key_core_s1",
        key_monopoly_failure: true,
        failure_reason: coreResult.failure_reason ?? null,
        one_key_core_trace: coreResult.oneKeyCoreTrace ?? null,
      },
    });
  }

  const intent = agentTurn.consultationIntent?.intent ?? "general_consultation";
  const storedFactoryProbe = await probeStoredFactoryRecords(userSupabase, customerId);
  const factoryAudit = buildSalesDirectorFactoryAudit({
    customerContextBundle,
    loadedContext,
    agentTurn: { ...agentTurn, text: answerText },
    salesDirectorTrace,
    storedProbe: storedFactoryProbe,
    keyComposeTrace: salesDirectorTrace?.key_compose_trace ?? null,
  });

  const { factsUsed, loadedContextContradictions } = buildSalesDirectorFactsUsed({
    agentTurn: { ...agentTurn, text: answerText },
    customerContextBundle,
    loadedContext,
    computeStats: computePremiumLookupStats,
    buildFactsUsed: buildHomeBrainFactsUsed,
  });

  const judgmentAudit = buildSalesDirectorJudgmentAudit({
    answerText,
    customerContextBundle,
    factoryAudit,
    answerEvidence: factoryAudit.answer_evidence,
  });

  const observability = buildSalesDirectorLoopObservability({
    modeDecision,
    agentTurn: { ...agentTurn, text: answerText },
    loadedContext,
    guardResult: null,
    contextSnapshotId: contextSnapshot.context_snapshot_id,
    reconciliationWarning: null,
    factsUsed,
    loadedContextContradictions,
    salesDirectorTrace: {
      ...salesDirectorTrace,
      truth_gate: truthGate,
      sales_director_factory_audit: factoryAudit,
      sales_director_judgment_audit: judgmentAudit,
      answer_evidence: factoryAudit.answer_evidence,
      key_customer_monopoly: true,
      persona_rewrite_blocked: true,
      p10_4_key_path_trace: {
        one_key_core_s1: true,
        legacy_paths_blocked: salesDirectorTrace?.legacy_paths_blocked ?? [],
        key_text_integrity: keyPass.key_text_integrity,
      },
      latency: {
        ...(loopLatency ?? {}),
        total_ms: Date.now() - startedAt,
      },
    },
  });

  return buildKeyCustomerFactReturn({
    coreResult,
    answerText,
    responseSource,
    keySpeakOriginal,
    keyTextIntegrity: keyPass.key_text_integrity,
    startedAt,
    extras: {
      intent,
      home_route: agentTurn.tomInternalRoute,
      tom_internal_route: agentTurn.tomInternalRoute,
      tool_used: agentTurn.toolUsed,
      agent: "one_key_core_s1",
      sales_director_loop: true,
      sales_director_mode: observability.sales_director_mode,
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
      one_key_core_trace: coreResult.oneKeyCoreTrace ?? null,
      key_monopoly_failure: coreResult.key_monopoly_failure === true,
      failure_reason: coreResult.failure_reason ?? null,
      factsUsed,
    },
  });
}
