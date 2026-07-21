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
import { resolveSupabaseConfig } from "./claudeGroundedExecutionCore.js";
import { buildDocumentDispatchPlanShadow } from "./keyBrain/documentIntakeShadow.js";
import {
  buildKeyWorkOrderRecord,
  mintKeyWorkOrderId,
  persistKeyWorkOrder,
  resolveKeyWorkOrderTtlMs,
} from "./keyBrain/workOrder.js";
import { runDocumentPolicyExtraction } from "./documentPolicyExtractionPipeline.js";

/** Reuse Claude-first turn fields for factory post-processing (no second Claude call). */
export function buildClaudeFactoryDirectionFromTurn({
  question = "",
  documentId = null,
  coreResult = null,
} = {}) {
  const trace = coreResult?.salesDirectorTrace ?? {};
  const voice = trace?.key_compose_trace?.key_voice_trace ?? {};
  const facts = Array.isArray(coreResult?.agentTurn?.factBundle?.key_confirmed_source_facts)
    ? coreResult.agentTurn.factBundle.key_confirmed_source_facts
    : [];
  const decision = null;
  const session_goal = trace.session_goal ?? null;
  const sessionGoalText =
    session_goal && typeof session_goal === "object"
      ? String(session_goal.goal ?? "").trim() || null
      : session_goal != null
        ? String(session_goal).trim() || null
        : null;
  const recheck = facts
    .map((fact) => fact?.field ?? fact?.fact_key ?? fact?.label ?? null)
    .filter(Boolean)
    .slice(0, 40);
  return {
    schema_version: "claude-factory-direction-v1",
    source: "claude_first_direct",
    document_id: documentId,
    customer_question_focus: String(question ?? "").trim().slice(0, 500),
    session_goal: sessionGoalText,
    decision,
    document_understanding:
      sessionGoalText ??
      (facts.length ? "confirmed_source_facts_present" : null),
    confirm_items: facts.slice(0, 40).map((fact) => ({
      field: fact?.field ?? fact?.fact_key ?? null,
      value: fact?.value ?? null,
      uncertain: fact?.uncertain === true || fact?.confidence === "low",
    })),
    uncertain_parts: facts
      .filter((fact) => fact?.uncertain === true || fact?.confidence === "low")
      .slice(0, 20),
    recheck_on_original: recheck,
    compare_or_calc_basis: sessionGoalText,
    pdf_attached: voice.pdf_attached === true,
    gaps: {
      decision_null: true,
      session_goal_null: sessionGoalText == null,
      note:
        "Claude-first: decision never persisted; session_goal is short-term work state only (or null)",
    },
  };
}

async function hasDocumentAnalysisConsent(supabase, customerId) {
  const { data, error } = await supabase
    .from("customer_consents")
    .select("id")
    .eq("customer_id", customerId)
    .eq("consent_type", "document_analysis")
    .eq("granted", true)
    .limit(1);
  if (error) return false;
  return (data ?? []).length > 0;
}

async function invokeDocumentIngestWorkerAfterClaude({
  env,
  accessToken,
  documentId,
  workOrderId,
  fetchImpl = fetch,
}) {
  const { url, anonKey } = resolveSupabaseConfig(env);
  const token = String(accessToken ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!url || !anonKey || !token) {
    return { ok: false, reason: "missing_worker_auth" };
  }
  const body = { document_id: documentId };
  if (workOrderId) body.work_order_id = workOrderId;
  const response = await fetchImpl(`${url}/functions/v1/document-ingest-worker`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      apikey: anonKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }
  if (!response.ok) {
    return {
      ok: false,
      reason: "worker_failed",
      status: response.status,
      error: payload?.error_message ?? payload?.error ?? null,
    };
  }
  return { ok: true, payload };
}

/**
 * After Claude seal: issue WO carrying Claude direction, then existing ingest path.
 * Never throws to caller — factory failure must not alter the sealed customer answer.
 */
