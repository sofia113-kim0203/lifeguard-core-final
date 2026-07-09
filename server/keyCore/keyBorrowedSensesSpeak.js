/**
 * S7-a + S7-b — Borrowed Senses shadow speak (Claude 1-call structured JSON · trace only).
 */
import { resolveAnthropicApiKey } from "../claudeGroundedExecutionCore.js";
import { gateBorrowedSensesOutput, S7_BORROWED_SENSES_SCHEMA, S7_BORROWED_SENSES_SCHEMA_B, S7B_EXPERTISE_TAXONOMY } from "./keyBorrowedSensesGate.js";

const DEFAULT_MODEL = "claude-sonnet-4-6";
const DEFAULT_TIMEOUT_MS = 35000;
const TIMEOUT_RETRY_MS = 45000;
const DEFAULT_TEMPERATURE = 0.3;
const MAX_PARSE_RETRIES = 1;

const BORROWED_SENSES_TOOL = {
  name: "emit_borrowed_senses",
  description: "Emit S7-a + S7-b borrowed senses shadow JSON. Expression + leadership trace only — never replace S6 final_answer.",
  input_schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      understanding_hypotheses: {
        type: "array",
        items: { type: "string" },
      },
      customer_intent: { type: "string" },
      emotional_signal: { type: ["string", "null"] },
      hesitation_signal: { type: ["string", "null"] },
      context_carryover: { type: ["string", "null"] },
      visual_observation: { type: ["string", "null"] },
      answer_purpose: { type: "string" },
      must_not_assume: {
        type: "array",
        items: { type: "string" },
      },
      used_facts: {
        type: "array",
        items: { type: "string" },
      },
      recommendation_basis: { type: ["string", "null"] },
      voice_raw_candidate: { type: "string" },
      key_purpose: { type: ["string", "null"] },
      leadership_move: { type: ["string", "null"] },
      insurance_expertise_angle: {
        type: "array",
        items: { type: "string" },
      },
      insurance_expertise_rationale: { type: ["string", "null"] },
      proposal_direction: { type: ["string", "null"] },
      next_decision_point: {
        type: "array",
        minItems: 2,
        items: { type: "string" },
      },
      final_answer_source: { type: "string", enum: ["s6"] },
    },
    required: [
      "understanding_hypotheses",
      "customer_intent",
      "emotional_signal",
      "hesitation_signal",
      "context_carryover",
      "visual_observation",
      "answer_purpose",
      "must_not_assume",
      "used_facts",
      "recommendation_basis",
      "voice_raw_candidate",
      "key_purpose",
      "leadership_move",
      "insurance_expertise_angle",
      "insurance_expertise_rationale",
      "proposal_direction",
      "next_decision_point",
      "final_answer_source",
    ],
  },
};

function summarizeVisualBlocks(blocks = []) {
  if (!Array.isArray(blocks) || blocks.length === 0) return null;
  return blocks.map((block) => ({
    type: block?.type ?? null,
    title: block?.title ?? null,
    subtitle: block?.subtitle ?? null,
    row_count: Array.isArray(block?.rows) ? block.rows.length : 0,
    rows: Array.isArray(block?.rows) ? block.rows.slice(0, 6) : [],
  }));
}

