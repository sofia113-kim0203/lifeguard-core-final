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
  buildAnthropicDirectAttachBlock,
  verifyAndFetchCustomerPdfOriginal,
  CLAUDE_FULL_PDF_MAX_BYTES,
  isClaudeDirectImageMediaType,
  normalizeClaudeDirectAttachMediaType,
} from "./keyClaudeFullDocumentDirect.js";
import {
  parseRotationQuarterTurns,
  quarterTurnsToDegrees,
  readImageSizeFromBuffer,
  buildPreviewOrientationHint,
  buildAttachOpsSignals,
} from "./keyClaudeImageOrient.js";
import {
  isPriorAttachFollowUpQuestion,
  PRIOR_ATTACH_REATTACH_CUSTOMER_TEXT,
} from "../../src/lib/chatActiveAttachment.js";
import {
  gateKeyVoiceAnswer,
  jailbreakAudit,
  recommendationOrTerminationRisk,
} from "./keyVoiceGate.js";
import {
  finalizeKeyCustomerText,
  KEY_MONOPOLY_FAILURE_CUSTOMER_TEXT,
} from "./keyCustomerMonopoly.js";
import { sealKeyCustomerText } from "./keyCustomerTextSeal.js";
import { loadAllowedCorporateContextsForClaude } from "./keyClaudeCorporateContext.js";
import { startSpan, resolveDeployIdentity } from "./keyLatencyMarks.js";
import { CLAUDE_FULL_VISUAL_BLOCK_TYPES } from "./keyClaudeFullEmit.js";
import {
  createSentenceCommitStream,
  SENTENCE_COMMIT_ABORT_CLOSER,
} from "./keyClaudeFirstSentenceCommit.js";

const DEFAULT_MODEL = "claude-sonnet-4-6";
const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";

/**
 * Explicit attach was requested but ownership/fetch/rotate/block failed.
 * One honest sentence — no chart / latest-doc / Claude substitute.
 */
export const ATTACH_PROCESS_FAILED_CUSTOMER_TEXT =
  "첨부 파일을 처리하지 못했습니다. 파일을 다시 첨부해 주세요.";

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
    "Materials may include verified_customer_chart, conversation originals, and an attached original PDF or image (JPEG/PNG) when present. Use them when helpful; do not invent policy facts that contradict them.",
    "web_search is available — use it when you need fresh public info (e.g. restaurants, places, news). Do not refuse daily questions just because insurance materials exist.",
    "If a PDF or photo is attached, you may read and analyze the original directly — no OCR pre-summary is provided.",
    "Attached-file literal rules (required): copy only what is clearly visible/printed. If a character, number, name, or field is blurry/partial/uncertain, write 미확인 — never guess a similar word. Do not reinterpret printed values into other insurance concepts (example: do not turn '9999세 만기' into '종신형'; keep the printed wording or mark 미확인).",
    "Attached table readout (required): account for image orientation first. Read each contract column independently — never pull a product name or value from an adjacent column. Keep printed units as-is (원, 세, 년납, etc.). If any part of a cell is uncertain, mark that whole cell 미확인 — do not invent similar words or partially invent the rest of the cell. Do not reinterpret document wording into other product meanings.",
    "Attached-file focus (required when a file is attached and the customer asks about that file): answer from the attachment first. Do not auto-mix verified_customer_chart into that answer. If chart facts are truly needed, separate sources explicitly (e.g. '첨부 문서:' vs '고객 차트:').",
    "Do NOT assert insurance payout eligibility, final benefit amount, exclusion/reduction, or medical final interpretation from an attached photo or PDF alone — when asked, say 증권·약관·계약 확인이 더 필요하다고 자연스럽게 안내한다.",
    "Delivery order (required for speed): write the full customer-facing reply as plain Korean text first. Do NOT wrap the main answer in emit_claude_full. Plain text streams to the customer immediately.",
    "emit_claude_full is only for optional visual_blocks AFTER the plain-text answer when a chart/table is useful. Never put the main prose only inside the tool. When reading an attached file into a markdown table, put the table in the plain-text answer — do not call emit_claude_full just to restate the attachment.",
    "Do not push enrollment, cancellation, or definitive '충분/부족합니다' / '문제 없습니다' verdicts without basis.",
    "Do not invent restaurant/place names or policy numbers that are not grounded in materials or search results.",
    "Tone (required): warm, respectful, and clear. Open with a short caring acknowledgment when helpful. Soften uncertainty without sounding cold or accusing. Do not call the customer's records '오류' or '가짜' — say what is confirmed vs not yet confirmed.",
    "When the customer asks whether riders/특약을 can be added: explain the concept kindly, clarify you cannot enroll or change the policy here, and invite sharing the 증권 for a concrete review. Do not use '지금 가입하세요' style language.",
    "Charts: when the customer asks for a chart/table/현황 정리 of their stored policies (not an attached-file readout), emit visual_blocks later via emit_claude_full (coverage_status_card, policy_count_summary, premium_summary_table, or coverage_gap_table) using ONLY verified_customer_chart facts. Omit visual_blocks for pure daily chit-chat and for attached-file readouts.",
    "Customer-facing presentation (required):",
    "- No emoji, emoticons, or decorative pictographs.",
    "- No HTML or citation markup (never output <cite> or other tags).",
    "- Clean readable Korean: short paragraphs, ## headings when helpful, - bullet lists, **bold** sparingly for key phrases.",
    "- Prefer clear structure over decoration. --- separators are ok when they help scanning.",
  ].join("\n");
}

