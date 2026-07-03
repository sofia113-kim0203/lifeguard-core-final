/**
 * EA-1 — KEY Evidence Foundation unit tests (Tom EXEC gate).
 */
import assert from "node:assert/strict";
import { applyKeyEvidenceFoundationEa1, buildCoverageSheetMultiExtractionForEa1 } from "../server/keyBrain/keyEvidenceFoundationEa1.js";
import {
  assertFactoryRawOutputHasNoKeyVocabulary,
  buildPolicyExtractRawOutput,
} from "../server/keyBrain/keyRawOutputInbox.js";
import {
  createEvidenceFromPolicyExtractRaw,
  KEY_EVIDENCE_GENERATION_MODE,
  processPolicyExtractRawOutputThroughKeyLayer,
  TRACE_STEP_KEY_EVIDENCE_REPORTED,
  validateEa1TraceOrder,
} from "../server/keyBrain/keyEvidenceFromRaw.js";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const SAMPLE_EXTRACTION = {
  policy_count: 1,
  policies: [
    {
      block_index: 0,
      tier: "full",
      confidence: 0.833,
      field_count: 4,
      fields: {
        insurer_name: "삼성화재",
        product_name: "실손의료비",
      },
      missing_fields: [],
    },
  ],
  blocks_rejected: 0,
};

function testRawOutputHasNoKeyVocabulary() {
  const raw = buildPolicyExtractRawOutput({
    documentId: "doc-ea1-1",
    multiExtraction: SAMPLE_EXTRACTION,
    persistResult: { policy_ids: ["p1"], policy_count: 1 },
    ocrTextLength: 1200,
    chunkCount: 3,
  });
  const gate = assertFactoryRawOutputHasNoKeyVocabulary(raw);
  assert.equal(gate.ok, true);
  assert.equal(raw.source_factory, "policy_extract");
  assert.ok(raw.raw_output_id);
}

function testKeyCreatesEvidenceFromRaw() {
  const raw = buildPolicyExtractRawOutput({
    documentId: "doc-ea1-2",
    multiExtraction: SAMPLE_EXTRACTION,
  });
  const evidence = createEvidenceFromPolicyExtractRaw(raw);
  assert.equal(evidence.length, 1);
  assert.equal(evidence[0].authored_by, "KEY");
  assert.equal(evidence[0].generation_mode, KEY_EVIDENCE_GENERATION_MODE);
  assert.match(evidence[0].interpretation, /삼성화재/);
  assert.match(evidence[0].interpretation, /KEY/);
}

function testEa1TraceOrder() {
  const result = processPolicyExtractRawOutputThroughKeyLayer({
    documentId: "doc-ea1-3",
    multiExtraction: SAMPLE_EXTRACTION,
    persistResult: { policy_ids: ["p1"], policy_count: 1 },
  });
  assert.equal(result.ok, true);
  const order = validateEa1TraceOrder(result.trace_steps);
  assert.equal(order.ok, true);
  assert.equal(result.memory_builder.invoked, false);
  assert.equal(result.memory_builder.reason, "retired_ea1_raw_output_must_pass_through_key_layer");
}

function testApplyEa1RetiresMemoryBuilder() {
  const applied = applyKeyEvidenceFoundationEa1({
    documentId: "doc-ea1-4",
    multiExtraction: SAMPLE_EXTRACTION,
    invokeMemory: true,
  });
  assert.ok(applied.key_evidence_foundation);
  assert.equal(applied.memory_builder.invoked, false);
  assert.equal(applied.key_evidence_foundation.evidence_count, 1);
  assert.equal(applied.key_evidence_foundation.trace_steps.length, 2);
}

function testSkippedWhenInvokeMemoryFalse() {
  const applied = applyKeyEvidenceFoundationEa1({
    documentId: "doc-ea1-5",
    multiExtraction: SAMPLE_EXTRACTION,
    invokeMemory: false,
  });
  assert.equal(applied.key_evidence_foundation, null);
  assert.equal(applied.memory_builder.reason, "skipped");
}

function testCoverageSheetLiveGatePathEa1() {
  const passingRows = [
    {
      row_index: 0,
      insurer_name: "메리츠화재",
      product_name: "실손의료비",
      amount_value: 50000,
      amount_unit: "won",
    },
  ];
  const persistResult = { policy_ids: ["p-sheet-1"], policy_count: 1 };
  const multiExtraction = buildCoverageSheetMultiExtractionForEa1({ passingRows, persistResult });
  assert.equal(multiExtraction.policy_count, 1);
  assert.equal(multiExtraction.policies[0].tier, "coverage_sheet_l1");

  const applied = applyKeyEvidenceFoundationEa1({
    documentId: "doc-sheet-ea1",
    multiExtraction,
    persistResult,
    ocrTextLength: 800,
    chunkCount: 2,
    invokeMemory: true,
  });
  assert.ok(applied.key_evidence_foundation);
  assert.equal(applied.memory_builder.invoked, false);
  const steps = applied.key_evidence_foundation.trace_steps.map((row) => row.step);
  assert.ok(steps.includes(TRACE_STEP_KEY_EVIDENCE_REPORTED));
}

function testPipelineHasNoInvokeMemoryBuilder() {
  const pipelinePath = join(dirname(fileURLToPath(import.meta.url)), "../server/documentPolicyExtractionPipeline.js");
  const source = readFileSync(pipelinePath, "utf8");
  assert.equal(source.includes("invokeMemoryBuilder"), false, "invokeMemoryBuilder must be removed from pipeline");
  assert.ok(source.includes("buildCoverageSheetMultiExtractionForEa1"), "coverage sheet EA-1 wiring required");
  assert.ok(source.includes("applyKeyEvidenceFoundationEa1"), "main path EA-1 wiring required");
}

const tests = [
  testRawOutputHasNoKeyVocabulary,
  testKeyCreatesEvidenceFromRaw,
  testEa1TraceOrder,
  testApplyEa1RetiresMemoryBuilder,
  testSkippedWhenInvokeMemoryFalse,
  testCoverageSheetLiveGatePathEa1,
  testPipelineHasNoInvokeMemoryBuilder,
];
for (const test of tests) test();
console.log(`KEY Evidence Foundation EA-1: ${tests.length} tests passed`);
