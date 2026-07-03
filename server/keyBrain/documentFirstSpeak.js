/**
 * KU-2c — KEY first customer sentence (from key_first_judgment · no coverage/gap/rec).
 */
export const KEY_FIRST_SPEAK_SCHEMA_VERSION = "key-first-speak-ku2c-v1";

/**
 * @param {object|null} keyFirstJudgment — from buildKeyFirstJudgment
 * @param {object} [document]
 */
export function buildCustomerFirstSentence(keyFirstJudgment, { document = {} } = {}) {
  if (!keyFirstJudgment || typeof keyFirstJudgment !== "object") {
    return null;
  }

  const hold = keyFirstJudgment.hold ?? {};
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
 * @param {object} intakeTrace
 * @param {string|null} customerFirstSentence
 */
export function appendKeyFirstSpeakTrace(intakeTrace, customerFirstSentence) {
  if (!intakeTrace || !customerFirstSentence) return intakeTrace;

  const speakStep = {
    step: "key_first_speak",
    actor: "KEY",
    gate: "KU-2c",
    payload: {
      schema_version: KEY_FIRST_SPEAK_SCHEMA_VERSION,
      customer_first_sentence: customerFirstSentence,
      subject: "KEY",
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
