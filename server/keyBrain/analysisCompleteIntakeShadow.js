/**
 * P4 — KEY analysis complete intake trace (mirror documentIntakeShadow · slim).
 */
import { KEY_BRAIN_SHADOW_SCHEMA_VERSION } from "./shadowPlan.js";
import { buildKeyContextLoadedStep, buildKeyRuntimeEnteredStep } from "./documentIntakeShadow.js";

export const KEY_ANALYSIS_COMPLETE_INTAKE_SCHEMA_VERSION = "key-analysis-complete-intake-p4-v1";

export function analysisJobHasPanelResults(analysisJob = {}) {
  const result = analysisJob?.result_json ?? analysisJob?.resultJson ?? null;
  if (!result || typeof result !== "object") return false;
  return Boolean(
    result.coverage_gap ||
      result.underwriting_risk ||
      result.recommendation ||
      result.insurance_design,
  );
}

export function buildAnalysisCompleteInterpretShadow({
  analysisJob = {},
  transitionObservedAt = null,
  loadedContext = null,
  contextSnapshot = null,
} = {}) {
  const hasPanels = analysisJobHasPanelResults(analysisJob);
  return {
    actor: "KEY",
    schema_version: "one-key-core-interpret-analysis-complete-v1",
    analysis_job_id: analysisJob.id ?? null,
    analysis_job_status: analysisJob.status ?? null,
    completed_at: analysisJob.completed_at ?? null,
    transition_observed_at: transitionObservedAt,
    panel_results_present: hasPanels,
    judgment_scope: {
      knowable: hasPanels ? ["analysis_completed", "panel_results_available"] : ["analysis_completed"],
      unknowable: hasPanels ? [] : ["panel_highlights_before_results"],
    },
    context_snapshot_id: contextSnapshot?.context_snapshot_id ?? null,
    customer_context_status: loadedContext
      ? {
          memory: loadedContext.memory ?? "empty",
          policies: loadedContext.policies ?? "empty",
          documents: loadedContext.documents ?? "empty",
        }
      : null,
  };
}

export function buildAnalysisCompleteJudgment({ analysisJob = {}, loadedContext = null, contextSnapshot = null } = {}) {
  const hasPanels = analysisJobHasPanelResults(analysisJob);
  return {
    schema_version: "key-analysis-complete-judgment-p4-v1",
    actor: "KEY",
    gate: "P4-ENTRY",
    analysis_job_id: analysisJob.id ?? null,
    analysis_job_status: analysisJob.status ?? null,
    panel_results_present: hasPanels,
    posture: hasPanels ? "initiative_ready" : "completed_hold",
    judgment_scope: {
      knowable: hasPanels ? ["analysis_completed", "panel_results_available"] : ["analysis_completed"],
      unknowable: hasPanels ? [] : ["panel_highlights_before_results"],
      must_not_claim: ["system_notification_tone", "analysis_procedure_finished_only"],
    },
    context_snapshot_id: contextSnapshot?.context_snapshot_id ?? null,
    customer_context_status: loadedContext
      ? {
          memory: loadedContext.memory ?? "empty",
          policies: loadedContext.policies ?? "empty",
          documents: loadedContext.documents ?? "empty",
        }
      : null,
    recorded_at: new Date().toISOString(),
  };
}

export function buildKeyAnalysisCompleteIntakeShadowTrace({
  analysisJob = {},
  loadedContext = null,
  contextSnapshot = null,
  snapshotFromCache = false,
  keyRuntimeEntered = false,
  keyEntry = "analysis_complete",
  transitionObservedAt = null,
} = {}) {
  const keyContextLoaded = buildKeyContextLoadedStep({
    contextSnapshot,
    loadedContext,
    fromCache: snapshotFromCache,
  });

  const traceSteps = [
    {
      step: "analysis_completed_observed",
      at: "session_transition_emitter",
      analysis_job_id: analysisJob.id ?? null,
      transition_observed_at: transitionObservedAt,
      subject: "KEY",
    },
    {
      step: "key_intake_called",
      at: "api/key-analysis-complete-intake",
      mode: "active",
      subject: "KEY",
    },
    {
      step: "analysis_job_loaded",
      actor: "KEY",
      payload: {
        job_id: analysisJob.id ?? null,
        status: analysisJob.status ?? null,
        completed_at: analysisJob.completed_at ?? null,
        panel_results_present: analysisJobHasPanelResults(analysisJob),
      },
    },
  ];

  if (keyContextLoaded) {
    traceSteps.push(keyContextLoaded);
  }

  if (keyRuntimeEntered) {
    traceSteps.push(buildKeyRuntimeEnteredStep({ keyEntry }));
  }

  const keyFirstJudgment = buildAnalysisCompleteJudgment({
    analysisJob,
    loadedContext,
    contextSnapshot,
  });

  traceSteps.push({
    step: "key_first_judgment",
    actor: "KEY",
    gate: "P4-ENTRY",
    payload: keyFirstJudgment,
  });

  return {
    schema_version: KEY_ANALYSIS_COMPLETE_INTAKE_SCHEMA_VERSION,
    brain_schema_version: KEY_BRAIN_SHADOW_SCHEMA_VERSION,
    gate: "KEY_UPLOAD_ACTIVE",
    mode: "active",
    subject: "KEY",
    key_entry: keyEntry,
    analysis_job_id: analysisJob.id ?? null,
    trace_steps: traceSteps,
    key_context_loaded: keyContextLoaded?.payload ?? null,
    key_runtime_entered: keyRuntimeEntered
      ? buildKeyRuntimeEnteredStep({ keyEntry }).payload
      : null,
    key_first_judgment: keyFirstJudgment,
    customer_speak_changed: false,
  };
}

export function appendAnalysisCompleteInitiativeSpeakTrace(intakeTrace, initiativeSentence, personaMeta = null) {
  if (!intakeTrace || !initiativeSentence) return intakeTrace;

  const speakStep = {
    step: "key_initiative_speak",
    actor: "KEY",
    gate: "P4-ENTRY",
    payload: {
      customer_initiative_sentence: initiativeSentence,
      subject: "KEY",
      ...(personaMeta?.persona_outlet
        ? {
            persona_outlet: personaMeta.persona_outlet,
            generation_mode: personaMeta.generation_mode ?? null,
            static_draft: personaMeta.static_draft ?? null,
          }
        : {}),
    },
  };

  const steps = [...(intakeTrace.trace_steps ?? [])];
  const judgmentIdx = steps.findIndex((row) => row.step === "key_first_judgment");
  const insertAt = judgmentIdx >= 0 ? judgmentIdx + 1 : steps.length;
  steps.splice(insertAt, 0, speakStep);

  return {
    ...intakeTrace,
    customer_initiative_sentence: initiativeSentence,
    customer_speak_changed: true,
    persona_outlet: personaMeta?.persona_outlet ?? null,
    trace_steps: steps,
  };
}
