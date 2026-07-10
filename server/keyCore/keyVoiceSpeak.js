/**
 * Slice 6 — KEY Voice Speak (Claude 발성기관 · 문장 후보만).
 */
import { resolveAnthropicApiKey } from "../claudeGroundedExecutionCore.js";
import { renderFactsSpokenBlock } from "./speakFactRenderer.js";

const DEFAULT_MODEL = "claude-sonnet-4-6";
const DEFAULT_TIMEOUT_MS = 20000;
const DEFAULT_TEMPERATURE = 0.4;

function buildSystemPrompt() {
  return [
    "You are the language muscle of KEY (LIFEGUARD).",
    "You render ONE natural Korean customer answer from a frozen KEY directive.",
    "You must NOT change judgment, direction, invite intent, or required_claims.",
    "You must NOT invent numbers, insurers, products, premiums, or coverage names.",
    "Use required_claims (mandatory) and optional_claims (use only if helpful).",
    "Use only allowed_numbers — never calculate numbers outside allowed_numbers.",
    "Never say '나머지 21건', '절반', '대부분', '비율', or derived counts.",
    "When answer_mode is analysis_consulting: interpret, do not fact-dump; KEY leads next check order.",
    "Intimacy (v3): open like talking to the customer — not a report. Warm grounded phrases OK.",
    "Use conversational polite endings (~할게요, ~거든요, ~보면 좋아요). Avoid stiff repetition of '확인해 드리겠습니다'.",
    "Number forward (v3): place question-relevant allowed numbers in the first two sentences with meaning.",
    "Premium scope: when policy_count > 1, monthly_premium is ONE confirmed representative contract — never read as total for all contracts. Never pair count and premium as 'N건, 월 X 기준' or '월 X 기준으로 전체 보험료'.",
    "Over-familiarity forbidden: no informal speech, emoji, exaggerated reactions, emotion certainty, '무조건', '걱정 마세요', '완벽합니다'.",
    "Follow question_focus in the first sentence.",
    "2-5 complete Korean sentences. Polite endings. No markdown.",
    "No enrollment/cancellation/final binding language.",
    "Never use '보장 축', '암 축', or calculated counts like '나머지 21건'.",
    "Never say 'KEY가' — always use '제가'.",
    "Plain text only.",
    "Follow key_situation_judgment, response_priority, key_next_move, and confirm_question from the directive — these are KEY Decision results.",
    "customer_situation_hypothesis is a hypothesis label only — never treat it as verified customer emotion or fact.",
    "Lead with KEY's next move / response_priority; at most one short confirm_question; do not only ask clarifying questions.",
    "When response_priority is fact_lookup: answer facts first, no emotional speculation.",
    "Never change numbers, facts, or forbidden claims.",
  ].join(" ");
}

function buildUserPrompt(directive) {
  return JSON.stringify(directive, null, 2);
}

/**
 * @param {object} params
 */
