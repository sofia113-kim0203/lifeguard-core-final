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
import { finalizeSalesDirectorResponse, resolveSalesDirectorJudgmentIntent } from "../salesDirectorFormatter.js";
import { ONE_BRAIN_SURFACES } from "../oneBrainResponseLayer.js";
import { polishLifeguardCustomerText } from "../lifeguardOutputGuard.js";
import {
  buildBasisTaggedFacts,
  buildHumanUnderstandingFrame,
  buildKeyStructuredResponse,
} from "../humanUnderstandingLoop.js";
import { computePremiumLookupStats } from "../intentGateLayer.js";
import {
  KEY_ENTRY,
  runSalesDirectorKeyTurn,
} from "../salesDirectorKeyOrchestrator.js";
import { buildWorkOrderDirectives } from "../keyBrain/workOrder.js";
import {
  isOneKeyCoreAnalysisCompleteEnabled,
  isOneKeyCoreDocumentEnabled,
  isOneKeyCoreS1Enabled,
  ONE_KEY_CORE_RESPONSE_SOURCE,
  ONE_KEY_CORE_S1_BLOCKED_PATHS,
  resolveOneKeyCoreAnalysisCompleteEnv,
  resolveOneKeyCoreDocumentEnv,
  resolveOneKeyCoreS1Env,
} from "./oneKeyCoreFlags.js";
import {
  buildQuestionInterpretShadow,
  buildQuestionThinkingBundle,
} from "./oneKeyCoreInterpret.js";
import { runOneKeyCoreDocumentTurn } from "./oneKeyCoreDocument.js";
import { runOneKeyCoreAnalysisCompleteTurn } from "./oneKeyCoreAnalysisComplete.js";

