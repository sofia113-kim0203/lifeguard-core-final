export function parseHomeBrainFactSseBlock(block) {
  const lines = String(block ?? "").split("\n");
  let event = "message";
  let data = "";
  for (const line of lines) {
    if (line.startsWith("event:")) event = line.slice(6).trim();
    if (line.startsWith("data:")) data = line.slice(5).trim();
  }
  if (!data) return null;
  return { event, data: JSON.parse(data) };
}

export async function consumeHomeBrainFactSse(response, handlers = {}) {
  if (!response.body) {
    throw new Error("Streaming response body unavailable.");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let finalPayload = null;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let splitAt = buffer.indexOf("\n\n");
    while (splitAt >= 0) {
      const block = buffer.slice(0, splitAt);
      buffer = buffer.slice(splitAt + 2);
      splitAt = buffer.indexOf("\n\n");

      const parsed = parseHomeBrainFactSseBlock(block);
      if (!parsed) continue;

      if (parsed.event === "ack") handlers.onAck?.(parsed.data?.text ?? "");
      if (parsed.event === "delta") handlers.onDelta?.(parsed.data?.text ?? "");
      if (parsed.event === "ttft") handlers.onTTFT?.(parsed.data?.ttft_ms ?? null);
      if (parsed.event === "replace") handlers.onReplace?.(parsed.data?.text ?? "");
      if (parsed.event === "error") {
        const error = new Error(parsed.data?.error_message ?? parsed.data?.reason ?? "Streaming failed.");
        error.reason = parsed.data?.reason ?? null;
        throw error;
      }
      if (parsed.event === "done") finalPayload = parsed.data;
    }
  }

  return finalPayload;
}
