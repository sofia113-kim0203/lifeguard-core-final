/**
 * ONE KEY Core S02-5 — bridge event (continuity template · no CONN weave).
 */
import {
  buildKeyBridgeDraft,
  finalizeBridgeSentence,
  scanBridgeSentence,
} from "../keyBrain/bridgeFirstSpeak.js";
import { buildKeyBridgeIntakeShadowTrace } from "../keyBrain/bridgeIntakeShadow.js";
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
  resolveOneKeyCoreBridgeEnv,
} from "./oneKeyCoreFlags.js";

export const ONE_KEY_CORE_BRIDGE_STEPS = [
  "interpret",
  "thinking",
  "judgment",
  "planner",
  "work_order",
  "evidence",
  "speak",
  "persona",
];

function buildBridgeInterpretShadow({
  sessionId = null,
  gapHours = null,
  anchorJob = null,
  gate = {},
} = {}) {
  return {
    schema_version: "one-key-core-interpret-bridge-v1",
    session_id: sessionId,
    gap_hours: gapHours,
    anchor_job_id: anchorJob?.id ?? null,
    anchor_job_status: anchorJob?.status ?? null,
    gate_emit: gate.emit === true,
    gate_reasons: gate.reasons ?? [],
    key_entry: KEY_ENTRY.BRIDGE,
  };
}

function buildBridgeThinkingBundle({ anchorJob = {}, plan = null, gapHours = null } = {}) {
  return {
    schema_version: "one-key-core-thinking-bridge-v1",
    anchor_job_id: anchorJob.id ?? null,
    gap_hours: gapHours,
    inputGates: {
      anchor_completed: anchorJob.status === "completed",
      coverage_gap_suppressed: plan?.coverage_gap_suppressed === true,
    },
    speak_mode: "template_only",
    conn_weave: false,
  };
}

function buildBridgeJudgment({ anchorJob = null, gapHours = null } = {}) {
  return {
    schema_version: "one-key-core-judgment-bridge-v1",
    posture: "continuity_bridge",
    anchor_job_id: anchorJob?.id ?? null,
    gap_hours: gapHours,
    speak_chain: "finalizeBridgeSentence (template only · no CONN weave)",
  };
}

function buildBridgeWorkOrderShadow({ plan = null } = {}) {
  const dispatchPlan = {
    actor: "KEY",
    executed: false,
    shadow_only: true,
    hold_reason: "bridge_template_only_no_factory_dispatch",
    factory_work_orders: [],
    note: "S02-5 — continuity bridge · Work Order mint skipped",
  };

  return {
    schema_version: "one-key-core-work-order-bridge-v1",
    shadow_only: true,
    work_order_id: null,
    persisted: false,
    directives: buildWorkOrderDirectives(dispatchPlan),
    dispatch_plan: dispatchPlan,
    planner_tools: plan?.tools ?? [],
    coverage_gap_suppressed: plan?.coverage_gap_suppressed === true,
  };
}

function buildBridgeEvidenceBundle({ factBundle = {}, analysisJob = {} } = {}) {
  return {
    schema_version: "one-key-core-evidence-bridge-v1",
    anchor_job_id: analysisJob.id ?? null,
    memory: {
      fact_count: factBundle.memory_fact_count ?? 0,
      loaded: factBundle.memory_tool_used === true,
    },
    snapshot: {
      loaded: factBundle.snapshot_tool_used === true,
    },
    tools_called: factBundle.key_tools_called ?? [],
    factory_explain_invoked: false,
    factory_raw_evidence_loaded: false,
    conn_weave: false,
  };
}

function buildBridgeIntakeTraceFromCore({
  sessionId = null,
  gapHours = null,
  anchorJobId = null,
  gate = {},
  bridgeSentence = null,
  personaMeta = null,
  oneKeyCoreTrace = null,
} = {}) {
  const intakeTrace = buildKeyBridgeIntakeShadowTrace({
    sessionId,
    gapHours,
    anchorJobId,
    keyRuntimeEntered: true,
    keyEntry: KEY_ENTRY.BRIDGE,
    gate,
  });

  return {
    ...intakeTrace,
    response_source: ONE_KEY_CORE_RESPONSE_SOURCE.BRIDGE,
    one_key_core_event: "bridge",
    one_key_core: true,
    one_key_core_trace: oneKeyCoreTrace,
    bridge_sentence: bridgeSentence,
    persona_outlet: personaMeta?.persona_outlet ?? null,
    generation_mode: personaMeta?.generation_mode ?? null,
  };
}