/** True when the question is mainly about reading an attached file/photo. */
export function isAttachDocumentReadQuestion(question = "") {
  const q = String(question ?? "");
  return /이\s*사진|이\s*문서|이\s*파일|첨부(?:된|한|파일)?|올려\s*준|올려주신|찾아\s*(?:줘|표)|표로\s*정리|읽어|판독|영수증|진단서|처방전|세부\s*내역/.test(
    q,
  );
}

/**
 * When to run Phase B chart visual_blocks (second tool call).
 * Attach-file readouts must not auto-trigger verified_customer_chart visuals.
 */
export function wantsClaudeFirstVisualBlocks(
  question = "",
  { documentAttached = false } = {},
) {
  if (
    documentAttached &&
    (isAttachDocumentReadQuestion(question) || isPriorAttachFollowUpQuestion(question))
  ) {
    return false;
  }
  const q = String(question ?? "");
  return /차트|표로\s*보여|현황|내\s*보험은\s*괜찮아|보험\s*어때|계약\s*요약/.test(q);
}

function normalizeCorporateContexts(corporateContexts = null) {
  const rows = Array.isArray(corporateContexts)
    ? corporateContexts
    : corporateContexts
      ? [corporateContexts]
      : [];
  return rows.filter(
    (row) =>
      row?.entity_type === "corporate" &&
      row?.authorization_verified === true &&
      String(row?.entity_id ?? "").trim(),
  );
}

