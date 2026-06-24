/**
 * P6-2B-3 / P7-PERSONA — Sales Director Free Thinking.
 */
import { resolveAnthropicApiKey } from "./claudeGroundedExecutionCore.js";
import { hasCoveragePresenceFactualAnswer } from "./coveragePresencePreserveGate.js";
import { classifyConsultationIntent } from "./intentGateLayer.js";
import { generateLifeguardChatResponse } from "./lifeguardChatCore.js";
import { CONVERSATION_BRAIN_TOPICS } from "./salesDirectorPersona.js";
import { buildCoverageGapDirectorContextLines } from "./salesDirectorCoverageGapContext.js";
import { markLatencyMs } from "./salesDirectorLatencyAudit.js";
import {
  SALES_DIRECTOR_PERSONA_ID,
  SALES_DIRECTOR_TRUSTED_ADVISOR_PROMPT,
  buildPersonaThinkingScaffold,
  buildTrustMemoryAcknowledgment,
  composeTrustedAdvisorTurn,
  inferCustomerIntent,
  violatesMemoryValueRepetition,
} from "./salesDirectorPersona.js";

export { SALES_DIRECTOR_PERSONA_ID, SALES_DIRECTOR_TRUSTED_ADVISOR_PROMPT as SALES_DIRECTOR_FREE_THINKING_PROMPT };

export const FORBIDDEN_MANUAL_PHRASES = [
  /^가입된\s*보험은\s*확인돼요/,
  /기억해\s*둔\s*상담\s*내용도\s*참고할\s*수\s*있어요/,
  /부족한\s*보장|우선\s*보강\s*항목|Gap\s*분석|coverage_gap|엔진\s*결과/i,
  /지난번\s+.+\s*얘기하셨던\s*거\s*기억나/i,
  /전에\s+.+\s*얘기\s*나눴던\s*게\s*기억나/i,
];

const PREMIUM_DUMP = /\d{1,3}(,\d{3})+\s*원|\d{5,}\s*원/;
const COUNT_DUMP = /\d+\s*건/;

const TOPIC_CONTEXT_LABELS = {
  cancer_coverage: "암보장",
  premium_burden: "보험료 부담",
  adequacy: "보장 충분성",
};

const FREE_THINKING_HISTORY_TURN_LIMIT = 2;
const FREE_THINKING_HISTORY_MAX_CHARS = 300;
export const FREE_THINKING_MAX_TOKENS = 320;
export const FREE_THINKING_MAX_CHARS = 480;
const DEFAULT_FREE_THINKING_MODEL = "claude-haiku-4-5";

export function resolveSalesDirectorFreeThinkingModel(env = process.env) {
  return String(
    env.SALES_DIRECTOR_FREE_THINKING_MODEL ??
      env.ANTHROPIC_FAST_MODEL ??
      DEFAULT_FREE_THINKING_MODEL,
  ).trim();
}

function hashSeed(value = "") {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
  }
  return hash;
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
  return [...new Set(labels)];
}

export function buildNaturalMemoryLine(memoryFacts = [], topic = null) {
  return buildTrustMemoryAcknowledgment(memoryFacts, topic);
}

export function buildSalesDirectorThinkingContext({
  question = "",
  history = [],
  customerContextBundle = null,
  loadedContext = null,
  topic = null,
} = {}) {
  const policies = customerContextBundle?.policies ?? [];
  const memoryFacts = customerContextBundle?.memoryFacts ?? [];
  const recent = customerContextBundle?.recentConversation ?? {};
  const signals = policySignals(policies);
  const signalText = signals.length ? signals.join(",") : "";
  const gapCtx = customerContextBundle?.coverageGapContext ?? null;
  const excerpt = String(
    recent.latestUserMessageExcerpt ?? recent.latestUserMessages?.[0] ?? "",
  ).trim();
  const hasHistory = Array.isArray(history) && history.length > 0;

  const lines = [
    buildPersonaThinkingScaffold({
      topic,
      loadedContext,
      policySignalText: signalText,
      memoryFacts,
      gapCtx,
    }),
    question ? `[질문] ${question}` : null,
    topic ? `[주제] ${TOPIC_CONTEXT_LABELS[topic] ?? topic}` : null,
  ].filter(Boolean);

  const gapLines = buildCoverageGapDirectorContextLines(gapCtx);
  if (gapLines.length) {
    lines.push(...gapLines.map((line) => `[내부참고] ${line}`));
  }
  if (excerpt && !hasHistory) {
    lines.push(`[최근맥락] ${excerpt.slice(0, 60)}`);
  }
  return lines.join("\n");
}