export async function runHomeChatFactoryAfterClaude({
  userSupabase,
  customerId,
  documentId,
  claudeFactoryDirection,
  accessToken = null,
  env = process.env,
  fetchImpl = fetch,
} = {}) {
  const trimmedId = String(documentId ?? "").trim();
  if (!userSupabase || !customerId || !trimmedId) {
    return { ok: false, reason: "missing_args" };
  }

  const hasConsent = await hasDocumentAnalysisConsent(userSupabase, customerId);
  if (!hasConsent) {
    return { ok: false, reason: "analysis_consent_missing" };
  }

  const { data: document, error: docError } = await userSupabase
    .from("customer_documents")
    .select("id, customer_id, metadata_json, customer_hint_type, doc_class, ingest_status")
    .eq("id", trimmedId)
    .eq("customer_id", customerId)
    .is("deleted_at", null)
    .maybeSingle();
  if (docError || !document) {
    return { ok: false, reason: "document_not_found" };
  }

  const dispatchPlan = buildDocumentDispatchPlanShadow({
    document,
    hasAnalysisConsent: true,
    claudeFactoryDirection,
  });
  const workOrderId = mintKeyWorkOrderId();
  const workOrderRecord = buildKeyWorkOrderRecord({
    workOrderId,
    customerId,
    documentId: trimmedId,
    dispatchPlan,
    ttlMs: resolveKeyWorkOrderTtlMs(env),
  });
  workOrderRecord.claude_factory_direction = claudeFactoryDirection ?? null;

  await persistKeyWorkOrder(userSupabase, {
    documentId: trimmedId,
    customerId,
    workOrderRecord,
    existingMetadata: {
      ...(document.metadata_json ?? {}),
      claude_factory_direction: claudeFactoryDirection ?? null,
      factory_deferred_until_claude: false,
      factory_started_after_claude: true,
    },
  });

  const { data: rpcData, error: rpcError } = await userSupabase.rpc(
    "lifeguard_request_customer_document_ingest",
    { p_document_id: trimmedId },
  );
  if (rpcError) {
    return { ok: false, reason: "ingest_rpc_failed", error: rpcError.message, work_order_id: workOrderId };
  }
  if (rpcData?.blocked) {
    return {
      ok: false,
      reason: "ingest_blocked",
      work_order_id: workOrderId,
      message: rpcData.message ?? null,
    };
  }

  const worker = await invokeDocumentIngestWorkerAfterClaude({
    env,
    accessToken,
    documentId: trimmedId,
    workOrderId,
    fetchImpl,
  });

  let policyExtraction = null;
  if (worker.ok && worker.payload?.ingest_status === "ready") {
    try {
      policyExtraction = await runDocumentPolicyExtraction({
        customerId,
        documentId: trimmedId,
        env,
        invokeMemory: true,
      });
    } catch (extractError) {
      policyExtraction = {
        ok: false,
        reason: "extract_failed",
        message: String(extractError?.message ?? extractError).slice(0, 200),
      };
    }
  }

  return {
    ok: worker.ok === true,
    work_order_id: workOrderId,
    claude_factory_direction: claudeFactoryDirection ?? null,
    worker,
    policyExtraction,
  };
}

export function scheduleHomeChatFactoryAfterClaude(args) {
  void runHomeChatFactoryAfterClaude(args).catch((error) => {
    console.error(
      "[homechat_factory_after_claude]",
      String(error?.message ?? error).slice(0, 240),
    );
  });
}

export {
  HOME_BRAIN_SUPPORTED_INTENTS,
  HOME_HIGH_STAKES_DEFER_MESSAGE,
  classifyHomeBrainIntent,
};

export const HOME_BRAIN_UNSUPPORTED_MESSAGE = HOME_HIGH_STAKES_DEFER_MESSAGE;

