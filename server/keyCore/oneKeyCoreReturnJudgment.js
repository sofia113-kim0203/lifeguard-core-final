/**
 * ONE KEY Core S02-4 — return_judgment event (anchor stored read → CONN speak chain).
 */
import {
  buildReturnJudgment,
  jobHasPanelResults,
} from "../keyBrain/returnJudgmentFirstSpeak.js";
import { keySpeakAsync, KEY_SPEAK_MASTER_PATH } from "../keyBrain/keySpeak.js";
import { finalizeKeyCustomerText } from "./keyCustomerMonopoly.js";
import { buildKeyReturnJudgmentIntakeShadowTrace } from "../keyBrain/returnJudgmentIntakeShadow.js";
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
  resolveOneKeyCoreReturnJudgmentEnv,
} from "./oneKeyCoreFlags.js";

export const ONE_KEY_CORE_RETURN_JUDGMENT_STEPS = [
  "interpret",
  "thinking",
  "judgment",
  "planner",
  "work_order",
  "evidence",
  "speak",
  "persona",
];

function buildReturnJudgmentInterpretShadow({
  sessionId = null,
  gapHours = null,
  anchorJob = null,
  gate = {},
} = {}) {
  return {
    schema_version: "one-key-core-interpret-return-judgment-v1",
    session_id: sessionId,
    gap_hours: gapHours,
    anchor_job_id: anchorJob?.id ?? null,
    anchor_job_status: anchorJob?.status ?? null,
    panel_results_present: jobHasPanelResults(anchorJob),
    gate_emit: gate.emit === true,
    gate_reasons: gate.reasons ?? [],
    key_entry: KEY_ENTRY.RETURN_JUDGMENT,
  };
}

function buildReturnJudgmentThinkingBundle({
  anchorJob = {},
  keyJudgment = null,
  plan = null,
} = {}) {
  return {
    schema_version: "one-key-core-thinking-return-judgment-v1",
    anchor_job_id: anchorJob.id ?? null,
    inputGates: {
      anchor_completed: anchorJob.status === "completed",
      panel_results_present: jobHasPanelResults(anchorJob),
      coverage_gap_suppressed: plan?.coverage_gap_suppressed === true,
    },
    conn_panel_wired: {
      conn_002_coverage_gap: plan?.conn_002_coverage_gap_panel_wired === true,
      conn_003_underwriting: plan?.conn_003_underwriting_panel_wired === true,
      conn_004_design: plan?.conn_004_design_panel_wired === true,
      conn_005_rebalancing: plan?.conn_005_rebalancing_panel_wired === true,
    },
    posture: keyJudgment?.posture ?? null,
    speak_chain: "keySpeak(key_master_return_judgment)",
  };
}

function buildReturnJudgmentWorkOrderShadow({ plan = null } = {}) {
  const dispatchPlan = {
    actor: "KEY",
    executed: false,
    shadow_only: true,
    hold_reason: "return_judgment_stored_panel_read_only",
    factory_work_orders: [],
    note: "S02-4 — anchor completed · Work Order mint skipped",
  };

  return {
    schema_version: "one-key-core-work-order-return-judgment-v1",
    shadow_only: true,
    work_order_id: null,
    persisted: false,
    directives: buildWorkOrderDirectives(dispatchPlan),
    dispatch_plan: dispatchPlan,
    planner_tools: plan?.tools ?? [],
    coverage_gap_suppressed: plan?.coverage_gap_suppressed === true,
  };
}

function buildReturnJudgmentEvidenceBundle({ factBundle = {}, analysisJob = {} } = {}) {
  const result = analysisJob.result_json ?? {};
  return {
    schema_version: "one-key-core-evidence-return-judgment-v1",
    anchor_job_id: analysisJob.id ?? null,
    stored_panels: {
      coverage_gap: Boolean(result.coverage_gap),
      underwriting_risk: Boolean(result.underwriting_risk),
      recommendation: Boolean(result.recommendation),
      insurance_design: Boolean(result.insurance_design),
    },
    coverage_gap: {
      loaded: factBundle.coverage_gap_used === true,
      top_concerns: factBundle.coverage_gap_top_concerns ?? [],
    },
    underwriting: {
      loaded: factBundle.underwriting_used === true,
      risk_score: factBundle.underwriting_risk_score ?? null,
    },
    design: {
      loaded: factBundle.design_used === true,
      next_actions: factBundle.design_next_actions ?? [],
    },
    rebalancing: {
      loaded: factBundle.rebalancing_used === true,
      maintenance_return_eligible: factBundle.maintenance_return_eligible === true,
    },
    tools_called: factBundle.key_tools_called ?? [],
    factory_explain_invoked: false,
    factory_raw_evidence_loaded: true,
  };
}

function buildReturnJudgmentIntakeTraceFromCore({
  sessionId = null,
  gapHours = null,
  anchorJobId = null,
  gate = {},
  keyFirstJudgment = null,
  returnJudgmentSentence = null,
  personaMeta = null,
  oneKeyCoreTrace = null,
} = {}) {
  let intakeTrace = buildKeyReturnJudgmentIntakeShadowTrace({
    sessionId,
    gapHours,
    anchorJobId,
    keyRuntimeEntered: true,
    keyEntry: KEY_ENTRY.RETURN_JUDGMENT,
    gate,
    keyFirstJudgment,
  });

  return {
    ...intakeTrace,
    response_source: ONE_KEY_CORE_RESPONSE_SOURCE.RETURN_JUDGMENT,
    one_key_core_event: "return_judgment",
    one_key_core: true,
    one_key_core_trace: oneKeyCoreTrace,
    return_judgment_sentence: returnJudgmentSentence,
    persona_outlet: personaMeta?.persona_outlet ?? null,
    generation_mode: personaMeta?.generation_mode ?? null,
    conn_002_panel_wired: personaMeta?.conn_002_panel_wired === true,
    conn_003_panel_wired: personaMeta?.conn_003_panel_wired === true,
    conn_004_weave_wired: personaMeta?.conn_004_weave_wired === true,
    conn_005_continuity_weave_wired: personaMeta?.conn_005_continuity_weave_wired === true,
  };
}