function buildSystemPrompt() {
  return [
    "You are KEY Borrowed Senses (S7-a + S7-b shadow layer) for LIFEGUARD.",
    "Claude provides: hearing, social reading, visual reading, expression CANDIDATES, and leadership TRACE only.",
    "KEY owns facts, judgment, responsibility, and the frozen S6 final_answer.",
    "Understanding is HYPOTHESIS — never state hypotheses as confirmed facts.",
    "Do NOT replace or rewrite the S6 final_answer.",
    "Do NOT recommend enrollment, cancellation, signup, or specific product purchase.",
    "Use ONLY facts from allowed_fact_tokens / allowed_numbers / used_facts inputs.",
    "For context_carryover: only reference conversation_history or previous_answer_summary — never invent '지난번' memory.",
    "For visual_observation: describe ONLY what is in visual_blocks_summary rows/titles — never invent numbers, contracts, or judgments not shown.",
    "When visual_blocks_summary is present, cite only cell values and row labels from that summary.",
    "For premium scope: when policy_count > 1, never imply monthly_premium is total for all contracts.",
    "voice_raw_candidate is an alternate expression sketch — NOT the customer-facing answer.",
    "S7-b leadership fields (key_purpose, leadership_move, insurance_expertise_angle, proposal_direction, next_decision_point) are trace-only — never customer-facing.",
    "KEY acts as 보험 주치의: lead the customer to the next safe decision point — soft but not passive.",
    "leadership_move must be an active framing step — never end with only '편하실 때 말씀해 주세요'.",
    "proposal_direction is a review/consult DIRECTION within confirmed facts — NOT product recommendation, enroll, or cancel instruction.",
    "On consult/premium-burden questions: proposal_direction MUST be a non-empty string (never null/empty). Example meaning: which review path to take before cutting cost (필수 보장 vs 중복 보장 분리 등).",
    "Greeting/browse may leave proposal_direction null; consult paths must not.",
    "insurance_expertise_angle: pick 1–3 tags ONLY from insurance_expertise_taxonomy in the payload.",
    "next_decision_point: provide 2–3 concrete choices the customer can decide next (consult path). NEVER leave this array empty on consult questions.",
    "For 암보험/암 보장 questions: split coverage into 진단비·수술비·치료비; NEVER claim 부족/충분 before verification; next_decision_point MUST offer 2–3 choices among those items or whole-vs-partial review.",
    "For 보험료/premium burden: NEVER write '22건, 월 X원' as if all 22 contracts share one monthly amount; always separate representative contract (4만5천 원) from unconfirmed total sum.",
    "used_facts: cite policy_count and monthly_premium_representative separately — never combine 22건 with a single premium as total.",
    "FORBIDDEN in all shadow fields including voice_raw_candidate: 보장축, 우선순위 축, 암 보장축, 필수축, 축별, 축으로, 축을, 축부터, 축 설정.",
    "Use 보장 구성, 보장 종류, 보장 영역 instead of '축'.",
    "Never claim 부족합니다/충분합니다/꼭 필요합니다 as definitive verdict before verification.",
    "You MUST call emit_borrowed_senses exactly once with valid JSON fields.",
    "final_answer_source must always be \"s6\".",
  ].join(" ");
}

function buildQuestionLeadershipHint(question = "") {
  const q = String(question ?? "").trim();
  if (/보험료.*부담|부담/.test(q)) {
    return "Premium burden path: proposal_direction MUST be a non-empty review direction (NOT product push) — e.g. separate essential vs overlapping coverage before cutting cost. next_decision_point MUST have 2-3 choices (highest-burden contracts / overlapping coverage / essential coverage). Never leave proposal_direction or next_decision_point empty.";
  }
  if (/암\s*보험|암보험/.test(q)) {
    return "Cancer coverage path: split 진단비·수술비·치료비; no 부족/충분 verdict; next_decision_point MUST offer 2-3 choices among those items or whole-vs-partial review.";
  }
  if (/표가|표\s*가|표\s*무슨|표의\s*뜻|표\s*의미/.test(q)) {
    return "Table meaning path: next_decision_point MUST have 2-3 choices even if visual_blocks_summary is null (e.g. representative row / total vs unconfirmed / one contract detail). Never leave empty.";
  }
  return null;
}

function buildUserPayload({
  question = "",
  directive = null,
  decision = null,
  history = [],
  previousAnswerSummary = "",
  s6FinalAnswer = "",
  visualBlocks = [],
} = {}) {
  return {
    schema_version: S7_BORROWED_SENSES_SCHEMA_B,
    s7a_schema_version: S7_BORROWED_SENSES_SCHEMA,
    insurance_expertise_taxonomy: S7B_EXPERTISE_TAXONOMY,
    forbidden_axis_terms: [
      "보장축",
      "우선순위 축",
      "암 보장축",
      "필수축",
      "축별",
      "축으로",
      "축을",
      "축부터",
      "축 설정",
    ],
    customer_question: question,
    conversation_history: (history ?? []).slice(-4).map((h) => ({
      role: h.role,
      text: h.text ?? h.content ?? "",
    })),
    previous_answer_summary: String(previousAnswerSummary ?? "").trim() || null,
    s6_final_answer_frozen: String(s6FinalAnswer ?? "").trim(),
    question_focus: directive?.question_focus ?? null,
    answer_mode: directive?.answer_mode ?? null,
    decision_situation_key: decision?.situation_key ?? null,
    allowed_fact_tokens: directive?.allowed_fact_tokens ?? {},
    allowed_numbers: directive?.allowed_numbers ?? [],
    facts_to_speak: (directive?.facts_to_speak ?? []).map((f) => f.fact_id),
    premium_scope_policy: directive?.premium_scope_policy ?? null,
    visual_blocks_summary: summarizeVisualBlocks(visualBlocks),
    s7b_question_leadership_hint: buildQuestionLeadershipHint(question),
  };
}

