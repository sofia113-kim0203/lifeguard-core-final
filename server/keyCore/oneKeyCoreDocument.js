/**
 * ONE KEY Core S02-1 — document event (upload Prototype → Core 8-step).
 * Claude-Full (Preview active): original PDF attached for Claude to read first — no KEY pre-summary.
 */
import {
  buildKeyContextLoadedStep,
  buildKeyRuntimeEnteredStep,
  buildDocumentDispatchPlanShadow,
  buildDocumentInterpretShadow,
  buildDocumentReadsShadow,
  KEY_DOCUMENT_INTAKE_SCHEMA_VERSION,
} from "../keyBrain/documentIntakeShadow.js";
import { buildKeyFirstJudgment } from "../keyBrain/documentFirstJudgment.js";
import { appendKeyFirstSpeakTrace } from "../keyBrain/documentFirstSpeak.js";
import { keySpeak, KEY_SPEAK_MASTER_PATH } from "../keyBrain/keySpeak.js";
import {
  finalizeKeyCustomerText,
  KEY_MONOPOLY_FAILURE_CUSTOMER_TEXT,
} from "./keyCustomerMonopoly.js";
import {
  buildDu1InputBundle,
  resolveDu1InputGates,
} from "../keyBrain/du1DocumentUploadFirstSpeak.js";
import { KEY_ENTRY, runSalesDirectorKeyTurn } from "../salesDirectorKeyOrchestrator.js";
import {
  buildKeyWorkOrderRecord,
  buildWorkOrderDirectives,
  mintKeyWorkOrderId,
  persistKeyWorkOrder,
  resolveKeyWorkOrderTtlMs,
} from "../keyBrain/workOrder.js";
import { KEY_UPLOAD_ACTIVE_GATE, KEY_UPLOAD_ENTRY_MODES } from "../keyBrain/uploadEntryFlags.js";
import {
  buildLoadedContextFromSnapshot,
  loadSalesDirectorTurnContext,
  snapshotToContextBundle,
} from "../customerContextSnapshot.js";
import {
  ONE_KEY_CORE_RESPONSE_SOURCE,
  ONE_KEY_CORE_S1_BLOCKED_PATHS,
  resolveOneKeyCoreDocumentEnv,
  isKeyBorrowedSensesStage3Active,
  isVercelProductionEnv,
} from "./oneKeyCoreFlags.js";
import { buildReflection } from "./keyReflection.js";
import { buildKeyVoiceComposeResult } from "./keyVoiceCompose.js";
import { verifyAndFetchCustomerPdfOriginal } from "./keyClaudeFullDocumentDirect.js";

export const ONE_KEY_CORE_DOCUMENT_STEPS = [
  "interpret",
  "thinking",
  "judgment",
  "planner",
  "work_order",
  "evidence",
  "speak",
  "persona",
];

function buildDocumentThinkingBundle({
  document = {},
  contextSnapshot = null,
  loadedContext = null,
  keyInterprets = null,
} = {}) {
  const bundle = buildDu1InputBundle({
    document,
    contextSnapshot,
    loadedContext,
    keyFirstJudgment: keyInterprets
      ? {
          judgment_scope: keyInterprets.judgment_scope,
          hold: keyInterprets.hold,
          posture: keyInterprets.orient_speech_planned?.posture ?? "provisional_metadata",
          document_kind_guess: keyInterprets.document_kind_guess,
        }
      : null,
  });

  return {
    schema_version: "one-key-core-thinking-document-v1",
    document_id: document.id ?? null,
    inputGates: resolveDu1InputGates(loadedContext, bundle),
    four_inputs: {
      document: true,
      policies: (bundle.policies ?? []).length,
      memory: (bundle.memoryFacts ?? []).length,
      conversation: bundle.conversation?.has_recent === true,
    },
    snapshot_loaded: bundle.context_snapshot_loaded === true,
  };
}

function buildDocumentEvidenceBundle({
  factBundle = {},
  customerContextBundle = null,
  hasAnalysisConsent = false,
} = {}) {
  return {
    schema_version: "one-key-core-evidence-document-v1",
    consent: { analysis_granted: hasAnalysisConsent === true },
    document: {
      id: factBundle.document_id ?? null,
      ingest_status: factBundle.document_ingest_status ?? null,
    },
    memory: {
      fact_count: factBundle.memory_fact_count ?? customerContextBundle?.memoryFactCount ?? 0,
    },
    policies: {
      active_count: factBundle.active_policy_count ?? factBundle.policy_count ?? null,
    },
    factory_explain_invoked: false,
    factory_raw_evidence_loaded: false,
  };
}

