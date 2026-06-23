/**
 * P6-2B-3 — Sales Director Free Thinking.
 * Grounded observe → think → speak (not template assembly).
 */
import { resolveAnthropicApiKey } from "./claudeGroundedExecutionCore.js";
import { generateLifeguardChatResponse } from "./lifeguardChatCore.js";
import { CONVERSATION_BRAIN_TOPICS } from "./salesDirectorConversationBrain.js";

export const FORBIDDEN_MANUAL_PHRASES = [
  /^가입된\s*보험은\s*확인돼요/,
  /기억해\s*둔\s*상담\s*내용도\s*참고할\s*수\s*있어요/,
];

const PREMIUM_DUMP = /\d{1,3}(,\d{3})+\s*원|\d{5,}\s*원/;
const COUNT_DUMP = /\d+\s*건/;

export const SALES_DIRECTOR_FREE_THINKING_PROMPT = [
  "You are a 15-year veteran insurance sales director (영업부장) speaking directly to your customer in Korean.",
  "You received ONLY the customer context block below — policies (names/types only, no verified premiums), memory facts, recent talk excerpts.",
  "Think first: why did they ask? what worry hides behind the words? what should you say first?",
  "Then speak naturally — NOT a fixed manual. Vary your opening each time.",
  "You MAY observe (\"~가 더 궁금하신 것 같네요\"), share grounded opinion (\"내가 보기엔\", \"느낌상\", \"우선은\"), and ask one good question.",
  "Use memory naturally if present (e.g. \"지난번 ○○ 얘기하셨던 거 기억나요\") — only facts listed in context.",
  "Never start with \"확인 어렵습니다\", \"판단 어렵습니다\", \"가입된 보험은 확인돼요\" as a formula.",
  "Never say \"기억해 둔 상담 내용도 참고할 수 있어요\".",
  "Never invent policies, premiums, coverage amounts, memory, or customer history not in context.",
  "Never end with \"보장내역서를 주세요\" alone — always ask a question or propose a next step together.",
  "Do NOT follow a rigid 5-step checklist visibly. Flow like a real consultation (3-6 short lines).",
  "No emojis. No engine/tool names.",
].join(" ");

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

function formatMemoryFactsForContext(memoryFacts = []) {
  return memoryFacts
    .slice(0, 8)
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
  customerContextBundle = null,
  loadedContext = null,
  topic = null,
} = {}) {
  const policies = customerContextBundle?.policies ?? [];
  const memoryFacts = customerContextBundle?.memoryFacts ?? [];
  const recent = customerContextBundle?.recentConversation ?? {};
  const signals = policySignals(policies);
  const memoryLines = formatMemoryFactsForContext(memoryFacts);
  const excerpt = String(
    recent.latestUserMessageExcerpt ?? recent.latestUserMessages?.[0] ?? "",
  ).trim();

  const lines = [
    "[영업부장에게 전달된 사실 — 이것만 사용]",
    `고객 질문: ${question}`,
    `보험 가입 여부: ${loadedContext?.policies === "present" ? "있음" : "없음"}`,
  ];
  if (signals.length) {
    lines.push(`보이는 상품 유형(이름 수준): ${signals.join(", ")}`);
  }
  lines.push("검증된 총 보험료: 없음 (단정 금지)");
  lines.push("검증된 담보 금액: 없음 (단정 금지)");
  if (memoryLines.length) {
    lines.push(`Memory facts: ${memoryLines.join(" | ")}`);
  }
  if (excerpt) {
    lines.push(`최근 대화 발췌: ${excerpt.slice(0, 80)}`);
  }
  lines.push("[지시] 관찰·생각·자연스러운 한국어 답변. 매뉴얼 조립 금지.");
  return lines.join("\n");
}

export function hasFreeThinkingQualities(text = "") {
  const body = String(text ?? "");
  return (
    /보기엔|느낌상|것\s*같|우선|좋은\s*질문|전체적으로|지금\s*걱정|연장선|기억나/.test(body) &&
    (/[?？]|할까요|볼게요|말씀해|알려주|짚어|보면/.test(body))
  );
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
      "암보장 쪽이 마음에 걸리시는군요.",
      "지금 걱정되는 건 암 쪽 담보인 것 같네요.",
      "보험은 확인되는데, 암 진단비까지 바로 말하기는 어려운 질문이에요.",
    ]);
    const cancerHint = signals.includes("암 관련")
      ? "암 관련 상품명은 보이긴 해요."
      : "상품명만으로는 암 담보 여부를 단정하긴 어려워요.";
    const parts = [
      opening,
      memoryLine,
      cancerHint,
      "내가 보기엔 가족력 걱정인지, 지금 가입 충분성 걱정인지에 따라 보는 순서가 달라져요.",
      "혹시 가족력 때문인가요, 아니면 지금 가입 상태가 충분한지 궁금하신 건가요?",
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
} = {}) {
  const contextBlock = buildSalesDirectorThinkingContext({
    question,
    customerContextBundle,
    loadedContext,
    topic,
  });

  const apiKey = resolveAnthropicApiKey(env);
  if (apiKey) {
    const llm = await generateLifeguardChatResponse({
      question,
      history,
      customerContextBlock: contextBlock,
      systemPrompt: SALES_DIRECTOR_FREE_THINKING_PROMPT,
      fetchImpl,
      env,
    });
    if (
      llm.ok &&
      llm.text &&
      !violatesManualTemplate(llm.text) &&
      hasFreeThinkingQualities(llm.text)
    ) {
      const policies = customerContextBundle?.policies ?? [];
      return {
        text: llm.text,
        source: "claude",
        opening_variant: llm.text.trim().split("\n")[0] ?? null,
        policies,
        policy_count: policies.length,
        memory_used: (customerContextBundle?.memoryFacts ?? []).length > 0,
        llm_response_source: llm.response_source,
      };
    }
  }

  const deterministic = composeDeterministicFreeThinking({
    question,
    topic,
    customerContextBundle,
    loadedContext,
    contextSnapshotId,
  });
  if (!deterministic?.text || violatesManualTemplate(deterministic.text)) {
    return null;
  }
  return deterministic;
}