function stripCodeFence(raw = "") {
  return String(raw ?? "")
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
}

function repairJsonText(raw = "") {
  let text = stripCodeFence(raw);
  text = text.replace(/,\s*([}\]])/g, "$1");
  return text;
}

function parseJsonFromText(raw = "") {
  const candidates = [String(raw ?? "").trim(), repairJsonText(raw)];
  for (const text of candidates) {
    if (!text) continue;
    try {
      return JSON.parse(text);
    } catch {
      const match = text.match(/\{[\s\S]*\}/);
      if (!match) continue;
      try {
        return JSON.parse(repairJsonText(match[0]));
      } catch {
        // continue
      }
    }
  }
  return null;
}

function extractParsedFromResponse(data = {}) {
  for (const block of data.content ?? []) {
    if (block?.type === "tool_use" && block?.name === "emit_borrowed_senses" && block?.input) {
      return block.input;
    }
  }
  const raw = (data.content ?? [])
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();
  return parseJsonFromText(raw);
}

function extractSlashChoicesFromText(text = "") {
  const raw = String(text ?? "");
  const paren = raw.match(/\(([^)]+)\)/);
  const candidate = paren ? paren[1] : raw;
  if (!candidate.includes("/")) return [];
  const parts = candidate
    .split(/\s*\/\s*/)
    .map((s) => s.replace(/^[\s—–\-·•]+|[\s—–\-·•]+$/g, "").trim())
    .filter((s) => s.length >= 2 && s.length <= 80);
  return parts.length >= 2 ? parts.slice(0, 3) : [];
}

function goldenNextDecisionFallback(question = "") {
  const q = String(question ?? "").trim();
  if (/표가|표\s*가|표\s*무슨|표의\s*뜻|표\s*의미/.test(q)) {
    return [
      "대표 계약 행부터 보기",
      "전체 합계와 미확인 항목 구분하기",
      "특정 보험사/계약 하나를 골라 자세히 보기",
    ];
  }
  if (/보험료.*부담|부담/.test(q)) {
    return [
      "납입 부담이 큰 계약부터 볼지",
      "겹치는 보장부터 정리할지",
      "꼭 필요한 보장만 먼저 확인할지",
    ];
  }
  if (/암\s*보험|암보험/.test(q)) {
    return [
      "암 보장 전체를 한번에 볼지",
      "진단비·수술비·치료비 중 하나부터 볼지",
    ];
  }
  return [];
}

function repairNextDecisionPoints(parsed = {}, question = "") {
  const existing = Array.isArray(parsed.next_decision_point)
    ? parsed.next_decision_point.map((s) => String(s).trim()).filter(Boolean)
    : [];
  if (existing.length >= 2) return existing;

  const fromMove = extractSlashChoicesFromText(parsed.leadership_move);
  if (fromMove.length >= 2) return fromMove;

  const fromProposal = extractSlashChoicesFromText(parsed.proposal_direction);
  if (fromProposal.length >= 2) return fromProposal;

  return goldenNextDecisionFallback(question);
}

