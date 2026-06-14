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

const GROUNDED_MAX_TOKENS = 700;
const GROUNDED_MAX_CHARS = 1500;

const GROUNDED_SYSTEM_PROMPT = [
  "You are a Korean-speaking insurance consultation assistant for a life insurance customer app.",
  "Answer the customer's question using ONLY the registered customer facts provided below.",
  "If there are no registered facts or the facts do not cover the question, reply exactly: 등록된 정보가 없습니다",
  "Reply in Korean only, concise and direct, answering the actual question asked.",
  "Do NOT use a fixed analysis script or template phrasing.",
  "Do NOT push recommendations or urge the customer to buy or change policies.",
  "Do NOT judge underwriting approval or rejection.",
  "Do NOT invent customer policies, health data, premiums, or any facts not in the provided grounding.",
].join(" ");

async function callGroundedAnthropic({
  apiKey,
  modelName,
  question,
  groundingText,
  fetchImpl = fetch,
}) {
  const trimmedQuestion = String(question ?? "").trim();
  const trimmedGrounding = String(groundingText ?? "").trim();
  const userContent = [
    "등록된 고객 사실:",
    trimmedGrounding || "(없음)",
    "",
    "고객 질문:",
    trimmedQuestion,
  ].join("\n");

  const response = await fetchImpl("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: modelName,
      max_tokens: GROUNDED_MAX_TOKENS,
      system: GROUNDED_SYSTEM_PROMPT,
      messages: [{ role: "user", content: userContent }],
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
    text: text.slice(0, GROUNDED_MAX_CHARS),
    model: body?.model ?? modelName,
    response_id: body?.id ?? null,
    request_id: requestId,
  };
}

export async function generateGroundedChatResponse({
  question,
  groundingText,
  fetchImpl = fetch,
  env = process.env,
} = {}) {
  const trimmedQuestion = String(question ?? "").trim();
  const apiKey = resolveAnthropicApiKey(env);
  const modelName = resolveClaudeModel(env);

  if (!apiKey) {
    return {
      ok: false,
      text: "",
      response_source: "grounded_fallback",
    };
  }

  try {
    const claudeResult = await callGroundedAnthropic({
      apiKey,
      modelName,
      question: trimmedQuestion,
      groundingText,
      fetchImpl,
    });

    if (claudeResult.ok) {
      return {
        ok: true,
        text: claudeResult.text,
        response_source: "claude_grounded",
      };
    }

    return {
      ok: false,
      text: "",
      response_source: "grounded_fallback",
    };
  } catch {
    return {
      ok: false,
      text: "",
      response_source: "grounded_fallback",
    };
  }
}
