/**
 * Casual chat — direct Claude natural response (no insurance analysis pipeline).
 * Phase 32 (Direction 1) — history-aware: recent conversation turns are passed to the model
 * so replies follow the flow, do not re-greet every turn, and everyday chat works naturally.
 */
import { resolveAnthropicApiKey } from "./claudeGroundedExecutionCore.js";
import { resolveClaudeModel } from "./policyTermsQaCore.js";
export const CASUAL_CHAT_FALLBACK =
  "음, 그건 제가 여기서는 딱 잘라 말하기 어렵네요. 다른 얘기도 편하게 이어가도 돼요.";
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
  "Do NOT deflect with \"필요하시면 보험 상담도 도와드릴게요\" or push insurance on everyday small talk.",
  "Do NOT invent customer policies, health data, or premiums.",
].join(" ");
const GROUNDED_MAX_TOKENS = 700;
const GROUNDED_MAX_CHARS = 1500;
const GROUNDED_SYSTEM_PROMPT = [
  "You are 보험 주치의, the customer's personal Korean-speaking 1차 보험 설계사 (first-line insurance advisor), in an ONGOING conversation.",
  "Respond naturally and conversationally in Korean, following the flow of the chat.",
  "This is a continuing chat: do NOT greet again (no '안녕하세요, ~님') when earlier messages already exist; just answer.",
  "First understand what the customer actually MEANS, not just the surface words. e.g. '내 보험에 추가할 거 있어?' means '어떤 보장을 더 가입하면 좋을지' (a recommendation request), NOT a request for the number of policies.",
  "Use ONLY the provided customer facts and analysis as the ground truth about this customer; never invent customer data, product names, premiums, or numbers. If something is not provided, say it is not registered yet (등록된 정보가 없습니다).",
  "When 보장 공백 / 우선 추천 / 인수 유의 material is provided, ACT as the first-line advisor: give concrete, prioritized guidance — which coverage areas are missing or weak, and what to consider adding first and why — based strictly on that material. Lead with the actual advice; do not deflect to a human instead of answering.",
  "Everyday or casual remarks may be answered casually; for insurance/coverage/health questions, ground strictly in the provided facts and analysis.",
  "Do NOT dump the full fixed analysis script (보장분석+인수심사+추천+설계안 all at once) unless the user explicitly asks for the complete analysis; answer the specific question that was asked.",
  "You give first-line advice, not binding decisions: do NOT state a final underwriting approval/decline. You MAY add ONE short closing note that exact enrollment conditions and the final 청약 are confirmed with a human 설계사 — but that note is a brief tail, never a replacement for giving the advice.",
  "Be concise and warm (usually 2-6 sentences): answer the core question first, then the short confirmation note only if relevant.",
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
const TOM_REGULATED_MAX_TOKENS = 512;
const TOM_REGULATED_MAX_CHARS = 800;
const TOM_REGULATED_SYSTEM_PROMPT = [
  "You are Tom (보험 주치의) speaking directly to the customer in warm, natural Korean.",
  "You translate ONLY the pre-computed [Tom decision] — do not add facts, won amounts, policy counts, premiums, or sufficiency judgments.",
  "If the decision says HOLD or lists unknown fields, you must NOT fill them in or assert 부족/충분.",
  "Follow voice_order in the decision. For hold turns, start with a brief friendly opener like \"잠깐 볼게요.\"",
  "Never use stiff 상담사 phrases such as \"말씀드리기 어렵습니다\" or inventory dumps (건수, 보험료 합계, 문서 수).",
  "Use ONLY [Tom decision] and [Evidence audit]. 2-4 warm sentences. No menu redirects.",
].join(" ");

export async function generateTomRegulatedChatResponse({
  question,
  regulatedEvidence = "",
  thinkingDecision = "",
  holdJudgment = true,
  topicLabel = "해당 보장",
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
      response_source: "tom_regulated_fallback",
      reason: !apiKey ? "ANTHROPIC_API_KEY_MISSING" : "EMPTY_QUESTION",
      model: null,
      request_id: null,
    };
  }
  const evidence =
    regulatedEvidence && String(regulatedEvidence).trim()
      ? String(regulatedEvidence).trim()
      : "(no regulated evidence provided)";
  const decision =
    thinkingDecision && String(thinkingDecision).trim()
      ? String(thinkingDecision).trim()
      : "(no Tom decision provided)";
  const userContent = [
    "[Evidence audit — read-only context; do not add fields]",
    evidence,
    "",
    "[Tom decision — translate this; do not change judgment]",
    decision,
    "",
    `judgment_hold_required: ${holdJudgment === true}`,
    `topic: ${topicLabel}`,
    "",
    "[Customer question]",
    trimmedQuestion,
  ].join("\n");
  try {
    const claudeResult = await callChatAnthropic({
      apiKey,
      modelName,
      system: TOM_REGULATED_SYSTEM_PROMPT,
      messages: buildMessagesFromHistory(history, userContent),
      maxTokens: TOM_REGULATED_MAX_TOKENS,
      maxChars: TOM_REGULATED_MAX_CHARS,
      fetchImpl,
    });
    if (claudeResult.ok) {
      return {
        ok: true,
        text: claudeResult.text,
        response_source: "tom_regulated_claude",
        reason: null,
        model: claudeResult.model,
        request_id: claudeResult.request_id,
        response_id: claudeResult.response_id,
      };
    }
    return {
      ok: false,
      text: "",
      response_source: "tom_regulated_fallback",
      reason: claudeResult.error_type ?? "CLAUDE_API_ERROR",
      model: modelName,
      request_id: claudeResult.request_id ?? null,
    };
  } catch (error) {
    return {
      ok: false,
      text: "",
      response_source: "tom_regulated_fallback",
      reason: "network_error",
      model: modelName,
      request_id: null,
      error_message: error instanceof Error ? error.message : "tom_regulated_chat_failed",
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
