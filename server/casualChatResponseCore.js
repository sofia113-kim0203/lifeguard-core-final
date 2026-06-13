/**
 * Casual chat — direct Claude natural response (no insurance analysis pipeline).
 */
import { resolveAnthropicApiKey } from "./claudeGroundedExecutionCore.js";
import { resolveClaudeModel } from "./policyTermsQaCore.js";

export const CASUAL_CHAT_FALLBACK =
  "네, 편하게 말씀해 주세요. 필요하시면 보험 상담도 도와드릴게요.";

const CASUAL_MAX_TOKENS = 256;
const CASUAL_MAX_CHARS = 400;

const CASUAL_SYSTEM_PROMPT = [
  "You are a warm, natural Korean-speaking assistant for a life insurance customer app.",
  "The user is making casual small talk (greeting, thanks, mood check, light chat).",
  "Reply in Korean only, 1-3 short sentences, conversational and empathetic.",
  "Do NOT start insurance analysis, coverage gap review, underwriting, recommendations, or policy design.",
  "Do NOT mention analyzing their profile, policies, or background jobs.",
  "Do NOT invent customer policies, health data, or premiums.",
  "If appropriate, you may briefly note that insurance help is available when they want it.",
].join(" ");

async function callCasualAnthropic({ apiKey, modelName, question, fetchImpl = fetch }) {
  const response = await fetchImpl("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: modelName,
      max_tokens: CASUAL_MAX_TOKENS,
      system: CASUAL_SYSTEM_PROMPT,
      messages: [{ role: "user", content: String(question ?? "").trim() }],
    }),
  });

  const requestId =
    response.headers.get("request-id") ?? response.headers.get("x-request-id") ?? null;
  const rawBody = await response.text();
  let body = {};
  try {
    body = rawBody ? JSON.parse(rawBody) : {};
  } catch {
    body = {};
  }

  if (!response.ok) {
    return {
      ok: false,
      http_status: response.status,
      error_type: body?.error?.type ?? "api_error",
      error_message: body?.error?.message ?? `Claude API error (${response.status})`,
      request_id: requestId,
    };
  }

  const text = Array.isArray(body?.content)
    ? body.content
        .filter((block) => block?.type === "text")
        .map((block) => block.text)
        .join("\n")
        .trim()
    : "";

  if (!text) {
    return {
      ok: false,
      http_status: 502,
      error_type: "empty_response",
      error_message: "Claude returned empty response.",
      request_id: requestId,
    };
  }

  return {
    ok: true,
    text: text.slice(0, CASUAL_MAX_CHARS),
    model: body?.model ?? modelName,
    response_id: body?.id ?? null,
    request_id: requestId,
  };
}

export async function generateCasualChatResponse({
  question,
  fetchImpl = fetch,
  env = process.env,
} = {}) {
  const trimmedQuestion = String(question ?? "").trim();
  const apiKey = resolveAnthropicApiKey(env);
  const modelName = resolveClaudeModel(env);

  if (!apiKey) {
    return {
      text: CASUAL_CHAT_FALLBACK,
      response_source: "casual_fallback",
      reason: "ANTHROPIC_API_KEY_MISSING",
      model: null,
      request_id: null,
    };
  }

  try {
    const claudeResult = await callCasualAnthropic({
      apiKey,
      modelName,
      question: trimmedQuestion,
      fetchImpl,
    });

    if (claudeResult.ok) {
      return {
        text: claudeResult.text,
        response_source: "claude",
        reason: null,
        model: claudeResult.model,
        request_id: claudeResult.request_id,
        response_id: claudeResult.response_id,
      };
    }

    return {
      text: CASUAL_CHAT_FALLBACK,
      response_source: "casual_fallback",
      reason: claudeResult.error_type ?? "CLAUDE_API_ERROR",
      model: modelName,
      request_id: claudeResult.request_id ?? null,
    };
  } catch (error) {
    return {
      text: CASUAL_CHAT_FALLBACK,
      response_source: "casual_fallback",
      reason: "network_error",
      model: modelName,
      request_id: null,
      error_message: error instanceof Error ? error.message : "casual_chat_failed",
    };
  }
}
