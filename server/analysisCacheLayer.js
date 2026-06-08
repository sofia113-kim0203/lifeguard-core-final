export const ANALYSIS_CACHE_TYPES = [
  "coverage_gap",
  "underwriting_risk",
  "recommendation",
  "insurance_design",
];

const DEFAULT_MAX_AGE_MS = 30 * 60 * 1000;

function nowMs(now = new Date()) {
  return now instanceof Date ? now.getTime() : new Date(now).getTime();
}

function updatedMs(entry) {
  const value = entry?.updated_at ?? entry?.generated_at ?? entry?.cached_at;
  if (!value) return null;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : null;
}

export function evaluateCacheEntry(entry, { currentMemoryVersion, now = new Date(), maxAgeMs = DEFAULT_MAX_AGE_MS } = {}) {
  if (!entry) {
    return {
      cache_status: "missing",
      is_fresh: false,
      is_stale: false,
      refresh_required: true,
      reason: "cache_missing",
    };
  }

  if (entry.source_memory_version == null || entry.source_memory_version !== currentMemoryVersion) {
    return {
      cache_status: "stale",
      is_fresh: false,
      is_stale: true,
      refresh_required: true,
      reason: "memory_version_mismatch",
    };
  }

  const updated = updatedMs(entry);
  if (updated == null) {
    return {
      cache_status: "stale",
      is_fresh: false,
      is_stale: true,
      refresh_required: true,
      reason: "updated_at_missing",
    };
  }

  const ageMs = nowMs(now) - updated;
  if (ageMs > maxAgeMs) {
    return {
      cache_status: "stale",
      is_fresh: false,
      is_stale: true,
      refresh_required: true,
      reason: "cache_expired",
      age_ms: ageMs,
    };
  }

  return {
    cache_status: "fresh",
    is_fresh: true,
    is_stale: false,
    refresh_required: false,
    reason: "cache_fresh",
    age_ms: Math.max(0, ageMs),
  };
}

export function normalizeAnalysisCache(rawCache = {}, options = {}) {
  const entries = {};
  for (const type of ANALYSIS_CACHE_TYPES) {
    const entry = rawCache[type] ?? null;
    entries[type] = {
      type,
      data: entry?.data ?? null,
      updated_at: entry?.updated_at ?? null,
      source_memory_version: entry?.source_memory_version ?? null,
      ...evaluateCacheEntry(entry, options),
    };
  }
  return entries;
}

export function buildFastReadPayload({
  customer_id = null,
  currentMemoryVersion,
  cache = {},
  now = new Date(),
  maxAgeMs = DEFAULT_MAX_AGE_MS,
} = {}) {
  const entries = normalizeAnalysisCache(cache, { currentMemoryVersion, now, maxAgeMs });
  const staleTypes = Object.values(entries)
    .filter((entry) => entry.cache_status !== "fresh")
    .map((entry) => entry.type);
  const freshTypes = Object.values(entries)
    .filter((entry) => entry.cache_status === "fresh")
    .map((entry) => entry.type);

  return {
    customer_id,
    source_memory_version: currentMemoryVersion,
    cache_status: staleTypes.length === 0 ? "fresh" : freshTypes.length === 0 ? "missing" : "stale",
    coverage_gap: entries.coverage_gap.data,
    underwriting_risk: entries.underwriting_risk.data,
    recommendation: entries.recommendation.data,
    insurance_design: entries.insurance_design.data,
    cache_entries: entries,
    background_refresh_required: staleTypes.length > 0,
    background_refresh_types: staleTypes,
    generated_at: new Date(now).toISOString(),
  };
}

export function makeCacheEntry({ data, sourceMemoryVersion, updatedAt = new Date().toISOString() }) {
  return {
    data,
    source_memory_version: sourceMemoryVersion,
    updated_at: updatedAt,
  };
}