function normalizeBorrowedOutput(parsed = {}, s6FinalAnswer = "", question = "") {
  const hypotheses = Array.isArray(parsed.understanding_hypotheses)
    ? parsed.understanding_hypotheses.map((h) => String(h).trim()).filter(Boolean)
    : parsed.understanding_hypothesis
      ? [String(parsed.understanding_hypothesis).trim()]
      : [];

  return {
    schema_version: S7_BORROWED_SENSES_SCHEMA_B,
    s7a_schema_version: S7_BORROWED_SENSES_SCHEMA,
    understanding_hypotheses: hypotheses,
    customer_intent: normalizeTextField(parsed.customer_intent),
    emotional_signal: normalizeNullable(parsed.emotional_signal),
    hesitation_signal: normalizeNullable(parsed.hesitation_signal),
    context_carryover: normalizeNullable(parsed.context_carryover),
    visual_observation: normalizeNullable(parsed.visual_observation),
    answer_purpose: normalizeTextField(parsed.answer_purpose),
    must_not_assume: Array.isArray(parsed.must_not_assume)
      ? parsed.must_not_assume.map((s) => String(s).trim()).filter(Boolean)
      : [],
    used_facts: Array.isArray(parsed.used_facts)
      ? parsed.used_facts.map((s) => String(s).trim()).filter(Boolean)
      : [],
    recommendation_basis: normalizeNullable(parsed.recommendation_basis),
    voice_raw_candidate: normalizeNullable(parsed.voice_raw_candidate),
    key_purpose: normalizeNullable(parsed.key_purpose),
    leadership_move: normalizeNullable(parsed.leadership_move),
    insurance_expertise_angle: Array.isArray(parsed.insurance_expertise_angle)
      ? parsed.insurance_expertise_angle.map((s) => String(s).trim()).filter(Boolean)
      : [],
    insurance_expertise_rationale: normalizeNullable(parsed.insurance_expertise_rationale),
    proposal_direction: normalizeNullable(parsed.proposal_direction),
    next_decision_point: repairNextDecisionPoints(parsed, question),
    final_answer_source: "s6",
    s6_final_answer_snapshot: String(s6FinalAnswer ?? "").trim(),
  };
}

function normalizeTextField(value) {
  return String(value ?? "").trim() || null;
}

function normalizeNullable(value) {
  const t = String(value ?? "").trim();
  return t || null;
}

async function callClaudeBorrowedSenses({
  model,
  apiKey,
  userPayload,
  fetchImpl,
  signal,
  temperature,
  repairRaw = null,
  repairReason = "json",
}) {
  const repairMessage =
    repairReason === "leadership"
      ? "Your previous output omitted next_decision_point (need 2-3 choices). Call emit_borrowed_senses again with all required fields including next_decision_point."
      : "Your previous output was not valid structured JSON. Call emit_borrowed_senses again with all required fields. JSON only via tool call.";
  const messages = repairRaw
    ? [
        { role: "user", content: JSON.stringify(userPayload, null, 2) },
        {
          role: "assistant",
          content: [{ type: "text", text: repairRaw }],
        },
        {
          role: "user",
          content: repairMessage,
        },
      ]
    : [{ role: "user", content: JSON.stringify(userPayload, null, 2) }];

  const res = await fetchImpl("https://api.anthropic.com/v1/messages", {
    method: "POST",
    signal,
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      max_tokens: 2048,
      temperature: Math.min(0.45, Math.max(0.15, Number(temperature) || DEFAULT_TEMPERATURE)),
      system: buildSystemPrompt(),
      tools: [BORROWED_SENSES_TOOL],
      tool_choice: { type: "tool", name: "emit_borrowed_senses" },
      messages,
    }),
  });

  if (!res.ok) {
    return { ok: false, error: `CLAUDE_API_${res.status}`, data: null, raw: null };
  }

  const data = await res.json();
  const parsed = extractParsedFromResponse(data);
  const raw = JSON.stringify(data.content ?? []);
  if (!parsed) {
    return { ok: false, error: "CLAUDE_JSON_PARSE_FAIL", data, raw };
  }
  return { ok: true, parsed, data, raw };
}

/**
 * Shadow-only borrowed senses probe — never mutates S6 final_answer.
 */
