/**
 * ONE KEY Core — Interpret → Thinking → Judgment → Planner → Work Order → Evidence → Speak → Persona
 */
import { classifyConsultationIntent } from "../intentGateLayer.js";
import {
  buildLoadedContextFromSnapshot,
  loadSalesDirectorTurnContext,
  snapshotToContextBundle,
} from "../customerContextSnapshot.js";
import { buildKeyFirstJudgment } from "../keyBrain/documentFirstJudgment.js";
import { resolveSalesDirectorJudgmentIntent } from "../salesDirectorFormatter.js";
import {
  finalizeKeyCustomerText,
  KEY_CUSTOMER_TEXT_PATH,
} from "./keyCustomerMonopoly.js";
import { keySpeak, keySpeakAsync } from "../keyBrain/keySpeak.js";
import { isKeyVoiceActive } from "./oneKeyCoreFlags.js";
import {
  KEY_ENTRY,
  runSalesDirectorKeyTurn,
} from "../salesDirectorKeyOrchestrator.js";
import { buildWorkOrderDirectives } from "../keyBrain/workOrder.js";
import {
  isOneKeyCoreAnalysisCompleteEnabled,
  isOneKeyCoreBridgeEnabled,
  isOneKeyCoreDocumentEnabled,
  isOneKeyCoreReturnJudgmentEnabled,
  isOneKeyCoreS1Enabled,
  ONE_KEY_CORE_RESPONSE_SOURCE,
  ONE_KEY_CORE_S1_BLOCKED_PATHS,
  resolveOneKeyCoreAnalysisCompleteEnv,
  resolveOneKeyCoreBridgeEnv,
  resolveOneKeyCoreDocumentEnv,
  resolveOneKeyCoreReturnJudgmentEnv,
  resolveOneKeyCoreS1Env,
} from "./oneKeyCoreFlags.js";
import {
  buildQuestionInterpretShadow,
  buildQuestionThinkingBundle,
} from "./oneKeyCoreInterpret.js";
import { runOneKeyCoreDocumentTurn } from "./oneKeyCoreDocument.js";
import { runOneKeyCoreAnalysisCompleteTurn } from "./oneKeyCoreAnalysisComplete.js";
import { runOneKeyCoreBridgeTurn } from "./oneKeyCoreBridge.js";
import { runOneKeyCoreReturnJudgmentTurn } from "./oneKeyCoreReturnJudgment.js";
import {
  buildKeyFirstDecisionShadowDiff,
  isKeyFirstDecisionShadowEnabled,
  resolveKeyFirstDecision,
} from "../keyBrain/keyFirstDecision.js";

export {
  isOneKeyCoreAnalysisCompleteEnabled,
  isOneKeyCoreBridgeEnabled,
  isOneKeyCoreDocumentEnabled,
  isOneKeyCoreReturnJudgmentEnabled,
  isOneKeyCoreS1Enabled,
  resolveOneKeyCoreAnalysisCompleteEnv,
  resolveOneKeyCoreBridgeEnv,
  resolveOneKeyCoreDocumentEnv,
  resolveOneKeyCoreReturnJudgmentEnv,
  resolveOneKeyCoreS1Env,
  ONE_KEY_CORE_S1_BLOCKED_PATHS,
  ONE_KEY_CORE_RESPONSE_SOURCE,
};

const CORE_STEPS = [
  "interpret",
  "thinking",
  "judgment",
  "planner",
  "work_order",
  "evidence",
  "speak",
  "persona",
];

function buildS1WorkOrderTrace({ plan = null } = {}) {
  const dispatchPlan = {
    actor: "KEY",
    executed: false,
    shadow_only: true,
    hold_reason: "one_key_core_s1_trace_only",
    factory_work_orders: (plan?.tools ?? []).map((tool) => ({
      factory: tool,
      scope: "stored_read_or_snapshot",
      reason: "s1_planner_selection",
      ordered_by: "KEY",
      executed_in_s1: false,
    })),
    note: "S1 — Work Order mint deferred · trace only",
  };

  return {
    schema_version: "one-key-core-work-order-trace-v1",
    shadow_only: true,
    directives: buildWorkOrderDirectives(dispatchPlan),
    dispatch_plan: dispatchPlan,
  };
}