/**
 * ONE KEY Core return_judgment turn — S02-4.
 */
export async function runOneKeyCoreReturnJudgmentTurn({
  userSupabase,
  customerId,
  sessionId = null,
  anchorJob = null,
  gapHours = null,
  gate = { emit: true, reasons: [] },
  transitionObservedAt = null,
  env = process.env,
  fetchImpl = fetch,
  startedAt = Date.now(),
} = {}) {
  const coreEnv = resolveOneKeyCoreReturnJudgmentEnv(env);
  const trace = {
    schema_version: "one-key-core-trace-return-judgment-v1",
    event: "return_judgment",
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
      requestHistory: [],
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

  const interpretRecord = buildReturnJudgmentInterpretShadow({
    sessionId,
    gapHours,
    anchorJob,
    gate,
  });
  recordStep("interpret", interpretRecord);

  const keyJudgment = buildReturnJudgment({
    analysisJob: anchorJob,
    loadedContext,
    contextSnapshot,
  });

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
    keyEntry: KEY_ENTRY.RETURN_JUDGMENT,
    analysisJob: anchorJob,
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

  const thinkingBundle = buildReturnJudgmentThinkingBundle({
    anchorJob,
    keyJudgment,
    plan,
  });
  recordStep("thinking", thinkingBundle);

  recordStep("planner", {
    primitive: "runSalesDirectorKeyTurn",
    key_entry: KEY_ENTRY.RETURN_JUDGMENT,
    tools_called: salesDirectorTrace?.key_orchestrator?.tools_called ?? [],
    conn_002_coverage_gap_panel_wired: plan?.conn_002_coverage_gap_panel_wired === true,
    conn_003_underwriting_panel_wired: plan?.conn_003_underwriting_panel_wired === true,
    conn_004_design_panel_wired: plan?.conn_004_design_panel_wired === true,
    conn_005_rebalancing_panel_wired: plan?.conn_005_rebalancing_panel_wired === true,
  });

  recordStep("work_order", buildReturnJudgmentWorkOrderShadow({ plan }));

  const factBundle = {
    ...(agentTurn.factBundle ?? {}),
    one_key_core: true,
    one_key_core_return_judgment: true,
    return_judgment: true,
    classification_intent: "return_judgment",
    analysis_job_id: anchorJob?.id ?? null,
  };
  recordStep("evidence", buildReturnJudgmentEvidenceBundle({ factBundle, analysisJob: anchorJob }));

  const speakResult = await keySpeakAsync({
    event: "return_judgment",
    keyFirstJudgment: keyJudgment,
    contextSnapshot,
    loadedContext,
  });
  recordStep("speak", {
    compose_mode: speakResult.key_compose_trace?.compose_mode ?? "key_master_return_judgment",
    key_speak_master: true,
    text_preview: String(speakResult.speakDraft ?? "").slice(0, 300),
    ghost_path_reached: speakResult.key_compose_trace?.ghost_path_reached ?? [],
  });

  trace.customer_text_path.push(...KEY_SPEAK_MASTER_PATH);

  const outletResult = finalizeKeyCustomerText(speakResult.speakDraft, {
    failureMode:
      speakResult.failureMode === true || !String(speakResult.speakDraft ?? "").trim(),
  });
  const keyFirstJudgment = keyJudgment;
  const returnJudgmentSentence = outletResult.keySpeakOriginal;
  const personaMeta = {
    generation_mode: outletResult.generation_mode,
    persona_rewrite_blocked: true,
    key_speak_master: true,
  };

  recordStep("persona", {
    generation_mode: personaMeta.generation_mode,
    text_preview: String(returnJudgmentSentence ?? "").slice(0, 300),
    persona_rewrite_blocked: true,
    key_speak_master: true,
  });

  const stepNames = trace.steps.map((row) => row.step);
  const traceComplete = ONE_KEY_CORE_RETURN_JUDGMENT_STEPS.every((name) => stepNames.includes(name));

  const intakeTrace = buildReturnJudgmentIntakeTraceFromCore({
    sessionId,
    gapHours,
    anchorJobId: anchorJob?.id ?? null,
    gate,
    keyFirstJudgment,
    returnJudgmentSentence,
    personaMeta,
    oneKeyCoreTrace: { ...trace, complete: traceComplete },
  });

  if (!returnJudgmentSentence) {
    return {
      ok: false,
      reason: "forbidden_speech_guard",
      keyFirstJudgment,
      intakeTrace,
      oneKeyCoreTrace: trace,
      traceComplete,
    };
  }

  return {
    ok: true,
    event: "return_judgment",
    response_source: ONE_KEY_CORE_RESPONSE_SOURCE.RETURN_JUDGMENT,
    returnJudgmentSentence,
    personaMeta,
    keyFirstJudgment,
    intakeTrace,
    workOrderId: null,
    agentTurn: {
      ...agentTurn,
      text: returnJudgmentSentence,
      responseSource: ONE_KEY_CORE_RESPONSE_SOURCE.RETURN_JUDGMENT,
      factBundle,
    },
    oneKeyCoreTrace: trace,
    traceComplete,
    salesDirectorTrace,
    transitionObservedAt,
  };
}
