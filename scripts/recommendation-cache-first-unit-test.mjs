/**
 * Unit tests — cache-first instant apply + background replace tier gate.
 */
import assert from "node:assert/strict";
import {
  isDisplayablePanelJob,
  panelJobDisplayTier,
  shouldReplacePanelJobWithBackground,
} from "../src/lib/analysisPanelJobUtils.js";

function job(resultJson, status = "completed") {
  return { status, result_json: resultJson };
}

const tier1Full = job({
  recommendation: { customer_visible_top2: [{ coverage_label: "암" }] },
  insurance_design: { customer_visible_design: { priority_coverages: [{ label: "암" }] } },
  coverage_gap: { gap_score: 42 },
  underwriting_risk: { risk_score: 10 },
});

const tier1RecOnly = job({
  recommendation: { customer_visible_top2: [{ coverage_label: "암" }] },
});

const tier2GapOnly = job({
  coverage_gap: { gap_score: 20 },
});

const tier2UwOnly = job({
  underwriting_risk: { risk_score: 5 },
});

const tier3ClaudeOnly = job({
  result_claude: { text: "hello" },
  intent_gate: { pipeline_manifest: ["result_claude"] },
});

const emptyJob = job({});

assert.equal(isDisplayablePanelJob(tier1Full), true);
assert.equal(isDisplayablePanelJob(tier2GapOnly), true);
assert.equal(isDisplayablePanelJob(tier3ClaudeOnly), false);
assert.equal(isDisplayablePanelJob(emptyJob), false);

assert.equal(panelJobDisplayTier(tier1RecOnly), 1);
assert.equal(panelJobDisplayTier(tier2GapOnly), 2);
assert.equal(panelJobDisplayTier(tier2UwOnly), 2);
assert.equal(panelJobDisplayTier(tier3ClaudeOnly), 3);
assert.equal(panelJobDisplayTier(emptyJob), 3);

assert.equal(
  shouldReplacePanelJobWithBackground(tier1Full, tier3ClaudeOnly),
  false,
  "tier1 current + tier3 background must not replace",
);

assert.equal(
  shouldReplacePanelJobWithBackground(tier1Full, tier2GapOnly),
  false,
  "tier1 current + tier2 background must not replace",
);

assert.equal(
  shouldReplacePanelJobWithBackground(tier1Full, tier1RecOnly),
  true,
  "tier1 current + tier1 background should replace",
);

assert.equal(
  shouldReplacePanelJobWithBackground(null, tier1RecOnly),
  true,
  "empty current + tier1 background should apply",
);

assert.equal(
  shouldReplacePanelJobWithBackground(null, tier3ClaudeOnly),
  false,
  "empty current + non-displayable background should not apply",
);

assert.equal(
  shouldReplacePanelJobWithBackground(tier2GapOnly, tier1RecOnly),
  true,
  "tier2 current + tier1 background should upgrade",
);

console.log(
  JSON.stringify(
    {
      test: "recommendation-cache-first-unit",
      pass: true,
      cases: 14,
    },
    null,
    2,
  ),
);
