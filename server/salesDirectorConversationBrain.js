/**
 * P6-2B-2 / P6-2B-3 / P7-PERSONA — Sales Director Conversation + Free Thinking.
 */
import { TOM_INTERNAL_ROUTES, INSURANCE_DEFER_WITHOUT_TOOL_MESSAGE } from "./homeAgentTom.js";
import { composeSalesDirectorFreeThinkingAnswer } from "./salesDirectorFreeThinking.js";
import { resolveActivePolicyCountFromUnified } from "./unifiedCustomerState.js";
import { markLatencyMs, mergeFreeThinkingLatency } from "./salesDirectorLatencyAudit.js";
import {
  SALES_DIRECTOR_PERSONA_ID,
  CONVERSATION_BRAIN_TOPICS,
  buildPersonaFollowUpQuestion,
  buildSituationFrame,
  buildExplanationFrame,
  buildJudgmentFrame,
  buildTrustMemoryAcknowledgment,
  buildTrustReassurance,
  composeTrustedAdvisorTurn,
  inferCustomerIntent,
  violatesMemoryValueRepetition,
} from "./salesDirectorPersona.js";

export { CONVERSATION_BRAIN_TOPICS };

const FORBIDDEN_OPENING =
  /^(그\s*부분은|확인\s*어렵|판단\s*어렵|모르겠|잘\s*모르)/;

const DEAD_END_DEFER =
  /숫자로\s*말씀드리기\s*어려|보장내역서를\s*주시면\s*같이\s*확인해\s*볼게요\.?\s*$/;

function normalizeQuestion(question = "") {
  return String(question ?? "")
    .replace(/\s+/g, " ")
    .replace(/[?!.?！？。]/g, "")
    .trim()
    .toLowerCase();
}

export function hasCustomerInsuranceReadiness(loadedContext = null, customerContextBundle = null) {
  const policies = customerContextBundle?.policies ?? [];
  return loadedContext?.policies === "present" && policies.length > 0;
}

export function matchConversationBrainTopic(question = "") {
  const q = normalizeQuestion(question);
  if (!q) return null;

  if (/암\s*보장|암보장|암\s*담보|암\s*관련|암보험/.test(q)) {
    return CONVERSATION_BRAIN_TOPICS.CANCER_COVERAGE;
  }
  if (/보험료.*(부담|비싼|높)/.test(q)) {
    return CONVERSATION_BRAIN_TOPICS.PREMIUM_BURDEN;
  }
  if (/내\s*보험.*(괜찮|충분|부족)|보험.*(괜찮|충분|부족)/.test(q)) {
    return CONVERSATION_BRAIN_TOPICS.ADEQUACY;
  }

  return null;
}

export function violatesForbiddenOpening(text = "") {
  const firstLine = String(text ?? "")
    .trim()
    .split(/\n/)[0]
    ?.trim();
  return FORBIDDEN_OPENING.test(firstLine ?? "");
}

export function isDeadEndDeferResponse(text = "") {
  const normalized = String(text ?? "").trim();
  if (normalized === INSURANCE_DEFER_WITHOUT_TOOL_MESSAGE.trim()) return true;
  return DEAD_END_DEFER.test(normalized);
}

export function hasConversationContinuation(text = "") {
  return /[?？]|할까요|볼게요|말씀해\s*주|알려주|이어|같이\s*보|궁금/.test(String(text ?? ""));
}

function policySignals(policies = []) {
  const labels = [];
  for (const policy of policies) {
    const name = `${policy.product_name ?? ""} ${policy.policy_type ?? ""}`.trim();
    if (/암|cancer/i.test(name)) labels.push("암 관련");
    else if (/실손|health/i.test(name)) labels.push("실손/건강");
    else if (/운전|auto/i.test(name)) labels.push("운전자");
    else if (name) labels.push("기타");
  }
  return [...new Set(labels)].join("·");
}

function memoryObservation(loadedContext, customerContextBundle) {
  return (
    loadedContext?.memory === "present" && (customerContextBundle?.memoryFactCount ?? 0) > 0
  );
}

