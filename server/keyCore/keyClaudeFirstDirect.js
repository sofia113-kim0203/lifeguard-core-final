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
import {
  buildVerifiedCustomerChart,
  ANTHROPIC_WEB_SEARCH_TOOL,
} from "./keyBorrowedSensesSpeak.js";
import { collectVerifiedSpeakAllowlistFromReality } from "./keyVoiceDirective.js";
import { buildClaudeFullContextPack } from "./keyClaudeFullContextPack.js";
import {
  buildClaudeFullUserContentWithPdf,
  verifyAndFetchCustomerPdfOriginal,
} from "./keyClaudeFullDocumentDirect.js";
import {
  gateKeyVoiceAnswer,
  jailbreakAudit,
  recommendationOrTerminationRisk,
} from "./keyVoiceGate.js";
import { KEY_MONOPOLY_FAILURE_CUSTOMER_TEXT } from "./keyCustomerMonopoly.js";
import { sealKeyCustomerText } from "./keyCustomerTextSeal.js";
import { startSpan, resolveDeployIdentity } from "./keyLatencyMarks.js";
import { CLAUDE_FULL_VISUAL_BLOCK_TYPES } from "./keyClaudeFullEmit.js";
import {
  createSentenceCommitStream,
  SENTENCE_COMMIT_ABORT_CLOSER,
} from "./keyClaudeFirstSentenceCommit.js";

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
        description:
          "Optional customer UI charts. Prefer when customer asks for a chart/table or insurance status summary. Allowed types: premium_summary_table, policy_count_summary, coverage_gap_table, coverage_status_card, next_steps_card. Use only verified chart facts; never invent coverages.",
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

export function buildSystemPrompt() {
  return [
    "You are Claude. Answer in natural Korean as yourself — not as an insurance bot, not as a scripted KEY persona.",
    "Decide freely whether the question is insurance, daily life, analysis, or something else, and use your full abilities.",
    "Materials may include verified_customer_chart, conversation originals, and an attached original PDF when present. Use them when helpful; do not invent policy facts that contradict them.",
    "web_search is available — use it when you need fresh public info (e.g. restaurants, places, news). Do not refuse daily questions just because insurance materials exist.",
    "If a PDF is attached, you may read and analyze it directly.",
    "Prefer calling emit_claude_full with customer_answer as the full customer-facing reply. Plain text answers are also acceptable.",
    "Do not push enrollment, cancellation, or definitive '충분/부족합니다' / '문제 없습니다' verdicts without basis.",
    "Do not invent restaurant/place names or policy numbers that are not grounded in materials or search results.",
    "Tone (required): warm, respectful, and clear. Open with a short caring acknowledgment when helpful. Soften uncertainty without sounding cold or accusing. Do not call the customer's records '오류' or '가짜' — say what is confirmed vs not yet confirmed.",
    "When the customer asks whether riders/특약을 can be added: explain the concept kindly, clarify you cannot enroll or change the policy here, and invite sharing the 증권 for a concrete review. Do not use '지금 가입하세요' style language.",
    "Charts: when the customer asks for a chart/table/현황 정리, or when an insurance status summary benefits from a table, include visual_blocks on emit_claude_full (coverage_status_card, policy_count_summary, premium_summary_table, or coverage_gap_table) using ONLY verified_customer_chart facts. Omit visual_blocks for pure daily chit-chat.",
    "Customer-facing presentation (required):",
    "- No emoji, emoticons, or decorative pictographs.",
    "- No HTML or citation markup in customer_answer (never output <cite> or other tags).",
    "- Clean readable Korean: short paragraphs, ## headings when helpful, - bullet lists, **bold** sparingly for key phrases.",
    "- Prefer clear structure over decoration. --- separators are ok when they help scanning.",
  ].join("\n");
}

function buildUserPayload({ question, chart, allowlist, contextPack, pdfMeta = null }) {
  return {
    mode: "claude_native_first_preview",
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
    direct_document: pdfMeta
      ? {
          attached: pdfMeta.attached === true,
          document_id: pdfMeta.document_id ?? null,
          original_filename: pdfMeta.original_filename ?? null,
          note: pdfMeta.attached
            ? "Original PDF is attached as a document block. Read it yourself — no KEY pre-summary."
            : pdfMeta.note ?? "No PDF attached for this turn.",
        }
      : { attached: false, note: "No PDF attached for this turn." },
    guidance:
      "Answer warmly and clearly in Korean. Insurance materials are optional context, not a mandate to steer every topic back to insurance. No emoji/<cite>/HTML. Prefer headings and lists. If a chart/table is requested for insurance status, also emit visual_blocks from verified_customer_chart only.",
  };
}