export function coverageGapUsedInThinking(customerContextBundle = null) {
  const ctx = customerContextBundle?.coverageGapContext;
  return Boolean(ctx?.loaded && ctx?.signals?.length > 0);
}

export function hasFreeThinkingQualities(text = "") {
  const body = String(text ?? "");
  const hasIntent = /것\s*같|걸리|궁금|신경|부담|확인하고\s*싶/.test(body);
  const hasSituation = /가입|보이|정보|확인|범위|단정|어려/.test(body);
  const hasJudgment = /보여|맞아|짚|나눠|함께|차근|조심/.test(body);
  const hasReassurance = /괜찮|천천히|함께|곁|걱정|안심|덜\s*답답|혼자\s*감당/.test(body);
  const hasQuestion = /[?？]|할까요|볼게요|말씀해|알려주|짚어|보면/.test(body);
  return hasIntent && hasSituation && hasJudgment && hasReassurance && hasQuestion;
}

/** P10-3F — accept short factual Claude FT for coverage_presence without relaxing hasFreeThinkingQualities globally. */
export function passesCoveragePresenceFactualFreeThinkingText(text = "", question = "", memoryFacts = []) {
  if (violatesManualTemplate(text, memoryFacts)) return false;
  if (hasFreeThinkingQualities(text)) return true;
  const consultation = classifyConsultationIntent(question);
  if (consultation.lookup_sub_intent !== "coverage_presence") return false;
  return hasCoveragePresenceFactualAnswer(text);
}

export function violatesManualTemplate(text = "", memoryFacts = []) {
  const body = String(text ?? "").trim();
  if (FORBIDDEN_MANUAL_PHRASES.some((pattern) => pattern.test(body))) return true;
  if (PREMIUM_DUMP.test(body)) return true;
  if (COUNT_DUMP.test(body)) return true;
  if (violatesMemoryValueRepetition(body, memoryFacts)) return true;
  return false;
}

function pickVariant(seed, variants) {
  if (!variants.length) return "";
  return variants[hashSeed(seed) % variants.length];
}

export function composeDeterministicFreeThinking({
  question = "",
  topic = null,
  customerContextBundle = null,
  loadedContext = null,
  contextSnapshotId = "",
} = {}) {
  const policies = customerContextBundle?.policies ?? [];
  const memoryFacts = customerContextBundle?.memoryFacts ?? [];
  const seed = `${contextSnapshotId}:${topic}:${question}`;
  const signals = policySignals(policies);
  const signalText = signals.length ? signals.join("·") : "";
  const gapCtx = customerContextBundle?.coverageGapContext ?? null;

  const openingVariants = {
    [CONVERSATION_BRAIN_TOPICS.ADEQUACY]: [
      inferCustomerIntent(CONVERSATION_BRAIN_TOPICS.ADEQUACY),
      "한 번에 '괜찮은지' 확인하고 싶으신 마음, 충분히 이해돼요.",
      "보험이 있냐 없냐보다, 잘 맞게 가입됐는지가 더 걸리시는 것 같아요.",
    ],
    [CONVERSATION_BRAIN_TOPICS.CANCER_COVERAGE]: [
      inferCustomerIntent(CONVERSATION_BRAIN_TOPICS.CANCER_COVERAGE),
      "암보장이 비어 있지 않은지, 그게 지금 가장 걸리시는 것 같아요.",
      "암 쪽 보장, 미리 확인하고 싶으신 마음이 느껴져요.",
    ],
    [CONVERSATION_BRAIN_TOPICS.PREMIUM_BURDEN]: [
      inferCustomerIntent(CONVERSATION_BRAIN_TOPICS.PREMIUM_BURDEN),
      "매달 나가는 부담, 요즘 특히 크게 느껴지시죠.",
      "매달 나가는 금액이 부담스럽게 느껴지시는 것 같아요.",
    ],
  };

  if (!topic || !openingVariants[topic]) return null;

  const opening = pickVariant(seed, openingVariants[topic]);
  const composed = composeTrustedAdvisorTurn({
    topic,
    memoryFacts,
    loadedContext,
    policySignalText: signalText,
    gapCtx,
    opening,
  });

  if (violatesManualTemplate(composed.text, memoryFacts)) return null;

  return {
    text: composed.text,
    opening_variant: composed.opening_variant,
    source: "deterministic",
    policies,
    policy_count: policies.length,
    memory_used: composed.memory_used,
    coverage_gap_used: coverageGapUsedInThinking(customerContextBundle),
    persona: SALES_DIRECTOR_PERSONA_ID,
  };
}

