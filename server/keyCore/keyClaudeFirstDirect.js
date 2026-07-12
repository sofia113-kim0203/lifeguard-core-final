/**
 * Preview experiment — Claude-first direct customer answer.
 * KEY: auth/ownership (caller) · verified raw materials · concrete CLOSED hard check only.
 * Does not confirm intent/Decision/Goal before Claude.
 * Does not run S3–S6 compose. Does not rewrite soft-pass answers.
 * Production must never enable (isClaudeFirstDirectPreview).
 */
import {
  isKeyBorrowedSensesProbeEnabled,
  isKeyBorrowedSensesStage2Partial,
  isVercelProductionEnv,
  ONE_KEY_CORE_RESPONSE_SOURCE,
} from "./oneKeyCoreFlags.js";
import { buildVerifiedCustomerChart } from "./keyBorrowedSensesSpeak.js";
import { collectVerifiedSpeakAllowlistFromReality } from "./keyVoiceDirective.js";
import { buildClaudeFullContextPack } from "./keyClaudeFullContextPack.js";
import { gateKeyVoiceAnswer, jailbreakAudit } from "./keyVoiceGate.js";
import { KEY_MONOPOLY_FAILURE_CUSTOMER_TEXT } from "./keyCustomerMonopoly.js";
import { sealKeyCustomerText } from "./keyCustomerTextSeal.js";
import { startSpan, resolveDeployIdentity } from "./keyLatencyMarks.js";

const DEFAULT_MODEL = "claude-sonnet-4-6";
const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";

/** Preview-only answer-first tool — customer_answer required; decision/goal/visual optional. */
export const CLAUDE_FIRST_DIRECT_EMIT_TOOL = Object.freeze({
  name: "emit_claude_full",
  description:
    "Emit the customer-facing Korean answer first. Optional fields may be omitted.",
  input_schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      customer_answer: {
        type: "string",
        description:
          "Full natural Korean customer-facing answer. Delivered as-is after hard safety only.",
      },
      visual_blocks: {
        type: "array",
        items: { type: "object", additionalProperties: true },
      },
      decision: {
        type: ["object", "null"],
        additionalProperties: true,
      },
      session_goal: {
        type: ["string", "null"],
      },
    },
    required: ["customer_answer"],
  },
});

const CLOSED_HARD = new Set([
  "jailbreak_fact",
  "unsupported_recommendation",
  "hard_sales_push",
  "product_push_as_direction",
  "closing_or_signup_push",
  "leadership_cancel_enroll_certainty",
  "empty_answer",
  "empty_voice",
  "answer_forbidden_certainty",
  "unverified_customer_coverage_claim",
  "number_scope_violation",
  "context_hallucination",
  "unsupported_public_research_claim",
  "unsupported_place_claim",
  "unsourced_public_assertion",
]);

export function isClaudeFirstDirectPreview(env = process.env) {
  if (isVercelProductionEnv(env)) return false;
  if (isKeyBorrowedSensesStage2Partial(env)) return false;
  if (!isKeyBorrowedSensesProbeEnabled(env)) return false;
  // Preview path lock: on whenever borrowed probe is on (shadow|active).
  // Optional explicit off: KEY_CLAUDE_FIRST_DIRECT=0
  const flag = String(env.KEY_CLAUDE_FIRST_DIRECT ?? "1").trim().toLowerCase();
  if (flag === "0" || flag === "false" || flag === "off") return false;
  return true;
}

function relMs(startedAt) {
  return Math.max(0, Date.now() - startedAt);
}

function extractPoliciesFromContext({
  loadedContext = null,
  customerContextBundle = null,
  unifiedState = null,
} = {}) {
  const fromLoaded = Array.isArray(loadedContext?.policies) ? loadedContext.policies : null;
  const fromBundle = Array.isArray(customerContextBundle?.policies)
    ? customerContextBundle.policies
    : null;
  const fromUnified = Array.isArray(unifiedState?.policies) ? unifiedState.policies : null;
  const policies = fromLoaded ?? fromBundle ?? fromUnified ?? [];
  const policy_count =
    Number(
      loadedContext?.policy_count ??
        customerContextBundle?.policy_count ??
        customerContextBundle?.active_policy_count ??
        unifiedState?.policy_count ??
        unifiedState?.active_policy_count ??
        policies.length ??
        0,
    ) || policies.length;
  return { policies, policy_count };
}

