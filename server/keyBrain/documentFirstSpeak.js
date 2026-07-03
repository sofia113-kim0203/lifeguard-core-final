/**
 * KU-2c — KEY first customer sentence (from key_first_judgment · no coverage/gap/rec).
 * DU-1 — Document + Policies + Memory + Conversation fusion when snapshot present.
 * Hand P3 — Persona outlet via finalizeSalesDirectorResponse (draft preserve).
 */
import { polishLifeguardCustomerText } from "../lifeguardOutputGuard.js";
import { finalizeSalesDirectorResponse } from "../salesDirectorFormatter.js";
import { ONE_BRAIN_SURFACES } from "../oneBrainResponseLayer.js";
import {
  buildDu1CustomerFirstSentence,
  buildDu1InputBundle,
  composeDu1WithEpistemicTrace,
  DU1_SCHEMA_VERSION,
} from "./du1DocumentUploadFirstSpeak.js";

export const KEY_FIRST_SPEAK_SCHEMA_VERSION = "key-first-speak-ku2c-v1";
export const DOCUMENT_INTAKE_PERSONA_OUTLET = "finalizeSalesDirectorResponse";

function resolveJudgmentPosture(keyFirstJudgment = {}) {
  return keyFirstJudgment.posture ?? keyFirstJudgment.orient_speech_planned?.posture ?? null;
}

function buildLegacyCustomerFirstSentence(keyFirstJudgment, { document = {} } = {}) {
  const hold = keyFirstJudgment.hold ?? {};
  const posture = resolveJudgmentPosture(keyFirstJudgment);
  if (posture === "provisional_metadata") {
    return null;
  }
  const kind = String(keyFirstJudgment.document_kind_guess ?? "");
  const filename = String(document.original_filename ?? "").trim();

  if (hold.needed && !kind.match(/insurance|policy|certificate/i)) {
    return "문서는 안전하게 받아 두었습니다. 내용 확인은 동의 후 KEY가 진행하겠습니다.";
  }

  if (hold.needed) {
    return "문서는 안전하게 받아 두었습니다. 내용 분석은 동의 후 KEY가 진행하겠습니다.";
  }

  if (/insurance|policy|certificate/i.test(kind)) {
    if (filename) {
      return "보내주신 보험 관련 문서 잘 받았습니다. KEY가 먼저 확인하고, 확인되는 범위에서 말씀드리겠습니다.";
    }
    return "보내주신 보험 관련 문서 잘 받았습니다. KEY가 먼저 확인한 뒤 말씀드리겠습니다.";
  }

  if (filename) {
    return "보내주신 문서 잘 받았습니다. KEY가 먼저 확인하고, 확인되는 범위에서 말씀드리겠습니다.";
  }

  return "문서 잘 받았습니다. KEY가 먼저 확인한 뒤 말씀드리겠습니다.";
}

/**
 * @param {object|null} keyFirstJudgment — from buildKeyFirstJudgment
 * @param {object} [options]
 * @param {object} [options.document]
 * @param {object|null} [options.contextSnapshot]
 * @param {object|null} [options.loadedContext]
 */
export function buildCustomerFirstSentence(
  keyFirstJudgment,
  { document = {}, contextSnapshot = null, loadedContext = null } = {},
) {
  if (!keyFirstJudgment || typeof keyFirstJudgment !== "object") {
    return null;
  }

  if (contextSnapshot && loadedContext) {
    const du1 = buildDu1CustomerFirstSentence(keyFirstJudgment, {
      document,
      contextSnapshot,
      loadedContext,
    });
    if (du1) return du1;

    if (resolveJudgmentPosture(keyFirstJudgment) === "provisional_metadata") {
      const bundle = buildDu1InputBundle({
        document,
        contextSnapshot,
        loadedContext,
        keyFirstJudgment,
      });
      const { text } = composeDu1WithEpistemicTrace(bundle);
      if (text) return text;
    }
  }

  return buildLegacyCustomerFirstSentence(keyFirstJudgment, { document });
}

export { buildDu1InputBundle, DU1_SCHEMA_VERSION };

/**
 * Hand P3 — route upload first sentence through Chat-equivalent Persona outlet.
 * @param {string} draftText — from buildCustomerFirstSentence (semantic draft only)
 * @param {object} [keyTurnResult] — runSalesDirectorKeyTurn result
 * @param {object} [document]
 */
export function finalizeDocumentIntakeFirstSentence(draftText, { keyTurnResult = null, document = {} } = {}) {
  const trimmedDraft = String(draftText ?? "").trim();
  if (!trimmedDraft) return null;

  const agentTurn = keyTurnResult?.agentTurn ?? null;
  const factBundle = {
    ...(agentTurn?.factBundle ?? {}),
    document_intake: true,
    key_orchestrator: true,
    document_id: document.id ?? agentTurn?.factBundle?.document_id ?? null,
    classification_intent: "document_intake",
  };

  const finalized = finalizeSalesDirectorResponse({
    rawText: trimmedDraft,
    intent: "document_intake",
    classificationIntent: "document_intake",
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
    persona_outlet: DOCUMENT_INTAKE_PERSONA_OUTLET,
    generation_mode: finalized.generation_mode ?? "document_intake_persona_outlet",
    key_compose_trace: finalized.key_compose_trace ?? null,
  };
}

/**
 * @param {object} intakeTrace
 * @param {string|null} customerFirstSentence
 * @param {object} [personaMeta]
 */
export function appendKeyFirstSpeakTrace(intakeTrace, customerFirstSentence, personaMeta = null) {
  if (!intakeTrace || !customerFirstSentence) return intakeTrace;

  const speakStep = {
    step: "key_first_speak",
    actor: "KEY",
    gate: "KU-2c",
    payload: {
      schema_version: KEY_FIRST_SPEAK_SCHEMA_VERSION,
      customer_first_sentence: customerFirstSentence,
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
    trace_steps: steps,
    customer_first_sentence: customerFirstSentence,
    customer_speak_changed: true,
    persona_outlet: personaMeta?.persona_outlet ?? intakeTrace.persona_outlet ?? null,
  };
}

/**
 * Tom KU-2c — speak after judgment, before work order / legacy.
 */
export function validateKu2cSpeakOrder(traceSteps = []) {
  const steps = traceSteps.map((row) => String(row?.step ?? ""));
  const judgmentIdx = steps.indexOf("key_first_judgment");
  const speakIdx = steps.indexOf("key_first_speak");
  const workOrderIdx = steps.indexOf("work_order_issued");
  const legacyIdx = steps.indexOf("legacy_pipeline_continued");

  if (speakIdx === -1) {
    return { ok: false, reason: "missing_key_first_speak" };
  }
  if (judgmentIdx === -1 || speakIdx <= judgmentIdx) {
    return { ok: false, reason: "speak_not_after_judgment" };
  }
  if (workOrderIdx !== -1 && speakIdx >= workOrderIdx) {
    return { ok: false, reason: "speak_not_before_work_order" };
  }
  if (legacyIdx !== -1 && speakIdx >= legacyIdx) {
    return { ok: false, reason: "speak_not_before_legacy" };
  }
  return { ok: true, reason: "speak_after_judgment_before_factory" };
}