/**
 * ONE KEY Core bridge turn — S02-5.
 */
export async function runOneKeyCoreBridgeTurn({
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
  const coreEnv = resolveOneKeyCoreBridgeEnv(env);
  const trace = {
    schema_version: "one-key-core-trace-bridge-v1",
    event: "bridge",
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

  recordStep(
    "interpret",
    buildBridgeInterpretShadow({ sessionId, gapHours, anchorJob, gate }),
  );

  const keyJudgment = buildBridgeJudgment({ anchorJob, gapHours });
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
    keyEntry: KEY_ENTRY.BRIDGE,
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

  recordStep(
    "thinking",
    buildBridgeThinkingBundle({ anchorJob, plan, gapHours }),
  );

  recordStep("planner", {
    primitive: "runSalesDirectorKeyTurn",
    key_entry: KEY_ENTRY.BRIDGE,
    tools_called: salesDirectorTrace?.key_orchestrator?.tools_called ?? [],
    key_bridge: plan?.key_bridge === true,
    coverage_gap_suppressed: plan?.coverage_gap_suppressed === true,
  });

  recordStep("work_order", buildBridgeWorkOrderShadow({ plan }));

  const factBundle = {
    ...(agentTurn.factBundle ?? {}),
    one_key_core: true,
    one_key_core_bridge: true,
    key_bridge: true,
    classification_intent: "key_bridge",
    analysis_job_id: anchorJob?.id ?? null,
  };
  recordStep("evidence", buildBridgeEvidenceBundle({ factBundle, analysisJob: anchorJob }));

  const staticDraft = buildKeyBridgeDraft();
  const finalized = finalizeBridgeSentence(staticDraft, {
    keyTurnResult: keyTurn.result,
    gapHours,
    anchorJobId: anchorJob?.id ?? null,
  });

  const scan = scanBridgeSentence(finalized?.text ?? "");
  const bridgeSentence = finalized?.text && scan.ok ? finalized.text : null;
  const personaMeta = bridgeSentence ? finalized : null;

  recordStep("speak", {
    compose_mode: "finalizeBridgeSentence",
    text_preview: String(bridgeSentence ?? "").slice(0, 300),
    speech_guard_ok: scan.ok,
    conn_weave: false,
  });

  trace.customer_text_path.push("buildKeyBridgeDraft", "finalizeBridgeSentence", "polishLifeguardCustomerText");

  recordStep("persona", {
    generation_mode: personaMeta?.generation_mode ?? null,
    text_preview: String(bridgeSentence ?? "").slice(0, 300),
    persona_outlet: personaMeta?.persona_outlet ?? null,
  });

  const stepNames = trace.steps.map((row) => row.step);
  const traceComplete = ONE_KEY_CORE_BRIDGE_STEPS.every((name) => stepNames.includes(name));

  const intakeTrace = buildBridgeIntakeTraceFromCore({
    sessionId,
    gapHours,
    anchorJobId: anchorJob?.id ?? null,
    gate,
    bridgeSentence,
    personaMeta,
    oneKeyCoreTrace: { ...trace, complete: traceComplete },
  });

  if (!bridgeSentence) {
    return {
      ok: false,
      reason: "forbidden_speech_guard",
      intakeTrace,
      oneKeyCoreTrace: trace,
      traceComplete,
    };
  }

  return {
    ok: true,
    event: "bridge",
    response_source: ONE_KEY_CORE_RESPONSE_SOURCE.BRIDGE,
    bridgeSentence,
    personaMeta,
    intakeTrace,
    workOrderId: null,
    agentTurn: {
      ...agentTurn,
      text: bridgeSentence,
      responseSource: ONE_KEY_CORE_RESPONSE_SOURCE.BRIDGE,
      factBundle,
    },
    oneKeyCoreTrace: trace,
    traceComplete,
    salesDirectorTrace,
    transitionObservedAt,
  };
}
