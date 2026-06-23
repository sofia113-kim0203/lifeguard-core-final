/**
 * P6-2B-3 — Sales Director Free Thinking.
 * Grounded observe → think → speak (not template assembly).
 */
import { resolveAnthropicApiKey } from "./claudeGroundedExecutionCore.js";
import { generateLifeguardChatResponse } from "./lifeguardChatCore.js";
import { CONVERSATION_BRAIN_TOPICS } from "./salesDirectorConversationBrain.js";
import { markLatencyMs } from "./salesDirectorLatencyAudit.js";

export const FORBIDDEN_MANUAL_PHRASES = [
  /^가입된\s*보험은\s*확인돼요/,
  /기억해\s*둔\s*상담\s*내용도\s*참고할\s*수\s*있어요/,
];

const PREMIUM_DUMP = /\d{1,3}(,\d{3})+\s*원|\d{5,}\s*원/;
const COUNT_DUMP = /\d+\s*건/;

export const SALES_DIRECTOR_FREE_THINKING_PROMPT = [
  "당신은 15년차 보험 영업부장입니다. 한국어로 고객에게 직접 말합니다.",
  "컨텍스트에 없는 보험료·담보·이력은 지어내지 마세요.",
  "순서: ①질문 직답(첫 문장 20자 내외) ②확인 사실/한계 ③의도 질문 1개.",
  "\"가입된 보험은 확인돼요\", \"기억해 둔 상담 내용도 참고할 수 있어요\", \"왜 궁금하세요?\" 단독 금지.",
  "3-4줄. 이모지·엔진명 금지.",
].join(" ");

const TOPIC_CONTEXT_LABELS = {
  cancer_coverage: "암보장",
  premium_burden: "보험료 부담",
  adequacy: "보장 충분성",
};

const FREE_THINKING_HISTORY_TURN_LIMIT = 2;
const FREE_THINKING_HISTORY_MAX_CHARS = 300;
const FREE_THINKING_MEMORY_FACT_LIMIT = 2;
export const FREE_THINKING_MAX_TOKENS = 280;
export const FREE_THINKING_MAX_CHARS = 420;
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

function formatMemoryFactsForContext(memoryFacts = [], topic = null) {
  const topicPatterns = {
    cancer_coverage: /암|cancer|가족력/i,
    premium_burden: /보험료|부담|premium/i,
    adequacy: /goal|보장|걱정|충분/i,
  };
  const pattern = topic ? topicPatterns[topic] : null;
  const prioritized = pattern
    ? [
        ...memoryFacts.filter((fact) =>
          pattern.test(`${fact.fact_key ?? ""} ${fact.fact_value ?? fact.value ?? ""}`),
        ),
        ...memoryFacts.filter(
          (fact) => !pattern.test(`${fact.fact_key ?? ""} ${fact.fact_value ?? fact.value ?? ""}`),
        ),
      ]
    : memoryFacts;

  return prioritized
    .slice(0, FREE_THINKING_MEMORY_FACT_LIMIT)
    .map((fact) => {
      const key = String(fact.fact_key ?? "").trim();
      const value = String(fact.fact_value ?? fact.value ?? "").trim();
      if (!value) return null;
      return key ? `${key}: ${value}` : value;
    })
    .filter(Boolean);
}

export function buildNaturalMemoryLine(memoryFacts = [], topic = null) {
  if (!memoryFacts.length) return null;
  const goal = memoryFacts.find(
    (fact) =>
      /goal|worry|concern|걱정|부담|보험료/i.test(`${fact.fact_key ?? ""} ${fact.fact_value ?? ""}`),
  );
  const value = String(goal?.fact_value ?? memoryFacts[0]?.fact_value ?? "").trim();
  if (!value) return null;

  if (topic === CONVERSATION_BRAIN_TOPICS.PREMIUM_BURDEN || /보험료|부담/.test(value)) {
    return `지난번 ${value} 얘기하셨던 거 기억나요. 그 연장선에서 보면`;
  }
  if (topic === CONVERSATION_BRAIN_TOPICS.CANCER_COVERAGE || /암/.test(value)) {
    return `전에 ${value} 쪽 걱정을 나눈 적이 있는데, 이번 질문도 그 흐름 같아요.`;
  }
  return `전에 ${value} 얘기 나눴던 게 기억나요.`;
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
  const memoryLines = formatMemoryFactsForContext(memoryFacts, topic);
  const excerpt = String(
    recent.latestUserMessageExcerpt ?? recent.latestUserMessages?.[0] ?? "",
  ).trim();
  const hasHistory = Array.isArray(history) && history.length > 0;

  const lines = [
    "[사실]",
    topic ? `주제:${TOPIC_CONTEXT_LABELS[topic] ?? topic}` : null,
    `가입:${loadedContext?.policies === "present" ? "있음" : "없음"}`,
  ].filter(Boolean);
  if (signals.length) {
    lines.push(`유형:${signals.join(",")}`);
  }
  lines.push("보험료·담보:미검증");
  if (memoryLines.length) {
    lines.push(`Memory: ${memoryLines.join(" | ")}`);
  }
  if (excerpt && !hasHistory) {
    lines.push(`최근 발췌: ${excerpt.slice(0, 60)}`);
  }
  return lines.join("\n");
}

