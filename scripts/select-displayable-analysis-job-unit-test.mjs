/**
 * Unit tests — selectDisplayableAnalysisJob completed-job selection for latest analysis API.
 */
import assert from "node:assert/strict";
import {
  analysisJobDisplayTier,
  isDisplayableAnalysisJob,
  selectDisplayableAnalysisJob,
} from "../server/conversationalBackgroundAnalysisCore.js";

function job(id, resultJson, status = "completed") {
  return { id, status, created_at: id, result_json: resultJson };
}

const fullJob = job("full-old", {
  coverage_gap: { gap_score: 42 },
  underwriting_risk: { risk_score: 10 },
  recommendation: { customer_visible_top2: [{ coverage_label: "암" }, { coverage_label: "뇌" }] },
  insurance_design: { customer_visible_design: { priority_coverages: [{ label: "암" }] } },
});

const gapOnlyJob = job("gap-newer", {
  coverage_gap: { gap_score: 20 },
});

const uwOnlyJob = job("uw-mid", {
  underwriting_risk: { risk_score: 5 },
});

const recOnlyJob = job("rec-old", {
  recommendation: { customer_visible_top2: [{ coverage_label: "암" }] },
});

const designOnlyJob = job("design-old", {
  insurance_design: { priority_coverages: [{ label: "실손" }] },
});

const claudeOnlyNew = job("claude-new", {
  result_claude: { text: "hello" },
  intent_gate: { pipeline_manifest: ["result_claude"] },
});

const claudeOnlyOlder = job("claude-old", {
  final_claude: { text: "older" },
});

const processingLatest = {
  id: "processing-latest",
  status: "processing",
  created_at: "z",
  result_json: { coverage_gap: { gap_score: 1 } },
};

assert.equal(isDisplayableAnalysisJob(fullJob), true);
assert.equal(isDisplayableAnalysisJob(gapOnlyJob), true);
assert.equal(isDisplayableAnalysisJob(claudeOnlyNew), false);
assert.equal(analysisJobDisplayTier(fullJob), 1);
assert.equal(analysisJobDisplayTier(gapOnlyJob), 2);
assert.equal(analysisJobDisplayTier(claudeOnlyNew), 3);

// 1. rec/design job preferred over gap-only even when gap-only is newer
const recPreferred = selectDisplayableAnalysisJob([gapOnlyJob, recOnlyJob], null);
assert.equal(recPreferred.id, "rec-old");

const designPreferred = selectDisplayableAnalysisJob([gapOnlyJob, designOnlyJob], null);
assert.equal(designPreferred.id, "design-old");

// 2. gap/uw fallback when no rec/design
const gapFallback = selectDisplayableAnalysisJob([claudeOnlyNew, uwOnlyJob, claudeOnlyOlder], null);
assert.equal(gapFallback.id, "uw-mid");

const gapOverClaude = selectDisplayableAnalysisJob([claudeOnlyNew, gapOnlyJob], null);
assert.equal(gapOverClaude.id, "gap-newer");

// 3. latest completed fallback when all completed are non-displayable
const latestCompleted = selectDisplayableAnalysisJob([claudeOnlyNew, claudeOnlyOlder], null);
assert.equal(latestCompleted.id, "claude-new");

// 4. no completed → latest-any fallback
const latestAny = selectDisplayableAnalysisJob([], processingLatest);
assert.equal(latestAny.id, "processing-latest");

assert.equal(selectDisplayableAnalysisJob([], null), null);

// 5. multiple result_claude-only + older FULL → FULL selected
const fullWins = selectDisplayableAnalysisJob(
  [claudeOnlyNew, claudeOnlyOlder, fullJob],
  null,
);
assert.equal(fullWins.id, "full-old");

console.log(
  JSON.stringify(
    {
      test: "select-displayable-analysis-job-unit",
      pass: true,
      cases: 14,
    },
    null,
    2,
  ),
);
