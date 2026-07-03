/**
 * EA-1 — Factory Raw Output inbox (Factory vocabulary only; no Evidence/Fact/Memory).
 */
import { randomUUID } from "node:crypto";

export const FACTORY_RAW_OUTPUT_SCHEMA_VERSION = "factory-raw-output-v1";
export const TRACE_STEP_FACTORY_RAW_OUTPUT_REPORTED = "factory_raw_output_reported";

/**
 * @param {object} policy — policy extract candidate block
 */
function slimPolicyBlock(policy) {
  if (!policy || typeof policy !== "object") return null;
  return {
    block_index: policy.block_index ?? null,
    tier: policy.tier ?? null,
    confidence: policy.confidence ?? null,
    field_count: policy.field_count ?? null,
    fields: policy.fields ?? null,
    missing_fields: policy.missing_fields ?? [],
  };
}

/**
 * Build policy_extract Raw Output — factory-native JSON only.
 */
export function buildPolicyExtractRawOutput({
  documentId,
  multiExtraction,
  persistResult = null,
  ocrTextLength = 0,
  chunkCount = 0,
} = {}) {
  const document_id = String(documentId ?? "").trim();
  if (!document_id) return null;

  const policies = (multiExtraction?.policies ?? [])
    .map(slimPolicyBlock)
    .filter(Boolean);

  return {
    raw_output_id: randomUUID(),
    schema_version: FACTORY_RAW_OUTPUT_SCHEMA_VERSION,
    source_factory: "policy_extract",
    document_id,
    payload_kind: "policy_extract_result_v1",
    payload: {
      policy_count: multiExtraction?.policy_count ?? policies.length,
      policies,
      blocks_rejected: multiExtraction?.blocks_rejected ?? 0,
      ocr_text_length: ocrTextLength,
      chunk_count: chunkCount,
      persist: {
        policy_ids: persistResult?.policy_ids ?? [],
        policy_count: persistResult?.policy_count ?? 0,
      },
    },
    reported_at: new Date().toISOString(),
  };
}

export function buildFactoryRawOutputReportedTraceStep(rawOutput) {
  if (!rawOutput?.raw_output_id) return null;

  return {
    step: TRACE_STEP_FACTORY_RAW_OUTPUT_REPORTED,
    actor: "FACTORY",
    payload: {
      raw_output_id: rawOutput.raw_output_id,
      source_factory: rawOutput.source_factory,
      document_id: rawOutput.document_id,
      payload_kind: rawOutput.payload_kind,
      policy_count: rawOutput.payload?.policy_count ?? 0,
      reported_at: rawOutput.reported_at,
    },
  };
}

export function assertFactoryRawOutputHasNoKeyVocabulary(rawOutput) {
  const serialized = JSON.stringify(rawOutput ?? {});
  const forbidden = ["evidence_id", "fact_key", "fact_value", "customer_memory_facts", "persona_outlet"];
  for (const token of forbidden) {
    if (serialized.includes(token)) {
      return { ok: false, reason: `forbidden_token_${token}` };
    }
  }
  return { ok: true };
}