export function hasFreeThinkingQualities(text = "") {
  const body = String(text ?? "");
  const hasDirectAnswer = /확인|단정|어렵|없습니다|있습니다|보입니다|가입|담보|보장|정보/.test(body);
  const hasQuestion = /[?？]|할까요|볼게요|말씀해|알려주|짚어|보면/.test(body);
  const hasDirectorVoice =
    /보기엔|느낌상|것\s*같|우선|전체적으로|지금\s*걱정|연장선|기억나|다만|혹시|우선은/.test(body);
  return hasDirectAnswer && hasQuestion && hasDirectorVoice;
}

export function violatesManualTemplate(text = "") {
  const body = String(text ?? "").trim();
  if (FORBIDDEN_MANUAL_PHRASES.some((pattern) => pattern.test(body))) return true;
  if (PREMIUM_DUMP.test(body)) return true;
  if (COUNT_DUMP.test(body)) return true;
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
  const memoryLine = buildNaturalMemoryLine(memoryFacts, topic);
  const signals = policySignals(policies);
  const signalText = signals.length ? signals.join("·") : "가입 계약";

  if (topic === CONVERSATION_BRAIN_TOPICS.ADEQUACY) {
    const opening = pickVariant(seed, [
      "좋은 질문이네요.",
      "전체적으로 보면 이런 고민이실 것 같아요.",
      "보험이 있냐 없냐보다, 잘 가입된 건지가 더 궁금하신 것 같네요.",
      "지금 걱정되는 건 '충분한가' 쪽에 가깝네요.",
    ]);
    const parts = [
      opening,
      memoryLine ? `${memoryLine} 우선 ${signalText} 쪽은 보이는데, 담보·한도·공백까지는 이 정보만으론 단정하기 어려워요.` : `내가 보기엔 ${signalText} 쪽 가입은 보이는데, 담보·한도·공백까지는 이 정보만으론 단정하기 어려워요.`,
      "느낌상 지금은 '어디가 비어 있을까'보다 '지금 걱정 축이 어디냐'를 먼저 짚는 게 좋을 것 같아요.",
      "특히 암·실손·운전자 중 어디가 더 신경 쓰이세요?",
      "그 지점부터 같이 보면 됩니다.",
    ];
    return {
      text: parts.filter(Boolean).join("\n"),
      opening_variant: opening,
      source: "deterministic",
      policies,
      policy_count: policies.length,
      memory_used: memoryFacts.length > 0,
    };
  }

  if (topic === CONVERSATION_BRAIN_TOPICS.CANCER_COVERAGE) {
    const opening = pickVariant(`${seed}:c`, [
      "보험 가입은 확인됩니다.",
      "가입된 보험은 보이는데,",
      "암보장 여부부터 말씀드리면,",
    ]);
    const cancerHint = signals.includes("암 관련")
      ? "암 관련 상품명은 보이지만, 암진단비 존재 여부까지는 이 정보만으론 단정할 수 없어요."
      : "상품명만으로는 암 담보 여부를 단정하긴 어려워요.";
    const parts = [
      opening,
      cancerHint,
      memoryLine,
      "혹시 가족력 때문인지, 지금 가입 충분성이 궁금한 건지 알려주실 수 있을까요?",
      "그 이유를 알면 우선 부족 가능성부터 같이 볼게요.",
    ];
    return {
      text: parts.filter(Boolean).join("\n"),
      opening_variant: opening,
      source: "deterministic",
      policies,
      policy_count: policies.length,
      memory_used: memoryFacts.length > 0,
    };
  }

  if (topic === CONVERSATION_BRAIN_TOPICS.PREMIUM_BURDEN) {
    const opening = pickVariant(`${seed}:p`, [
      "보험료 부담, 요즘 특히 크게 느껴지시죠.",
      "지금 걱정되는 건 매달 나가는 부담 쪽인 것 같네요.",
      "전체적으로 보면 '너무 비싼가'보다 '어디가 무거운가'가 더 궁금하신 것 같아요.",
    ]);
    const parts = [
      opening,
      memoryLine
        ? `${memoryLine} 총액은 아직 검증 전이라 숫자로 단정하긴 어렵고요.`
        : "가입은 보이는데, 총액은 아직 검증 전이라 숫자로 단정하긴 어렵고요.",
      "느낌상 총액 문제인지, 특정 계약 한두 개가 무거운 건지부터 나눠보면 좋을 것 같아요.",
      "부담이 총액 때문인지, 최근 인상 때문인지 알려주시면 그 기준으로 같이 판단해볼게요.",
      "먼저 어떤 보험료가 가장 신경 쓰이는지부터 말씀해 주실까요?",
    ];
    return {
      text: parts.filter(Boolean).join("\n"),
      opening_variant: opening,
      source: "deterministic",
      policies,
      policy_count: policies.length,
      memory_used: memoryFacts.length > 0,
    };
  }

  return null;
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
      systemPrompt: SALES_DIRECTOR_FREE_THINKING_PROMPT,
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
      !violatesManualTemplate(llm.text) &&
      hasFreeThinkingQualities(llm.text)
    ) {
      latency.parse_ms += markLatencyMs(validateStart);
      const policies = customerContextBundle?.policies ?? [];
      return {
        text: llm.text,
        source: "claude",
        opening_variant: llm.text.trim().split("\n")[0] ?? null,
        policies,
        policy_count: policies.length,
        memory_used: (customerContextBundle?.memoryFacts ?? []).length > 0,
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
      if (deterministic?.text && !violatesManualTemplate(deterministic.text)) {
        streamHandlers?.onReplace?.(deterministic.text);
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
  if (!deterministic?.text || violatesManualTemplate(deterministic.text)) {
    return null;
  }
  return { ...deterministic, latency };
}