function buildDocumentIntakeTraceFromCore({
  document = {},
  hasAnalysisConsent = false,
  uploadSource = "web",
  categoryKey = null,
  loadedContext = null,
  contextSnapshot = null,
  snapshotFromCache = false,
  keyRuntimeEntered = true,
  keyJudgment = null,
  customerFirstSentence = null,
  personaMeta = null,
  dispatchPlan = null,
  workOrderRecord = null,
  workOrderId = null,
  oneKeyCoreTrace = null,
  uploadEntryMode = KEY_UPLOAD_ENTRY_MODES.SHADOW,
} = {}) {
  const keyReads = buildDocumentReadsShadow({ document });
  const keyInterprets = buildDocumentInterpretShadow({
    document,
    hasAnalysisConsent,
    loadedContext,
    contextSnapshot,
  });
  const keyContextLoaded = buildKeyContextLoadedStep({
    contextSnapshot,
    loadedContext,
    fromCache: snapshotFromCache,
  });

  const traceSteps = [
    {
      step: "document_uploaded",
      at: "uploadDocument_ssot",
      document_id: document.id ?? null,
      upload_source: uploadSource,
      category_key: categoryKey,
    },
    {
      step: "key_intake_called",
      at: "api/key-document-intake",
      mode: uploadEntryMode === KEY_UPLOAD_ENTRY_MODES.ACTIVE ? "active" : "shadow",
      subject: "KEY",
      one_key_core: true,
    },
    { step: "key_reads", actor: "KEY", payload: keyReads },
  ];

  if (keyContextLoaded) traceSteps.push(keyContextLoaded);
  if (keyRuntimeEntered) traceSteps.push(buildKeyRuntimeEnteredStep({ keyEntry: KEY_ENTRY.DOCUMENT_INTAKE }));
  traceSteps.push({ step: "key_interprets", actor: "KEY", payload: keyInterprets });

  if (keyJudgment) {
    traceSteps.push({
      step: "key_first_judgment",
      actor: "KEY",
      gate: "KU-2b",
      payload: keyJudgment,
    });
  }

  traceSteps.push({
    step: "dispatch_plan_created",
    actor: "KEY",
    payload: dispatchPlan,
  });

  if (workOrderId) {
    traceSteps.push({
      step: "work_order_issued",
      actor: "KEY",
      work_order_id: workOrderId,
      ordered_by: "KEY",
      gate: "KU-2a",
    });
  }

  let resolvedTrace = {
    schema_version: KEY_DOCUMENT_INTAKE_SCHEMA_VERSION,
    gate: uploadEntryMode === KEY_UPLOAD_ENTRY_MODES.ACTIVE ? KEY_UPLOAD_ACTIVE_GATE : "ONE_KEY_CORE_DOCUMENT",
    mode: uploadEntryMode === KEY_UPLOAD_ENTRY_MODES.ACTIVE ? "active" : "shadow",
    subject: "KEY",
    document_id: document.id ?? null,
    response_source: ONE_KEY_CORE_RESPONSE_SOURCE.DOCUMENT,
    one_key_core_event: "document",
    one_key_core_trace: oneKeyCoreTrace,
    trace_steps: traceSteps,
    key_reads: keyReads,
    key_context_loaded: keyContextLoaded?.payload ?? null,
    key_runtime_entered: keyRuntimeEntered
      ? buildKeyRuntimeEnteredStep({ keyEntry: KEY_ENTRY.DOCUMENT_INTAKE }).payload
      : null,
    key_interprets: keyInterprets,
    key_first_judgment: keyJudgment,
    context_snapshot_id: contextSnapshot?.context_snapshot_id ?? null,
    dispatch_plan: dispatchPlan,
    legacy_pipeline_continued: null,
    factory_executed: false,
    customer_speak_changed: Boolean(customerFirstSentence),
    customer_first_sentence: customerFirstSentence,
    persona_outlet: personaMeta?.persona_outlet ?? null,
  };

  if (workOrderRecord) {
    resolvedTrace.work_order = workOrderRecord;
  }

  if (customerFirstSentence && contextSnapshot) {
    resolvedTrace.du1_fusion = {
      schema_version: "du-1-document-upload-first-speak-v2",
      four_inputs: {
        document: true,
        policies: (contextSnapshot?.bundle?.policies ?? []).length,
        memory: (contextSnapshot?.bundle?.memoryFacts ?? []).length,
        conversation: contextSnapshot?.flags?.has_recent_conversation === true,
      },
    };
  }

  if (customerFirstSentence) {
    resolvedTrace = appendKeyFirstSpeakTrace(resolvedTrace, customerFirstSentence, personaMeta);
  }

  return resolvedTrace;
}

/**
 * ONE KEY Core document turn — S02-1.
 */