export {
  isOneKeyCoreAnalysisCompleteEnabled,
  isOneKeyCoreDocumentEnabled,
  isOneKeyCoreS1Enabled,
  resolveOneKeyCoreAnalysisCompleteEnv,
  resolveOneKeyCoreDocumentEnv,
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

function buildOneKeySpeakDraft({
  question = "",
  factBundle = {},
  consultationIntent = null,
  customerContextBundle = null,
} = {}) {
  const classificationIntent = consultationIntent?.intent ?? factBundle.classification_intent ?? "";
  const resolvedIntent = resolveSalesDirectorJudgmentIntent(classificationIntent, question);
  const enrichedBundle = {
    ...factBundle,
    question,
    key_orchestrator: true,
    one_key_core: true,
    premium_stats: factBundle.premium_stats ?? computePremiumLookupStats(factBundle.policies ?? []),
  };

  const basisTaggedFacts = buildBasisTaggedFacts(enrichedBundle, resolvedIntent);
  const humanFrame = buildHumanUnderstandingFrame({
    question,
    intent: resolvedIntent,
    surface: ONE_BRAIN_SURFACES.HOME,
    conversationContext: { classificationIntent },
    factBundle: enrichedBundle,
    basisTaggedFacts,
  });

  const speakDraft = buildKeyStructuredResponse(
    humanFrame,
    basisTaggedFacts,
    enrichedBundle,
    { resolvedIntent },
    {
      phaseBCoverageJudgment: null,
      phaseBPremiumJudgment: null,
    },
  );

  return {
    speakDraft,
    humanFrame,
    basisTaggedFacts,
    resolvedIntent,
    enrichedBundle,
    customerState: {
      question,
      keyOrchestrator: true,
      coverageGapContext: customerContextBundle?.coverageGapContext ?? null,
      recommendationContext: customerContextBundle?.recommendationContext ?? null,
      underwritingRiskContext: customerContextBundle?.underwritingRiskContext ?? null,
      designContext: customerContextBundle?.designContext ?? null,
    },
  };
}

function finalizeOneKeyCorePersona({
  speakDraft = "",
  question = "",
  consultationIntent = null,
  factBundle = {},
  customerState = null,
  resolvedIntent = null,
} = {}) {
  const classificationIntent = consultationIntent?.intent ?? factBundle.classification_intent ?? "";
  const personaFactBundle = {
    ...factBundle,
    question,
    key_orchestrator: true,
    one_key_core: true,
    one_key_core_s1: true,
    classification_intent: classificationIntent,
  };

  const finalized = finalizeSalesDirectorResponse({
    rawText: speakDraft,
    intent: resolvedIntent ?? resolveSalesDirectorJudgmentIntent(classificationIntent, question),
    classificationIntent,
    surface: ONE_BRAIN_SURFACES.HOME,
    factBundle: personaFactBundle,
    customerState: {
      ...(customerState ?? {}),
      question,
      keyOrchestrator: true,
    },
    homeBrainIntent: "unsupported",
    conversationContext: { responseSource: ONE_KEY_CORE_RESPONSE_SOURCE.QUESTION },
  });

  const customerText = polishLifeguardCustomerText(finalized.text ?? speakDraft);

  return {
    customerText,
    personaMeta: finalized,
    generation_mode: finalized.generation_mode ?? "one_key_core_persona_outlet",
  };
}

/**
 * ONE KEY Core turn — routes by event (question · document · analysis_complete).
 */
export async function runOneKeyCoreTurn({
  event = "question",
  userSupabase,
  customerId,
  question = "",
  history = [],
  document = null,
  analysisJob = null,
  transitionObservedAt = null,
  hasAnalysisConsent = false,
  uploadSource = "web",
  categoryKey = null,
  uploadEntryMode = null,
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
    return {
      ok: false,
      reason: "context_snapshot_load_failed",
      error_message: error?.message ?? "snapshot_load_failed",
    };
  }

  const consultationIntent = classifyConsultationIntent(question);

  const interpretRecord = buildQuestionInterpretShadow({
    question,
    loadedContext,
    contextSnapshot,
    consultationIntent,
  });
  recordStep("interpret", interpretRecord);

  const thinkingBundle = buildQuestionThinkingBundle({
    question,
    contextSnapshot,
    loadedContext,
    keyInterprets: interpretRecord,
  });
  recordStep("thinking", thinkingBundle);

  const keyJudgment = buildKeyFirstJudgment({
    document: { id: null, event_type: "question" },
    keyInterprets: interpretRecord,
    loadedContext,
    contextSnapshot,
  });
  recordStep("judgment", keyJudgment);

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
    return {
      ok: false,
      reason: keyTurn?.reason ?? "key_planner_failed",
      one_key_core_trace: trace,
    };
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

  const speakResult = buildOneKeySpeakDraft({
    question,
    factBundle,
    consultationIntent,
    customerContextBundle: keyTurn.result.customerContextBundle,
  });
  recordStep("speak", {
    draft_preview: String(speakResult.speakDraft ?? "").slice(0, 300),
    resolved_intent: speakResult.resolvedIntent,
    compose_mode: "buildKeyStructuredResponse",
  });

  trace.customer_text_path.push(
    "buildKeyStructuredResponse",
    "finalizeSalesDirectorResponse(one_key_core_preserve)",
    "polishLifeguardCustomerText",
  );

  const personaResult = finalizeOneKeyCorePersona({
    speakDraft: speakResult.speakDraft,
    question,
    consultationIntent,
    factBundle,
    customerState: speakResult.customerState,
    resolvedIntent: speakResult.resolvedIntent,
  });
  recordStep("persona", {
    generation_mode: personaResult.generation_mode,
    text_preview: String(personaResult.customerText ?? "").slice(0, 300),
  });

  const stepNames = trace.steps.map((row) => row.step);
  const traceComplete = CORE_STEPS.every((name) => stepNames.includes(name));

  return {
    ok: true,
    customerText: personaResult.customerText,
    agentTurn: {
      ...agentTurn,
      text: personaResult.customerText,
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
      finalize_trace: personaResult.personaMeta,
    },
    truthGate: keyTurn.result.truthGate,
    latency: keyTurn.result.latency,
    loopStartedAt: keyTurn.result.loopStartedAt ?? startedAt,
    oneKeyCoreTrace: trace,
    traceComplete,
  };
}
