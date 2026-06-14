/**
 * Casual chat — direct Claude natural response (no insurance analysis pipeline).
 * Phase 32 (Direction 1) — history-aware: recent conversation turns are passed to the model
 * so replies follow the flow, do not re-greet every turn, and everyday chat works naturally.
 */
import { resolveAnthropicApiKey } from "./claudeGroundedExecutionCore.js";
import { resolveClaudeModel } from "./policyTermsQaCore.js";
export const CASUAL_CHAT_FALLBACK =
  "네, 편하게 말씀해 주세요. 필요하시면 보험 상담도 도와드릴게요.";
const CASUAL_MAX_TOKENS = 256;
const CASUAL_MAX_CHARS = 400;
const HISTORY_TURN_LIMIT = 10;
const HISTORY_CONTENT_MAX_CHARS = 1500;
const CASUAL_SYSTEM_PROMPT = [
  "You are 보험 주치의, a warm, natural Korean-speaking assistant for an insurance customer, in an ONGOING conversation.",
  "Chat naturally in Korean — everyday small talk is welcome.",
  "This is a continuing chat: do NOT greet again (no '안녕하세요') when earlier messages already exist; just respond and follow the flow.",
  "Keep replies short and conversational (1-4 sentences).",
  "Do NOT launch into insurance analysis, coverage gap review, underwriting, or recommendations unless asked.",
  "Do NOT invent customer policies, health data, or premiums.",
  "You may briefly offer insurance help when it fits naturally.",
].join(" ");
const GROUNDED_MAX_TOKENS = 700;
const GROUNDED_MAX_CHARS = 1500;
const GROUNDED_SYSTEM_PROMPT = [
  "You are 보험 주치의, the customer's personal Korean-speaking insurance advisor, in an ONGOING conversation.",
  "Respond naturally and conversationally in Korean, following the flow of the chat.",
  "This is a continuing chat: do NOT greet again (no '안녕하세요, ~님') when earlier messages already exist; just answer.",
  "Use ONLY the customer facts provided as the ground truth about this specific customer; never guess or invent customer data. If a fact is not present, say it is not registered yet (등록된 정보가 없습니다).",
  "Everyday or casual remarks may be answered casually; when asked about insurance, coverage, or health, ground strictly in the provided facts.",
  "Do NOT recite a fixed analysis script (보장 분석 / 인수 심사 / 추천 / 설계안) unless the user explicitly asks for that analysis.",
  "Do NOT make underwriting approval/decline decisions, and do NOT tell the user to buy or cancel a specific product. You may explain options and suggest consulting a human advisor, but give no binding verdicts.",
  "Be concise (usually 1-5 sentences); answer simple facts plainly first.",
].join(" ");
function buildMessagesFromHistory(history, finalUserContent) {
  const seq = [];
  const turns = Array.isArray(history) ? history.slice(-HISTORY_TURN_LIMIT) : [];
  for (const turn of turns) {
    const role = turn?.role === "assistant" ? "assistant" : turn?.role === "user" ? "user" : null;
    let content = String(turn?.content ?? "").trim();
    if (!role || !content) continue;
    if (content.length > HISTORY_CONTENT_MAX_CHARS) content = content.slice(0, HISTORY_CONTENT_MAX_CHARS);
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
    text: maxChars ? text.slice(0, maxChars) : text,
    model: body?.model ?? modelName,
    response_id: body?.id ?? null,
    request_id: requestId,
  };
}
export async function generateCasualChatResponse({
  question,
  history = [],
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
    const claudeResult = await callChatAnthropic({
      apiKey,
      modelName,
      system: CASUAL_SYSTEM_PROMPT,
      messages: buildMessagesFromHistory(history, trimmedQuestion),
      maxTokens: CASUAL_MAX_TOKENS,
      maxChars: CASUAL_MAX_CHARS,
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
export async function generateGroundedChatResponse({
  question,
  groundingText = "",
  history = [],
  fetchImpl = fetch,
  env = process.env,
} = {}) {
  const trimmedQuestion = String(question ?? "").trim();
  const apiKey = resolveAnthropicApiKey(env);
  const modelName = resolveClaudeModel(env);
  if (!apiKey || !trimmedQuestion) {
    return {
      ok: false,
      text: "",
      response_source: "grounded_fallback",
      reason: !apiKey ? "ANTHROPIC_API_KEY_MISSING" : "EMPTY_QUESTION",
      model: null,
      request_id: null,
    };
  }
  const facts = groundingText && groundingText.trim() ? groundingText.trim() : "(등록된 고객 정보가 거의 없습니다.)";
  const userContent = [
    "다음은 이 고객에 대해 시스템에 등록된 사실입니다. 이 사실만을 근거로 답하세요.",
    "",
    "[고객 사실]",
    facts,
    "",
    "[고객 질문]",
    trimmedQuestion,
  ].join("\n");
  try {
    const claudeResult = await callChatAnthropic({
      apiKey,
      modelName,
      system: GROUNDED_SYSTEM_PROMPT,
      messages: buildMessagesFromHistory(history, userContent),
      maxTokens: GROUNDED_MAX_TOKENS,
      maxChars: GROUNDED_MAX_CHARS,
      fetchImpl,
    });
    if (claudeResult.ok) {
      return {
        ok: true,
        text: claudeResult.text,
        response_source: "claude_grounded",
        reason: null,
        model: claudeResult.model,
        request_id: claudeResult.request_id,
        response_id: claudeResult.response_id,
      };
    }
    return {
      ok: false,
      text: "",
      response_source: "grounded_fallback",
      reason: claudeResult.error_type ?? "CLAUDE_API_ERROR",
      model: modelName,
      request_id: claudeResult.request_id ?? null,
    };
  } catch (error) {
    return {
      ok: false,
      text: "",
      response_source: "grounded_fallback",
      reason: "network_error",
      model: modelName,
      request_id: null,
      error_message: error instanceof Error ? error.message : "grounded_chat_failed",
    };
  }
}
