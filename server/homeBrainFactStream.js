/**
 * P6-2B-6 — SSE helpers for customer-home-brain-fact streaming.
 */

/** T2 — factory / phase8 diagnostics must not ride customer SSE done. */
export const CUSTOMER_SSE_DONE_STRIP_KEYS = Object.freeze([
  "phase8_golden_parallel_trace",
  "factory_called",
  "sales_director_factory_audit",
  "factory_enqueue",
  "claude_factory_direction",
  "factory_hypothesis",
  "factory_primary_disconnect",
  "answer_evidence",
]);

/**
 * Shallow strip for customer `done` SSE only (does not mutate input).
 * @param {unknown} data
 */
export function stripCustomerHomeBrainDoneSseMeta(data) {
  if (!data || typeof data !== "object" || Array.isArray(data)) return data;
  const out = { ...data };
  for (const key of CUSTOMER_SSE_DONE_STRIP_KEYS) {
    if (Object.prototype.hasOwnProperty.call(out, key)) {
      delete out[key];
    }
  }
  return out;
}

export function initHomeBrainFactSseResponse(res) {
  res.statusCode = 200;
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
}

export function writeHomeBrainFactSseEvent(res, event, data) {
  const payload =
    event === "done" ? stripCustomerHomeBrainDoneSseMeta(data) : data;
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

export function writeHomeBrainFactSseError(res, payload) {
  writeHomeBrainFactSseEvent(res, "error", payload);
  res.end();
}
