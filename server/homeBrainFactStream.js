/**
 * P6-2B-6 — SSE helpers for customer-home-brain-fact streaming.
 */

export function initHomeBrainFactSseResponse(res) {
  res.statusCode = 200;
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
}

export function writeHomeBrainFactSseEvent(res, event, data) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

export function writeHomeBrainFactSseError(res, payload) {
  writeHomeBrainFactSseEvent(res, "error", payload);
  res.end();
}
