/**
 * Phase 25 Step 1A — Analysis Cache Layer test.
 */
import assert from "node:assert/strict";
import {
  buildFastReadPayload,
  evaluateCacheEntry,
  makeCacheEntry,
  normalizeAnalysisCache,
} from "../server/analysisCacheLayer.js";

const now = new Date("2026-06-08T12:00:00.000Z");
const freshUpdated = "2026-06-08T11:55:00.000Z";
const staleUpdated = "2026-06-08T10:00:00.000Z";
const currentMemoryVersion = 7;

const coverageGap = { gap_score: 42, overall_severity: "medium" };
const underwritingRisk = { risk_score: 31, underwriting_risk_level: "medium" };
const recommendation = { customer_top2: [{ carrier_id: "a" }, { carrier_id: "b" }] };
const insuranceDesign = { customer_top2_designs: [{ carrier_id: "a" }, { carrier_id: "b" }] };

const freshEntry = makeCacheEntry({ data: coverageGap, sourceMemoryVersion: currentMemoryVersion, updatedAt: freshUpdated });
const staleVersionEntry = makeCacheEntry({ data: underwritingRisk, sourceMemoryVersion: currentMemoryVersion - 1, updatedAt: freshUpdated });
const expiredEntry = makeCacheEntry({ data: recommendation, sourceMemoryVersion: currentMemoryVersion, updatedAt: staleUpdated });

const fresh = evaluateCacheEntry(freshEntry, { currentMemoryVersion, now });
const staleByVersion = evaluateCacheEntry(staleVersionEntry, { currentMemoryVersion, now });
const staleByAge = evaluateCacheEntry(expiredEntry, { currentMemoryVersion, now, maxAgeMs: 30 * 60 * 1000 });
const missing = evaluateCacheEntry(null, { currentMemoryVersion, now });

const mixedPayload = buildFastReadPayload({
  customer_id: "customer-a",
  currentMemoryVersion,
  now,
  cache: {
    coverage_gap: freshEntry,
    underwriting_risk: staleVersionEntry,
    recommendation: expiredEntry,
    insurance_design: makeCacheEntry({ data: insuranceDesign, sourceMemoryVersion: currentMemoryVersion, updatedAt: freshUpdated }),
  },
});

const allFreshPayload = buildFastReadPayload({
  customer_id: "customer-a",
  currentMemoryVersion,
  now,
  cache: {
    coverage_gap: freshEntry,
    underwriting_risk: makeCacheEntry({ data: underwritingRisk, sourceMemoryVersion: currentMemoryVersion, updatedAt: freshUpdated }),
    recommendation: makeCacheEntry({ data: recommendation, sourceMemoryVersion: currentMemoryVersion, updatedAt: freshUpdated }),
    insurance_design: makeCacheEntry({ data: insuranceDesign, sourceMemoryVersion: currentMemoryVersion, updatedAt: freshUpdated }),
  },
});

const normalized = normalizeAnalysisCache({ coverage_gap: freshEntry }, { currentMemoryVersion, now });

const report = {
  phase: "25-1A",
  tests: {
    freshCache: {
      pass: fresh.cache_status === "fresh" && fresh.refresh_required === false,
      fresh,
    },
    staleCacheByVersion: {
      pass: staleByVersion.cache_status === "stale" && staleByVersion.reason === "memory_version_mismatch" && staleByVersion.refresh_required === true,
      staleByVersion,
    },
    staleCacheByAge: {
      pass: staleByAge.cache_status === "stale" && staleByAge.reason === "cache_expired" && staleByAge.refresh_required === true,
      staleByAge,
    },
    missingCache: {
      pass: missing.cache_status === "missing" && missing.refresh_required === true,
      missing,
    },
    fastReadPayload: {
      pass:
        mixedPayload.customer_id === "customer-a" &&
        mixedPayload.coverage_gap.gap_score === 42 &&
        mixedPayload.insurance_design.customer_top2_designs.length === 2 &&
        mixedPayload.cache_status === "stale" &&
        mixedPayload.background_refresh_required === true &&
        mixedPayload.background_refresh_types.includes("underwriting_risk") &&
        mixedPayload.background_refresh_types.includes("recommendation"),
      mixedPayload,
    },
    allFreshPayload: {
      pass: allFreshPayload.cache_status === "fresh" && allFreshPayload.background_refresh_required === false && allFreshPayload.background_refresh_types.length === 0,
      allFreshPayload,
    },
    normalizeMissingTypes: {
      pass:
        normalized.coverage_gap.cache_status === "fresh" &&
        normalized.underwriting_risk.cache_status === "missing" &&
        normalized.recommendation.cache_status === "missing" &&
        normalized.insurance_design.cache_status === "missing",
      normalized,
    },
  },
};

report.allPass = Object.values(report.tests).every((test) => test.pass === true);
for (const [name, test] of Object.entries(report.tests)) {
  assert.equal(test.pass, true, `${name} should pass`);
}
assert.equal(report.allPass, true);
console.log(JSON.stringify(report, null, 2));
