/**
 * Preview-only KEY→Claude request size observer.
 * Records section char counts immediately before Provider fetch.
 * Never emits raw prompt text, API keys, auth, or image bytes.
 */
import { createHash } from "node:crypto";

export const KEY_CLAUDE_REQUEST_SIZE_OBSERVE_SCHEMA =
  "key_claude_request_size_observe_v1";
export const KEY_CLAUDE_REQUEST_SIZE_OBSERVE_LOG_TAG =
  "KEY_CLAUDE_REQUEST_SIZE_OBSERVE";

export function shouldRecordKeyClaudeRequestSizeObserve(env = process.env) {
  return String(env?.VERCEL_ENV ?? "").trim() === "preview";
}

function safeJsonChars(value) {
  try {
    return JSON.stringify(value ?? null).length;
  } catch {
    return 0;
  }
}

function utf8Bytes(text) {
  return Buffer.byteLength(String(text ?? ""), "utf8");
}

function sha256Hex(input) {
  return createHash("sha256").update(input).digest("hex");
}

function estimateBase64Bytes(b64) {
  const s = String(b64 ?? "");
  if (!s) return 0;
  return Math.floor((s.length * 3) / 4);
}

function assistantTurnsChars(recentConversation) {
  const rows = Array.isArray(recentConversation) ? recentConversation : [];
  let chars = 0;
  for (const row of rows) {
    const role = String(row?.role ?? row?.speaker ?? "").toLowerCase();
    if (role === "assistant" || role === "key" || role === "ai") {
      chars += safeJsonChars(row);
    }
  }
  return chars;
}

/**
 * Build PII-safe size observation from the exact Anthropic request body.
 * Does not mutate body. Does not retain text/base64.
 */
