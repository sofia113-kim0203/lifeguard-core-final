/**
 * EA-1 — Wire policy extract success path through KEY Layer (Tom EXEC GO).
 */
import { processPolicyExtractRawOutputThroughKeyLayer } from "./keyEvidenceFromRaw.js";

export const KEY_EVIDENCE_FOUNDATION_EA1_SCHEMA = "key-evidence-foundation-ea1-v1";

/**
 * Map coverage sheet passing rows into policy_extract-shaped Raw Output for KEY Layer (EA-1).
 */
export function buildCoverageSheetMultiExtractionForEa1({
  passingRows = [],
  persistResult = null,
} = {}) {
  const policies = passingRows.map((row, index) => {
    const fields = {
      insurer_name: row.insurer_name ?? null,
      product_name: row.product_name ?? row.coverage_name ?? row.plan_name ?? null,
    };
    const populatedFields = Object.values(fields).filter((value) => String(value ?? "").trim());
    return {
      block_index: row.row_index ?? index,
      tier: "coverage_sheet_l1",
      confidence: row.confidence ?? null,
      field_count: populatedFields.length,
      fields,
      missing_fields: [],
    };
  });

  return {
    policy_count: persistResult?.policy_count ?? policies.length,
    policies,
    blocks_rejected: 0,
  };
}

/**
 * When invokeMemory is true, Raw Output must pass through KEY Layer — no direct Memory Builder.
 * @param {boolean} invokeMemory — legacy param name; true = run KEY EA-1 path
 */
export function applyKeyEvidenceFoundationEa1({
  documentId,
  multiExtraction,
  persistResult = null,
  ocrTextLength = 0,
  chunkCount = 0,
  invokeMemory = true,
} = {}) {
  if (!invokeMemory) {
    return {
      key_evidence_foundation: null,
      memory_builder: { invoked: false, reason: "skipped" },
    };
  }

  const keyLayer = processPolicyExtractRawOutputThroughKeyLayer({
    documentId,
    multiExtraction,
    persistResult,
    ocrTextLength,
    chunkCount,
  });

  if (!keyLayer.ok) {
    return {
      key_evidence_foundation: null,
      memory_builder: { invoked: false, reason: keyLayer.reason ?? "key_layer_failed" },
    };
  }

  return {
    key_evidence_foundation: {
      schema_version: KEY_EVIDENCE_FOUNDATION_EA1_SCHEMA,
      raw_output_id: keyLayer.raw_output.raw_output_id,
      evidence_count: keyLayer.evidence.length,
      trace_steps: keyLayer.trace_steps,
    },
    memory_builder: keyLayer.memory_builder,
    _key_layer: keyLayer,
  };
}

export function buildKeyEvidenceFoundationMetadataPatch(ea1Result) {
  const foundation = ea1Result?.key_evidence_foundation;
  if (!foundation) return {};

  return {
    key_evidence_foundation_ea1: foundation,
  };
}