/** P11-6 — Preserve upstream SSOT; never recalculate from policies.length. */
export function buildConversationBrainFactBundlePolicyFields({
  unified = null,
  upstreamFactBundle = null,
} = {}) {
  if (upstreamFactBundle?.active_policy_count != null) {
    const activePolicyCount = Number(upstreamFactBundle.active_policy_count);
    return {
      active_policy_count: activePolicyCount,
      active_policy_count_source: upstreamFactBundle.active_policy_count_source ?? "unified_state",
      active_policy_ids:
        upstreamFactBundle.active_policy_ids ?? upstreamFactBundle.policy_ids ?? [],
      policy_count: upstreamFactBundle.policy_count ?? activePolicyCount,
    };
  }
  return resolveActivePolicyCountFromUnified(unified);
}

export function composeConversationBrainAnswer({
  topic,
  question: _question = "",
  customerContextBundle = null,
  loadedContext = null,
  unified = null,
} = {}) {
  const policies = customerContextBundle?.policies ?? [];
  const memoryFacts = customerContextBundle?.memoryFacts ?? [];
  const memoryUsed = memoryObservation(loadedContext, customerContextBundle);
  const gapCtx = customerContextBundle?.coverageGapContext ?? null;
  const signalText = policySignals(policies);

  const composed = composeTrustedAdvisorTurn({
    topic,
    memoryFacts: memoryUsed ? memoryFacts : [],
    loadedContext,
    policySignalText: signalText,
    gapCtx,
    opening: inferCustomerIntent(topic),
  });

  if (violatesMemoryValueRepetition(composed.text, memoryFacts)) {
    const fallbackParts = [
      inferCustomerIntent(topic),
      buildSituationFrame({ loadedContext, policySignalText: signalText, gapCtx, topic }),
      buildJudgmentFrame({ topic, gapCtx }),
      buildExplanationFrame({ topic, gapCtx }),
      buildTrustReassurance(topic),
      buildPersonaFollowUpQuestion(topic),
    ].filter(Boolean);
    composed.text = fallbackParts.join("\n");
  }

  const policyFields = resolveActivePolicyCountFromUnified(unified);

  return {
    text: composed.text,
    policies,
    ...policyFields,
    memory_used: memoryUsed,
    coverage_gap_used: Boolean(gapCtx?.loaded && gapCtx?.signals?.length > 0),
    persona: SALES_DIRECTOR_PERSONA_ID,
  };
}

export function shouldApplyConversationBrain({
  question = "",
  loadedContext = null,
  customerContextBundle = null,
  agentTurn = null,
} = {}) {
  if (!hasCustomerInsuranceReadiness(loadedContext, customerContextBundle)) {
    return { apply: false, reason: "no_insurance_readiness" };
  }

  const topic = matchConversationBrainTopic(question);
  if (!topic) {
    return { apply: false, reason: "no_topic_match" };
  }

  const deferLike =
    agentTurn?.tomInternalRoute === TOM_INTERNAL_ROUTES.DEFER ||
    agentTurn?.responseSource === "tom_internal_defer" ||
    isDeadEndDeferResponse(agentTurn?.text);

  const weakPilot =
    agentTurn?.responseSource?.startsWith("p5_brain_") &&
    (!hasConversationContinuation(agentTurn?.text) || violatesForbiddenOpening(agentTurn?.text));

  if (deferLike || weakPilot || topic) {
    return { apply: true, topic, reason: deferLike ? "replace_defer" : "conversation_compose" };
  }

  return { apply: false, reason: "already_conversational" };
}

