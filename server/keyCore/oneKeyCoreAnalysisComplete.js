/**
 * ONE KEY Core S02-2 — analysis_complete event (stored panel read → initiative speak).
 */
import {
  appendAnalysisCompleteInitiativeSpeakTrace,
  analysisJobHasPanelResults,
  buildAnalysisCompleteInterpretShadow,
  buildAnalysisCompleteJudgment,
  buildKeyAnalysisCompleteIntakeShadowTrace,
  KEY_ANALYSIS_COMPLETE_INTAKE_SCHEMA_VERSION,
} from "../keyBrain/analysisCompleteIntakeShadow.js";
import { jobHasStoredRecommendation } from "../keyBrain/analysisCompleteFirstSpeak.js";
import { keySpeakAsync, KEY_SPEAK_MASTER_PATH } from "../keyBrain/keySpeak.js";
import { finalizeKeyCustomerText } from "./keyCustomerMonopoly.js";
import { sealKeyCustomerText } from "./keyCustomerTextSeal.js";
import { KEY_ENTRY, runSalesDirectorKeyTurn } from "../salesDirectorKeyOrchestrator.js";
import { buildWorkOrderDirectives } from "../keyBrain/workOrder.js";
import {
  buildLoadedContextFromSnapshot,
  loadSalesDirectorTurnContext,
  snapshotToContextBundle,
} from "../customerContextSnapshot.js";
import {
  ONE_KEY_CORE_RESPONSE_SOURCE,
  ONE_KEY_CORE_S1_BLOCKED_PATHS,
  resolveOneKeyCoreAnalysisCompleteEnv,
} from "./oneKeyCoreFlags.js";

export const ONE_KEY_CORE_ANALYSIS_COMPLETE_STEPS = [
  "interpret",
  "thinking",
  "judgment",
  "planner",
  "work_order",
  "evidence",
  "speak",
  "persona",
];

function buildAnalysisCompleteThinkingBundle({
  analysisJob = {},
  loadedContext = null,
  keyJudgment = null,
} = {}) {
  const hasStoredReco = jobHasStoredRecommendation(analysisJob);
  const hasPanels = analysisJobHasPanelResults(analysisJob);
  return {
    schema_version: "one-key-core-thinking-analysis-complete-v1",
    analysis_job_id: analysisJob.id ?? null,
    inputGates: {
      completed_job_present: analysisJob.status === "completed",
      panel_results_present: hasPanels,
      conn_001_panel_eligible: hasStoredReco,
      coverage_gap_suppressed: true,
    },
    speak_branch: hasStoredReco ? "conn_001_or_static" : "static_fallback",
    posture: keyJudgment?.posture ?? null,
    snapshot_loaded: Boolean(loadedContext),
  };
}

function buildAnalysisCompleteWorkOrderShadow({ plan = null } = {}) {
  const dispatchPlan = {
    actor: "KEY",
    executed: false,
    shadow_only: true,
    hold_reason: "analysis_complete_stored_panel_read_only",
    factory_work_orders: [],
    note: "S02-2 — factory already completed · Work Order mint skipped",
  };

  return {
    schema_version: "one-key-core-work-order-analysis-complete-v1",
    shadow_only: true,
    work_order_id: null,
    persisted: false,
    directives: buildWorkOrderDirectives(dispatchPlan),
    dispatch_plan: dispatchPlan,
    planner_tools: plan?.tools ?? [],
    coverage_gap_suppressed: plan?.coverage_gap_suppressed === true,
  };
}

function buildAnalysisCompleteEvidenceBundle({
  factBundle = {},
  analysisJob = {},
} = {}) {
  const result = analysisJob.result_json ?? {};
  return {
    schema_version: "one-key-core-evidence-analysis-complete-v1",
    analysis_job_id: analysisJob.id ?? null,
    stored_panels: {
      recommendation: Boolean(result.recommendation),
      coverage_gap: Boolean(result.coverage_gap),
      underwriting_risk: Boolean(result.underwriting_risk),
      insurance_design: Boolean(result.insurance_design),
    },
    recommendation: {
      loaded: factBundle.recommendation_used === true,
      priority_labels: factBundle.recommendation_priority_labels ?? [],
    },
    memory: {
      fact_count: factBundle.memory_fact_count ?? 0,
    },
    tools_called: factBundle.key_tools_called ?? [],
    factory_explain_invoked: false,
    factory_raw_evidence_loaded: true,
  };
}

function buildAnalysisCompleteIntakeTraceFromCore({
  analysisJob = {},
  loadedContext = null,
  contextSnapshot = null,
  snapshotFromCache = false,
  transitionObservedAt = null,
  keyJudgment = null,
  customerInitiativeSentence = null,
  personaMeta = null,
  oneKeyCoreTrace = null,
} = {}) {
  let intakeTrace = buildKeyAnalysisCompleteIntakeShadowTrace({
    analysisJob,
    loadedContext,
    contextSnapshot,
    snapshotFromCache,
    keyRuntimeEntered: true,
    keyEntry: KEY_ENTRY.ANALYSIS_COMPLETE,
    transitionObservedAt,
  });

  intakeTrace = {
    ...intakeTrace,
    schema_version: KEY_ANALYSIS_COMPLETE_INTAKE_SCHEMA_VERSION,
    response_source: ONE_KEY_CORE_RESPONSE_SOURCE.ANALYSIS_COMPLETE,
    one_key_core_event: "analysis_complete",
    one_key_core: true,
    one_key_core_trace: oneKeyCoreTrace,
    key_first_judgment: keyJudgment ?? intakeTrace.key_first_judgment,
  };

  if (customerInitiativeSentence) {
    intakeTrace = appendAnalysisCompleteInitiativeSpeakTrace(
      intakeTrace,
      customerInitiativeSentence,
      personaMeta,
    );
  }

  return intakeTrace;
}

