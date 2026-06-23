/**
 * P6-2B-2 / P6-2B-3 — Sales Director Conversation + Free Thinking.
 */
import { TOM_INTERNAL_ROUTES, INSURANCE_DEFER_WITHOUT_TOOL_MESSAGE } from "./homeAgentTom.js";
import { composeSalesDirectorFreeThinkingAnswer } from "./salesDirectorFreeThinking.js";
import { markLatencyMs, mergeFreeThinkingLatency } from "./salesDirectorLatencyAudit.js";

export const CONVERSATION_BRAIN_TOPICS = {
  CANCER_COVERAGE: "cancer_coverage",
  PREMIUM_BURDEN: "premium_burden",
  ADEQUACY: "adequacy",
};

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

  if (/암\s*보장|암보장|암\s*담보|암\s*관련/.test(q)) {
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

function cancerProductSignal(policies = []) {
  return policies.some((policy) =>
    /암|cancer/i.test(`${policy.product_name ?? ""} ${policy.policy_type ?? ""}`),
  );
}

function memoryObservation(loadedContext, customerContextBundle) {
  return (
    loadedContext?.memory === "present" && (customerContextBundle?.memoryFactCount ?? 0) > 0
  );
}

export function composeConversationBrainAnswer({
  topic,
  question: _question = "",
  customerContextBundle = null,
  loadedContext = null,
} = {}) {
  const policies = customerContextBundle?.policies ?? [];
  const memoryUsed = memoryObservation(loadedContext, customerContextBundle);

  if (topic === CONVERSATION_BRAIN_TOPICS.CANCER_COVERAGE) {
    const empathy = "암보장이 신경 쓰이시는군요.";
    const known = cancerProductSignal(policies)
      ? "가입된 보험 중 암 관련 상품명은 확인돼요."
      : "가입된 보험은 확인돼요.";
    const unknown =
      "다만 현재 정보만으로는 암 진단비·치료비 금액까지는 보이지 않아요.";
    const question =
      "혹시 가족력 때문에 걱정되시는 건가요, 아니면 현재 가입 상태가 충분한지 궁금하신 건가요?";
    const next = "그 이유를 알면 우선 부족 가능성부터 같이 볼게요.";
    const memoryLine = memoryUsed ? "기억해 둔 상담 내용도 참고할 수 있어요." : null;
    return {
      text: [empathy, known, memoryLine, unknown, question, next].filter(Boolean).join("\n"),
      policies,
      policy_count: policies.length,
      memory_used: memoryUsed,
    };
  }

  if (topic === CONVERSATION_BRAIN_TOPICS.PREMIUM_BURDEN) {
    return {
      text: [
        "보험료 부담이 걱정되시는군요.",
        "가입된 보험은 확인돼요.",
        memoryUsed ? "기억해 둔 상담 내용도 참고할 수 있어요." : null,
        "다만 총 보험료는 현재 검증이 필요해서, 지금 숫자로 단정하긴 어려워요.",
        "부담이 총액 때문인지, 최근 인상 때문인지 알려주시면 그 기준으로 같이 판단해볼게요.",
        "먼저 어떤 보험료가 가장 신경 쓰이는지부터 말씀해 주실까요?",
      ]
        .filter(Boolean)
        .join("\n"),
      policies,
      policy_count: policies.length,
      memory_used: memoryUsed,
    };
  }

  if (topic === CONVERSATION_BRAIN_TOPICS.ADEQUACY) {
    return {
      text: [
        "전체적으로 괜찮은지 한번에 짚어주셨네요.",
        "가입된 보험은 확인돼요.",
        memoryUsed ? "기억해 둔 상담 내용도 참고할 수 있어요." : null,
        "다만 담보 범위·한도·공백까지는 현재 정보만으로는 단정하기 어려워요.",
        "특히 암·실손·운전자 중 어느 부분이 더 걱정되세요?",
        "걱정 지점을 알려주시면 그 부분부터 충분한지 같이 보면 됩니다.",
      ]
        .filter(Boolean)
        .join("\n"),
      policies,
      policy_count: policies.length,
      memory_used: memoryUsed,
    };
  }

  return null;
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

/**
 * Replace dead-end defer with free-thinking dialogue when insurance is already read.
 */
export async function refineWithConversationBrain({
  agentTurn,
  question = "",
  history = [],
  customerContextBundle = null,
  loadedContext = null,
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

  const conversationTrace = {
    status: "p6_2b_2",
    topic: decision.topic,
    reason: decision.reason,
    memory_used: composed.memory_used === true,
    snapshot_insurance_used: true,
    policy_count_from_snapshot: composed.policy_count ?? 0,
    free_thinking: freeThinking?.text
      ? {
          status: "p6_2b_3",
          source: freeThinking.source ?? "deterministic",
          opening_variant: freeThinking.opening_variant ?? null,
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
        policy_count: composed.policy_count ?? 0,
        policies: composed.policies ?? [],
        memory_fact_count: customerContextBundle?.memoryFactCount ?? 0,
        customer_context_used: true,
        conversation_brain_topic: decision.topic,
        conversation_brain_applied: true,
        free_thinking_applied: Boolean(freeThinking?.text),
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