function buildEvidenceBundle({ factBundle = {}, customerContextBundle = null, toolRun = null } = {}) {
  return {
    schema_version: "one-key-core-evidence-v1",
    coverage_gap: {
      loaded: factBundle.coverage_gap_used === true,
      score: factBundle.coverage_gap_score ?? null,
      top_concerns: factBundle.coverage_gap_top_concerns ?? [],
    },
    underwriting: {
      loaded: factBundle.underwriting_used === true,
      risk_score: factBundle.underwriting_risk_score ?? null,
    },
    recommendation: {
      loaded: factBundle.recommendation_used === true,
      priority_labels: factBundle.recommendation_priority_labels ?? [],
    },
    design: {
      loaded: factBundle.design_used === true,
    },
    memory: {
      fact_count: factBundle.memory_fact_count ?? customerContextBundle?.memoryFactCount ?? 0,
    },
    policies: {
      active_count: factBundle.active_policy_count ?? factBundle.policy_count ?? null,
      tool_policies_count: (factBundle.policies ?? []).length,
    },
    premium_stats: factBundle.premium_stats ?? null,
    tools_called: toolRun?.tools_called ?? factBundle.key_tools_called ?? [],
    factory_explain_invoked: false,
  };
}

async function buildOneKeySpeakDraft({
  question = "",
  keyJudgment = null,
  consultationIntent = null,
  contextSnapshot = null,
  loadedContext = null,
  thinkingFlow = null,
  evidenceBundle = null,
  env = process.env,
  history = [],
  previousAnswerSummary = "",
  shadowVisualBlocksOverride = null,
} = {}) {
  const speakInput = {
    event: "question",
    question,
    keyFirstJudgment: keyJudgment,
    contextSnapshot,
    loadedContext,
    consultationIntent,
    thinkingFlow,
    evidenceBundle,
    env,
    history,
    previousAnswerSummary,
    shadowVisualBlocksOverride,
  };

  const speakResult = isKeyVoiceActive(env)
    ? await keySpeakAsync(speakInput)
    : keySpeak(speakInput);

  return {
    speakDraft: speakResult.speakDraft,
    keyComposeTrace: speakResult.key_compose_trace,
    visualBlocks: speakResult.visual_blocks ?? speakResult.key_compose_trace?.visual_blocks ?? [],
    keySpeakMaster: true,
  };
}

function buildKeyMonopolyQuestionFailure({
  question = "",
  consultationIntent = null,
  reason = "key_turn_failed",
  trace = null,
  startedAt = Date.now(),
} = {}) {
  const outlet = finalizeKeyCustomerText("", { failureMode: true });
  const customerText = outlet.keySpeakOriginal;
  const resolvedIntent = resolveSalesDirectorJudgmentIntent(
    consultationIntent?.intent ?? "general_consultation",
    question,
  );
  return {
    ok: true,
    customerText,
    keySpeakOriginal: customerText,
    key_monopoly_failure: true,
    failure_reason: reason,
    agentTurn: {
      text: customerText,
      responseSource: ONE_KEY_CORE_RESPONSE_SOURCE.QUESTION,
      consultationIntent: consultationIntent ?? classifyConsultationIntent(question),
      factBundle: {
        one_key_core: true,
        one_key_core_s1: true,
        key_monopoly_failure: true,
        question,
        classification_intent: consultationIntent?.intent ?? null,
      },
    },
    modeDecision: null,
    loadedContext: null,
    contextSnapshot: null,
    unifiedState: null,
    customerContextBundle: null,
    salesDirectorTrace: {
      one_key_core: true,
      one_key_core_s1: true,
      key_monopoly_failure: true,
      failure_reason: reason,
      one_key_core_trace: trace,
      legacy_paths_blocked: ONE_KEY_CORE_S1_BLOCKED_PATHS,
    },
    truthGate: null,
    latency: { total_ms: Date.now() - startedAt },
    loopStartedAt: startedAt,
    oneKeyCoreTrace: trace,
    traceComplete: false,
    resolvedIntent,
  };
}

/**
 * ONE KEY Core turn — routes by event (question · document · analysis_complete · bridge · return_judgment).
 */
