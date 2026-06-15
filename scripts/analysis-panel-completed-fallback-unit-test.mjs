/**
 * Unit tests — completed fallback while a newer in-flight engine job is bound to the panel.
 */
import assert from "node:assert/strict";
import {
  isCompletedPanelFallbackJob,
  jobBlocksPanelLoading,
  jobHasEnginePanelResults,
  pickCompletedFallbackJob,
  shouldDeferInFlightPanelApply,
} from "../src/lib/analysisPanelJobUtils.js";

const completedEngineJob = {
  id: "job-completed-full",
  status: "completed",
  result_json: {
    intent_gate: { pipeline_manifest: ["coverage_gap", "recommendation", "insurance_design"] },
    coverage_gap: { gap_score: 42 },
    recommendation: { customer_visible_top2: [{ coverage_label: "암" }] },
    insurance_design: { customer_visible_design: { design_title: "맞춤 설계안" } },
  },
};

const shortPipelineCompletedJob = {
  id: "job-completed-short",
  status: "completed",
  result_json: {
    intent_gate: { pipeline_manifest: ["coverage_gap", "result_claude"] },
    coverage_gap: { gap_score: 10 },
    result_claude: { text: "done" },
  },
};

const processingEngineJob = {
  id: "job-processing-new",
  status: "processing",
  result_json: {
    intent_gate: { pipeline_manifest: ["coverage_gap", "recommendation", "insurance_design"] },
  },
};

const queuedEngineJob = {
  id: "job-queued-new",
  status: "queued",
  result_json: {
    intent_gate: { pipeline_manifest: ["coverage_gap", "underwriting_risk"] },
  },
};

const processingOnlyLatest = {
  id: "job-processing-only",
  status: "processing",
  result_json: {
    intent_gate: { pipeline_manifest: ["coverage_gap", "recommendation"] },
  },
};

assert.equal(jobBlocksPanelLoading(processingEngineJob), true);
assert.equal(jobBlocksPanelLoading(queuedEngineJob), true);
assert.equal(jobBlocksPanelLoading(completedEngineJob), false);

assert.equal(isCompletedPanelFallbackJob(completedEngineJob), true);
assert.equal(isCompletedPanelFallbackJob(shortPipelineCompletedJob), true);
assert.equal(isCompletedPanelFallbackJob(processingEngineJob), false);
assert.equal(
  isCompletedPanelFallbackJob({
    status: "completed",
    result_json: { intent_gate: { pipeline_manifest: ["result_claude"] }, final_claude: { text: "x" } },
  }),
  false,
);

const fallback = pickCompletedFallbackJob(processingEngineJob, completedEngineJob);
assert.ok(fallback);
assert.equal(fallback.id, "job-completed-full");

const queuedFallback = pickCompletedFallbackJob(queuedEngineJob, completedEngineJob);
assert.ok(queuedFallback);
assert.equal(queuedFallback.id, "job-completed-full");

assert.equal(pickCompletedFallbackJob(processingEngineJob, processingOnlyLatest), null);
assert.equal(pickCompletedFallbackJob(processingEngineJob, null), null);
assert.equal(pickCompletedFallbackJob(completedEngineJob, completedEngineJob), null);

assert.equal(shouldDeferInFlightPanelApply(processingEngineJob, completedEngineJob), true);
assert.equal(shouldDeferInFlightPanelApply(processingEngineJob, null), false);

assert.equal(jobHasEnginePanelResults(shortPipelineCompletedJob), true);
assert.equal(
  pickCompletedFallbackJob(processingEngineJob, shortPipelineCompletedJob)?.id,
  "job-completed-short",
);

console.log(
  JSON.stringify(
    {
      test: "analysis-panel-completed-fallback-unit",
      pass: true,
      cases: 12,
    },
    null,
    2,
  ),
);
