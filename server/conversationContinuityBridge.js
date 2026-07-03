/**
 * RC-CONTINUITY-COMPANION-v1 — Conversation Continuity Bridge.
 * Memory (internal) → Relationship → Continuity → Companion voice.
 */
import { RC_CONTINUITY_COMPANION_CLUSTER_ID } from "./intentGateLayer.js";

export { RC_CONTINUITY_COMPANION_CLUSTER_ID };

function lastAssistantExcerpt(history = []) {
  for (let i = history.length - 1; i >= 0; i -= 1) {
    const row = history[i];
    if (row?.role === "assistant" && String(row.content ?? "").trim()) {
      return String(row.content).replace(/\s+/g, " ").trim();
    }
  }
  return "";
}

const MEMORY_LOOKUP_LEAK_RE =
  /저장(?:해|된)|확인(?:된|돼)|memory_fact|상담\s*맥락이\s*확인|기억(?:이|을)\s*(?:없|확인)/;

function resolveMemoryFactsFromBundle(factBundle = {}) {
  const facts = factBundle.memory_facts ?? factBundle.memoryFacts ?? [];
  if (!Array.isArray(facts)) return [];
  return facts.filter((fact) => fact && (fact.fact_key || fact.fact_value || fact.value));
}

function normalizeQuestion(question = "") {
  return String(question ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeText(text = "") {
  return String(text ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

export function lastUserExcerpt(history = []) {
  for (let i = history.length - 1; i >= 0; i -= 1) {
    const row = history[i];
    if (row?.role === "user" && String(row.content ?? "").trim()) {
      return String(row.content).replace(/\s+/g, " ").trim();
    }
  }
  return "";
}

function isCompanionThreadHint(text = "") {
  const hint = normalizeText(text);
  if (!hint || hint.length < 4) return false;
  if (MEMORY_LOOKUP_LEAK_RE.test(hint)) return false;
  return true;
}

function reflectPriorUserThread(priorUser = "") {
  const prior = normalizeText(priorUser);
  if (/힘들|우울|스트레스|지치|피곤|슬프|답답/.test(prior)) {
    return "힘들다고 이야기해 주셨는데, 오늘은 좀 나아지셨나요?";
  }
  if (/기분\s*좋|행복|즐거|신나/.test(prior)) {
    return "기분 좋다고 해 주셨던 이야기, 그 흐름 이어가 볼게요.";
  }
  if (/고마|감사/.test(prior)) {
    return "아까 전해 주신 말씀, 그 마음 이어서 같이 볼게요.";
  }
  const excerpt = prior.slice(0, 48).trim();
  if (excerpt.length >= 6) {
    return `${excerpt}… 그 이야기 이어서 같이 볼게요.`;
  }
  return "아까 나눈 이야기, 그 흐름 이어서 같이 볼게요.";
}

function reflectMemoryFactThread(facts = []) {
  for (const fact of facts) {
    const value = normalizeText(fact?.fact_value ?? fact?.value ?? "");
    if (!isCompanionThreadHint(value)) continue;
    if (/힘들|우울|스트레스/.test(value)) {
      return "힘들다고 이야기해 주셨던 부분, 그 흐름 이어서 같이 볼게요.";
    }
    if (value.length >= 8 && value.length <= 80) {
      return `${value.slice(0, 48)}… 그 이야기 이어서 같이 볼게요.`;
    }
  }
  return null;
}

/**
 * Internal bridge — not customer-facing "Memory read".
 */
export function resolveContinuityBridgeContext({ factBundle = {}, humanFrame = {} } = {}) {
  const history = humanFrame.conversation_history ?? [];
  const priorUser = lastUserExcerpt(history);
  const facts = resolveMemoryFactsFromBundle(factBundle);
  const factThread = facts.length ? reflectMemoryFactThread(facts) : null;

  if (factThread) {
    return {
      memory_present: true,
      bridge_source: "memory_facts",
      thread_hint: factThread,
    };
  }

  if (isCompanionThreadHint(priorUser)) {
    return {
      memory_present: true,
      bridge_source: "session_history",
      thread_hint: reflectPriorUserThread(priorUser),
      prior_user_excerpt: priorUser.slice(0, 80),
    };
  }

  const priorAssistant = lastAssistantExcerpt(history);
  if (isCompanionThreadHint(priorAssistant) && history.length >= 2) {
    return {
      memory_present: true,
      bridge_source: "session_assistant_thread",
      thread_hint: "아까 나눈 이야기, 그 흐름 이어서 같이 볼게요.",
    };
  }

  return {
    memory_present: false,
    bridge_source: null,
    thread_hint: null,
  };
}

export function buildContinuityCompanionJudgment(ctx = {}) {
  return buildContinuityCompanionResponse(ctx);
}

export function buildContinuityCompanionResponse({
  question = "",
  factBundle = {},
  humanFrame = {},
} = {}) {
  const bridge = resolveContinuityBridgeContext({ factBundle, humanFrame });

  if (!bridge.memory_present) {
    return normalizeText(
      "이전 대화를 확인할 수 없어요. 조금만 다시 말씀해 주시면 자연스럽게 이어갈게요.",
    );
  }

  const body = bridge.thread_hint ?? "아까 나눈 이야기, 그 흐름 이어서 같이 볼게요.";
  return normalizeText(`지난번 이야기 이어서 해볼게요. ${body}`);
}

export function shouldUseContinuityCompanionCompose({
  question = "",
  factBundle = {},
  humanFrame = {},
} = {}) {
  const q = normalizeQuestion(question || humanFrame.surface_question || factBundle.question || "");
  const cluster =
    factBundle.companion_cluster ??
    (q && factBundle.classification?.companion_cluster) ??
    null;
  return cluster === RC_CONTINUITY_COMPANION_CLUSTER_ID;
}

export function continuityCompanionResponseShape(text = "") {
  const normalized = normalizeText(text);
  if (!normalized) return "empty";
  if (/이전\s*대화를\s*확인할\s*수\s*없/.test(normalized)) return "memory_absent";
  if (/지난번\s*이야기\s*이어서/.test(normalized)) return "memory_present";
  return "other";
}