export async function runOneKeyCoreTurn({
  event = "question",
  userSupabase,
  customerId,
  question = "",
  history = [],
  document = null,
  analysisJob = null,
  sessionId = null,
  gapHours = null,
  gate = { emit: true, reasons: [] },
  transitionObservedAt = null,
  hasAnalysisConsent = false,
  uploadSource = "web",
  categoryKey = null,
  uploadEntryMode = null,
  shadowVisualBlocksOverride = null,
  env = process.env,
  fetchImpl = fetch,
  startedAt = Date.now(),
} = {}) {
  if (event === "document") {
    return runOneKeyCoreDocumentTurn({
      userSupabase,
      customerId,
      document,
      hasAnalysisConsent,
      uploadSource,
      categoryKey,
      uploadEntryMode,
      env,
      fetchImpl,
      startedAt,
    });
  }

  if (event === "analysis_complete") {
    return runOneKeyCoreAnalysisCompleteTurn({
      userSupabase,
      customerId,
      analysisJob,
      transitionObservedAt,
      env,
      fetchImpl,
      startedAt,
    });
  }

  if (event === "return_judgment") {
    return runOneKeyCoreReturnJudgmentTurn({
      userSupabase,
      customerId,
      sessionId,
      anchorJob: analysisJob,
      gapHours,
      gate,
      transitionObservedAt,
      env,
      fetchImpl,
      startedAt,
    });
  }

  if (event === "bridge") {
    return runOneKeyCoreBridgeTurn({
      userSupabase,
      customerId,
      sessionId,
      anchorJob: analysisJob,
      gapHours,
      gate,
      transitionObservedAt,
      env,
      fetchImpl,
      startedAt,
    });
  }

  return runOneKeyCoreQuestionTurn({
    userSupabase,
    customerId,
    question,
    history,
    env,
    fetchImpl,
    startedAt,
  });
}

/**
 * ONE KEY Core question event (S1).
 */