/**
 * Progressive extract of customer_answer string from partial tool JSON.
 * Returns { text, complete } where complete means closing quote seen.
 */
export function extractPartialCustomerAnswer(partialJson = "") {
  const src = String(partialJson ?? "");
  const key = /"customer_answer"\s*:\s*"/;
  const m = key.exec(src);
  if (!m) return { text: "", complete: false };
  let i = m.index + m[0].length;
  let out = "";
  let complete = false;
  while (i < src.length) {
    const c = src[i];
    if (c === "\\") {
      const n = src[i + 1];
      if (n == null) break;
      const map = { n: "\n", r: "\r", t: "\t", '"': '"', "\\": "\\", "/": "/" };
      if (n === "u" && /^[0-9a-fA-F]{4}/.test(src.slice(i + 2, i + 6))) {
        out += String.fromCharCode(parseInt(src.slice(i + 2, i + 6), 16));
        i += 6;
        continue;
      }
      out += map[n] ?? n;
      i += 2;
      continue;
    }
    if (c === '"') {
      complete = true;
      break;
    }
    out += c;
    i += 1;
  }
  return { text: out, complete };
}

function buildSystemPrompt() {
  return [
    "You are KEY speaking directly to the customer in natural Korean.",
    "Answer the customer's current question first, using only verified_customer_chart, allowed_numbers, allowed_entities, and conversation originals provided.",
    "Do not invent policy counts, premiums, insurers, products, coverages, or place names absent from the materials.",
    "If materials are incomplete, say what is confirmed and what still needs checking — do not invent.",
    "Do not push enrollment, cancellation, or definitive '충분/부족합니다' verdicts.",
    "Call emit_claude_full with customer_answer as the full customer-facing reply.",
    "Decision/session_goal/visual_blocks are optional — never delay customer_answer for them.",
  ].join("\n");
}

function buildUserPayload({ question, chart, allowlist, contextPack }) {
  return {
    mode: "claude_first_direct_preview",
    customer_question: String(question ?? ""),
    conversation_originals: {
      recent_turns: contextPack?.recent_turns ?? [],
      older_summary: contextPack?.older_summary ?? null,
      retained_past_originals: contextPack?.retained_past_originals ?? [],
    },
    verified_customer_chart: chart,
    allowed_numbers: allowlist?.allowed_numbers ?? [],
    allowed_entities: allowlist?.allowed_entities ?? [],
    insurer_counts: allowlist?.insurer_counts ?? null,
    product_counts: allowlist?.product_counts ?? null,
  };
}