export async function runOneKeyCoreDocumentTurn({
  userSupabase,
  customerId,
  document,
  hasAnalysisConsent = false,
  uploadSource = "web",
  categoryKey = null,
  uploadEntryMode = KEY_UPLOAD_ENTRY_MODES.ACTIVE,
  customerQuestion = "",
  history = [],
  env = process.env,
  fetchImpl = fetch,
  startedAt = Date.now(),
  // Test-only PDF injection (never logged as bytes)
  injectedPdfBytes = null,
} = {}) {
  const coreEnv = resolveOneKeyCoreDocumentEnv(env);
  const trace = {
    schema_version: "one-key-core-trace-document-v1",
    event: "document",
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

  const interpretRecord = buildDocumentInterpretShadow({
    document,
    hasAnalysisConsent,
    loadedContext,
    contextSnapshot,
  });
  recordStep("interpret", interpretRecord);

  const thinkingBundle = buildDocumentThinkingBundle({
    document,
    contextSnapshot,
    loadedContext,
    keyInterprets: interpretRecord,
  });
  recordStep("thinking", thinkingBundle);

  const keyJudgment = buildKeyFirstJudgment({
    document,
    keyInterprets: interpretRecord,
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
    keyEntry: KEY_ENTRY.DOCUMENT_INTAKE,
    document,
    hasAnalysisConsent,
  });

  if (!keyTurn?.handled || !keyTurn.result) {
    return {
      ok: false,
      reason: keyTurn?.reason ?? "key_planner_failed",
      one_key_core_trace: trace,
    };
  }

  const { agentTurn, salesDirectorTrace } = keyTurn.result;
  recordStep("planner", {
    primitive: "runSalesDirectorKeyTurn",
    key_entry: KEY_ENTRY.DOCUMENT_INTAKE,
    tools_called: salesDirectorTrace?.key_orchestrator?.tools_called ?? [],
  });

  const dispatchPlan = buildDocumentDispatchPlanShadow({ document, hasAnalysisConsent });
  let workOrderId = null;
  let workOrderRecord = null;

  if (uploadEntryMode === KEY_UPLOAD_ENTRY_MODES.ACTIVE) {
    workOrderId = mintKeyWorkOrderId();
    workOrderRecord = buildKeyWorkOrderRecord({
      workOrderId,
      customerId,
      documentId: document.id,
      dispatchPlan,
      ttlMs: resolveKeyWorkOrderTtlMs(env),
    });

    try {
      await persistKeyWorkOrder(userSupabase, {
        documentId: document.id,
        customerId,
        workOrderRecord,
        existingMetadata: document.metadata_json ?? {},
      });
    } catch (error) {
      return {
        ok: false,
        reason: "work_order_persist_failed",
        error_message: error?.message ?? "work_order_persist_failed",
        one_key_core_trace: trace,
      };
    }
  }

  recordStep("work_order", {
    schema_version: "one-key-core-work-order-document-v1",
    shadow_only: uploadEntryMode !== KEY_UPLOAD_ENTRY_MODES.ACTIVE,
    work_order_id: workOrderId,
    directives: buildWorkOrderDirectives(dispatchPlan),
    dispatch_plan: dispatchPlan,
    persisted: Boolean(workOrderId),
  });

  const factBundle = {
    ...(agentTurn.factBundle ?? {}),
    one_key_core: true,
    one_key_core_document: true,
    document_id: document.id ?? null,
    document_ingest_status: document.ingest_status ?? null,
  };
  const evidenceBundle = buildDocumentEvidenceBundle({
    factBundle,
    customerContextBundle,
    hasAnalysisConsent,
  });
  recordStep("evidence", evidenceBundle);

  const claudeFullDocumentDirect =
    isKeyBorrowedSensesStage3Active(coreEnv) && !isVercelProductionEnv(coreEnv);

  let speakResult;
  let documentDirectMeta = null;
  let directPdfAttachment = null;

  if (claudeFullDocumentDirect) {
    const pdfFetch = await verifyAndFetchCustomerPdfOriginal({
      supabase: userSupabase,
      customerId,
      documentId: document.id,
      env: coreEnv,
      injectedPdfBytes,
      injectedDocument: injectedPdfBytes != null ? document : null,
    });
    documentDirectMeta = {
      ...(pdfFetch.metrics ?? {}),
      original_filename: pdfFetch.document?.original_filename ?? document.original_filename ?? null,
    };
    if (pdfFetch.ok && pdfFetch.pdfBase64) {
      directPdfAttachment = {
        pdfBase64: pdfFetch.pdfBase64,
        mediaType: pdfFetch.mediaType,
      };
    }
    // Direct-read failure: mark fallback; OCR/RAG auxiliary stays available via documentEvidence
    // callers (embedding path). No new parser. Compose still runs without KEY PDF summary.

    const policies =
      customerContextBundle?.policies ??
      contextSnapshot?.bundle?.policies ??
      [];
    const reality = {
      policy_count: Array.isArray(policies) ? policies.length : 0,
      policies: Array.isArray(policies) ? policies : [],
    };
    // KEY seed for Decision only — Claude gets empty customer_question when PDF-only.
    // Include insurance topic so Decision is not non_insurance (PDF explain ≠ daily pollution).
    const customerQ = String(customerQuestion ?? "").trim();
    const reflectionSeed = customerQ || "올린 보험 관련 문서를 확인해 주세요.";
    const reflection = buildReflection({ customerSaid: reflectionSeed, reality });
    const compose = await buildKeyVoiceComposeResult(
      {
        reflection,
        reality,
        policies: reality.policies,
        decision: null,
      },
      {
        question: customerQ,
        env: coreEnv,
        history,
        fetchImpl,
        startedAt,
        directPdfAttachment,
        documentDirectMeta,
      },
    );

    if (compose?.text) {
      const composeDocDirect =
        compose.key_voice_trace?.document_direct ?? documentDirectMeta;
      if (composeDocDirect) documentDirectMeta = composeDocDirect;
      speakResult = {
        speakDraft: compose.text,
        visual_blocks: compose.visual_blocks ?? [],
        key_speak_master: true,
        failureMode: compose.key_voice_trace?.used_failure_mode === true,
        key_compose_trace: {
          compose_mode: compose.compose_mode,
          key_voice_trace: compose.key_voice_trace,
          failureMode: compose.key_voice_trace?.used_failure_mode === true,
          document_direct: documentDirectMeta,
        },
      };
    } else {
      // Honest monopoly failure only — never invent KEY PDF summary / S3–S5.
      speakResult = {
        speakDraft: KEY_MONOPOLY_FAILURE_CUSTOMER_TEXT,
        visual_blocks: [],
        key_speak_master: true,
        failureMode: true,
        key_compose_trace: {
          compose_mode: "key_claude_full_document_direct",
          failureMode: true,
          document_direct: documentDirectMeta,
        },
      };
      documentDirectMeta = {
        ...(documentDirectMeta ?? {}),
        document_fallback_used: true,
        document_fallback_reason:
          documentDirectMeta?.document_fallback_reason ??
          pdfFetch.reason ??
          "claude_full_compose_empty",
      };
    }
  } else {
    speakResult = keySpeak({
      event: "document",
      document,
      keyFirstJudgment: keyJudgment,
      contextSnapshot,
      loadedContext,
    });
  }

  recordStep("speak", {
    compose_mode:
      speakResult.key_compose_trace?.compose_mode ?? "key_master_document",
    static_draft_preview: String(speakResult.speakDraft ?? "").slice(0, 300),
    du1: !claudeFullDocumentDirect,
    key_speak_master: true,
    document_direct: documentDirectMeta,
  });

  trace.customer_text_path.push(...KEY_SPEAK_MASTER_PATH);

  const outletResult = finalizeKeyCustomerText(speakResult.speakDraft);
  const customerFirstSentence = outletResult.keySpeakOriginal;
  const personaMeta = {
    generation_mode: outletResult.generation_mode,
    persona_rewrite_blocked: outletResult.persona_rewrite_blocked,
    key_speak_master: true,
  };

  recordStep("persona", {
    generation_mode: personaMeta.generation_mode,
    text_preview: String(customerFirstSentence ?? "").slice(0, 300),
    persona_rewrite_blocked: true,
    key_speak_master: true,
  });

  const stepNames = trace.steps.map((row) => row.step);
  const traceComplete = ONE_KEY_CORE_DOCUMENT_STEPS.every((name) => stepNames.includes(name));

  const intakeTrace = buildDocumentIntakeTraceFromCore({
    document,
    hasAnalysisConsent,
    uploadSource,
    categoryKey,
    loadedContext,
    contextSnapshot,
    snapshotFromCache,
    keyJudgment,
    customerFirstSentence,
    personaMeta,
    dispatchPlan,
    workOrderRecord,
    workOrderId,
    oneKeyCoreTrace: { ...trace, complete: traceComplete },
    uploadEntryMode,
  });

  return {
    ok: true,
    event: "document",
    response_source: ONE_KEY_CORE_RESPONSE_SOURCE.DOCUMENT,
    customerFirstSentence,
    personaMeta,
    keyFirstJudgment: keyJudgment,
    intakeTrace,
    workOrderId,
    workOrderRecord,
    agentTurn: {
      ...agentTurn,
      text: customerFirstSentence,
      responseSource: ONE_KEY_CORE_RESPONSE_SOURCE.DOCUMENT,
      factBundle,
    },
    oneKeyCoreTrace: trace,
    traceComplete,
    dispatchPlan,
    salesDirectorTrace,
  };
}