export async function composeSalesDirectorFreeThinkingAnswer({
  question = "",
  history = [],
  topic = null,
  customerContextBundle = null,
  loadedContext = null,
  contextSnapshotId = "",
  fetchImpl = fetch,
  env = process.env,
  streamHandlers = null,
  requestStartedAt = null,
} = {}) {
  const memoryFacts = customerContextBundle?.memoryFacts ?? [];
  const latency = {
    free_thinking_prepare_ms: 0,
    claude_ms: 0,
    first_token_ms: 0,
    ttft_ms: 0,
    parse_ms: 0,
  };

  const prepareStart = Date.now();
  const contextBlock = buildSalesDirectorThinkingContext({
    question,
    history,
    customerContextBundle,
    loadedContext,
    topic,
  });
  latency.free_thinking_prepare_ms += markLatencyMs(prepareStart);

  const apiKey = resolveAnthropicApiKey(env);
  if (apiKey) {
    let streamed = false;
    const llm = await generateLifeguardChatResponse({
      question,
      history,
      customerContextBlock: contextBlock,
      systemPrompt: SALES_DIRECTOR_TRUSTED_ADVISOR_PROMPT,
      historyTurnLimit: FREE_THINKING_HISTORY_TURN_LIMIT,
      historyContentMaxChars: FREE_THINKING_HISTORY_MAX_CHARS,
      maxTokens: FREE_THINKING_MAX_TOKENS,
      maxChars: FREE_THINKING_MAX_CHARS,
      modelName: resolveSalesDirectorFreeThinkingModel(env),
      streamHandlers: streamHandlers?.onDelta
        ? {
            onDelta: (chunk) => {
              streamed = true;
              streamHandlers.onDelta(chunk);
            },
            onFirstToken: (firstTokenMs) => {
              latency.first_token_ms = firstTokenMs;
              if (requestStartedAt) {
                latency.ttft_ms = Math.max(0, Date.now() - requestStartedAt);
                streamHandlers.onFirstToken?.(latency.ttft_ms);
              }
            },
          }
        : null,
      fetchImpl,
      env,
    });
    latency.claude_ms += llm.timing?.claude_ms ?? 0;
    latency.first_token_ms = Math.max(latency.first_token_ms, llm.timing?.first_token_ms ?? 0);
    latency.parse_ms += llm.timing?.parse_ms ?? 0;

    const validateStart = Date.now();
    if (
      llm.ok &&
      llm.text &&
      passesCoveragePresenceFactualFreeThinkingText(llm.text, question, memoryFacts)
    ) {
      latency.parse_ms += markLatencyMs(validateStart);
      const policies = customerContextBundle?.policies ?? [];
      return {
        text: llm.text,
        source: "claude",
        opening_variant: llm.text.trim().split("\n")[0] ?? null,
        policies,
        policy_count: policies.length,
        memory_used: memoryFacts.length > 0,
        coverage_gap_used: coverageGapUsedInThinking(customerContextBundle),
        persona: SALES_DIRECTOR_PERSONA_ID,
        llm_response_source: llm.response_source,
        latency,
      };
    }
    latency.parse_ms += markLatencyMs(validateStart);

    if (streamed) {
      const deterministic = composeDeterministicFreeThinking({
        question,
        topic,
        customerContextBundle,
        loadedContext,
        contextSnapshotId,
      });
      if (deterministic?.text && !violatesManualTemplate(deterministic.text, memoryFacts)) {
        return { ...deterministic, source: deterministic.source ?? "deterministic", latency };
      }
    }
  }

  const deterministicStart = Date.now();
  const deterministic = composeDeterministicFreeThinking({
    question,
    topic,
    customerContextBundle,
    loadedContext,
    contextSnapshotId,
  });
  latency.free_thinking_prepare_ms += markLatencyMs(deterministicStart);
  if (!deterministic?.text || violatesManualTemplate(deterministic.text, memoryFacts)) {
    return null;
  }
  return { ...deterministic, latency };
}
