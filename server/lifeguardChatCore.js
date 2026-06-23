/**
 * P4-A — LIFEGUARD layer-1 chat (natural conversation, contextual insurance bridge, no deflection).
 */
import { resolveAnthropicApiKey } from "./claudeGroundedExecutionCore.js";
import { resolveClaudeModel } from "./policyTermsQaCore.js";

export const LIFEGUARD_CHAT_FALLBACK =
  "음, 그건 제가 여기서는 딱 잘라 말하기 어렵네요. 다른 얘기도 편하게 이어가도 돼요.";

const LIFEGUARD_MAX_TOKENS = 512;
const LIFEGUARD_MAX_CHARS = 600;
const HISTORY_TURN_LIMIT = 10;
const HISTORY_CONTENT_MAX_CHARS = 1500;

const LIFEGUARD_AGENT_SYSTEM_PROMPT = [
  "You are LIFEGUARD — one warm, natural Korean-speaking person the customer talks to.",
  "Answer like a thoughtful friend who remembers them: food, family outings, identity, hospitals, insurance — anything goes.",
  "This is an ongoing chat: do NOT re-greet every turn; follow the conversation flow.",
  "Never deflect with phrases like \"필요하시면 보험 상담도 도와드릴게요\", \"보험 상담도 가능합니다\", or \"보험 이야기 해볼까요\".",
  "Do NOT push insurance when the user is clearly on everyday topics (e.g. restaurants, travel, small talk). Ask natural follow-ups instead.",
  "When the user shares a medical event (surgery, hospitalization, diagnosis) or asks if they can receive insurance money, you MAY gently connect to insurance ONLY if it fits — e.g. \"실손이나 입원일당 대상일 수 있어요. 가입 내역 한번 볼까요?\" — never assert payout without evidence.",
  "When the user asks about tax, inheritance, legal, or corporate finance with numbers: honestly defer — you cannot calculate or decide here.",
  "Do NOT invent customer policy counts, premiums, coverage amounts, insurer names, or tax numbers.",
  "Do NOT mention internal engines, tools, Gap, Coverage Gap, Recommendation Engine, Design Engine, Customer Analysis, 보장분석, 추천엔진, 보험 분석 엔진, audit, Tom, or pipeline names.",
  "If asked who you are: you are LIFEGUARD, the customer's insurance partner — here to talk and help honestly.",
  "Never use emojis, emoticons, or exclamation-heavy cheerfulness. Never prefix replies with \"LIFEGUARD:\".",
  "Write like a calm consultation transcript: plain Korean sentences, natural line breaks, trustworthy tone (not chatbot stickers).",
  "Keep replies conversational (1-5 sentences). Answer directly or ask a natural follow-up when helpful — never forced.",
].join(" ");

function buildMessagesFromHistory(history, finalUserContent, { turnLimit, contentMaxChars } = {}) {
  const seq = [];
  const maxTurns = turnLimit ?? HISTORY_TURN_LIMIT;
  const maxChars = contentMaxChars ?? HISTORY_CONTENT_MAX_CHARS;
  const turns = Array.isArray(history) ? history.slice(-maxTurns) : [];
  for (const turn of turns) {
    const role = turn?.role === "assistant" ? "assistant" : turn?.role === "user" ? "user" : null;
    let content = String(turn?.content ?? turn?.message ?? "").trim();
    if (!role || !content) continue;
    if (content.length > maxChars) content = content.slice(0, maxChars);
    if (seq.length && seq[seq.length - 1].role === role) {
      seq[seq.length - 1].content += `\n${content}`;
    } else {
      seq.push({ role, content });
    }
  }
  const finalContent = String(finalUserContent ?? "").trim();
  if (seq.length && seq[seq.length - 1].role === "user") {
    seq[seq.length - 1].content += `\n${finalContent}`;
  } else {
    seq.push({ role: "user", content: finalContent });
  }
  while (seq.length && seq[0].role === "assistant") seq.shift();
  return seq;
}

function parseAnthropicSseChunk(buffer) {
  const events = [];
  const lines = buffer.split("\n");
  let eventName = "message";
  for (const line of lines) {
    if (line.startsWith("event:")) {
      eventName = line.slice(6).trim();
      continue;
    }
    if (!line.startsWith("data:")) continue;
    const payload = line.slice(5).trim();
    if (!payload || payload === "[DONE]") continue;
    try {
      events.push({ eventName, data: JSON.parse(payload) });
    } catch {
      // ignore malformed SSE chunks
    }
  }
  return events;
}

async function callChatAnthropic({ apiKey, modelName, system, messages, maxTokens, maxChars, fetchImpl = fetch }) {
  const requestStartedAt = Date.now();
  const response = await fetchImpl("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: modelName,
      max_tokens: maxTokens,
      system,
      messages,
    }),
  });
  const claude_ms = Math.max(0, Date.now() - requestStartedAt);
  const requestId =
    response.headers.get("request-id") ?? response.headers.get("x-request-id") ?? null;
  const parseStartedAt = Date.now();
  const rawBody = await response.text();
  let body = {};
  try {
    body = rawBody ? JSON.parse(rawBody) : {};
  } catch {
    body = {};
  }
  const text = (body?.content ?? [])
    .filter((block) => block?.type === "text")
    .map((block) => block.text)
    .join("")
    .trim();
  const parse_ms = Math.max(0, Date.now() - parseStartedAt);
  if (!response.ok) {
    return {
      ok: false,
      error_type: body?.error?.type ?? "CLAUDE_API_ERROR",
      request_id: requestId,
      timing: { claude_ms, parse_ms, first_token_ms: 0 },
    };
  }
  return {
    ok: true,
    text: maxChars ? text.slice(0, maxChars) : text,
    model: body?.model ?? modelName,
    request_id: requestId,
    timing: { claude_ms, parse_ms, first_token_ms: claude_ms > 0 ? claude_ms : 0 },
  };
}