export async function speakKeyVoice({
  directive = null,
  env = process.env,
  fetchImpl = fetch,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  temperature = DEFAULT_TEMPERATURE,
} = {}) {
  const apiKey = resolveAnthropicApiKey(env);
  if (!apiKey) {
    return { ok: false, error: "ANTHROPIC_NOT_CONFIGURED", voice_raw: null, provider: null };
  }

  const model = String(env.ANTHROPIC_MODEL ?? env.CLAUDE_MODEL ?? DEFAULT_MODEL).trim();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetchImpl("https://api.anthropic.com/v1/messages", {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model,
        max_tokens: 512,
        temperature: Math.min(0.5, Math.max(0.3, Number(temperature) || DEFAULT_TEMPERATURE)),
        system: buildSystemPrompt(),
        messages: [{ role: "user", content: buildUserPrompt(directive) }],
      }),
    });

    if (!res.ok) {
      return { ok: false, error: `CLAUDE_API_${res.status}`, voice_raw: null, provider: "anthropic" };
    }

    const data = await res.json();
    const voiceRaw = (data.content ?? [])
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("")
      .replace(/\s+/g, " ")
      .trim();

    if (!voiceRaw) {
      return { ok: false, error: "CLAUDE_EMPTY", voice_raw: null, provider: "anthropic" };
    }

    return { ok: true, error: null, voice_raw: voiceRaw, provider: "anthropic", model };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const isTimeout = /abort|timeout/i.test(msg);
    return {
      ok: false,
      error: isTimeout ? "CLAUDE_TIMEOUT" : "CLAUDE_FETCH_ERROR",
      voice_raw: null,
      provider: "anthropic",
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * KEY-owned safe utterance — 새 사실 생성 금지, legacy lego 금지.
 */
export function buildKeyVoiceSafeUtterance(directive = {}) {
  const focus = directive.question_focus ?? "general";
  const optionalFacts = directive.facts_to_speak ?? [];
  const factBlock = optionalFacts.length ? renderFactsSpokenBlock(optionalFacts, []) : null;
  const invite = directive.key_direction?.invite_prompt;
  const move = directive.key_direction?.move;

  if (focus === "greeting") {
    return "안녕하세요. 반갑습니다. 오늘은 편하게 이야기하셔도 됩니다.";
  }
  if (focus === "first_visit" || focus === "browse") {
    return "처음 오셨군요. 부담 없이 둘러보셔도 됩니다. 보험 이야기는 필요하실 때부터 천천히 해도 괜찮아요.";
  }
  if (focus === "emotional_support") {
    return "오늘 많이 버티셨네요. 지금은 쉬는 게 먼저입니다. 편할 때 이야기해 주셔도 됩니다.";
  }

  if (focus === "cancer_coverage" || focus === "cancer_direct") {
    const parts = [
      "암 보장이 궁금하시군요.",
      "지금 목록만으로는 충분·부족을 단정하기 어렵습니다.",
      "제가 먼저 암 진단비·수술비·치료비 항목부터 확인하겠습니다.",
      "그다음 보험료 대비 유지 우선순위와 추가로 짚을 보장을 나누겠습니다.",
    ];
    return parts.join(" ");
  }

  if (focus === "next_step") {
    const parts = [
      "이어서 보실 순서부터 정해볼게요.",
      "제가 먼저 확인된 삼성생명 실손의료비보험부터 어떤 상황에 적용되는지 짚겠습니다.",
    ];
    if (factBlock) parts.push(factBlock);
    parts.push("그다음 등록된 다른 계약도 같은 순서로 함께 보겠습니다.");
    return parts.filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
  }

  if (focus === "policy_overview") {
    const parts = ["내보험 현황이 궁금하시군요."];
    if (factBlock) {
      parts.push(factBlock);
    } else if (directive.premium_scope_policy?.preferred_phrases?.length) {
      parts.push(directive.premium_scope_policy.preferred_phrases[0]);
    }
    parts.push(
      directive.premium_scope_policy?.preferred_phrases?.[2] ??
        "전체 흐름은 계약별 납입액이 더 확인되어야 정확히 볼 수 있어요.",
    );
    if (directive.key_judgment) parts.push(directive.key_judgment);
    if (move) parts.push(`다음은 ${move.endsWith(".") ? move.slice(0, -1) : move}.`);
    if (invite) parts.push(invite);
    return parts.filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
  }

  const parts = [];
  if (focus === "premium_amount") {
    parts.push("보험료가 궁금하시군요.");
  } else if (focus === "premium_burden") {
    parts.push(directive.direct_answer_hint ?? "보험료 부담이시군요.");
  } else if (focus === "premium_reduction") {
    parts.push("보험료를 줄이고 싶으시군요.");
  } else if (directive.direct_answer_hint) {
    parts.push(directive.direct_answer_hint);
  }
  if (factBlock) parts.push(factBlock);
  if (directive.key_judgment) parts.push(directive.key_judgment);
  if (move) parts.push(`다음은 ${move.endsWith(".") ? move.slice(0, -1) : move}.`);
  else parts.push("확인 가능한 범위까지만 말씀드릴게요.");
  if (invite) parts.push(invite);

  const text = parts.filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
  if (text) return text;

  return "지금 확인 가능한 범위까지만 말씀드릴게요. 이어서 같이 보면 됩니다.";
}
