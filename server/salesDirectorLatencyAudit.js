/**
 * P6-2B-4 — Sales Director latency audit (measurement only).
 */
export function createSalesDirectorLatencyBucket() {
  return {
    snapshot_ms: 0,
    memory_ms: 0,
    tool_brain_ms: 0,
    handler_ms: 0,
    free_thinking_prepare_ms: 0,
    claude_ms: 0,
    parse_ms: 0,
    compose_ms: 0,
    total_ms: 0,
  };
}

export function markLatencyMs(startedAt) {
  return Math.max(0, Date.now() - startedAt);
}

export function finalizeSalesDirectorLatency(bucket, startedAt) {
  if (!bucket) return createSalesDirectorLatencyBucket();
  bucket.total_ms = markLatencyMs(startedAt);
  return bucket;
}

export function mergeFreeThinkingLatency(bucket, freeThinkingLatency = null) {
  if (!bucket || !freeThinkingLatency) return bucket;
  bucket.free_thinking_prepare_ms += freeThinkingLatency.free_thinking_prepare_ms ?? 0;
  bucket.claude_ms += freeThinkingLatency.claude_ms ?? 0;
  bucket.parse_ms += freeThinkingLatency.parse_ms ?? 0;
  return bucket;
}
