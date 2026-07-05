/**
 * P4 — KEY analysis complete initiative sentence (Persona outlet · mirror documentFirstSpeak).
 * CONN-001 — stored recommendation top2 → 1-line initiative when panel present; static fallback otherwise.
 */
import { polishLifeguardCustomerText } from "../lifeguardOutputGuard.js";
import { finalizeSalesDirectorResponse } from "../salesDirectorFormatter.js";
import { ONE_BRAIN_SURFACES } from "../oneBrainResponseLayer.js";
import {
  KEY_ANALYSIS_INITIATIVE_PASS_VOICE,
  hasKeyInitiativeSignals,
  hasSystemAnalysisNotificationSpeech,
} from "../keyAnalysisInitiativeSpeak.js";
import { extractRecommendationTop2Items } from "../salesDirectorRecommendationContext.js";

export const ANALYSIS_COMPLETE_PERSONA_OUTLET = "finalizeSalesDirectorResponse";
export const KEY_ANALYSIS_COMPLETE_SPEAK_SCHEMA_VERSION = "key-analysis-complete-speak-p4-v1";
export const CONN_001_SPEAK_SCHEMA_VERSION = "conn-001-analysis-panel-p4-v1";

export const ANALYSIS_COMPLETE_PANEL_FORBIDDEN_PATTERNS = [
  /memory/i,
  /memory_fact/i,
  /저장(?:해|된)\s*분석/i,
  /저장된\s*우선순위/i,
  /기억(?:하고|나요|해\s*드)/i,
  /보험\s*\d+\s*건/i,
  /분석\s*결과\s*요약/i,
  /파일명/i,
  /시스템\s*알림/i,
  /업로드\s*(?:가\s*)?완료/i,
  /분석\s*중/i,
  /가입\s*하세요/i,
  /반드시\s*추가/i,
  /특정\s*상품/i,
];

export function jobHasStoredRecommendation(analysisJob = {}) {
  const result = analysisJob?.result_json ?? analysisJob?.resultJson ?? null;
  const payload = result?.recommendation ?? null;
  return extractRecommendationTop2Items(payload).length > 0;
}

export function buildAnalysisCompleteInitiativeDraft() {
  return String(KEY_ANALYSIS_INITIATIVE_PASS_VOICE ?? "").trim();
}

export function scanAnalysisCompletePanelSentence(text = "") {
  const trimmed = String(text ?? "").trim();
  if (!trimmed) return { ok: false, reason: "empty" };
  if (trimmed.length > 140) return { ok: false, reason: "too_long" };
  for (const pattern of ANALYSIS_COMPLETE_PANEL_FORBIDDEN_PATTERNS) {
    if (pattern.test(trimmed)) {
      return { ok: false, reason: `forbidden:${pattern.source}` };
    }
  }
  if (hasSystemAnalysisNotificationSpeech(trimmed)) {
    return { ok: false, reason: "system_notification" };
  }
  if (!hasKeyInitiativeSignals(trimmed) && !/같이/.test(trimmed)) {
    return { ok: false, reason: "missing_initiative" };
  }
  return { ok: true, reason: null };
}

export function buildAnalysisCompleteRecommendationDraft(factBundle = {}) {
  const labels = (factBundle.recommendation_priority_labels ?? []).filter(Boolean);
  const first = String(labels[0] ?? "").trim();
  if (!first) return null;
  return `${first} 쪽부터 같이 짚어보면 좋겠습니다.`;
}

export function finalizeAnalysisCompleteInitiativeSentence(draftText, { keyTurnResult = null, analysisJob = {} } = {}) {
  const trimmedDraft = String(draftText ?? buildAnalysisCompleteInitiativeDraft()).trim();
  if (!trimmedDraft) return null;

  const agentTurn = keyTurnResult?.agentTurn ?? null;
  const factBundle = {
    ...(agentTurn?.factBundle ?? {}),
    analysis_complete: true,
    key_orchestrator: true,
    analysis_job_id: analysisJob.id ?? agentTurn?.factBundle?.analysis_job_id ?? null,
    classification_intent: "analysis_complete",
  };

  const finalized = finalizeSalesDirectorResponse({
    rawText: trimmedDraft,
    intent: "analysis_complete",
    classificationIntent: "analysis_complete",
    surface: ONE_BRAIN_SURFACES.HOME,
    factBundle,
    customerState: {
      keyOrchestrator: true,
      question: "",
    },
    conversationContext: {},
  });

  const text = polishLifeguardCustomerText(finalized.text ?? trimmedDraft);

  return {
    text,
    static_draft: trimmedDraft,
    persona_outlet: ANALYSIS_COMPLETE_PERSONA_OUTLET,
    generation_mode: finalized.generation_mode ?? "analysis_complete_persona_outlet",
    key_compose_trace: finalized.key_compose_trace ?? null,
    conn_001_panel_wired: false,
  };
}

function finalizeAnalysisCompleteInitiativeFromPanels({
  keyTurnResult = null,
  analysisJob = null,
  loadedContext = null,
  factBundle = {},
} = {}) {
  const candidate = buildAnalysisCompleteRecommendationDraft(factBundle);
  const scan = candidate ? scanAnalysisCompletePanelSentence(candidate) : { ok: false, reason: "empty_draft" };

  if (!scan.ok || !candidate) {
    return finalizeAnalysisCompleteInitiativeSentence(buildAnalysisCompleteInitiativeDraft(), {
      keyTurnResult,
      analysisJob,
    });
  }

  const polished = polishLifeguardCustomerText(candidate);
  const finalScan = scanAnalysisCompletePanelSentence(polished);
  if (!finalScan.ok) {
    return finalizeAnalysisCompleteInitiativeSentence(buildAnalysisCompleteInitiativeDraft(), {
      keyTurnResult,
      analysisJob,
    });
  }

  return {
    text: polished,
    static_draft: buildAnalysisCompleteInitiativeDraft(),
    persona_outlet: "conn_001_stored_recommendation_top2",
    generation_mode: "analysis_complete_conn_001_panel",
    key_compose_trace: null,
    conn_001_panel_wired: true,
    recommendation_labels: factBundle.recommendation_priority_labels ?? [],
    loaded_context: loadedContext
      ? {
          memory: loadedContext.memory ?? "empty",
          policies: loadedContext.policies ?? "empty",
        }
      : null,
  };
}

export function resolveAnalysisCompleteInitiativeSentence({
  keyTurnResult = null,
  analysisJob = null,
  loadedContext = null,
} = {}) {
  const agentTurn = keyTurnResult?.agentTurn ?? null;
  const factBundle = {
    ...(agentTurn?.factBundle ?? {}),
    analysis_complete: true,
    classification_intent: "analysis_complete",
  };

  const hasStored = jobHasStoredRecommendation(analysisJob);
  const recommendationUsed =
    factBundle.recommendation_used === true || factBundle.has_stored_recommendation_analysis === true;

  if (!hasStored || !recommendationUsed) {
    return finalizeAnalysisCompleteInitiativeSentence(buildAnalysisCompleteInitiativeDraft(), {
      keyTurnResult,
      analysisJob,
    });
  }

  return finalizeAnalysisCompleteInitiativeFromPanels({
    keyTurnResult,
    analysisJob,
    loadedContext,
    factBundle,
  });
}