function passThroughKeyCustomerText(coreResult) {
  const keySpeakOriginal = coreResult.keySpeakOriginal ?? coreResult.customerText ?? "";
  const responseSource =
    coreResult.agentTurn?.responseSource ?? ONE_KEY_CORE_RESPONSE_SOURCE.QUESTION;
  const answerText = keySpeakOriginal;
  // Monopoly failure with empty customer text: allow pass-through (do not invent KEY copy).
  if (coreResult.key_monopoly_failure === true && !String(keySpeakOriginal).trim()) {
    return {
      answerText: "",
      responseSource,
      keySpeakOriginal: "",
      key_text_integrity: {
        ok: true,
        reason: "key_monopoly_failure_empty",
        text_equal: true,
        response_source: responseSource,
      },
    };
  }
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
  const allowEmptyMonopolyFailure =
    (coreResult?.key_monopoly_failure === true || extras?.key_monopoly_failure === true) &&
    !String(keySpeakOriginal ?? "").trim();
  if (!allowEmptyMonopolyFailure) {
    enforceKeyCustomerTextIntegrity({
      keySpeakOriginal,
      finalCustomerText: answerText,
      responseSource,
      postMutators: [],
    });
  }
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

function resolveVisualBlocksFromCoreResult(coreResult = {}) {
  const speakStep = coreResult?.oneKeyCoreTrace?.steps?.find((row) => row.step === "speak");
  const payload = speakStep?.payload ?? {};
  const visual_blocks = Array.isArray(coreResult.visualBlocks) && coreResult.visualBlocks.length
    ? coreResult.visualBlocks
    : Array.isArray(payload.visual_blocks)
      ? payload.visual_blocks
      : Array.isArray(payload.key_compose_trace?.visual_blocks)
        ? payload.key_compose_trace.visual_blocks
        : [];
  const gateRaw =
    payload.visual_blocks_gate ??
    payload.key_voice_trace?.visual_blocks_gate ??
    payload.key_compose_trace?.key_voice_trace?.visual_blocks_gate ??
    null;
  const visual_blocks_gate = gateRaw
    ? {
        accepted_count:
          typeof gateRaw.accepted_count === "number"
            ? gateRaw.accepted_count
            : Array.isArray(gateRaw.accepted)
              ? gateRaw.accepted.length
              : visual_blocks.length,
        omitted_count:
          typeof gateRaw.omitted_count === "number"
            ? gateRaw.omitted_count
            : Array.isArray(gateRaw.omitted)
              ? gateRaw.omitted.length
              : 0,
        omitted: gateRaw.omitted ?? [],
      }
    : null;
  return { visual_blocks, visual_blocks_gate };
}

/** SSE done + JSON response payload — includes KEY Voice visual_blocks from core turn. */
export function buildDonePayload({
  coreResult,
  answerText,
  responseSource,
  keySpeakOriginal,
  keyTextIntegrity,
  startedAt,
  extras = {},
}) {
  return {
    ...buildKeyCustomerFactReturn({
      coreResult,
      answerText,
      responseSource,
      keySpeakOriginal,
      keyTextIntegrity,
      startedAt,
      extras,
    }),
    ...resolveVisualBlocksFromCoreResult(coreResult),
  };
}

export const P5_BRAIN_RESPONSE_SOURCES = new Set([
  "p5_brain_customer_state",
  "p5_brain_state_guarded",
]);

export function isP5BrainResponseSource(responseSource) {
  return P5_BRAIN_RESPONSE_SOURCES.has(responseSource);
}

/**
 * Triangle T3 — raw question direct.
 * Trim ends only. Do NOT collapse newlines/spaces (no rewrite / spell-fix / intent reshape).
 */
export function normalizeHomeBrainQuestion(question) {
  return String(question ?? "").trim();
}

function normalizeQuestion(question) {
  return normalizeHomeBrainQuestion(question);
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

export async function handleHomeBrainFactRequest({
  userSupabase,
  customerId,
  authUserId = null,
  entityContext = null,
  question,
  history = [],
  attachedDocumentId = null,
  priorAttachFollowUp = false,
  sessionId = null,
  readyCardHandoffToken = null,
  presenceTurn = false,
  shadowVisualBlocksOverride = null,
  accessToken = null,
  env = process.env,
  fetchImpl = fetch,
  streamHandlers = null,
  requestStartedAt = null,
}) {
  const isPresenceTurn = presenceTurn === true;
  const trimmedQuestion = isPresenceTurn
    ? "__KEY_PRESENCE_LISTEN_FOCUS__"
    : normalizeQuestion(question);
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

  // Presence opener: no wait-ack filler (not a customer question).
  if (activeStreamHandlers?.onKeyWaitAck && !isPresenceTurn) {
    const ackText = buildKeyWaitAck(trimmedQuestion);
    sseTrace.key_wait_ack_text = ackText;
    sseTrace.key_wait_ack_ms = Math.max(0, Date.now() - startedAt);
    activeStreamHandlers.onKeyWaitAck(ackText);
  }

  const keyEnv = resolveOneKeyCoreS1Env(env);
  const coreResult = await runOneKeyCoreTurn({
    userSupabase,
    customerId,
    authUserId,
    entityContext,
    question: trimmedQuestion,
    history: isPresenceTurn ? [] : history,
    attachedDocumentId: isPresenceTurn ? null : attachedDocumentId,
    priorAttachFollowUp: isPresenceTurn ? false : priorAttachFollowUp,
    sessionId,
    readyCardHandoffToken,
    presenceTurn: isPresenceTurn,
    shadowVisualBlocksOverride: isPresenceTurn ? null : shadowVisualBlocksOverride,
    streamHandlers: activeStreamHandlers,
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
    return buildDonePayload({
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
    // Keep internal traces (incl. anthropic_upstream_diag on key_voice_trace).
    // Do not rebuild observability — customer text / SSE stay monopoly pass-through.
    return buildDonePayload({
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
        sales_director_trace: salesDirectorTrace ?? null,
      },
    });
  }

  const intent = agentTurn.consultationIntent?.intent ?? "general_consultation";
  const triangleT0 =
    salesDirectorTrace?.key_compose_trace?.key_voice_trace?.latency_marks?.triangle_t0 ?? null;
  // T4 — do not overwrite Claude-path persist marks with probe timing.
  if (
    triangleT0 &&
    typeof triangleT0 === "object" &&
    triangleT0.persist_start_ms == null
  ) {
    triangleT0.persist_start_ms = Math.max(0, Date.now() - startedAt);
  }
  const storedFactoryProbe = await probeStoredFactoryRecords(userSupabase, customerId);
  if (
    triangleT0 &&
    typeof triangleT0 === "object" &&
    triangleT0.persist_complete_ms == null
  ) {
    triangleT0.persist_complete_ms = Math.max(0, Date.now() - startedAt);
  }
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

  const attachedId = String(attachedDocumentId ?? "").trim() || null;
  const claudeFactoryDirection = attachedId
    ? buildClaudeFactoryDirectionFromTurn({
        question: trimmedQuestion,
        documentId: attachedId,
        coreResult,
      })
    : null;

  // Customer answer is already sealed/streamed — factory must not delay or rewrite it.
  if (attachedId && claudeFactoryDirection) {
    scheduleHomeChatFactoryAfterClaude({
      userSupabase,
      customerId,
      documentId: attachedId,
      claudeFactoryDirection,
      accessToken,
      env,
      fetchImpl,
    });
  }

  return buildDonePayload({
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
      // GO3 — short-term session work state for client metadata persist (not decision/memory).
      session_goal: coreResult.salesDirectorTrace?.session_goal ?? null,
      // OUR CLAUDE memory loop — consultation kinds for assistant metadata (not verified fact).
      key_consultation_record: coreResult.salesDirectorTrace?.key_consultation_record ?? null,
      decision_persisted: false,
      factsUsed,
      claude_factory_direction: claudeFactoryDirection,
      factory_enqueue: attachedId
        ? {
            deferred_until_after_claude: true,
            document_id: attachedId,
            started_async: true,
          }
        : null,
    },
  });
}