async function readAnthropicSseWithAnswerStream({
  res,
  startedAt,
  onFirstContent = null,
}) {
  const reader = res.body?.getReader?.();
  if (!reader) {
    const dataRaw = await res.json();
    return {
      dataRaw,
      ttft_ms: startedAt != null ? relMs(startedAt) : null,
      streamed_answer: "",
      answer_complete_before_end: false,
    };
  }
  const decoder = new TextDecoder();
  let buffer = "";
  let ttft_ms = null;
  let message = null;
  let usage = null;
  let contentBlocks = [];
  let streamedAnswer = "";
  let answerComplete = false;
  let firstContentNotified = false;

  const markTtft = () => {
    if (ttft_ms == null && startedAt != null) {
      ttft_ms = relMs(startedAt);
      if (!firstContentNotified) {
        firstContentNotified = true;
        onFirstContent?.(ttft_ms);
      }
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split("\n");
    buffer = parts.pop() ?? "";
    for (const line of parts) {
      const trimmed = line.trimEnd();
      if (!trimmed.startsWith("data:")) continue;
      const payload = trimmed.slice(5).trim();
      if (!payload || payload === "[DONE]") continue;
      let evt;
      try {
        evt = JSON.parse(payload);
      } catch {
        continue;
      }
      const type = String(evt?.type ?? "");
      if (type === "message_start" && evt.message) {
        message = evt.message;
        if (Array.isArray(message.content)) contentBlocks = [...message.content];
      } else if (type === "content_block_start") {
        markTtft();
        const idx = Number(evt.index);
        if (Number.isFinite(idx)) {
          const block =
            evt.content_block && typeof evt.content_block === "object"
              ? { ...evt.content_block }
              : { type: "text", text: "" };
          if (block.type === "tool_use") block.input_json = block.input_json ?? "";
          contentBlocks[idx] = block;
        }
      } else if (type === "content_block_delta") {
        markTtft();
        const idx = Number(evt.index);
        const delta = evt.delta ?? {};
        if (!Number.isFinite(idx)) continue;
        if (!contentBlocks[idx]) contentBlocks[idx] = { type: "text", text: "" };
        if (delta.type === "text_delta") {
          contentBlocks[idx].text = `${contentBlocks[idx].text ?? ""}${delta.text ?? ""}`;
        } else if (delta.type === "input_json_delta") {
          contentBlocks[idx].input_json =
            `${contentBlocks[idx].input_json ?? ""}${delta.partial_json ?? ""}`;
          contentBlocks[idx].type = contentBlocks[idx].type || "tool_use";
          const partial = extractPartialCustomerAnswer(contentBlocks[idx].input_json ?? "");
          if (partial.text.length > streamedAnswer.length) {
            streamedAnswer = partial.text;
          }
          if (partial.complete) answerComplete = true;
        }
      } else if (type === "message_delta") {
        if (evt.usage) usage = { ...(usage ?? {}), ...evt.usage };
      }
    }
  }

  const content = contentBlocks.map((block) => {
    if (!block || typeof block !== "object") return block;
    if (block.type === "tool_use" || block.input_json != null) {
      let input = block.input;
      if (block.input_json) {
        try {
          input = JSON.parse(block.input_json);
        } catch {
          input = block.input ?? {};
        }
      }
      return {
        type: "tool_use",
        id: block.id ?? null,
        name: block.name ?? null,
        input: input ?? {},
      };
    }
    return block;
  });

  return {
    dataRaw: {
      ...(message && typeof message === "object" ? message : {}),
      content,
      usage: usage ?? message?.usage ?? null,
    },
    ttft_ms,
    streamed_answer: streamedAnswer,
    answer_complete_before_end: answerComplete,
  };
}

function pickCustomerAnswer(dataRaw) {
  const blocks = Array.isArray(dataRaw?.content) ? dataRaw.content : [];
  for (const b of blocks) {
    if (b?.type === "tool_use" && b?.name === "emit_claude_full") {
      const answer = String(b.input?.customer_answer ?? "").trim();
      if (answer) {
        return {
          customer_answer: answer,
          visual_blocks: Array.isArray(b.input?.visual_blocks) ? b.input.visual_blocks : [],
          decision: b.input?.decision ?? null,
          session_goal: b.input?.session_goal ?? null,
        };
      }
    }
  }
  return { customer_answer: "", visual_blocks: [], decision: null, session_goal: null };
}

/**
 * Concrete CLOSED hard only — soft reasons never veto or rewrite.
 */
export function hardOnlySafetyCheck(text, { allowed_numbers = [], allowed_entities = [] } = {}) {
  const insurerGuess =
    allowed_entities.find((e) => /생명|손보|화재|해상|보험/.test(String(e))) ?? null;
  const directive = {
    allowed_numbers,
    allowed_fact_tokens: {
      insurer: insurerGuess,
      product: null,
      policy_count: allowed_numbers[0] ?? null,
    },
    original_user_question: "",
    required_claims: [],
    optional_claims: [],
    facts_to_speak: [],
  };
  const gate = gateKeyVoiceAnswer({ text, directive, s5ReferenceText: "" });
  const hard = [];
  for (const reason of gate.reasons ?? []) {
    const key = String(reason).replace(/^answer_facing:/, "");
    if (CLOSED_HARD.has(key) || CLOSED_HARD.has(String(reason))) {
      hard.push(String(reason));
      continue;
    }
    // Gate emits recommendation_or_termination for enroll/cancel/definitive — treat as CLOSED hard.
    // Do NOT promote soft forbidden:* / du1 / over_familiar into hard (call-site only).
    if (key === "recommendation_or_termination") {
      hard.push(String(reason));
    }
  }
  const jail = jailbreakAudit(directive, text);
  if (jail.forbidden_fact_violation && !hard.includes("jailbreak_fact")) {
    hard.push("jailbreak_fact");
  }
  if (!String(text ?? "").trim() && !hard.includes("empty_answer")) {
    hard.push("empty_answer");
  }
  return {
    hard_fail: hard.length > 0,
    hard,
    soft: (gate.reasons ?? []).filter((r) => !hard.includes(r)),
    jailbreak_detail: jail,
  };
}

async function callClaudeFirstDirect({
  question,
  history,
  reality,
  env,
  fetchImpl = fetch,
  startedAt = Date.now(),
  onFirstContent = null,
}) {
  const apiKey = String(env.ANTHROPIC_API_KEY ?? "").trim();
  if (!apiKey) {
    return { ok: false, error: "ANTHROPIC_NOT_CONFIGURED" };
  }
  const model = String(env.ANTHROPIC_MODEL ?? env.CLAUDE_MODEL ?? DEFAULT_MODEL).trim();
  const chart = buildVerifiedCustomerChart(reality);
  const allowlist = collectVerifiedSpeakAllowlistFromReality(reality);
  const { pack: contextPack } = buildClaudeFullContextPack({
    history,
    question,
  });
  const userPayload = buildUserPayload({
    question,
    chart,
    allowlist,
    contextPack,
  });
  const system = buildSystemPrompt();
  const body = {
    model,
    max_tokens: 4096,
    temperature: 0.35,
    system,
    tools: [CLAUDE_FIRST_DIRECT_EMIT_TOOL],
    tool_choice: { type: "tool", name: "emit_claude_full" },
    messages: [{ role: "user", content: JSON.stringify(userPayload) }],
    stream: true,
  };

  const res = await fetchImpl(ANTHROPIC_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    return {
      ok: false,
      error: `ANTHROPIC_HTTP_${res.status}`,
      detail: String(errText).slice(0, 400),
      model,
    };
  }

  const streamed = await readAnthropicSseWithAnswerStream({
    res,
    startedAt,
    onFirstContent,
  });
  const picked = pickCustomerAnswer(streamed.dataRaw);
  const customer_answer = String(
    picked.customer_answer || streamed.streamed_answer || "",
  ).trim();

  return {
    ok: Boolean(customer_answer),
    customer_answer,
    visual_blocks: picked.visual_blocks,
    decision: picked.decision,
    session_goal: picked.session_goal,
    ttft_ms: streamed.ttft_ms,
    chart,
    allowlist,
    error: customer_answer ? null : "empty_customer_answer",
  };
}

/**
 * Preview Claude-first question turn — skips interpret/Decision/Goal/planner/S3–S6.
 */
export async function runClaudeFirstDirectQuestionTurn({
  question,
  history = [],
  loadedContext = null,
  customerContextBundle = null,
  unifiedState = null,
  contextSnapshot = null,
  env = process.env,
  fetchImpl = fetch,
  startedAt = Date.now(),
  streamHandlers = null,
} = {}) {
  const span = startSpan(startedAt);
  const { policies, policy_count } = extractPoliciesFromContext({
    loadedContext,
    customerContextBundle,
    unifiedState,
  });
  const reality = { policies, policy_count };

  let firstTokenMs = null;
  const claude = await callClaudeFirstDirect({
    question,
    history,
    reality,
    env,
    fetchImpl,
    startedAt,
    onFirstContent: (ms) => {
      firstTokenMs = ms;
    },
  });
  const emitMark = span.end();

  if (!claude.ok || !claude.customer_answer) {
    const sealed = sealKeyCustomerText(KEY_MONOPOLY_FAILURE_CUSTOMER_TEXT);
    return {
      ok: true,
      customerText: sealed.key_speak_original,
      keySpeakOriginal: sealed.key_speak_original,
      visualBlocks: [],
      key_monopoly_failure: true,
      failure_reason: claude.error ?? "claude_first_empty",
      agentTurn: {
        text: sealed.key_speak_original,
        responseSource: ONE_KEY_CORE_RESPONSE_SOURCE.QUESTION,
        consultationIntent: { intent: "claude_first_direct" },
        factBundle: { policies, policy_count, one_key_core: true },
      },
      modeDecision: null,
      loadedContext,
      contextSnapshot,
      unifiedState,
      customerContextBundle,
      salesDirectorTrace: {
        one_key_core: true,
        one_key_core_s1: true,
        compose_mode: "key_claude_first_direct",
        key_compose_trace: {
          compose_mode: "key_claude_first_direct",
          key_voice_trace: {
            used_failure_mode: true,
            fallback_reason: claude.error ?? "claude_first_empty",
            latency_marks: {
              claude_full_emit: emitMark,
              ttft_ms: firstTokenMs ?? claude.ttft_ms ?? null,
              ...resolveDeployIdentity(env),
            },
          },
        },
      },
      oneKeyCoreTrace: {
        schema_version: "one-key-core-trace-claude-first-v1",
        steps: [
          { step: "context", at_ms: 0, payload: { policy_count, policies: policies.length } },
          {
            step: "claude_first_direct",
            at_ms: emitMark?.exit_ms ?? relMs(startedAt),
            payload: { error: claude.error ?? "empty", ttft_ms: firstTokenMs ?? claude.ttft_ms },
          },
        ],
        legacy_paths_blocked: ["interpret", "decision", "planner", "s3_s6_compose"],
      },
    };
  }

  const safety = hardOnlySafetyCheck(claude.customer_answer, {
    allowed_numbers: claude.allowlist?.allowed_numbers ?? [],
    allowed_entities: claude.allowlist?.allowed_entities ?? [],
  });

  let finalText = claude.customer_answer;
  let usedFailure = false;
  let failureReason = null;
  if (safety.hard_fail) {
    finalText = KEY_MONOPOLY_FAILURE_CUSTOMER_TEXT;
    usedFailure = true;
    failureReason = safety.hard.join(";") || "closed_hard";
  }

  // As-is delivery (no polish rewrite). Seal only.
  const sealed = sealKeyCustomerText(finalText);

  // Emit after hard check so we never paint then yank; TTFT measured at Claude first byte.
  if (streamHandlers?.onDelta && !streamHandlers._emitted) {
    streamHandlers.onDelta(sealed.key_speak_original);
    streamHandlers._emitted = true;
    streamHandlers.onFirstToken?.(firstTokenMs ?? claude.ttft_ms ?? relMs(startedAt));
  }

  return {
    ok: true,
    customerText: sealed.key_speak_original,
    keySpeakOriginal: sealed.key_speak_original,
    visualBlocks: usedFailure ? [] : claude.visual_blocks ?? [],
    key_monopoly_failure: usedFailure,
    failure_reason: failureReason,
    agentTurn: {
      text: sealed.key_speak_original,
      responseSource: ONE_KEY_CORE_RESPONSE_SOURCE.QUESTION,
      consultationIntent: { intent: "claude_first_direct" },
      factBundle: {
        policies,
        policy_count,
        one_key_core: true,
        claude_first_direct: true,
      },
    },
    modeDecision: null,
    loadedContext,
    contextSnapshot,
    unifiedState,
    customerContextBundle,
    salesDirectorTrace: {
      one_key_core: true,
      one_key_core_s1: true,
      compose_mode: "key_claude_first_direct",
      decision: claude.decision ?? null,
      session_goal: claude.session_goal ?? null,
      key_compose_trace: {
        compose_mode: "key_claude_first_direct",
        key_voice_trace: {
          provider: "claude_first_direct",
          used_failure_mode: usedFailure,
          fallback_reason: failureReason,
          focused_correction_count: 0,
          hard_safety_repair_attempt: 0,
          s6_speak_calls: 0,
          soft_reasons_ignored: safety.soft,
          hard_reasons: safety.hard,
          jailbreak_detail: safety.jailbreak_detail,
          latency_marks: {
            claude_full_emit: emitMark,
            ttft_ms: firstTokenMs ?? claude.ttft_ms ?? null,
            ...resolveDeployIdentity(env),
          },
        },
      },
    },
    oneKeyCoreTrace: {
      schema_version: "one-key-core-trace-claude-first-v1",
      steps: [
        {
          step: "context",
          at_ms: 0,
          payload: { policy_count, policy_rows: policies.length },
        },
        {
          step: "claude_first_direct",
          at_ms: emitMark?.exit_ms ?? relMs(startedAt),
          payload: {
            compose_mode: "key_claude_first_direct",
            ttft_ms: firstTokenMs ?? claude.ttft_ms ?? null,
            hard_fail: usedFailure,
            hard_reasons: safety.hard,
            soft_ignored: safety.soft,
            answer_preview: String(claude.customer_answer).slice(0, 300),
          },
        },
        {
          step: "speak",
          at_ms: relMs(startedAt),
          payload: {
            compose_mode: "key_claude_first_direct",
            draft_preview: String(sealed.key_speak_original).slice(0, 300),
          },
        },
      ],
      legacy_paths_blocked: [
        "interpret_before_claude",
        "decision_before_claude",
        "session_goal_before_claude",
        "planner_before_claude",
        "s3_s6_compose",
        "soft_rewrite",
        "focused_correction",
      ],
      customer_text_path: ["claude_first_direct", "hard_only_check", "sealKeyCustomerText"],
    },
  };
}