async function readAnthropicSseWithAnswerStream({
  res,
  startedAt,
  onFirstContent = null,
  onAnswerProgress = null,
}) {
  const reader = res.body?.getReader?.();
  if (!reader) {
    const dataRaw = await res.json();
    const picked = pickCustomerAnswer(dataRaw);
    if (picked.customer_answer) onAnswerProgress?.(picked.customer_answer);
    return {
      dataRaw,
      ttft_ms: startedAt != null ? relMs(startedAt) : null,
      streamed_answer: picked.customer_answer || "",
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

  const publishProgress = () => {
    const textParts = contentBlocks
      .filter((b) => b?.type === "text" && String(b.text ?? "").trim())
      .map((b) => String(b.text));
    const fromText = textParts.join("\n\n").trim();
    const progress = streamedAnswer || fromText;
    if (progress) onAnswerProgress?.(progress);
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
          publishProgress();
        } else if (delta.type === "input_json_delta") {
          contentBlocks[idx].input_json =
            `${contentBlocks[idx].input_json ?? ""}${delta.partial_json ?? ""}`;
          contentBlocks[idx].type = contentBlocks[idx].type || "tool_use";
          const partial = extractPartialCustomerAnswer(contentBlocks[idx].input_json ?? "");
          if (partial.text.length > streamedAnswer.length) {
            streamedAnswer = partial.text;
            publishProgress();
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

function sanitizeClaudeFirstVisualBlocks(raw) {
  if (!Array.isArray(raw)) return [];
  const allowed = new Set(CLAUDE_FULL_VISUAL_BLOCK_TYPES);
  return raw
    .filter((b) => b && typeof b === "object")
    .map((b) => {
      const type = String(b.type ?? "").trim();
      if (!allowed.has(type)) return null;
      const out = { type };
      if (b.title != null) out.title = String(b.title);
      if (b.subtitle != null) out.subtitle = String(b.subtitle);
      if (Array.isArray(b.columns)) {
        out.columns = b.columns.map((c) => String(c ?? ""));
      }
      if (Array.isArray(b.rows)) {
        out.rows = b.rows.map((row) =>
          (Array.isArray(row) ? row : []).map((c) => String(c ?? "")),
        );
      }
      if (Array.isArray(b.steps)) {
        out.steps = b.steps
          .filter((s) => s && typeof s === "object")
          .map((s, idx) => ({
            order: Number.isFinite(Number(s.order)) ? Number(s.order) : idx + 1,
            label: String(s.label ?? ""),
            move: String(s.move ?? ""),
          }));
      }
      return out;
    })
    .filter(Boolean);
}

function pickCustomerAnswer(dataRaw) {
  const blocks = Array.isArray(dataRaw?.content) ? dataRaw.content : [];
  for (const b of blocks) {
    if (b?.type === "tool_use" && b?.name === "emit_claude_full") {
      const answer = String(b.input?.customer_answer ?? "").trim();
      if (answer) {
        return {
          customer_answer: answer,
          visual_blocks: sanitizeClaudeFirstVisualBlocks(b.input?.visual_blocks),
          decision: b.input?.decision ?? null,
          session_goal: b.input?.session_goal ?? null,
          source: "emit_claude_full",
        };
      }
    }
  }
  // Native Claude may answer as plain text without the tool.
  const textParts = blocks
    .filter((b) => b?.type === "text" && String(b.text ?? "").trim())
    .map((b) => String(b.text).trim());
  if (textParts.length) {
    return {
      customer_answer: textParts.join("\n\n").trim(),
      visual_blocks: [],
      decision: null,
      session_goal: null,
      source: "plain_text",
    };
  }
  return {
    customer_answer: "",
    visual_blocks: [],
    decision: null,
    session_goal: null,
    source: null,
  };
}

/**
 * Monopoly A — call-site only (gate body unchanged).
 * Do not monopoly-replace recommendation_or_termination for definitive-verdict-only /
 * explanatory wording. Still replace real enroll / cancel / close-push.
 */
export function selectReplacingHardReasons(hardReasons = [], text = "") {
  const REPLACE_HARD = new Set([
    "recommendation_or_termination",
    "empty_answer",
    "empty_voice",
    "hard_sales_push",
    "closing_or_signup_push",
    "product_push_as_direction",
    "leadership_cancel_enroll_certainty",
    "unsupported_recommendation",
  ]);
  const risk = recommendationOrTerminationRisk(text);
  return (hardReasons ?? []).filter((r) => {
    const key = String(r).replace(/^answer_facing:/, "");
    if (!REPLACE_HARD.has(key) && !REPLACE_HARD.has(String(r))) return false;
    if (key === "recommendation_or_termination" || r === "recommendation_or_termination") {
      return (
        risk.enrollment_push === true ||
        risk.cancellation_push === true ||
        risk.termination_close_risk === true
      );
    }
    return true;
  });
}

function latestDocumentIdFromContext(loadedContext = null) {
  const docs = Array.isArray(loadedContext?.documents) ? loadedContext.documents : [];
  for (let i = docs.length - 1; i >= 0; i -= 1) {
    const id = String(docs[i]?.id ?? docs[i]?.document_id ?? "").trim();
    if (id) return id;
  }
  return null;
}

async function resolveOptionalPdfAttachment({
  userSupabase = null,
  customerId = null,
  loadedContext = null,
  env = process.env,
} = {}) {
  const documentId = latestDocumentIdFromContext(loadedContext);
  if (!documentId || !userSupabase || !customerId) {
    return { pdfBase64: null, mediaType: null, meta: { attached: false } };
  }
  try {
    const fetched = await verifyAndFetchCustomerPdfOriginal({
      supabase: userSupabase,
      customerId,
      documentId,
      env,
    });
    if (!fetched?.ok || !fetched.pdfBase64) {
      return {
        pdfBase64: null,
        mediaType: null,
        meta: {
          attached: false,
          document_id: documentId,
          note: fetched?.reason ?? "pdf_attach_skipped",
        },
      };
    }
    return {
      pdfBase64: fetched.pdfBase64,
      mediaType: fetched.mediaType,
      meta: {
        attached: true,
        document_id: documentId,
        original_filename: fetched.document?.original_filename ?? null,
      },
    };
  } catch {
    return {
      pdfBase64: null,
      mediaType: null,
      meta: { attached: false, document_id: documentId, note: "pdf_attach_error" },
    };
  }
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
  onAnswerProgress = null,
  pdfBase64 = null,
  pdfMediaType = null,
  pdfMeta = null,
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
    pdfMeta,
  });
  const system = buildSystemPrompt();
  const tools = [ANTHROPIC_WEB_SEARCH_TOOL, CLAUDE_FIRST_DIRECT_EMIT_TOOL];
  const userContent = buildClaudeFullUserContentWithPdf({
    userPayload,
    pdfBase64,
    mediaType: pdfMediaType,
  });
  let messages = [{ role: "user", content: userContent }];

  let lastTtft = null;
  let lastPicked = {
    customer_answer: "",
    visual_blocks: [],
    decision: null,
    session_goal: null,
    source: null,
  };
  let streamedAnswer = "";

  for (let turn = 0; turn < 4; turn += 1) {
    const forceEmit = turn > 0 && !lastPicked.customer_answer;
    const body = {
      model,
      max_tokens: 4096,
      temperature: 0.4,
      system,
      tools,
      tool_choice: forceEmit
        ? { type: "tool", name: "emit_claude_full" }
        : { type: "auto" },
      messages,
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
      onFirstContent: turn === 0 ? onFirstContent : null,
      onAnswerProgress,
    });
    if (streamed.ttft_ms != null && lastTtft == null) lastTtft = streamed.ttft_ms;
    if (streamed.streamed_answer) streamedAnswer = streamed.streamed_answer;

    const picked = pickCustomerAnswer(streamed.dataRaw);
    if (picked.customer_answer) {
      lastPicked = picked;
      onAnswerProgress?.(picked.customer_answer);
      break;
    }

    // Continue after web_search / intermediate tool use — ask Claude to emit the answer.
    const assistantContent = Array.isArray(streamed.dataRaw?.content)
      ? streamed.dataRaw.content
      : [];
    if (!assistantContent.length) break;
    messages = [
      ...messages,
      { role: "assistant", content: assistantContent },
      {
        role: "user",
        content:
          "이제 고객에게 보여줄 최종 한국어 답변을 emit_claude_full의 customer_answer로 보내 주세요. 따뜻하고 존중하는 톤으로, 이모지·<cite>·HTML 없이, 문단·제목·목록으로 깔끔히 정리하세요. 차트/표가 필요하면 visual_blocks도 함께 넣으세요. 보험으로 억지 전환하지 말고, 현재 질문 자체에 답하세요.",
      },
    ];
  }

  const customer_answer = String(
    lastPicked.customer_answer || streamedAnswer || "",
  ).trim();

  return {
    ok: Boolean(customer_answer),
    customer_answer,
    visual_blocks: lastPicked.visual_blocks,
    decision: lastPicked.decision,
    session_goal: lastPicked.session_goal,
    answer_source: lastPicked.source,
    ttft_ms: lastTtft,
    chart,
    allowlist,
    pdf_attached: Boolean(pdfBase64),
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
  userSupabase = null,
  customerId = null,
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

  const pdf = await resolveOptionalPdfAttachment({
    userSupabase,
    customerId,
    loadedContext,
    env,
  });

  let firstTokenMs = null;
  let sentenceStreamAborted = false;
  let sentenceAbortReason = null;
  const commitStream = createSentenceCommitStream({
    onCommit(sentence) {
      if (!streamHandlers?.onDelta) return;
      streamHandlers.onDelta(sentence);
      streamHandlers._emitted = true;
      if (firstTokenMs == null) {
        firstTokenMs = relMs(startedAt);
        streamHandlers.onFirstToken?.(firstTokenMs);
      }
    },
  });

  const claude = await callClaudeFirstDirect({
    question,
    history,
    reality,
    env,
    fetchImpl,
    startedAt,
    onFirstContent: (ms) => {
      if (firstTokenMs == null) firstTokenMs = ms;
    },
    onAnswerProgress: (text) => {
      const result = commitStream.pushAnswerText(text);
      if (result?.aborted) {
        sentenceStreamAborted = true;
        sentenceAbortReason = commitStream.getAbortReason();
      }
    },
    pdfBase64: pdf.pdfBase64,
    pdfMediaType: pdf.mediaType,
    pdfMeta: pdf.meta,
  });
  const emitMark = span.end();
  commitStream.flush();
  if (commitStream.isAborted()) {
    sentenceStreamAborted = true;
    sentenceAbortReason = commitStream.getAbortReason() ?? sentenceAbortReason;
  }

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

  // Native Claude-first: do not replace a real answer with monopoly for jailbreak_fact alone
  // (citations / derived math / place names from web_search). Gate body unchanged —
  // call-site only chooses which CLOSED reasons may swap customer text.
  // Monopoly A: recommendation_or_termination → monopoly only for enroll/cancel/close push.
  const replacingHard = selectReplacingHardReasons(safety.hard, claude.customer_answer);

  // E: sentence commit stream — committed text is never replaced.
  const alreadyCommitted = Boolean(streamHandlers?._emitted) || Boolean(commitStream.getCommitted());
  let finalText = commitStream.getCommitted() || claude.customer_answer;
  let usedFailure = false;
  let failureReason = null;

  if (sentenceStreamAborted && commitStream.getCommitted()) {
    // Keep committed sentences; append soft closer once (also commit to stream if needed).
    if (!String(finalText).includes(SENTENCE_COMMIT_ABORT_CLOSER)) {
      const closer = `\n\n${SENTENCE_COMMIT_ABORT_CLOSER}`;
      finalText = `${finalText.trimEnd()}${closer}`;
      if (streamHandlers?.onDelta) {
        streamHandlers.onDelta(closer);
        streamHandlers._emitted = true;
      }
    }
    usedFailure = false;
    failureReason = sentenceAbortReason;
  } else if (!String(finalText ?? "").trim()) {
    finalText = KEY_MONOPOLY_FAILURE_CUSTOMER_TEXT;
    usedFailure = true;
    failureReason = "empty_answer";
  } else if (replacingHard.length > 0 && !alreadyCommitted) {
    // Only monopoly-replace when nothing was already shown to the customer.
    finalText = KEY_MONOPOLY_FAILURE_CUSTOMER_TEXT;
    usedFailure = true;
    failureReason = replacingHard.join(";") || "closed_hard";
  } else if (replacingHard.length > 0 && alreadyCommitted) {
    // E: keep committed text; do not yank.
    failureReason = `committed_no_replace:${replacingHard.join(";")}`;
  }

  // As-is delivery (no polish rewrite). Seal only.
  const sealed = sealKeyCustomerText(finalText);

  // If nothing was sentence-committed (e.g. tiny answer without boundary), emit once.
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
          replacing_hard_reasons: replacingHard,
          jailbreak_detail: safety.jailbreak_detail,
          answer_source: claude.answer_source ?? null,
          pdf_attached: claude.pdf_attached === true,
          sentence_commit: {
            mode: "sentence_unit_e",
            aborted: sentenceStreamAborted,
            abort_reason: sentenceAbortReason,
            committed_len: String(commitStream.getCommitted() ?? "").length,
            already_committed: alreadyCommitted,
          },
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
            answer_source: claude.answer_source ?? null,
            pdf_attached: claude.pdf_attached === true,
            answer_preview: String(claude.customer_answer).slice(0, 300),
            sentence_commit_aborted: sentenceStreamAborted,
            sentence_commit_abort_reason: sentenceAbortReason,
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
