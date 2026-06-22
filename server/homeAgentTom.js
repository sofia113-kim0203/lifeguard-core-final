/**
 * P3 v4 — Agent Tom: LLM-first home brain with internal routing + gap tool only.
 */
import { classifyConsultationIntent, hasInsuranceTopicSignal } from "./intentGateLayer.js";
import { loadRawCustomerRecords } from "./unifiedCustomerState.js";
import { ONE_BRAIN_SURFACES } from "./oneBrainResponseLayer.js";
import { runTomGapLightVoiceTurn, shouldUseTomGapLightPath } from "./tomGapLightPath.js";
import { generateLifeguardChatResponse, LIFEGUARD_CHAT_FALLBACK } from "./lifeguardChatCore.js";
import {
  HOME_HIGH_STAKES_DEFER_MESSAGE,
  hasHighStakesSignal,
  isCasualHomeQuestion,
  isConversationalInsuranceBridgeQuestion,
} from "./homeBrainRouter.js";

export const TOM_INTERNAL_ROUTES = {
  GAP_TOOL: "gap_tool",
  DEFER: "defer",
  CHAT: "chat",
};

export const INSURANCE_DEFER_WITHOUT_TOOL_MESSAGE =
  "그 부분은 지금 바로 숫자로 말씀드리기 어려워요. 보장내역서를 주시면 같이 확인해 볼게요.";

function normalizeQuestion(question = "") {
  return String(question ?? "").replace(/\s+/g, " ").trim();
}

function normalizeHistory(history = []) {
  if (!Array.isArray(history)) return [];
  return history
    .slice(-10)
    .map((turn) => ({
      role: turn?.role === "assistant" ? "assistant" : "user",
      content: String(turn?.content ?? turn?.message ?? "").trim(),
    }))
    .filter((turn) => turn.content);
}

/**
 * Tom-internal classification — must stay alive for falsy-0 (high-stakes → defer, not raw chat).
 */
export function resolveTomInternalRoute(question = "", consultationIntent = null) {
  const classification = consultationIntent ?? classifyConsultationIntent(question);
  const intent = classification?.intent ?? null;

  if (intent === "coverage_gap_check") {
    return TOM_INTERNAL_ROUTES.GAP_TOOL;
  }

  if (hasHighStakesSignal(question, classification)) {
    return TOM_INTERNAL_ROUTES.DEFER;
  }

  if (isConversationalInsuranceBridgeQuestion(question, classification)) {
    return TOM_INTERNAL_ROUTES.CHAT;
  }

  if (isCasualHomeQuestion(question, classification)) {
    return TOM_INTERNAL_ROUTES.CHAT;
  }

  if (hasInsuranceTopicSignal(question)) {
    return TOM_INTERNAL_ROUTES.DEFER;
  }

  return TOM_INTERNAL_ROUTES.DEFER;
}

export function composeTomDeferMessage(question = "", route = TOM_INTERNAL_ROUTES.DEFER) {
  if (hasHighStakesSignal(question)) {
    return HOME_HIGH_STAKES_DEFER_MESSAGE;
  }
  if (route === TOM_INTERNAL_ROUTES.DEFER && hasInsuranceTopicSignal(question)) {
    return INSURANCE_DEFER_WITHOUT_TOOL_MESSAGE;
  }
  return HOME_HIGH_STAKES_DEFER_MESSAGE;
}

async function runGapAuditTool({
  question,
  intentClassification,
  userSupabase,
  customerId,
  fetchImpl,
  env,
  startedAt,
}) {
  const raw = await loadRawCustomerRecords(userSupabase, customerId);
  const policies = raw?.policies ?? [];
  return runTomGapLightVoiceTurn({
    question,
    intentClassification,
    surface: ONE_BRAIN_SURFACES.HOME,
    policies,
    fetchImpl,
    env,
    handler: "homeAgentTom.gap_audit_tool",
    startedAt,
  });
}

async function runTomChatTurn({ question, history, fetchImpl, env }) {
  const llm = await generateLifeguardChatResponse({
    question,
    history,
    fetchImpl,
    env,
  });
  return {
    text: llm.text || LIFEGUARD_CHAT_FALLBACK,
    response_source: llm.response_source ?? "lifeguard_chat_fallback",
    llm_ok: llm.ok === true,
  };
}

export async function runHomeAgentTomTurn({
  question = "",
  history = [],
  userSupabase,
  customerId,
  env = process.env,
  fetchImpl = fetch,
  startedAt = Date.now(),
} = {}) {
  const trimmedQuestion = normalizeQuestion(question);
  const conversationHistory = normalizeHistory(history);
  const consultationIntent = classifyConsultationIntent(trimmedQuestion);
  const tomInternalRoute = resolveTomInternalRoute(trimmedQuestion, consultationIntent);

  const baseTrace = {
    tom_internal_route: tomInternalRoute,
    consultation_intent: consultationIntent.intent,
    tool_used: null,
    agent: "home_agent_tom",
  };

  if (
    tomInternalRoute === TOM_INTERNAL_ROUTES.GAP_TOOL &&
    shouldUseTomGapLightPath(consultationIntent, env)
  ) {
    const lightTurn = await runGapAuditTool({
      question: trimmedQuestion,
      intentClassification: consultationIntent,
      userSupabase,
      customerId,
      fetchImpl,
      env,
      startedAt,
    });
    return {
      text: lightTurn.tomApply.text,
      tomInternalRoute,
      consultationIntent,
      toolUsed: "gap_audit",
      tomGapLightPath: true,
      tomTurnMs: lightTurn.elapsed_ms,
      skippedStages: lightTurn.skipped_stages,
      tomVoiceTrace: lightTurn.tomApply.trace,
      responseSource: lightTurn.tomApply.trace?.response_source ?? "tom_gap_tool",
      factBundle: lightTurn.factBundle,
      tomGapVoiceHandled: true,
      trace: { ...baseTrace, tool_used: "gap_audit", tom_ran: true },
    };
  }

  if (tomInternalRoute === TOM_INTERNAL_ROUTES.DEFER) {
    return {
      text: composeTomDeferMessage(trimmedQuestion, tomInternalRoute),
      tomInternalRoute,
      consultationIntent,
      toolUsed: null,
      responseSource: "tom_internal_defer",
      factBundle: { question: trimmedQuestion, policy_count: 0, policies: [] },
      tomGapVoiceHandled: false,
      trace: { ...baseTrace, tool_used: null, tom_ran: false },
    };
  }

  const chatTurn = await runTomChatTurn({
    question: trimmedQuestion,
    history: conversationHistory,
    fetchImpl,
    env,
  });
  return {
    text: chatTurn.text,
    tomInternalRoute,
    consultationIntent,
    toolUsed: null,
    responseSource: chatTurn.response_source,
    factBundle: { question: trimmedQuestion, policy_count: 0, policies: [] },
    tomGapVoiceHandled: false,
    trace: { ...baseTrace, tool_used: null, tom_ran: true, llm_ok: chatTurn.llm_ok },
  };
}
