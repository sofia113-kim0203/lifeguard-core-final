/**
 * Unit tests — analysis_jobs autopilot claim eligibility + failure policy.
 */
import assert from "node:assert/strict";
import {
  DEFAULT_STALE_MS,
  isClaimEligible,
  isWithinTimeBudget,
  shouldMarkFailed,
  TIME_BUDGET_FRACTION,
} from "../server/analysisJobsAutopilot.js";

const NOW = Date.parse("2026-06-16T12:00:00.000Z");
const STALE = DEFAULT_STALE_MS;

function job(overrides = {}) {
  return {
    id: "job-1",
    status: "queued",
    updated_at: new Date(NOW - STALE - 60_000).toISOString(),
    locked_at: null,
    attempts: 0,
    ...overrides,
  };
}

assert.equal(shouldMarkFailed(2, 3), false);
assert.equal(shouldMarkFailed(3, 3), true);
assert.equal(shouldMarkFailed(4, 3), true);

assert.equal(isClaimEligible(job({ status: "queued" }), NOW, STALE), true, "queued+stale");

assert.equal(
  isClaimEligible(job({ status: "processing", updated_at: new Date(NOW - 60_000).toISOString() }), NOW, STALE),
  false,
  "processing+fresh=not eligible (browser active)",
);

assert.equal(
  isClaimEligible(
    job({
      status: "processing",
      updated_at: new Date(NOW - STALE - 120_000).toISOString(),
    }),
    NOW,
    STALE,
  ),
  true,
  "processing+stale=eligible",
);

assert.equal(isClaimEligible(job({ status: "completed" }), NOW, STALE), false);

assert.equal(
  isClaimEligible(
    job({
      locked_at: new Date(NOW - 60_000).toISOString(),
    }),
    NOW,
    STALE,
  ),
  false,
  "fresh lease blocks claim",
);

assert.equal(isWithinTimeBudget(NOW, NOW + 299_000, 300_000), false);
assert.equal(isWithinTimeBudget(NOW, NOW + 200_000, 300_000), true);
assert.equal(TIME_BUDGET_FRACTION, 0.7);

console.log(
  JSON.stringify(
    {
      test: "analysis-jobs-autopilot-unit",
      pass: true,
      cases: 11,
    },
    null,
    2,
  ),
);
