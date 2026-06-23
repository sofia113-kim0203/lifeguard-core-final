/**
 * P6-2B-6a — In-process TTL cache for Sales Director turn context.
 */
const CACHE_TTL_MS = 45_000;
const cache = new Map();

export function readSalesDirectorTurnContextCache(customerId) {
  if (!customerId) return null;
  const entry = cache.get(String(customerId));
  if (!entry || entry.expiresAt <= Date.now()) {
    cache.delete(String(customerId));
    return null;
  }
  return {
    snapshot: entry.snapshot,
    unifiedState: entry.unifiedState,
    from_cache: true,
  };
}

export function writeSalesDirectorTurnContextCache(customerId, snapshot, unifiedState) {
  if (!customerId || !snapshot || !unifiedState) return;
  cache.set(String(customerId), {
    snapshot,
    unifiedState,
    memoryVersion: snapshot.memory_version ?? 0,
    expiresAt: Date.now() + CACHE_TTL_MS,
  });
}

export function clearSalesDirectorTurnContextCache(customerId = null) {
  if (customerId) {
    cache.delete(String(customerId));
    return;
  }
  cache.clear();
}