export async function refineWithConversationBrain({
  agentTurn,
  question = "",
  history = [],
  customerContextBundle = null,
  loadedContext = null,
  unified = null,
  consultationIntent = null,
  contextSnapshotId = "",
  fetchImpl = fetch,
  env = process.env,
  latencyBucket = null,
  streamHandlers = null,
  requestStartedAt = null,
} = {}) {
  const decisionStart = Date.now();
  const decision = shouldApplyConversationBrain({
    question,
    loadedContext,
    customerContextBundle,
    agentTurn,
  });
  if (latencyBucket) {
    latencyBucket.free_thinking_prepare_ms += markLatencyMs(decisionStart);
  }
  if (!decision.apply || !decision.topic) {
    return { agentTurn, applied: false, freeThinkingApplied: false };
  }

  const freeThinking = await composeSalesDirectorFreeThinkingAnswer({
    question,
    history,
    topic: decision.topic,
    customerContextBundle,
    loadedContext,
    unified,
    contextSnapshotId,
    fetchImpl,
    env,
    streamHandlers,
    requestStartedAt,
  });
  mergeFreeThinkingLatency(latencyBucket, freeThinking?.latency);

  let composed = freeThinking;
  if (!composed?.text || violatesForbiddenOpening(composed.text)) {
    const fallbackStart = Date.now();
    composed = composeConversationBrainAnswer({
      topic: decision.topic,
      question,
      customerContextBundle,
      loadedContext,
      unified,
    });
    if (latencyBucket) {
      latencyBucket.free_thinking_prepare_ms += markLatencyMs(fallbackStart);
    }
    if (composed?.text && streamHandlers?.onDelta && !streamHandlers._emitted) {
      streamHandlers.onDelta(composed.text);
      streamHandlers._emitted = true;
      if (requestStartedAt) {
        const ttft = Math.max(0, Date.now() - requestStartedAt);
        latencyBucket.ttft_ms = Math.max(latencyBucket?.ttft_ms ?? 0, ttft);
        streamHandlers.onFirstToken?.(ttft);
      }
    }
  }

  if (!composed?.text || violatesForbiddenOpening(composed.text)) {
    return { agentTurn, applied: false, freeThinkingApplied: false };
  }

  const policyFields = buildConversationBrainFactBundlePolicyFields({
    unified,
    upstreamFactBundle: agentTurn?.factBundle ?? null,
  });

  const conversationTrace = {
    status: "p7_persona",
    persona: SALES_DIRECTOR_PERSONA_ID,
    topic: decision.topic,
    reason: decision.reason,
    memory_used: composed.memory_used === true,
    snapshot_insurance_used: true,
    coverage_gap_used: composed.coverage_gap_used === true,
    policy_count_from_snapshot: policyFields.active_policy_count,
    free_thinking: freeThinking?.text
      ? {
          status: "p6_2b_3",
          source: freeThinking.source ?? "deterministic",
          opening_variant: freeThinking.opening_variant ?? null,
          persona: freeThinking.persona ?? SALES_DIRECTOR_PERSONA_ID,
        }
      : null,
  };

  return {
    applied: true,
    freeThinkingApplied: Boolean(freeThinking?.text),
    agentTurn: {
      ...agentTurn,
      text: composed.text,
      tomInternalRoute: TOM_INTERNAL_ROUTES.CHAT,
      consultationIntent: consultationIntent ?? agentTurn?.consultationIntent,
      responseSource: freeThinking?.text
        ? "sales_director_free_thinking"
        : "sales_director_conversation_brain",
      factBundle: {
        ...(agentTurn?.factBundle ?? {}),
        question,
        ...policyFields,
        policies: composed.policies ?? agentTurn?.factBundle?.policies ?? [],
        memory_fact_count: customerContextBundle?.memoryFactCount ?? 0,
        customer_context_used: true,
        coverage_gap_used: composed.coverage_gap_used === true,
        coverage_gap_record_count: customerContextBundle?.coverageGapContext?.record_count ?? 0,
        conversation_brain_topic: decision.topic,
        conversation_brain_applied: true,
        free_thinking_applied: Boolean(freeThinking?.text),
        sales_director_persona: SALES_DIRECTOR_PERSONA_ID,
      },
      trace: {
        ...(agentTurn?.trace ?? {}),
        agent: freeThinking?.text ? "sales_director_free_thinking" : "sales_director_conversation_brain",
        conversation_brain: conversationTrace,
      },
      conversationBrainTrace: conversationTrace,
    },
  };
}