async function streamChatAnthropic({
  apiKey,
  modelName,
  system,
  messages,
  maxTokens,
  maxChars,
  fetchImpl = fetch,
  onDelta = null,
  onFirstToken = null,
} = {}) {
  const requestStartedAt = Date.now();
  let firstTokenAt = null;
  let fullText = "";
  let truncated = false;

  const response = await fetchImpl("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: modelName,
      max_tokens: maxTokens,
      stream: true,
      system,
      messages,
    }),
  });

  const requestId =
    response.headers.get("request-id") ?? response.headers.get("x-request-id") ?? null;

  if (!response.ok || !response.body) {
    const rawBody = await response.text().catch(() => "");
    let body = {};
    try {
      body = rawBody ? JSON.parse(rawBody) : {};
    } catch {
      body = {};
    }
    return {
      ok: false,
      error_type: body?.error?.type ?? "CLAUDE_API_ERROR",
      request_id: requestId,
      timing: {
        claude_ms: Math.max(0, Date.now() - requestStartedAt),
        parse_ms: 0,
        first_token_ms: 0,
      },
    };
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let splitAt = buffer.indexOf("\n\n");
    while (splitAt >= 0) {
      const chunk = buffer.slice(0, splitAt);
      buffer = buffer.slice(splitAt + 2);
      splitAt = buffer.indexOf("\n\n");

      for (const event of parseAnthropicSseChunk(chunk)) {
        if (event.data?.type !== "content_block_delta") continue;
        if (event.data?.delta?.type !== "text_delta") continue;
        const piece = String(event.data.delta.text ?? "");
        if (!piece) continue;

        if (!firstTokenAt) {
          firstTokenAt = Date.now();
          onFirstToken?.(Math.max(0, firstTokenAt - requestStartedAt));
        }

        if (maxChars && fullText.length >= maxChars) {
          truncated = true;
          continue;
        }

        const allowed = maxChars ? piece.slice(0, maxChars - fullText.length) : piece;
        fullText += allowed;
        onDelta?.(allowed);
        if (maxChars && fullText.length >= maxChars) truncated = true;
      }
    }
  }

  const claude_ms = Math.max(0, Date.now() - requestStartedAt);
  const first_token_ms = firstTokenAt ? Math.max(0, firstTokenAt - requestStartedAt) : 0;

  return {
    ok: true,
    text: fullText.trim(),
    model: modelName,
    request_id: requestId,
    truncated,
    timing: { claude_ms, parse_ms: 0, first_token_ms },
  };
}

export async function generateLifeguardChatResponse({
  question,
  history = [],
  customerContextBlock = "",
  systemPrompt = LIFEGUARD_AGENT_SYSTEM_PROMPT,
  historyTurnLimit = HISTORY_TURN_LIMIT,
  historyContentMaxChars = HISTORY_CONTENT_MAX_CHARS,
  maxTokens = LIFEGUARD_MAX_TOKENS,
  maxChars = LIFEGUARD_MAX_CHARS,
  modelName = null,
  streamHandlers = null,
  fetchImpl = fetch,
  env = process.env,
} = {}) {
  const trimmedQuestion = String(question ?? "").trim();
  const contextBlock = String(customerContextBlock ?? "").trim();
  const userContent = contextBlock
    ? `${contextBlock}\n\n[고객 질문]\n${trimmedQuestion}`
    : trimmedQuestion;
  const apiKey = resolveAnthropicApiKey(env);
  const resolvedModelName = modelName ?? resolveClaudeModel(env);
  if (!apiKey || !trimmedQuestion) {
    return {
      ok: false,
      text: LIFEGUARD_CHAT_FALLBACK,
      response_source: "lifeguard_chat_fallback",
      reason: !apiKey ? "ANTHROPIC_API_KEY_MISSING" : "EMPTY_QUESTION",
    };
  }
  try {
    const messages = buildMessagesFromHistory(history, userContent, {
      turnLimit: historyTurnLimit,
      contentMaxChars: historyContentMaxChars,
    });
    const claudeArgs = {
      apiKey,
      modelName: resolvedModelName,
      system: systemPrompt,
      messages,
      maxTokens,
      maxChars,
      fetchImpl,
    };
    const claudeResult =
      streamHandlers?.onDelta || streamHandlers?.onFirstToken
        ? await streamChatAnthropic({
            ...claudeArgs,
            onDelta: streamHandlers?.onDelta ?? null,
            onFirstToken: streamHandlers?.onFirstToken ?? null,
          })
        : await callChatAnthropic(claudeArgs);
    if (claudeResult.ok && claudeResult.text) {
      return {
        ok: true,
        text: claudeResult.text,
        response_source: "lifeguard_claude",
        reason: null,
        model: claudeResult.model,
        request_id: claudeResult.request_id,
        timing: claudeResult.timing ?? null,
      };
    }
    return {
      ok: false,
      text: LIFEGUARD_CHAT_FALLBACK,
      response_source: "lifeguard_chat_fallback",
      reason: claudeResult.error_type ?? "CLAUDE_API_ERROR",
      timing: claudeResult.timing ?? null,
    };
  } catch {
    return {
      ok: false,
      text: LIFEGUARD_CHAT_FALLBACK,
      response_source: "lifeguard_chat_fallback",
      reason: "network_error",
    };
  }
}