export function buildUserPayload({
  question,
  chart,
  allowlist,
  contextPack,
  pdfMeta = null,
  corporateContexts = null,
} = {}) {
  const attached = pdfMeta?.attached === true;
  const mime = pdfMeta?.mime_type ? String(pdfMeta.mime_type) : null;
  const isImage = Boolean(mime && mime.startsWith("image/"));
  const turns = parseRotationQuarterTurns(pdfMeta?.rotation_quarter_turns);
  const previewHint = attached && isImage ? buildPreviewOrientationHint(turns) : null;
  const corporate_contexts = normalizeCorporateContexts(corporateContexts).map((corporate) => ({
    entity_type: corporate.entity_type,
    entity_id: corporate.entity_id,
    display_name: corporate.display_name ?? null,
    membership_role: corporate.membership_role,
    verified_facts: corporate.verified_facts ?? [],
    partial_facts: corporate.partial_facts ?? [],
    unknowns: corporate.unknowns ?? [],
    provenance: corporate.provenance ?? null,
  }));

  const baseGuidance = attached
    ? [
        "ATTACHED FILE READ: Focus on the attached PDF/image first.",
        "Copy visible/printed values literally. Unclear glyphs → 미확인 (never guess similar words).",
        "Table cells: respect image orientation; read each contract column independently (do not take names/values from adjacent columns); keep units as printed; if a cell is uncertain, mark the whole cell 미확인 — never invent similar words or reinterpret product meaning.",
        "Do not reinterpret printed wording (e.g. keep '9999세 만기'; do not say 종신형 unless printed).",
        "Do not auto-mix verified_customer_chart. If chart is needed, label '첨부 문서' vs '고객 차트' separately.",
        "Put any summary table in plain Korean text. No emoji/<cite>/HTML.",
        ...(previewHint ? [previewHint] : []),
      ].join(" ")
    : "Answer warmly in plain Korean text first (not inside emit_claude_full). Insurance materials are optional context. No emoji/<cite>/HTML. Prefer headings and lists. Charts/visual_blocks come in a later step if needed.";

  const sourceGuidance = [
    "Use verified_customer_chart (personal) and verified_corporate_contexts (per-entity corporate) together when relevant.",
    "Keep personal and corporate sources separate — never flatten corporate facts into the personal chart or mix contracts across entities.",
    "Infer which source the question needs from conversation context; if truly ambiguous, ask one natural clarifying question.",
    "Treat partial_facts as incomplete and unknowns as 미확인.",
  ].join(" ");

  return {
    mode: "claude_native_first_preview",
    customer_question: String(question ?? ""),
    conversation_originals: {
      recent_turns: contextPack?.recent_turns ?? [],
      older_summary: contextPack?.older_summary ?? null,
      retained_past_originals: contextPack?.retained_past_originals ?? [],
    },
    // Personal chart stays present even when corporate contexts exist — never XOR-null.
    verified_customer_chart: chart,
    verified_corporate_contexts: corporate_contexts,
    allowed_numbers: allowlist?.allowed_numbers ?? [],
    allowed_entities: allowlist?.allowed_entities ?? [],
    insurer_counts: allowlist?.insurer_counts ?? null,
    product_counts: allowlist?.product_counts ?? null,
    direct_document: pdfMeta
      ? {
          attached,
          document_id: pdfMeta.document_id ?? null,
          original_filename: pdfMeta.original_filename ?? null,
          mime_type: mime,
          note: attached
            ? isImage
              ? "Original image is attached as an image block. Read it yourself — no OCR/KEY pre-summary."
              : "Original PDF is attached as a document block. Read it yourself — no KEY pre-summary."
            : pdfMeta.note ?? "No document attached for this turn.",
          ...(previewHint ? { preview_orientation_hint: previewHint } : {}),
        }
      : { attached: false, note: "No document attached for this turn." },
    guidance: [sourceGuidance, baseGuidance].join(" "),
  };
}

/**
 * Finalize streamed Anthropic content blocks for the next request.
 * Preserve server_tool_use / web_search_tool_result as-is (never rewrite to client tool_use).
 * Only client tool_use gets input_json → input parsing.
 */