/**
 * ONE KEY Core analysis_complete turn — S02-2.
 */
export async function runOneKeyCoreAnalysisCompleteTurn({
  userSupabase,
  customerId,
  analysisJob,
  transitionObservedAt = null,
  env = process.env,
  fetchImpl = fetch,
  startedAt = Date.now(),
} = {}) {
  const coreEnv = resolveOneKeyCoreAnalysisCompleteEnv(env);
  const trace = {
    schema_version: "one-key-core-trace-analysis-complete-v1",
    event: "analysis_complete",
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
  let snapshotFromCache = false;

  try {
    const turnContext = await loadSalesDirectorTurnContext(userSupabase, customerId, {
      requestHistory: [],
    });
    contextSnapshot = turnContext.snapshot;
    unifiedState = turnContext.unifiedState;
    loadedContext = buildLoadedContextFromSnapshot(contextSnapshot);
    customerContextBundle = snapshotToContextBundle(contextSnapshot) ?? {};
    snapshotFromCache = turnContext.from_cache === true;
  } catch (error) {
    return {
      ok: false,
      reason: "context_snapshot_load_failed",
      error_message: error?.message ?? "snapshot_load_failed",
    };
  }

  const interpretRecord = buildAnalysisCompleteInterpretShadow({
    analysisJob,
    transitionObservedAt,
    loadedContext,
    contextSnapshot,
  });
  recordStep("interpret", interpretRecord);

  const keyJudgment = buildAnalysisCompleteJudgment({
    analysisJob,
    loadedContext,
    contextSnapshot,
  });

  const thinkingBundle = buildAnalysisCompleteThinkingBundle({
    analysisJob,
    loadedContext,
    keyJudgment,
  });
  recordStep("thinking", thinkingBundle);
  recordStep("judgment", keyJudgment);

  const keyTurn = await runSalesDirectorKeyTurn({
    userSupabase,
    customerId,
    question: "",
    env: coreEnv,
    fetchImpl,
    startedAt,
    snapshot: contextSnapshot,
    unified: unifiedState,
    loadedContext,
    customerContextBundle,
    reconciliationWarning: null,
    keyEntry: KEY_ENTRY.ANALYSIS_COMPLETE,
    analysisJob,
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

  recordStep("planner", {
    primitive: "runSalesDirectorKeyTurn",
    key_entry: KEY_ENTRY.ANALYSIS_COMPLETE,
    tools_called: salesDirectorTrace?.key_orchestrator?.tools_called ?? [],
    conn_001_recommendation_panel_wired: plan?.conn_001_recommendation_panel_wired === true,
  });

  recordStep("work_order", buildAnalysisCompleteWorkOrderShadow({ plan }));

  const factBundle = {
    ...(agentTurn.factBundle ?? {}),
    one_key_core: true,
    one_key_core_analysis_complete: true,
    analysis_job_id: analysisJob.id ?? null,
    analysis_job_status: analysisJob.status ?? null,
  };
  recordStep("evidence", buildAnalysisCompleteEvidenceBundle({ factBundle, analysisJob }));

  const speakResult = await keySpeakAsync({
    event: "analysis_complete",
    keyFirstJudgment: keyJudgment,
    contextSnapshot,
    loadedContext,
  });
  recordStep("speak", {
    compose_mode: speakResult.key_compose_trace?.compose_mode ?? "key_master_analysis_complete",
    key_speak_master: true,
    static_draft_preview: String(speakResult.speakDraft ?? "").slice(0, 300),
    ghost_path_reached: speakResult.key_compose_trace?.ghost_path_reached ?? [],
  });

  trace.customer_text_path.push(...KEY_SPEAK_MASTER_PATH);

  const outletResult = finalizeKeyCustomerText(speakResult.speakDraft, {
    failureMode:
      speakResult.failureMode === true || !String(speakResult.speakDraft ?? "").trim(),
  });
  const customerInitiativeSeal = sealKeyCustomerText(outletResult.keySpeakOriginal);
  const customerInitiativeSentence = customerInitiativeSeal.key_speak_original;
  const personaMeta = {
    generation_mode: outletResult.generation_mode,
    persona_rewrite_blocked: true,
    key_speak_master: true,
  };

  recordStep("persona", {
    generation_mode: personaMeta.generation_mode,
    text_preview: String(customerInitiativeSentence ?? "").slice(0, 300),
    persona_rewrite_blocked: true,
    key_speak_master: true,
  });

  const stepNames = trace.steps.map((row) => row.step);
  const traceComplete = ONE_KEY_CORE_ANALYSIS_COMPLETE_STEPS.every((name) => stepNames.includes(name));

  const intakeTrace = buildAnalysisCompleteIntakeTraceFromCore({
    analysisJob,
    loadedContext,
    contextSnapshot,
    snapshotFromCache,
    transitionObservedAt,
    keyJudgment,
    customerInitiativeSentence,
    ...customerInitiativeSeal,
    personaMeta,
    oneKeyCoreTrace: { ...trace, complete: traceComplete },
  });

  return {
    ok: true,
    event: "analysis_complete",
    response_source: ONE_KEY_CORE_RESPONSE_SOURCE.ANALYSIS_COMPLETE,
    customerInitiativeSentence,
    ...customerInitiativeSeal,
    personaMeta,
    keyFirstJudgment: keyJudgment,
    intakeTrace,
    workOrderId: null,
    agentTurn: {
      ...agentTurn,
      text: customerInitiativeSentence,
      responseSource: ONE_KEY_CORE_RESPONSE_SOURCE.ANALYSIS_COMPLETE,
      factBundle,
    },
    oneKeyCoreTrace: trace,
    traceComplete,
    salesDirectorTrace,
  };
}
