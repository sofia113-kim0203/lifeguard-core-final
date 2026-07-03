/**
 * P3 v4 — Agent Tom: LLM-first home brain with internal routing + gap tool only.
 */
import { classifyConsultationIntent, hasInsuranceTopicSignal } from "./intentGateLayer.js";
import { buildCustomerContextBundle } from "./buildCustomerContextBundle.js";
import { matchP5BrainPilotQuestion } from "./p5BrainPilotQuestions.js";
import { resolveP5BrainPilotAnswer } from "./p5BrainStateAwareAnswer.js";
import { loadRawCustomerRecords, resolveActivePolicyCountFromUnified } from "./unifiedCustomerState.js";
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

async function runTomChatTurn({ question, history, fetchImpl, env, gi1Profile = false }) {
  const llm = await generateLifeguardChatResponse({
    question,
    history,
    fetchImpl,
    env,
    gi1Profile,
  });
  return {
    text: llm.text || LIFEGUARD_CHAT_FALLBACK,
    response_source: llm.response_source ?? "lifeguard_chat_fallback",
    llm_ok: llm.ok === true,
    chat_profile: llm.chat_profile ?? (gi1Profile ? "gi1" : "default"),
    max_chars_applied: llm.max_chars_applied ?? null,
  };
}

/** KEY-GI-1 R1 — General Knowledge Delegation to lifeguardChatCore (orchestrator path). */
export async function delegateGeneralKnowledgeChatTurn({
  question,
  history = [],
  fetchImpl = fetch,
  env = process.env,
} = {}) {
  return runTomChatTurn({ question, history, fetchImpl, env, gi1Profile: true });
}

export function shouldRunGeneralKnowledgeDelegation({
  question = "",
  consultationIntent = null,
  keyOrchestrator = false,
} = {}) {
  if (!keyOrchestrator) return false;
  if (!consultationIntent) return false;
  if (consultationIntent.general_knowledge === true) return true;
  return false;
}

export async function runHomeAgentTomTurn({
  question = "",
  history = [],
  userSupabase,
  customerId,
  customerContextBundle = null,
  unified = null,
  env = process.env,
  fetchImpl = fetch,
  startedAt = Date.now(),
} = {}) {
  const trimmedQuestion = normalizeQuestion(question);
  const conversationHistory = normalizeHistory(history);
  const consultationIntent = classifyConsultationIntent(trimmedQuestion);

  const pilotKey = matchP5BrainPilotQuestion(trimmedQuestion);
  if (pilotKey && userSupabase && customerId) {
    const customerContext =
      customerContextBundle ??
      (await buildCustomerContextBundle(userSupabase, customerId, {
        requestHistory: conversationHistory,
      }));
    const stateAnswer = resolveP5BrainPilotAnswer(pilotKey, trimmedQuestion, customerContext);
    const tomInternalRoute = TOM_INTERNAL_ROUTES.CHAT;
    const responseSource = stateAnswer.guarded
      ? "p5_brain_state_guarded"
      : "p5_brain_customer_state";
    const policyFields = resolveActivePolicyCountFromUnified(unified);
    return {
      text: stateAnswer.text,
      tomInternalRoute,
      consultationIntent,
      toolUsed: null,
      responseSource,
      factBundle: {
        question: trimmedQuestion,
        ...policyFields,
        policies: customerContext.policies ?? [],
        document_count: customerContext.documentCount ?? 0,
        memory_fact_count: customerContext.memoryFactCount ?? 0,
        customer_context_used: true,
        pilot_key: pilotKey,
        p5_brain_guarded: stateAnswer.guarded === true,
      },
      tomGapVoiceHandled: false,
      trace: {
        tom_internal_route: tomInternalRoute,
        consultation_intent: consultationIntent.intent,
        tool_used: null,
        agent: "home_agent_tom",
        p5_brain_pilot: pilotKey,
        p5_brain_guarded: stateAnswer.guarded === true,
        customer_context_used: true,
      },
    };
  }

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
    const policyFields = resolveActivePolicyCountFromUnified(unified);
    return {
      text: composeTomDeferMessage(trimmedQuestion, tomInternalRoute),
      tomInternalRoute,
      consultationIntent,
      toolUsed: null,
      responseSource: "tom_internal_defer",
      factBundle: { question: trimmedQuestion, ...policyFields, policies: [] },
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
  const chatPolicyFields = resolveActivePolicyCountFromUnified(unified);
  return {
    text: chatTurn.text,
    tomInternalRoute,
    consultationIntent,
    toolUsed: null,
    responseSource: chatTurn.response_source,
    factBundle: { question: trimmedQuestion, ...chatPolicyFields, policies: [] },
    tomGapVoiceHandled: false,
    trace: { ...baseTrace, tool_used: null, tom_ran: true, llm_ok: chatTurn.llm_ok },
  };
}