export function buildKeyClaudeRequestSizeObservation({ body = null } = {}) {
  const systemBlocks = Array.isArray(body?.system) ? body.system : [];
  const messages = Array.isArray(body?.messages) ? body.messages : [];
  const tools = Array.isArray(body?.tools) ? body.tools : [];

  let system_chars = 0;
  for (const block of systemBlocks) {
    system_chars += String(block?.text ?? "").length;
  }

  let question_chars = 0;
  let customer_card_chars = 0;
  let memory_chars = 0;
  let recent_dialogue_chars = 0;
  let prior_answers_chars = 0;
  let handoff_chars = 0;
  let wholesale_envelope_chars = 0;
  let other_user_text_chars = 0;
  let image_payload_chars = 0;
  const images = [];

  const card_breakdown = {
    insurance_contracts_chars: 0,
    confirmed_facts_chars: 0,
    recent_conversation_chars: 0,
    prior_consultation_chars: 0,
    entrusted_and_ready_chars: 0,
    other_card_fields_chars: 0,
  };

  for (const msg of messages) {
    const content = Array.isArray(msg?.content) ? msg.content : [];
    for (const block of content) {
      const type = String(block?.type ?? "");
      if (type === "text") {
        const text = String(block?.text ?? "");
        if (text.includes("[CURRENT_CUSTOMER_REQUEST")) {
          question_chars += text.length;
          continue;
        }
        let parsed = null;
        try {
          parsed = JSON.parse(text);
        } catch {
          parsed = null;
        }
        if (parsed && typeof parsed === "object" && parsed.key_customer_card) {
          const card = parsed.key_customer_card;
          customer_card_chars += safeJsonChars(card);
          card_breakdown.insurance_contracts_chars = safeJsonChars(
            card?.insurance_contracts,
          );
          card_breakdown.confirmed_facts_chars = safeJsonChars(
            card?.confirmed_facts,
          );
          card_breakdown.recent_conversation_chars = safeJsonChars(
            card?.recent_conversation,
          );
          card_breakdown.prior_consultation_chars = safeJsonChars(
            card?.prior_consultation,
          );
          card_breakdown.entrusted_and_ready_chars =
            safeJsonChars(card?.entrusted_originals) +
            safeJsonChars(card?.insurance_clock) +
            safeJsonChars(card?.life_ledger) +
            safeJsonChars(card?.claim_evidence) +
            safeJsonChars(card?.active_claims) +
            safeJsonChars(card?.active_goal) +
            safeJsonChars(card?.this_turn_original_delivery);

          memory_chars +=
            card_breakdown.insurance_contracts_chars +
            card_breakdown.confirmed_facts_chars +
            safeJsonChars(card?.memory_status) +
            safeJsonChars(parsed?.customer_memory);

          recent_dialogue_chars += card_breakdown.recent_conversation_chars;
          prior_answers_chars +=
            card_breakdown.prior_consultation_chars +
            assistantTurnsChars(card?.recent_conversation);
          handoff_chars += card_breakdown.entrusted_and_ready_chars;

          const accounted =
            card_breakdown.insurance_contracts_chars +
            card_breakdown.confirmed_facts_chars +
            card_breakdown.recent_conversation_chars +
            card_breakdown.prior_consultation_chars +
            card_breakdown.entrusted_and_ready_chars +
            safeJsonChars(card?.relationship) +
            safeJsonChars(card?.note) +
            safeJsonChars(card?.schema_version) +
            safeJsonChars(card?.authority) +
            safeJsonChars(card?.delivery_mode) +
            safeJsonChars(card?.past_original_bytes_mode) +
            safeJsonChars(card?.memory_status);
          card_breakdown.other_card_fields_chars = Math.max(
            0,
            customer_card_chars - accounted,
          );

          const envelope = { ...parsed };
          delete envelope.key_customer_card;
          wholesale_envelope_chars += safeJsonChars(envelope);
          continue;
        }
        other_user_text_chars += text.length;
        continue;
      }

      if (type === "image" || type === "document") {
        const data = block?.source?.data ?? block?.data ?? "";
        const mediaType = String(
          block?.source?.media_type ?? block?.media_type ?? type,
        );
        const b64 = typeof data === "string" ? data : "";
        const payloadChars = b64.length;
        image_payload_chars += payloadChars;
        images.push({
          block_type: type,
          media_type: mediaType.slice(0, 64),
          count: 1,
          payload_chars: payloadChars,
          approx_bytes: estimateBase64Bytes(b64),
          sha256: b64 ? sha256Hex(b64) : null,
        });
      }
    }
  }

  let bodyJson = "";
  try {
    bodyJson = JSON.stringify(body ?? null);
  } catch {
    bodyJson = "";
  }

  const tools_chars = safeJsonChars(tools);
  const total_request_chars = bodyJson.length;
  const total_request_bytes = utf8Bytes(bodyJson);

  // Top-level accounting without double-counting card subfields into the sum.
  const accounted_top_chars =
    system_chars +
    question_chars +
    customer_card_chars +
    wholesale_envelope_chars +
    other_user_text_chars +
    image_payload_chars +
    tools_chars;

  const observation = {
    schema: KEY_CLAUDE_REQUEST_SIZE_OBSERVE_SCHEMA,
    recorded_at: new Date().toISOString(),
    vercel_env: "preview",
    section_chars: {
      system: system_chars,
      question: question_chars,
      customer_card: customer_card_chars,
      memory: memory_chars,
      recent_dialogue: recent_dialogue_chars,
      prior_answers: prior_answers_chars,
      handoff: handoff_chars,
      wholesale_envelope: wholesale_envelope_chars,
      other_user_text: other_user_text_chars,
      image_payload: image_payload_chars,
      tools: tools_chars,
    },
    card_breakdown,
    images: {
      count: images.length,
      total_payload_chars: image_payload_chars,
      total_approx_bytes: images.reduce(
        (sum, row) => sum + (Number(row.approx_bytes) || 0),
        0,
      ),
      items: images,
    },
    totals: {
      request_chars: total_request_chars,
      request_bytes: total_request_bytes,
      accounted_top_chars,
      unaccounted_chars: Math.max(0, total_request_chars - accounted_top_chars),
      message_count: messages.length,
      system_block_count: systemBlocks.length,
      tool_count: tools.length,
    },
    privacy_guard: {
      raw_prompt_text_present: false,
      image_bytes_present: false,
      api_key_present: false,
      auth_present: false,
    },
  };

  assertSafeKeyClaudeRequestSizeObservation(observation);
  return observation;
}

export function assertSafeKeyClaudeRequestSizeObservation(observation) {
  const s = JSON.stringify(observation ?? null);
  if (/sk-ant-|x-api-key|authorization|bearer\s+[a-z0-9]/i.test(s)) {
    throw new Error("REQUEST_SIZE_OBSERVE_LEAK:auth");
  }
  if (/data:image\/|base64,[A-Za-z0-9+/]{80,}/.test(s)) {
    throw new Error("REQUEST_SIZE_OBSERVE_LEAK:base64");
  }
  if (/"text"\s*:\s*"[^"]{200,}"/.test(s)) {
    throw new Error("REQUEST_SIZE_OBSERVE_LEAK:long_text");
  }
  return true;
}

/**
 * Preview-only console record. Never returns payload for customer SSE.
 * @returns {boolean} whether a log line was written
 */
export function emitKeyClaudeRequestSizeObservation(
  observation,
  env = process.env,
) {
  if (!shouldRecordKeyClaudeRequestSizeObserve(env)) return false;
  if (!observation || typeof observation !== "object") return false;
  assertSafeKeyClaudeRequestSizeObservation(observation);
  const line = {
    ...observation,
    vercel_env: String(env?.VERCEL_ENV ?? "preview"),
  };
  console.log(
    KEY_CLAUDE_REQUEST_SIZE_OBSERVE_LOG_TAG,
    JSON.stringify(line),
  );
  return true;
}
