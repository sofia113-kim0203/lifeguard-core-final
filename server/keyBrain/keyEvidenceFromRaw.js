/**
 * EA-1 — KEY Layer: Raw Output → Evidence (KEY-authored interpretation).
 */
import { randomUUID } from "node:crypto";
import {
  assertFactoryRawOutputHasNoKeyVocabulary,
  buildFactoryRawOutputReportedTraceStep,
  buildPolicyExtractRawOutput,
  TRACE_STEP_FACTORY_RAW_OUTPUT_REPORTED,
} from "./keyRawOutputInbox.js";

export const KEY_EVIDENCE_SCHEMA_VERSION = "key-evidence-v1";
export const TRACE_STEP_KEY_EVIDENCE_REPORTED = "key_evidence_reported";
export const KEY_EVIDENCE_GENERATION_MODE = "key_evidence_from_raw";

/**
 * KEY interprets policy_extract Raw Output into Evidence records.
 * @param {object} rawOutput
 */
export function createEvidenceFromPolicyExtractRaw(rawOutput) {
  if (!rawOutput?.raw_output_id) return [];

  const policies = rawOutput.payload?.policies ?? [];
  const evidence = [];

  for (let index = 0; index < policies.length; index += 1) {
    const policy = policies[index];
    const fields = policy?.fields ?? {};
    const insurer = String(fields.insurer_name ?? "").trim();
    const product = String(fields.product_name ?? "").trim();
    const parts = [];
    if (insurer) parts.push(`보험사명 ${insurer}`);
    if (product) parts.push(`상품명 ${product}`);
    if (policy?.confidence != null) {
      parts.push(`추출 신뢰도 ${policy.confidence}`);
    }
    if (policy?.field_count != null) {
      parts.push(`식별 필드 ${policy.field_count}개`);
    }

    const interpretation =
      parts.length > 0
        ? `KEY가 policy_extract Raw Output을 검토했습니다. ${parts.join(" · ")}.`
        : "KEY가 policy_extract Raw Output을 검토했으나 계약 식별 필드가 충분하지 않습니다.";

    evidence.push({
      evidence_id: randomUUID(),
      raw_output_id: rawOutput.raw_output_id,
      authored_by: "KEY",
      source_factory: rawOutput.source_factory,
      document_id: rawOutput.document_id,
      interpretation,
      generation_mode: KEY_EVIDENCE_GENERATION_MODE,
      policy_block_index: policy?.block_index ?? index,
    });
  }

  if (evidence.length === 0) {
    evidence.push({
      evidence_id: randomUUID(),
      raw_output_id: rawOutput.raw_output_id,
      authored_by: "KEY",
      source_factory: rawOutput.source_factory,
      document_id: rawOutput.document_id,
      interpretation:
        "KEY가 policy_extract Raw Output을 검토했으나 계약 후보가 없거나 식별 가능한 필드가 없습니다.",
      generation_mode: KEY_EVIDENCE_GENERATION_MODE,
      policy_block_index: null,
    });
  }

  return evidence;
}

export function buildKeyEvidenceReportedTraceStep(rawOutput, evidence = []) {
  return {
    step: TRACE_STEP_KEY_EVIDENCE_REPORTED,
    actor: "KEY",
    payload: {
      raw_output_id: rawOutput?.raw_output_id ?? null,
      evidence_ids: evidence.map((row) => row.evidence_id),
      evidence_count: evidence.length,
      authored_by: "KEY",
      generation_mode: KEY_EVIDENCE_GENERATION_MODE,
      subject: "KEY",
    },
  };
}

/**
 * Route factory Raw Output through KEY Layer (Evidence creation only — EA-1).
 */
export function processPolicyExtractRawOutputThroughKeyLayer({
  documentId,
  multiExtraction,
  persistResult = null,
  ocrTextLength = 0,
  chunkCount = 0,
} = {}) {
  const rawOutput = buildPolicyExtractRawOutput({
    documentId,
    multiExtraction,
    persistResult,
    ocrTextLength,
    chunkCount,
  });

  if (!rawOutput) {
    return { ok: false, reason: "raw_output_build_failed" };
  }

  const vocab = assertFactoryRawOutputHasNoKeyVocabulary(rawOutput);
  if (!vocab.ok) {
    return { ok: false, reason: vocab.reason };
  }

  const evidence = createEvidenceFromPolicyExtractRaw(rawOutput);
  const factory_raw_output_reported = buildFactoryRawOutputReportedTraceStep(rawOutput);
  const key_evidence_reported = buildKeyEvidenceReportedTraceStep(rawOutput, evidence);

  return {
    ok: true,
    raw_output: rawOutput,
    evidence,
    trace_steps: [factory_raw_output_reported, key_evidence_reported],
    factory_raw_output_reported,
    key_evidence_reported,
    memory_builder: {
      invoked: false,
      reason: "retired_ea1_raw_output_must_pass_through_key_layer",
    },
  };
}

export function validateEa1TraceOrder(traceSteps = []) {
  const steps = traceSteps.map((row) => String(row?.step ?? ""));
  const rawIdx = steps.indexOf(TRACE_STEP_FACTORY_RAW_OUTPUT_REPORTED);
  const evidenceIdx = steps.indexOf(TRACE_STEP_KEY_EVIDENCE_REPORTED);
  if (rawIdx === -1) return { ok: false, reason: "missing_factory_raw_output_reported" };
  if (evidenceIdx === -1) return { ok: false, reason: "missing_key_evidence_reported" };
  if (evidenceIdx <= rawIdx) return { ok: false, reason: "key_evidence_not_after_raw_output" };
  return { ok: true, reason: "ea1_trace_order_valid" };
}
