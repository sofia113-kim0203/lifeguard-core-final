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
      timing: { claude_ms, parse_ms },
    };
  }
  return {
    ok: true,
    text: maxChars ? text.slice(0, maxChars) : text,
    model: body?.model ?? modelName,
    request_id: requestId,
    timing: { claude_ms, parse_ms },
  };
}

export async function generateLifeguardChatResponse({
  question,
  history = [],
  customerContextBlock = "",
  systemPrompt = LIFEGUARD_AGENT_SYSTEM_PROMPT,
  historyTurnLimit = HISTORY_TURN_LIMIT,
  historyContentMaxChars = HISTORY_CONTENT_MAX_CHARS,
  fetchImpl = fetch,
  env = process.env,
} = {}) {
  const trimmedQuestion = String(question ?? "").trim();
  const contextBlock = String(customerContextBlock ?? "").trim();
  const userContent = contextBlock
    ? `${contextBlock}\n\n[고객 질문]\n${trimmedQuestion}`
    : trimmedQuestion;
  const apiKey = resolveAnthropicApiKey(env);
  const modelName = resolveClaudeModel(env);
  if (!apiKey || !trimmedQuestion) {
    return {
      ok: false,
      text: LIFEGUARD_CHAT_FALLBACK,
      response_source: "lifeguard_chat_fallback",
      reason: !apiKey ? "ANTHROPIC_API_KEY_MISSING" : "EMPTY_QUESTION",
    };
  }
  try {
    const claudeResult = await callChatAnthropic({
      apiKey,
      modelName,
      system: systemPrompt,
      messages: buildMessagesFromHistory(history, userContent, {
        turnLimit: historyTurnLimit,
        contentMaxChars: historyContentMaxChars,
      }),
      maxTokens: LIFEGUARD_MAX_TOKENS,
      maxChars: LIFEGUARD_MAX_CHARS,
      fetchImpl,
    });
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
