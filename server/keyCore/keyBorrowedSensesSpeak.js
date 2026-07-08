/**
 * S7-a — Borrowed Senses shadow speak (Claude 1-call structured JSON · trace only).
 */
import { resolveAnthropicApiKey } from "../claudeGroundedExecutionCore.js";
import { gateBorrowedSensesOutput, S7_BORROWED_SENSES_SCHEMA } from "./keyBorrowedSensesGate.js";

const DEFAULT_MODEL = "claude-sonnet-4-6";
const DEFAULT_TIMEOUT_MS = 35000;
const TIMEOUT_RETRY_MS = 45000;
const DEFAULT_TEMPERATURE = 0.3;
const MAX_PARSE_RETRIES = 1;

const BORROWED_SENSES_TOOL = {
  name: "emit_borrowed_senses",
  description: "Emit S7-a borrowed senses shadow JSON. Expression candidates only — never replace S6 final_answer.",
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
    "You are KEY Borrowed Senses (S7-a shadow layer) for LIFEGUARD.",
    "Claude provides: hearing, social reading, visual reading, and expression CANDIDATES only.",
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
    "You MUST call emit_borrowed_senses exactly once with valid JSON fields.",
    "final_answer_source must always be \"s6\".",
  ].join(" ");
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
    schema_version: S7_BORROWED_SENSES_SCHEMA,
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

function normalizeBorrowedOutput(parsed = {}, s6FinalAnswer = "") {
  const hypotheses = Array.isArray(parsed.understanding_hypotheses)
    ? parsed.understanding_hypotheses.map((h) => String(h).trim()).filter(Boolean)
    : parsed.understanding_hypothesis
      ? [String(parsed.understanding_hypothesis).trim()]
      : [];

  return {
    schema_version: S7_BORROWED_SENSES_SCHEMA,
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
}) {
  const messages = repairRaw
    ? [
        { role: "user", content: JSON.stringify(userPayload, null, 2) },
        {
          role: "assistant",
          content: [{ type: "text", text: repairRaw }],
        },
        {
          role: "user",
          content:
            "Your previous output was not valid structured JSON. Call emit_borrowed_senses again with all required fields. JSON only via tool call.",
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
      max_tokens: 1536,
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
    schema_version: S7_BORROWED_SENSES_SCHEMA,
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
  let timeoutRetryUsed = false;
  let activeTimeoutMs = Number(timeoutMs) || DEFAULT_TIMEOUT_MS;
  let attempts = 0;

  try {
    while (attempts < 3) {
      attempts += 1;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), activeTimeoutMs);
      const attemptTemp =
        attempts === 1 ? temperature : Math.min(0.22, Number(temperature) || DEFAULT_TEMPERATURE);

      let result;
      try {
        result = await callClaudeBorrowedSenses({
          model,
          apiKey,
          userPayload,
          fetchImpl,
          signal: controller.signal,
          temperature: attemptTemp,
          repairRaw: parseRetryUsed ? lastRaw : null,
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
        const borrowed = normalizeBorrowedOutput(result.parsed, s6FinalAnswer);
        const gate = gateBorrowedSensesOutput({
          borrowed,
          directive,
          history,
          question,
          visualBlocks,
        });

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

export { S7_BORROWED_SENSES_SCHEMA, summarizeVisualBlocks, buildUserPayload };
