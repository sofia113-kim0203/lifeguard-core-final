/**
 * Phase 26 Step 2A — Persistent customer analysis cache store.
 */
import {
  ANALYSIS_CACHE_TYPES,
  buildFastReadPayload,
  evaluateCacheEntry,
  makeCacheEntry,
} from "./analysisCacheLayer.js";

export async function loadCustomerAnalysisCacheRows(supabase, customerId) {
  const { data, error } = await supabase
    .from("customer_analysis_cache")
    .select("cache_type, source_memory_version, cache_data, updated_at")
    .eq("customer_id", customerId);

  if (error) {
    throw new Error(`analysis_cache_load_failed: ${error.message}`);
  }

  const cache = {};
  for (const row of data ?? []) {
    cache[row.cache_type] = {
      data: row.cache_data,
      source_memory_version: row.source_memory_version,
      updated_at: row.updated_at,
    };
  }
  return cache;
}

export async function loadCustomerAnalysisCachePayload(supabase, customerId, memoryVersion, options = {}) {
  const cache = await loadCustomerAnalysisCacheRows(supabase, customerId);
  return buildFastReadPayload({
    customer_id: customerId,
    currentMemoryVersion: memoryVersion,
    cache,
    ...options,
  });
}

export async function saveCustomerAnalysisCacheEntry(
  supabase,
  customerId,
  cacheType,
  data,
  sourceMemoryVersion,
) {
  if (!ANALYSIS_CACHE_TYPES.includes(cacheType)) {
    throw new Error(`invalid_cache_type: ${cacheType}`);
  }

  const entry = makeCacheEntry({
    data,
    sourceMemoryVersion,
    updatedAt: new Date().toISOString(),
  });

  const { error } = await supabase.from("customer_analysis_cache").upsert(
    {
      customer_id: customerId,
      cache_type: cacheType,
      source_memory_version: entry.source_memory_version,
      cache_data: entry.data,
      updated_at: entry.updated_at,
    },
    { onConflict: "customer_id,cache_type" },
  );

  if (error) {
    throw new Error(`analysis_cache_save_failed: ${error.message}`);
  }

  return entry;
}

export async function loadFreshCacheEntry(supabase, customerId, cacheType, memoryVersion, options = {}) {
  const cache = await loadCustomerAnalysisCacheRows(supabase, customerId);
  const entry = cache[cacheType] ?? null;
  const evaluation = evaluateCacheEntry(entry, {
    currentMemoryVersion: memoryVersion,
    ...options,
  });
  return { entry, evaluation };
}