export function finalizeClaudeFirstStreamContentBlocks(contentBlocks = []) {
  return (Array.isArray(contentBlocks) ? contentBlocks : []).map((block) => {
    if (!block || typeof block !== "object") return block;
    const type = String(block.type ?? "");

    if (type === "tool_use") {
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

    if (type === "server_tool_use") {
      let input = block.input;
      if (block.input_json) {
        try {
          input = JSON.parse(block.input_json);
        } catch {
          input = block.input ?? {};
        }
      }
      return {
        type: "server_tool_use",
        id: block.id ?? null,
        name: block.name ?? null,
        input: input ?? {},
      };
    }

    // web_search_tool_result and other blocks: drop stream-only input_json, keep type.
    if (Object.prototype.hasOwnProperty.call(block, "input_json")) {
      const { input_json: _drop, ...rest } = block;
      return rest;
    }
    return block;
  });
}

/** True only for client tool_use — server web_search must not drive the follow-up loop. */
export function hasClientToolUse(content = []) {
  return (Array.isArray(content) ? content : []).some((b) => b?.type === "tool_use");
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

  const content = finalizeClaudeFirstStreamContentBlocks(contentBlocks);

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

function latestDocumentIdFromContext(loadedContext = null, unifiedState = null) {
  const fromUnified = Array.isArray(unifiedState?.documents) ? unifiedState.documents : [];
  for (let i = fromUnified.length - 1; i >= 0; i -= 1) {
    const id = String(fromUnified[i]?.id ?? fromUnified[i]?.document_id ?? "").trim();
    if (id) return id;
  }
  const docs = Array.isArray(loadedContext?.documents) ? loadedContext.documents : [];
  for (let i = docs.length - 1; i >= 0; i -= 1) {
    const id = String(docs[i]?.id ?? docs[i]?.document_id ?? "").trim();
    if (id) return id;
  }
  return null;
}

/**
 * Resolve which customer document to attach for Claude-first.
 * Explicit request document_id wins — never guess "latest" over an active chat attach.
 * Prior-attach follow-ups must not use latest-document fallback.
 */
export function resolveClaudeFirstPdfDocumentId({
  attachedDocumentId = null,
  loadedContext = null,
  unifiedState = null,
  allowLatestFallback = true,
} = {}) {
  const explicit = String(attachedDocumentId ?? "").trim();
  if (explicit) return explicit;
  if (!allowLatestFallback) return null;
  return latestDocumentIdFromContext(loadedContext, unifiedState);
}

/**
 * Build Claude image bytes from Storage original only.
 * Never trusts client-provided image bytes. Never decode/rotate/re-encode.
 * rotation_quarter_turns is recorded for UI/hint only — bytes stay Storage original.
 */
export function buildClaudeImageAttachFromStorageOriginal({
  storageBase64 = null,
  storageMediaType = null,
  rotationQuarterTurns = 0,
} = {}) {
  const turns = parseRotationQuarterTurns(rotationQuarterTurns);
  const stored = String(storageBase64 ?? "").trim();
  const storedMime = normalizeClaudeDirectAttachMediaType(storageMediaType);

  if (!stored || !storedMime) {
    return {
      ok: false,
      reason: "storage_image_missing",
      base64: null,
      mediaType: null,
      claude_image_source: null,
      rotation_quarter_turns: turns,
      image_rotation_deg: quarterTurnsToDegrees(turns),
      rotated: false,
      attach_signals: buildAttachOpsSignals({
        attachment_requested: true,
        attachment_attached: false,
        attachment_failed: true,
        attachment_failure_code: "storage_image_missing",
        rotation_requested: turns,
        attachment_block_built: false,
      }),
    };
  }
  if (storedMime === "application/pdf") {
    return {
      ok: true,
      base64: stored,
      mediaType: storedMime,
      claude_image_source: "storage_original",
      rotation_quarter_turns: 0,
      image_rotation_deg: 0,
      rotated: false,
      attach_signals: buildAttachOpsSignals({
        attachment_requested: true,
        attachment_attached: true,
        attachment_failed: false,
        rotation_requested: 0,
        attachment_block_built: true,
      }),
    };
  }
  if (!isClaudeDirectImageMediaType(storedMime)) {
    return {
      ok: false,
      reason: "mime_not_image",
      base64: null,
      mediaType: storedMime,
      claude_image_source: null,
      rotation_quarter_turns: turns,
      image_rotation_deg: quarterTurnsToDegrees(turns),
      rotated: false,
      attach_signals: buildAttachOpsSignals({
        attachment_requested: true,
        attachment_attached: false,
        attachment_failed: true,
        attachment_failure_code: "mime_not_image",
        rotation_requested: turns,
        attachment_block_built: false,
      }),
    };
  }

  const rawBuf = Buffer.from(stored, "base64");
  if (rawBuf.length > CLAUDE_FULL_PDF_MAX_BYTES) {
    return {
      ok: false,
      reason: "image_too_large",
      base64: null,
      mediaType: storedMime,
      claude_image_source: null,
      rotation_quarter_turns: turns,
      image_rotation_deg: quarterTurnsToDegrees(turns),
      rotated: false,
      attach_signals: buildAttachOpsSignals({
        attachment_requested: true,
        attachment_attached: false,
        attachment_failed: true,
        attachment_failure_code: "image_too_large",
        rotation_requested: turns,
        attachment_block_built: false,
      }),
    };
  }

  const size = readImageSizeFromBuffer(rawBuf, storedMime);
  const block = buildAnthropicDirectAttachBlock({
    base64: stored,
    mediaType: storedMime,
  });
  if (!block) {
    return {
      ok: false,
      reason: "block_build_failed",
      base64: null,
      mediaType: storedMime,
      claude_image_source: null,
      rotation_quarter_turns: turns,
      image_rotation_deg: quarterTurnsToDegrees(turns),
      rotated: false,
      attach_signals: buildAttachOpsSignals({
        attachment_requested: true,
        attachment_attached: false,
        attachment_failed: true,
        attachment_failure_code: "block_build_failed",
        rotation_requested: turns,
        attachment_block_built: false,
      }),
    };
  }

  return {
    ok: true,
    base64: stored,
    mediaType: storedMime,
    claude_image_source: "storage_original",
    rotation_quarter_turns: turns,
    image_rotation_deg: quarterTurnsToDegrees(turns),
    rotated: false,
    source_width: size?.width ?? null,
    source_height: size?.height ?? null,
    width: size?.width ?? null,
    height: size?.height ?? null,
    attach_signals: buildAttachOpsSignals({
      attachment_requested: true,
      attachment_attached: true,
      attachment_failed: false,
      rotation_requested: turns,
      attachment_block_built: true,
    }),
  };
}

async function resolveOptionalPdfAttachment({
  userSupabase = null,
  customerId = null,
  loadedContext = null,
  unifiedState = null,
  attachedDocumentId = null,
  env = process.env,
  rotationQuarterTurns = 0,
  allowLatestFallback = true,
} = {}) {
  const turns = parseRotationQuarterTurns(rotationQuarterTurns);
  const documentId = resolveClaudeFirstPdfDocumentId({
    attachedDocumentId,
    loadedContext,
    unifiedState,
    allowLatestFallback,
  });
  if (!documentId || !userSupabase || !customerId) {
    return {
      pdfBase64: null,
      mediaType: null,
      meta: {
        attached: false,
        attach_signals: buildAttachOpsSignals({
          attachment_requested: false,
          attachment_attached: false,
          attachment_failed: false,
          rotation_requested: turns,
          attachment_block_built: false,
        }),
      },
    };
  }
  try {
    const fetched = await verifyAndFetchCustomerPdfOriginal({
      supabase: userSupabase,
      customerId,
      documentId,
      env,
    });
    if (!fetched?.ok || !fetched.pdfBase64) {
      const failCode = fetched?.reason ?? "pdf_attach_skipped";
      return {
        pdfBase64: null,
        mediaType: null,
        meta: {
          attached: false,
          document_id: documentId,
          note: failCode,
          rotation_quarter_turns: turns,
          attach_signals: buildAttachOpsSignals({
            attachment_requested: true,
            attachment_attached: false,
            attachment_failed: true,
            attachment_failure_code: failCode,
            rotation_requested: turns,
            attachment_block_built: false,
          }),
        },
      };
    }

    const isPdf = fetched.mediaType === "application/pdf";
    if (isPdf) {
      return {
        pdfBase64: fetched.pdfBase64,
        mediaType: fetched.mediaType,
        meta: {
          attached: true,
          document_id: documentId,
          original_filename: fetched.document?.original_filename ?? null,
          mime_type: fetched.mediaType,
          storage_mime_type: fetched.mediaType,
          claude_image_source: "storage_original",
          rotation_quarter_turns: 0,
          image_rotation_deg: 0,
          attach_signals: buildAttachOpsSignals({
            attachment_requested: true,
            attachment_attached: true,
            attachment_failed: false,
            rotation_requested: 0,
            attachment_block_built: true,
          }),
        },
      };
    }

    const storageSize = readImageSizeFromBuffer(
      Buffer.from(String(fetched.pdfBase64), "base64"),
      fetched.mediaType,
    );
    const built = buildClaudeImageAttachFromStorageOriginal({
      storageBase64: fetched.pdfBase64,
      storageMediaType: fetched.mediaType,
      rotationQuarterTurns: turns,
    });
    if (!built.ok || !built.base64) {
      return {
        pdfBase64: null,
        mediaType: null,
        meta: {
          attached: false,
          document_id: documentId,
          note: built.reason ?? "image_attach_failed",
          rotation_quarter_turns: turns,
          attach_signals:
            built.attach_signals ??
            buildAttachOpsSignals({
              attachment_requested: true,
              attachment_attached: false,
              attachment_failed: true,
              attachment_failure_code: built.reason ?? "image_attach_failed",
              rotation_requested: turns,
              attachment_block_built: false,
            }),
        },
      };
    }

    return {
      pdfBase64: built.base64,
      mediaType: built.mediaType,
      meta: {
        attached: true,
        document_id: documentId,
        original_filename: fetched.document?.original_filename ?? null,
        mime_type: built.mediaType,
        storage_mime_type: fetched.mediaType ?? null,
        claude_image_source: built.claude_image_source,
        rotation_quarter_turns: built.rotation_quarter_turns,
        image_rotation_deg: built.image_rotation_deg,
        storage_pixel_width: storageSize?.width ?? built.source_width ?? null,
        storage_pixel_height: storageSize?.height ?? built.source_height ?? null,
        claude_pixel_width: built.width ?? storageSize?.width ?? null,
        claude_pixel_height: built.height ?? storageSize?.height ?? null,
        attach_signals:
          built.attach_signals ??
          buildAttachOpsSignals({
            attachment_requested: true,
            attachment_attached: true,
            attachment_failed: false,
            rotation_requested: turns,
            attachment_block_built: true,
          }),
      },
    };
  } catch {
    return {
      pdfBase64: null,
      mediaType: null,
      meta: {
        attached: false,
        document_id: documentId,
        note: "attach_error",
        rotation_quarter_turns: turns,
        attach_signals: buildAttachOpsSignals({
          attachment_requested: true,
          attachment_attached: false,
          attachment_failed: true,
          attachment_failure_code: "attach_error",
          rotation_requested: turns,
          attachment_block_built: false,
        }),
      },
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
  corporateContexts = null,
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
    corporateContexts,
  });
  const system = buildSystemPrompt();
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

  // Phase A — plain text (+ optional web_search). No emit tool so prose streams early.
  const answerTools = [ANTHROPIC_WEB_SEARCH_TOOL];
  for (let turn = 0; turn < 4; turn += 1) {
    const body = {
      model,
      max_tokens: 4096,
      temperature: 0.4,
      system,
      tools: answerTools,
      tool_choice: { type: "auto" },
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
    const assistantContent = Array.isArray(streamed.dataRaw?.content)
      ? streamed.dataRaw.content
      : [];
    // Client tool_use only — server web_search must not force a follow-up turn.
    const hasToolUse = hasClientToolUse(assistantContent);

    if (picked.customer_answer && !hasToolUse) {
      lastPicked = { ...picked, source: picked.source || "plain_text" };
      onAnswerProgress?.(picked.customer_answer);
      messages = [...messages, { role: "assistant", content: assistantContent }];
      break;
    }

    if (picked.customer_answer && hasToolUse) {
      // Unusual mix — prefer plain text progress already streamed.
      lastPicked = { ...picked, source: picked.source || "plain_text" };
      onAnswerProgress?.(picked.customer_answer);
    }

    if (!assistantContent.length) break;
    messages = [
      ...messages,
      { role: "assistant", content: assistantContent },
      {
        role: "user",
        content:
          "이제 고객에게 보여줄 최종 한국어 답변을 일반 텍스트로만 작성해 주세요. emit_claude_full 도구는 사용하지 마세요. 따뜻하고 존중하는 톤으로, 이모지·<cite>·HTML 없이, 문단·제목·목록으로 깔끔히 정리하세요. 보험으로 억지 전환하지 말고 현재 질문 자체에 답하세요.",
      },
    ];

    if (picked.customer_answer && !hasToolUse) break;
  }

  const customer_answer = String(
    lastPicked.customer_answer || streamedAnswer || "",
  ).trim();

  // Phase B — optional charts after prose (does not stream customer prose again).
  // Skip when this turn is an attached-file readout (avoid mixing verified_customer_chart).
  // Corporate contexts do not force a different visual path.
  let visual_blocks = Array.isArray(lastPicked.visual_blocks) ? lastPicked.visual_blocks : [];
  const documentAttached = Boolean(pdfBase64) || pdfMeta?.attached === true;
  if (
    customer_answer &&
    wantsClaudeFirstVisualBlocks(question, { documentAttached }) &&
    visual_blocks.length === 0
  ) {
    const chartMessages = [
      ...messages,
      {
        role: "user",
        content:
          "Plain-text answer already delivered to the customer. Now call emit_claude_full with visual_blocks only (policy_count_summary / premium_summary_table / coverage_status_card / coverage_gap_table) using verified_customer_chart facts only. Set customer_answer to a single short line like '현황 표입니다.' — do not rewrite the full answer.",
      },
    ];
    const chartBody = {
      model,
      max_tokens: 2048,
      temperature: 0.2,
      system,
      tools: [CLAUDE_FIRST_DIRECT_EMIT_TOOL],
      tool_choice: { type: "tool", name: "emit_claude_full" },
      messages: chartMessages,
      stream: true,
    };
    const chartRes = await fetchImpl(ANTHROPIC_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(chartBody),
    });
    if (chartRes.ok) {
      const chartStreamed = await readAnthropicSseWithAnswerStream({
        res: chartRes,
        startedAt,
        onFirstContent: null,
        onAnswerProgress: null,
      });
      const chartPicked = pickCustomerAnswer(chartStreamed.dataRaw);
      if (Array.isArray(chartPicked.visual_blocks) && chartPicked.visual_blocks.length) {
        visual_blocks = chartPicked.visual_blocks;
      }
    }
  }

  return {
    ok: Boolean(customer_answer),
    customer_answer,
    visual_blocks,
    decision: lastPicked.decision,
    session_goal: lastPicked.session_goal,
    answer_source: lastPicked.source || (customer_answer ? "plain_text" : null),
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
  authUserId = null,
  entityContext = null,
  attachedDocumentId = null,
  rotationQuarterTurns = 0,
  priorAttachFollowUp = false,
  env = process.env,
  fetchImpl = fetch,
  startedAt = Date.now(),
  streamHandlers = null,
  loadAllowedCorporateContextsForClaudeImpl = loadAllowedCorporateContextsForClaude,
} = {}) {
  const span = startSpan(startedAt);

  // Membership-scoped corporate contexts only. Client entity_id never widens access.
  // Do not fail the personal turn when a stale/foreign entity hint is present.
  const corporateLoaded = await loadAllowedCorporateContextsForClaudeImpl({
    userSupabase,
    customerId,
    authUserId,
  });
  const corporateContexts = Array.isArray(corporateLoaded?.corporate_contexts)
    ? corporateLoaded.corporate_contexts
    : [];
  // entityContext from older clients is ignored for data access scope.
  void entityContext;

  const { policies, policy_count } = extractPoliciesFromContext({
    loadedContext,
    customerContextBundle,
    unifiedState,
  });
  const reality = { policies, policy_count };

  const followUp =
    priorAttachFollowUp === true ||
    isPriorAttachFollowUpQuestion(question, { history });
  // Follow-up photo refs must never invent a latest document or chart substitute.
  const allowLatestFallback = !followUp;

  const pdf = await resolveOptionalPdfAttachment({
    userSupabase,
    customerId,
    loadedContext,
    unifiedState,
    attachedDocumentId,
    env,
    rotationQuarterTurns,
    allowLatestFallback,
  });

  // Explicit attach requested this turn but processing failed → fail-closed.
  // Do not fire on weak latest-document-only turns (no attachedDocumentId).
  // Slice A client flag priorAttachFollowUp keeps the dedicated reattach copy.
  const explicitDocumentId = String(attachedDocumentId ?? "").trim();
  if (explicitDocumentId && pdf?.meta?.attached !== true) {
    const usePriorAttachCopy = priorAttachFollowUp === true;
    const failureNote = usePriorAttachCopy
      ? "prior_attach_missing"
      : String(pdf?.meta?.note ?? "").trim() || "attach_process_failed";
    let outlet;
    if (usePriorAttachCopy) {
      const sealed = sealKeyCustomerText(PRIOR_ATTACH_REATTACH_CUSTOMER_TEXT);
      outlet = {
        customerText: sealed.key_speak_original,
        keySpeakOriginal: sealed.key_speak_original,
        latency_marks: null,
      };
    } else {
      outlet = finalizeKeyCustomerText(ATTACH_PROCESS_FAILED_CUSTOMER_TEXT, {
        failureMode: true,
        startedAt,
      });
    }
    if (streamHandlers?.onDelta) {
      streamHandlers.onDelta(outlet.keySpeakOriginal);
      streamHandlers._emitted = true;
      streamHandlers.onFirstToken?.(relMs(startedAt));
    }
    const emitMark = span.end();
    return {
      ok: true,
      customerText: outlet.customerText,
      keySpeakOriginal: outlet.keySpeakOriginal,
      visualBlocks: [],
      key_monopoly_failure: usePriorAttachCopy ? false : true,
      failure_reason: failureNote,
      agentTurn: {
        text: outlet.keySpeakOriginal,
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
            provider: "claude_first_direct",
            used_failure_mode: usePriorAttachCopy ? false : true,
            fallback_reason: failureNote,
            ...(usePriorAttachCopy
              ? { prior_attach_follow_up: true }
              : {
                  attachment_fail_closed: true,
                  explicit_document_id_present: true,
                }),
            pdf_attached: false,
            ...(usePriorAttachCopy
              ? {}
              : {
                  attach_signals: pdf?.meta?.attach_signals ?? null,
                }),
            latency_marks: {
              claude_full_emit: emitMark,
              ttft_ms: relMs(startedAt),
              ...(outlet.latency_marks
                ? {
                    finalize: outlet.latency_marks.finalize ?? null,
                    seal: outlet.latency_marks.seal ?? null,
                  }
                : {}),
              ...resolveDeployIdentity(env),
            },
          },
        },
      },
      oneKeyCoreTrace: {
        schema_version: "one-key-core-trace-claude-first-v1",
        steps: [
          {
            step: usePriorAttachCopy
              ? "prior_attach_reattach"
              : "attach_process_fail_closed",
            at_ms: relMs(startedAt),
            payload: {
              compose_mode: "key_claude_first_direct",
              reason: failureNote,
              document_id_present: true,
              allow_latest_fallback: false,
              claude_call_started: false,
              ...(usePriorAttachCopy
                ? {}
                : {
                    attach_signals: pdf?.meta?.attach_signals ?? null,
                  }),
            },
          },
        ],
        legacy_paths_blocked: [
          "claude_first_direct_call",
          "latest_document_fallback",
          "verified_customer_chart_substitute",
          "phase_b_visual",
          "s3_s6_compose",
        ],
      },
    };
  }

  // Slice A / question follow-up without an explicit document_id → reattach prompt.
  if (followUp && pdf?.meta?.attached !== true) {
    const sealed = sealKeyCustomerText(PRIOR_ATTACH_REATTACH_CUSTOMER_TEXT);
    if (streamHandlers?.onDelta) {
      streamHandlers.onDelta(sealed.key_speak_original);
      streamHandlers._emitted = true;
      streamHandlers.onFirstToken?.(relMs(startedAt));
    }
    const emitMark = span.end();
    return {
      ok: true,
      customerText: sealed.key_speak_original,
      keySpeakOriginal: sealed.key_speak_original,
      visualBlocks: [],
      key_monopoly_failure: false,
      failure_reason: "prior_attach_missing",
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
            provider: "claude_first_direct",
            used_failure_mode: false,
            fallback_reason: "prior_attach_missing",
            prior_attach_follow_up: true,
            pdf_attached: false,
            latency_marks: {
              claude_full_emit: emitMark,
              ttft_ms: relMs(startedAt),
              ...resolveDeployIdentity(env),
            },
          },
        },
      },
      oneKeyCoreTrace: {
        schema_version: "one-key-core-trace-claude-first-v1",
        steps: [
          {
            step: "prior_attach_reattach",
            at_ms: relMs(startedAt),
            payload: {
              compose_mode: "key_claude_first_direct",
              reason: "prior_attach_missing",
              allow_latest_fallback: false,
            },
          },
        ],
        legacy_paths_blocked: [
          "latest_document_fallback",
          "verified_customer_chart_substitute",
          "s3_s6_compose",
        ],
      },
    };
  }

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
    corporateContexts,
  });
  const emitMark = span.end();
  // Completeness: progressive extract can lag the final customer_answer.
  // Append-only catch-up — exact suffix after committed; never replace sent text.
  let sentenceCatchUp = null;
  if (!sentenceStreamAborted && claude.ok && claude.customer_answer) {
    sentenceCatchUp = commitStream.catchUpFinalAnswer(claude.customer_answer);
    if (sentenceCatchUp?.aborted) {
      sentenceStreamAborted = true;
      sentenceAbortReason = commitStream.getAbortReason() ?? sentenceAbortReason;
    }
  }
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
          attach_signals: pdf?.meta?.attach_signals ?? null,
          sentence_commit: {
            mode: "sentence_unit_e",
            aborted: sentenceStreamAborted,
            abort_reason: sentenceAbortReason,
            committed_len: String(commitStream.getCommitted() ?? "").length,
            already_committed: alreadyCommitted,
            catch_up_appended: commitStream.didCatchUpAppend?.() === true,
            catch_up_reason: sentenceCatchUp?.reason ?? null,
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
            attach_signals: pdf?.meta?.attach_signals ?? null,
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