export async function runBorrowedSensesShadowProbe({
  question = "",
  directive = null,
  decision = null,
  history = [],
  previousAnswerSummary = "",
  s6FinalAnswer = "",
  visualBlocks = [],
  env = process.env,
  fetchImpl = fetch,
  timeoutMs = Number(env.KEY_BORROWED_SENSES_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS,
  temperature = DEFAULT_TEMPERATURE,
} = {}) {
  const apiKey = resolveAnthropicApiKey(env);
  const base = {
    schema_version: S7_BORROWED_SENSES_SCHEMA_B,
    shadow_only: true,
    customer_text_changed: false,
    final_answer_source: "s6",
    s6_final_answer: String(s6FinalAnswer ?? "").trim(),
    provider: null,
    error: null,
    borrowed: null,
    gate: null,
    raw: null,
    attempts: 0,
  };

  if (!apiKey) {
    return {
      ...base,
      error: "ANTHROPIC_NOT_CONFIGURED",
    };
  }

  const model = String(env.ANTHROPIC_MODEL ?? env.CLAUDE_MODEL ?? DEFAULT_MODEL).trim();
  const userPayload = buildUserPayload({
    question,
    directive,
    decision,
    history,
    previousAnswerSummary,
    s6FinalAnswer,
    visualBlocks,
  });

  let lastRaw = null;
  let lastError = "CLAUDE_JSON_PARSE_FAIL";
  let parseRetryUsed = false;
  let leadershipRetryCount = 0;
  let timeoutRetryUsed = false;
  let activeTimeoutMs = Number(timeoutMs) || DEFAULT_TIMEOUT_MS;
  let attempts = 0;
  const maxAttempts = 5;

  try {
    while (attempts < maxAttempts) {
      attempts += 1;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), activeTimeoutMs);
      const attemptTemp =
        attempts === 1 ? temperature : Math.min(0.22, Number(temperature) || DEFAULT_TEMPERATURE);

      let repairRaw = null;
      let repairReason = "json";
      if (parseRetryUsed && lastRaw) {
        repairRaw = lastRaw;
        repairReason = "json";
      } else if (leadershipRetryCount > 0 && lastRaw) {
        repairRaw = lastRaw;
        repairReason = "leadership";
      }

      let result;
      try {
        result = await callClaudeBorrowedSenses({
          model,
          apiKey,
          userPayload,
          fetchImpl,
          signal: controller.signal,
          temperature: attemptTemp,
          repairRaw,
          repairReason,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        result = {
          ok: false,
          error: /abort|timeout/i.test(msg) ? "CLAUDE_TIMEOUT" : "CLAUDE_FETCH_ERROR",
          raw: null,
        };
      } finally {
        clearTimeout(timer);
      }

      if (!result.ok && result.error?.startsWith("CLAUDE_API_")) {
        return { ...base, error: result.error, provider: "anthropic", attempts };
      }

      lastRaw = result.raw;
      if (result.ok && result.parsed) {
        const borrowed = normalizeBorrowedOutput(result.parsed, s6FinalAnswer, question);
        const gate = gateBorrowedSensesOutput({
          borrowed,
          directive,
          history,
          question,
          visualBlocks,
        });

        if ((gate.missing_next_decision || gate.missing_proposal_direction) && leadershipRetryCount < 2) {
          leadershipRetryCount += 1;
          lastRaw = JSON.stringify(result.parsed, null, 2);
          userPayload.s7b_retry_hint = gate.missing_proposal_direction
            ? "RETRY: proposal_direction MUST be a non-empty review direction within confirmed facts (NOT product enroll/cancel). For 보험료 부담: e.g. separate essential vs overlapping coverage before cutting cost. Also keep next_decision_point with 2-3 choices."
            : "RETRY: next_decision_point must contain 2-3 non-empty customer choices. For 암보험/암 보장: 진단비·수술비·치료비 choices. For 보험료 부담: 납입 큰 계약 / 겹치는 보장 / 필수 보장 choices. Never leave next_decision_point empty.";
          continue;
        }

        return {
          ...base,
          provider: "anthropic",
          model,
          raw: result.raw,
          borrowed,
          gate,
          error: null,
          attempts,
        };
      }

      lastError = result.error ?? "CLAUDE_JSON_PARSE_FAIL";

      if (lastError === "CLAUDE_TIMEOUT" && !timeoutRetryUsed) {
        timeoutRetryUsed = true;
        activeTimeoutMs = TIMEOUT_RETRY_MS;
        continue;
      }

      if (lastError === "CLAUDE_JSON_PARSE_FAIL" && !parseRetryUsed) {
        parseRetryUsed = true;
        continue;
      }

      break;
    }

    return {
      ...base,
      error: lastError,
      raw: lastRaw,
      provider: "anthropic",
      model,
      attempts,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      ...base,
      error: /abort|timeout/i.test(msg) ? "CLAUDE_TIMEOUT" : "CLAUDE_FETCH_ERROR",
      provider: "anthropic",
      attempts,
    };
  }
}

export { S7_BORROWED_SENSES_SCHEMA, S7_BORROWED_SENSES_SCHEMA_B, summarizeVisualBlocks, buildUserPayload };