async function runOneKeyCoreQuestionTurn({
  userSupabase,
  customerId,
  question,
  history = [],
  env = process.env,
  fetchImpl = fetch,
  startedAt = Date.now(),
} = {}) {
  const coreEnv = resolveOneKeyCoreS1Env(env);
  const trace = {
    schema_version: "one-key-core-trace-s1-v1",
    steps: [],
    legacy_paths_blocked: ONE_KEY_CORE_S1_BLOCKED_PATHS,
    customer_text_path: [],
  };

  const recordStep = (step, payload) => {
    trace.steps.push({ step, at: step, payload });
  };

  let contextSnapshot = null;
  let unifiedState = null;
  let loadedContext = null;
  let customerContextBundle = null;

  try {
    const turnContext = await loadSalesDirectorTurnContext(userSupabase, customerId, {
      requestHistory: history,
    });
    contextSnapshot = turnContext.snapshot;
    unifiedState = turnContext.unifiedState;
    loadedContext = buildLoadedContextFromSnapshot(contextSnapshot);
    customerContextBundle = snapshotToContextBundle(contextSnapshot) ?? {};
  } catch (error) {
    return buildKeyMonopolyQuestionFailure({
      question,
      consultationIntent: classifyConsultationIntent(question),
      reason: "context_snapshot_load_failed",
      trace,
      startedAt,
    });
  }

  const consultationIntent = classifyConsultationIntent(question);

  const interpretRecord = buildQuestionInterpretShadow({
    question,
    loadedContext,
    contextSnapshot,
    consultationIntent,
  });
  recordStep("interpret", interpretRecord);

  const thinkingBundle = buildQuestionThinkingBundle(
    {
      question,
      contextSnapshot,
      loadedContext,
      keyInterprets: interpretRecord,
      consultationIntent,
    },
    env,
  );
  recordStep("thinking", thinkingBundle);

  if (thinkingBundle.slice5_enabled) {
    recordStep("reflection", thinkingBundle.reflection ?? null);
    recordStep("decision", thinkingBundle.decision ?? null);
    recordStep("runtime_trace", thinkingBundle.runtime_trace ?? null);
  }

  const keyJudgment = buildKeyFirstJudgment({
    document: { id: null, event_type: "question" },
    keyInterprets: interpretRecord,
    loadedContext,
    contextSnapshot,
  });
  recordStep("judgment", keyJudgment);

  let keyFirstDecisionRecord = null;
  if (isKeyFirstDecisionShadowEnabled(env)) {
    keyFirstDecisionRecord = resolveKeyFirstDecision({
      question,
      consultationIntent,
      keyJudgment,
      loadedContext,
      thinkingBundle,
    });
    recordStep("key_first_decision", keyFirstDecisionRecord);
  }

  const keyTurn = await runSalesDirectorKeyTurn({
    userSupabase,
    customerId,
    question,
    history,
    env: coreEnv,
    fetchImpl,
    startedAt,
    snapshot: contextSnapshot,
    unified: unifiedState,
    loadedContext,
    customerContextBundle,
    reconciliationWarning: null,
    keyEntry: KEY_ENTRY.QUESTION,
  });

  if (!keyTurn?.handled || !keyTurn.result) {
    return buildKeyMonopolyQuestionFailure({
      question,
      consultationIntent,
      reason: keyTurn?.reason ?? "key_planner_failed",
      trace,
      startedAt,
    });
  }

  const { agentTurn, salesDirectorTrace } = keyTurn.result;
  const plan = salesDirectorTrace?.key_orchestrator?.plan ?? null;
  const toolRun = {
    tools_called: salesDirectorTrace?.key_orchestrator?.tools_called ?? [],
    tool_results: salesDirectorTrace?.key_orchestrator?.tool_results ?? [],
  };

  recordStep("planner", {
    primitive: "runSalesDirectorKeyTurn",
    plan,
    tools_called: toolRun.tools_called,
    consultation_intent: consultationIntent?.intent ?? null,
  });

  if (isKeyFirstDecisionShadowEnabled(env) && keyFirstDecisionRecord) {
    recordStep(
      "key_first_decision_shadow_diff",
      buildKeyFirstDecisionShadowDiff({
        decision: keyFirstDecisionRecord,
        legacyPlan: plan,
      }),
    );
  }

  const workOrderTrace = buildS1WorkOrderTrace({ plan });
  recordStep("work_order", workOrderTrace);

  const factBundle = {
    ...(agentTurn.factBundle ?? {}),
    one_key_core: true,
    one_key_core_s1: true,
  };
  const evidenceBundle = buildEvidenceBundle({
    factBundle,
    customerContextBundle: keyTurn.result.customerContextBundle,
    toolRun,
  });
  recordStep("evidence", evidenceBundle);

  const conversationHistory = (history ?? []).map((turn) => ({
    role: turn.role === "assistant" ? "assistant" : "user",
    text: String(turn.content ?? turn.text ?? turn.message ?? "").trim(),
  })).filter((t) => t.text);
  const previousAnswerSummary = conversationHistory
    .filter((t) => t.role === "assistant")
    .slice(-1)[0]?.text ?? "";

  const speakResult = await buildOneKeySpeakDraft({
    question,
    keyJudgment,
    consultationIntent,
    contextSnapshot,
    loadedContext,
    thinkingFlow: thinkingBundle,
    evidenceBundle,
    env: coreEnv,
    history: conversationHistory,
    previousAnswerSummary,
    shadowVisualBlocksOverride,
  });
  recordStep("speak", {
    draft_preview: String(speakResult.speakDraft ?? "").slice(0, 300),
    compose_mode: speakResult.keyComposeTrace?.compose_mode ?? "key_master_question",
    key_speak_master: true,
    key_compose_trace: speakResult.keyComposeTrace,
    shadow_visual_blocks_override_used:
      speakResult.keyComposeTrace?.key_voice_trace?.shadow_visual_blocks_override_used ?? false,
    shadow_visual_blocks_override_count:
      speakResult.keyComposeTrace?.key_voice_trace?.shadow_visual_blocks_override_count ?? 0,
    speech_turn_type: speakResult.keyComposeTrace?.speech_turn_type ?? null,
    conversation_intention: speakResult.keyComposeTrace?.conversation_intention ?? null,
    conversation_elements_used: speakResult.keyComposeTrace?.conversation_elements_used ?? [],
    facts_used: speakResult.keyComposeTrace?.facts_used ?? [],
    facts_spoken: speakResult.keyComposeTrace?.facts_spoken ?? [],
    facts_withheld: speakResult.keyComposeTrace?.facts_withheld ?? [],
    defer_detected: speakResult.keyComposeTrace?.defer_detected ?? false,
    element_count: speakResult.keyComposeTrace?.element_count ?? 0,
    thinking_density: speakResult.keyComposeTrace?.thinking_density ?? null,
    thinking_ok: speakResult.keyComposeTrace?.thinking_ok ?? thinkingBundle?.thinking_ok ?? null,
    understanding_ok: speakResult.keyComposeTrace?.understanding_ok ?? thinkingBundle?.understanding_ok ?? null,
    thinking_flow_applied: speakResult.keyComposeTrace?.thinking_flow_applied ?? false,
    confidence: speakResult.keyComposeTrace?.confidence ?? thinkingBundle?.customer_understanding?.confidence ?? null,
    selected_goal: speakResult.keyComposeTrace?.selected_goal ?? thinkingBundle?.customer_understanding?.selected_goal ?? null,
    rejected_hypotheses:
      speakResult.keyComposeTrace?.rejected_hypotheses ??
      thinkingBundle?.customer_understanding?.rejected_hypotheses ??
      [],
    confirmation_required:
      speakResult.keyComposeTrace?.confirmation_required ??
      thinkingBundle?.customer_understanding?.confirmation_required ??
      false,
    fact_selection: thinkingBundle?.fact_selection ?? null,
    slice5_enabled: speakResult.keyComposeTrace?.slice5_enabled ?? thinkingBundle?.slice5_enabled ?? false,
    inferred_goal:
      speakResult.keyComposeTrace?.inferred_goal ?? thinkingBundle?.runtime_trace?.inferred_goal ?? null,
    direction_type: speakResult.keyComposeTrace?.direction_type ?? null,
    fact_text_gate: speakResult.keyComposeTrace?.fact_text_gate ?? null,
    reflection_snapshot: speakResult.keyComposeTrace?.reflection_snapshot ?? thinkingBundle?.reflection ?? null,
    decision_snapshot: speakResult.keyComposeTrace?.decision_snapshot ?? thinkingBundle?.decision ?? null,
    compose_mode: speakResult.keyComposeTrace?.compose_mode ?? null,
    key_voice_enabled: speakResult.keyComposeTrace?.key_voice_enabled ?? false,
    key_voice_trace: speakResult.keyComposeTrace?.key_voice_trace ?? null,
    visual_blocks: speakResult.visualBlocks ?? [],
    visual_blocks_gate:
      speakResult.keyComposeTrace?.key_voice_trace?.visual_blocks_gate ?? null,
  });

  trace.customer_text_path.push(...KEY_CUSTOMER_TEXT_PATH);

  const outletResult = finalizeKeyCustomerText(speakResult.speakDraft);
  recordStep("persona", {
    generation_mode: outletResult.generation_mode,
    persona_rewrite_blocked: outletResult.persona_rewrite_blocked,
    completeness_guard: outletResult.completeness_guard ?? null,
    text_preview: String(outletResult.customerText ?? "").slice(0, 300),
  });

  trace.persona_rewrite_blocked = outletResult.persona_rewrite_blocked;

  const stepNames = trace.steps.map((row) => row.step);
  const traceComplete = CORE_STEPS.every((name) => stepNames.includes(name));

  return {
    ok: true,
    customerText: outletResult.customerText,
    visualBlocks: speakResult.visualBlocks ?? [],
    keySpeakOriginal: outletResult.keySpeakOriginal,
    agentTurn: {
      ...agentTurn,
      text: outletResult.customerText,
      responseSource: ONE_KEY_CORE_RESPONSE_SOURCE.QUESTION,
      consultationIntent,
      factBundle,
    },
    modeDecision: keyTurn.result.modeDecision,
    loadedContext,
    contextSnapshot,
    unifiedState,
    customerContextBundle: keyTurn.result.customerContextBundle,
    salesDirectorTrace: {
      ...salesDirectorTrace,
      one_key_core: true,
      one_key_core_s1: true,
      one_key_core_trace: {
        ...trace,
        complete: traceComplete,
        core_steps_expected: CORE_STEPS,
      },
      legacy_paths_blocked: ONE_KEY_CORE_S1_BLOCKED_PATHS,
      key_customer_monopoly: true,
      persona_rewrite_blocked: outletResult.persona_rewrite_blocked,
    },
    truthGate: keyTurn.result.truthGate,
    latency: keyTurn.result.latency,
    loopStartedAt: keyTurn.result.loopStartedAt ?? startedAt,
    oneKeyCoreTrace: trace,
    traceComplete,
  };
}
