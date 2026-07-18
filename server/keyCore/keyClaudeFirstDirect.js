/**
 * Claude-first — free KEY answer path (Slice 5 + Slice 6 evidence Hand).
 * KEY: auth/ownership · verified raw materials · CLOSED hard-only · seal as-is.
 * Does not pre-decide intent/format/judgment. No Phase B / soft rewrite / S3–S6.
 * Enabled by KEY_CLAUDE_FIRST_DIRECT=1 on Preview and Production alike.
 */
import {
  isKeyBorrowedSensesProbeEnabled,
  isKeyBorrowedSensesStage2Partial,
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
import { createSentenceCommitStream } from "./keyClaudeFirstSentenceCommit.js";
import {
  normalizeKeyConfirmedSourceFacts,
  mergeKeyConfirmedSourceFacts,
  persistKeyConfirmedSourceFactsToPolicies,
  normalizeKeyClaimCaseUpdates,
  mergeKeyActiveClaimCases,
  persistKeyActiveClaimCases,
  loadKeyActiveClaimCases,
} from "../documentPolicyUploadPersist.js";

const DEFAULT_MODEL = "claude-sonnet-4-6";
const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";

/**
 * Same Claude-first call — internal only. Customer never sees this tool output.
 * customer_answer stays plain text; facts are storage materials for the customer card.
 */
export const RECORD_CONFIRMED_SOURCE_FACTS_TOOL = Object.freeze({
  name: "record_confirmed_source_facts",
  description:
    "원본 첨부 문서에서 명시적으로 확인한 계약 사실만 내부 고객카드 보관용으로 기록한다. 고객에게 보이는 답변이 아니다. 추측·검색 일반정보·고객 미확인 발언·추천·의미변환 금지. literal_value는 원문 그대로.",
  input_schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      confirmed_source_facts: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            fact_type: {
              type: "string",
              description:
                "policyholder|insured|beneficiary|beneficiaries|insurer|insurer_name|product_name|premium|monthly_premium|coverage_name|coverage_amount|payment_period|insurance_period|effective_from|change_date|policy_number",
            },
            literal_value: {
              type: "string",
              description: "원본에 적힌 그대로. 9999세 등 변환 금지.",
            },
            source_document_id: { type: "string" },
            source_locator: {
              type: "object",
              additionalProperties: false,
              properties: {
                page: {},
                section: { type: "string" },
                table_row: { type: "string" },
                source_text: { type: "string" },
              },
            },
          },
          required: ["fact_type", "literal_value"],
        },
      },
    },
    required: ["confirmed_source_facts"],
  },
});

/**
 * Same Claude-first call — internal claim-case card updates (not customer text).
 */
export const RECORD_CLAIM_CASE_UPDATES_TOOL = Object.freeze({
  name: "record_claim_case_updates",
  description:
    "의료사건·보험 비교 후 청구 준비 건을 내부 고객카드에 보관한다. 고객 답변이 아니다. 안정적 claim_case_key 필수(임의 UUID 금지). 접수·지급·거절은 확인 근거(evidence) 있을 때만. 검색 일반정보·추측 진단을 사실로 넣지 않는다.",
  input_schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      claim_case_updates: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            claim_case_key: { type: "string" },
            medical_event: {
              type: "object",
              additionalProperties: false,
              properties: {
                diagnosis_name: { type: "string" },
                diagnosis_code: { type: "string" },
                diagnosis_certainty: {
                  type: "string",
                  description: "confirmed|suspected|under_test",
                },
                event_kind: { type: "string" },
                surgery_name: { type: "string" },
                diagnosis_date: { type: "string" },
                surgery_date: { type: "string" },
                admission_date: { type: "string" },
                discharge_date: { type: "string" },
                event_date: { type: "string" },
                facility_name: { type: "string" },
                source_document_id: { type: "string" },
                source_locator: {
                  type: "object",
                  additionalProperties: false,
                  properties: {
                    page: {},
                    section: { type: "string" },
                    source_text: { type: "string" },
                  },
                },
              },
            },
            related_policies: { type: "array", items: { type: "string" } },
            related_coverages: { type: "array", items: { type: "string" } },
            assessment: {
              type: "object",
              additionalProperties: false,
              properties: {
                code: {
                  type: "string",
                  description:
                    "claim_warranted|claim_possible|needs_policy_or_docs|insufficient_evidence",
                },
                rationale: { type: "string" },
                evidence_refs: { type: "array", items: { type: "string" } },
              },
              required: ["code"],
            },
            required_documents: { type: "array", items: { type: "string" } },
            available_documents: { type: "array", items: { type: "string" } },
            missing_documents: { type: "array", items: { type: "string" } },
            status: {
              type: "string",
              description:
                "identified|preparing|ready_for_customer_submission|submitted_by_customer|under_review|paid|denied|closed",
            },
            next_action: { type: "string" },
            evidence: { type: "array", items: { type: "string" } },
          },
        },
      },
    },
    required: ["claim_case_updates"],
  },
});

function buildConfirmedSourceFactsToolHint(pdfMeta = null) {
  const docId =
    pdfMeta?.document_id != null && String(pdfMeta.document_id).trim()
      ? String(pdfMeta.document_id).trim()
      : null;
  return [
    "원본 첨부가 있다. 고객 답변은 평문 한국어로만 작성한다 (형식·톤 재작성 금지).",
    "같은 응답에서 원본에 명시된 계약 사실만 record_confirmed_source_facts 도구로 내부 기록한다.",
    "추측·웹검색 일반정보·고객의 '아마' 발언·추천·해석(9999세→종신, 간편가입→건강이력 등)은 기록하지 않는다.",
    "literal_value는 원문 그대로 둔다.",
    docId ? `source_document_id 기본값: ${docId}` : "source_document_id를 알면 반드시 넣는다.",
  ].join("\n");
}

function buildClaimCaseUpdatesToolHint() {
  return [
    "의료사건·수술·입원·병원비·진단이 보이면 고객카드 계약과 비교해 청구 필요성을 직접 판단한다.",
    "근거가 충분하면 선제적으로 청구 확인을 제안하고, 같은 응답에서 record_claim_case_updates로 내부 보관한다.",
    "claim_case_key는 문서id+사건일 또는 사건일+사건종류로 안정적으로 식별한다. 매 턴 임의 UUID 금지.",
    "submitted_by_customer·under_review·paid·denied는 확인 근거(evidence) 없이 전진하지 않는다.",
    "청구했습니다/접수 완료/심사 중/지급됐습니다는 확인 근거 없이 고객에게 말하지 않는다.",
    "고객에게 내부 도구명·필드명을 말하지 않는다.",
  ].join("\n");
}

function extractConfirmedSourceFactsFromContent(content = [], defaults = {}) {
  const blocks = Array.isArray(content) ? content : [];
  let facts = [];
  for (const block of blocks) {
    if (block?.type !== "tool_use") continue;
    if (block?.name !== RECORD_CONFIRMED_SOURCE_FACTS_TOOL.name) continue;
    facts = mergeKeyConfirmedSourceFacts(
      facts,
      normalizeKeyConfirmedSourceFacts(block?.input?.confirmed_source_facts, defaults),
    );
  }
  return facts;
}

function extractClaimCaseUpdatesFromContent(content = [], defaults = {}) {
  const blocks = Array.isArray(content) ? content : [];
  let cases = [];
  for (const block of blocks) {
    if (block?.type !== "tool_use") continue;
    if (block?.name !== RECORD_CLAIM_CASE_UPDATES_TOOL.name) continue;
    cases = mergeKeyActiveClaimCases(
      cases,
      normalizeKeyClaimCaseUpdates(block?.input?.claim_case_updates, defaults),
    );
  }
  return cases;
}

const KEY_CARD_CLIENT_TOOL_NAMES = new Set([
  RECORD_CONFIRMED_SOURCE_FACTS_TOOL.name,
  RECORD_CLAIM_CASE_UPDATES_TOOL.name,
]);

/**
 * Explicit attach was requested but ownership/fetch/rotate/block failed.
 * One honest sentence — no chart / latest-doc / Claude substitute.
 */
export const ATTACH_PROCESS_FAILED_CUSTOMER_TEXT =
  "첨부 파일을 처리하지 못했습니다. 파일을 다시 첨부해 주세요.";

/** @deprecated Slice 5 — Phase B / emit_claude_full removed. Kept export for stale imports. */
export const CLAUDE_FIRST_DIRECT_EMIT_TOOL = Object.freeze({
  name: "emit_claude_full",
  description: "Deprecated — unused after Slice 5 free KEY cleanup.",
  input_schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      customer_answer: { type: "string" },
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
  if (isKeyBorrowedSensesStage2Partial(env)) return false;
  if (!isKeyBorrowedSensesProbeEnabled(env)) return false;
  // Same flag on Preview and Production — do not hard-block by VERCEL_ENV alone.
  // Explicit on only: KEY_CLAUDE_FIRST_DIRECT=1|true|on. Absent or 0 → off.
  const flag = String(env.KEY_CLAUDE_FIRST_DIRECT ?? "").trim().toLowerCase();
  if (flag === "1" || flag === "true" || flag === "on") return true;
  return false;
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
    "너는 고객이 만나는 보험 AI KEY다.",
    "너는 보험의 전문성을 바탕으로 고객의 삶과 재산을 평생 지키며, 필요한 보험을 근거와 함께 정확하게 안내한다.",
    "일상 대화와 생활 정보 탐색은 고객을 이해하고 신뢰를 쌓는 보험 전문가의 기본 능력이다.",
    "고객의 일상 질문에도 네 모든 이해·검색·대화 능력을 사용해 충실히 답한다.",
    "고객에게 보험이 실제로 필요하다는 근거가 확인되면, 그 이유를 분명히 설명하고 가입·유지·정리·보완을 자신 있게 제안한다.",
    "보험이 관련되지 않은 순간에는 고객이 지금 묻는 문제를 온전히 해결한다.",
    "제공된 질문, 대화, 검증 사실, 원본 첨부와 도구를 충분히 보고 스스로 이해하고, 필요한 경우 조사·검색·비교·계산·판단하여 답한다.",
    "네 답변이 최종 KEY 답변이다.",
    "검증된 고객 계약 사실과 법령·공공 기준을 구분하고, 고객 사실은 제공된 검증 자료 범위 안에서만 단정한다.",
    "계약상 수익자와 법정상속인을 같은 개념으로 취급하지 않는다. 가족관계·자금 부담자를 이름만으로 추정하지 않는다.",
    "입력이 충분하면 지분·금액·구조의 의미를 직접 계산·판단하고, 부족하면 무엇이 부족한지 구체적으로 밝힌다. 무조건 전문가에게만 넘기며 판단을 회피하지 않는다.",
    "고객에게 내부 필드명·도구명·시스템 경로를 말하지 않는다.",
    "웹 검색어에는 공개된 상품명·약관명·법령명·제도명 등만 사용하고, 고객의 이름·연락처·계약번호·건강·재산·가족 및 법인 비공개 정보는 검색어로 외부에 내보내지 않는다.",
    "보험계약 자동조회·본인인증 연동은 아직 준비되지 않았다. '내 보험 한눈에 서비스(보험다보여)를 통해 전체 계약을 조회하신 후 올려주셔도 됩니다'처럼 지금 바로 가능한 기능인 양 안내하지 마라. 자료가 더 필요하면 보험증권·보장내역서 또는 내보험다보여 조회자료를 올려주시면 정리·확인한다고 말하고, 자동조회는 준비 중이라고만 밝혀라. 본인인증 버튼을 작동하는 것처럼 위장하지 마라.",
    buildClaimCaseUpdatesToolHint(),
  ].join("\n");
}

/** @deprecated Slice 5 — keyword attach pre-route removed. Always false. */
export function isAttachDocumentReadQuestion(_question = "") {
  return false;
}

/** @deprecated Slice 5 — Phase B removed. Always false. */
export function wantsClaudeFirstVisualBlocks(
  _question = "",
  _opts = {},
) {
  return false;
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

function factStatusLabel(row = null) {
  if (!row || typeof row !== "object") return "unknown";
  if (row.verified_absent === true || row.status === "verified_absent") return "verified_absent";
  if (row.known_gap === true && row.status === "known_gap") return "verified_absent";
  if (row.unknown_gap === true || row.status === "unknown") return "unknown";
  if (row.sufficient === true || row.status === "verified" || row.status === "verified_present") {
    return "verified_present";
  }
  if (row.status === "partial" || row.partial === true) return "partial";
  return row.status ? String(row.status) : "unknown";
}

const REQUEST_TIMEZONE = "Asia/Seoul";

/** Request-time clock for Claude materials — never hardcode calendar dates. */
export function buildRequestClock(now = new Date(), timeZone = REQUEST_TIMEZONE) {
  const date = now instanceof Date ? now : new Date(now);
  const safe = Number.isFinite(date.getTime()) ? date : new Date();
  const dateParts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(safe);
  const pick = (type) => dateParts.find((p) => p.type === type)?.value ?? "";
  const current_date = `${pick("year")}-${pick("month")}-${pick("day")}`;
  const current_datetime = new Intl.DateTimeFormat("sv-SE", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  })
    .format(safe)
    .replace(" ", "T");
  return {
    current_datetime,
    current_date,
    timezone: timeZone,
  };
}

function chartEvidenceState(chart = null) {
  if (!chart || typeof chart !== "object") return "unknown";
  const contracts = Array.isArray(chart.contracts) ? chart.contracts : [];
  if (!contracts.length) {
    return chart.policy_count?.status === "verified" ? "partial" : "unknown";
  }
  if (contracts.every((c) => c?.evidence_state === "verified" || c?.status === "verified")) {
    return "verified";
  }
  if (contracts.some((c) => (c?.coverages?.length ?? 0) > 0 || c?.verified_fields)) {
    return "partial";
  }
  return "unknown";
}

function buildDocumentsEvidence(pdfMeta = null) {
  if (!pdfMeta || typeof pdfMeta !== "object") return [];
  const attached = pdfMeta.attached === true;
  const mime = pdfMeta?.mime_type ? String(pdfMeta.mime_type) : null;
  const isImage = Boolean(mime && mime.startsWith("image/"));
  const turns = parseRotationQuarterTurns(pdfMeta?.rotation_quarter_turns);
  const previewHint = attached && isImage ? buildPreviewOrientationHint(turns) : null;
  if (!attached && !pdfMeta.document_id) return [];
  return [
    {
      document_id: pdfMeta.document_id ?? null,
      original_filename: pdfMeta.original_filename ?? null,
      mime_type: mime,
      attached,
      note: attached
        ? isImage
          ? "Original image is attached as an image block."
          : "Original PDF is attached as a document block."
        : pdfMeta.note ?? "No document attached for this turn.",
      evidence_state: attached ? "attached" : "missing",
      ...(previewHint ? { preview_orientation_hint: previewHint } : {}),
    },
  ];
}

function buildCorporateEvidenceEntries({
  corporateContexts = null,
  corporateGapEvidence = null,
  corporateRecommendationCandidates = null,
  corporateUnknowns = null,
} = {}) {
  const gaps = (Array.isArray(corporateGapEvidence) ? corporateGapEvidence : [])
    .filter((row) => String(row?.entity_id ?? "").trim() && String(row?.item ?? "").trim())
    .map((row) => ({
      entity_id: row.entity_id,
      item: row.item,
      subject: "corporate",
      status: factStatusLabel(row),
      known_gap: row.known_gap === true,
      unknown_gap: row.unknown_gap === true,
      sufficient: row.sufficient === true,
      reason: row.reason ?? null,
      snapshot_field: row.snapshot_field ?? null,
      provenance: row.provenance ?? null,
    }));
  const recs = (
    Array.isArray(corporateRecommendationCandidates) ? corporateRecommendationCandidates : []
  )
    .filter((row) => String(row?.entity_id ?? "").trim() && String(row?.item ?? "").trim())
    .map((row) => ({
      entity_id: row.entity_id,
      item: row.item,
      subject: "corporate",
      action: row.action ?? null,
      confidence: row.confidence ?? null,
      reason: row.reason ?? null,
      provenance: row.provenance ?? null,
    }));
  const unknownsRaw = Array.isArray(corporateUnknowns) ? corporateUnknowns : [];

  return normalizeCorporateContexts(corporateContexts).map((corporate) => {
    const entityId = String(corporate.entity_id ?? "").trim();
    const entityUnknowns = unknownsRaw
      .filter((u) => String(u?.entity_id ?? "").trim() === entityId)
      .map((u) => (typeof u === "string" ? u : u?.unknown ?? u?.item ?? u))
      .filter(Boolean);
    const mergedUnknowns = [
      ...new Set([...(Array.isArray(corporate.unknowns) ? corporate.unknowns : []), ...entityUnknowns]),
    ];
    return {
      subject_type: "corporate",
      entity_id: entityId,
      entity_name: corporate.display_name ?? null,
      membership_role: corporate.membership_role ?? null,
      verified_context: {
        entity_type: corporate.entity_type,
        verified_facts: corporate.verified_facts ?? [],
        partial_facts: corporate.partial_facts ?? [],
      },
      gap_evidence: gaps.filter((g) => String(g.entity_id) === entityId),
      recommendation_candidates: recs.filter((r) => String(r.entity_id) === entityId),
      unknowns: mergedUnknowns,
      provenance: corporate.provenance ?? null,
      evidence_state:
        (corporate.verified_facts?.length ?? 0) > 0
          ? mergedUnknowns.length
            ? "partial"
            : "verified"
          : mergedUnknowns.length
            ? "unknown"
            : "partial",
    };
  });
}

/**
 * Preserve Anthropic web_search / citation metadata for KEY (not customer UI internals).
 * Does not write to customer fact/memory.
 */
export function extractPublicEvidenceFromClaudeContent(
  content = [],
  { retrievedAt = null } = {},
) {
  const retrieved_at =
    retrievedAt ??
    buildRequestClock(new Date(), REQUEST_TIMEZONE).current_datetime;
  const out = [];
  const seen = new Set();
  const push = (row) => {
    if (!row || typeof row !== "object") return;
    const title = row.title != null ? String(row.title) : null;
    const url = row.url != null ? String(row.url) : null;
    if (!title && !url) return;
    const key = `${url ?? ""}|${title ?? ""}|${row.citation_reference ?? ""}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({
      title,
      publisher: row.publisher != null ? String(row.publisher) : null,
      url,
      published_at: row.published_at ?? null,
      retrieved_at,
      citation_reference: row.citation_reference ?? null,
    });
  };

  for (const block of Array.isArray(content) ? content : []) {
    if (block?.type === "web_search_tool_result") {
      for (const item of Array.isArray(block.content) ? block.content : []) {
        if (!item || item.type === "web_search_tool_result_error") continue;
        push({
          title: item.title ?? item.page_title ?? null,
          publisher: item.publisher ?? item.site_name ?? null,
          url: item.url ?? item.page_url ?? null,
          published_at: item.published_at ?? item.page_age ?? null,
          citation_reference:
            item.cited_text ?? item.encrypted_index ?? item.snippet ?? null,
        });
      }
    }
    if (block?.type === "text" && Array.isArray(block.citations)) {
      for (const c of block.citations) {
        if (!c || typeof c !== "object") continue;
        push({
          title: c.title ?? c.source_title ?? null,
          publisher: c.publisher ?? c.site_name ?? null,
          url: c.url ?? c.source_url ?? null,
          published_at: c.published_at ?? c.page_age ?? null,
          citation_reference:
            c.cited_text ??
            c.citation_reference ??
            (c.start_char_index != null
              ? `chars:${c.start_char_index}-${c.end_char_index ?? ""}`
              : null),
        });
      }
    }
  }
  return out;
}

/**
 * Slice 6 question-centered evidence payload for the single free Claude-first KEY.
 * No guidance/mode/classifier. Insurance materials are available evidence, not identity.
 */
export function buildUserPayload({
  question,
  chart,
  contextPack,
  pdfMeta = null,
  corporateContexts = null,
  corporateGapEvidence = null,
  corporateRecommendationCandidates = null,
  corporateUnknowns = null,
  publicEvidence = null,
  activeClaimCases = null,
  now = null,
} = {}) {
  const clock = buildRequestClock(now ?? new Date(), REQUEST_TIMEZONE);
  const documents = buildDocumentsEvidence(pdfMeta);
  const corporate = buildCorporateEvidenceEntries({
    corporateContexts,
    corporateGapEvidence,
    corporateRecommendationCandidates,
    corporateUnknowns,
  });
  const public_evidence = Array.isArray(publicEvidence) ? publicEvidence : [];
  const keyConfirmed = Array.isArray(chart?.key_confirmed_source_facts)
    ? chart.key_confirmed_source_facts
    : [];
  const active_claim_cases = Array.isArray(activeClaimCases)
    ? activeClaimCases
    : [];

  // Compat mirrors for tests / older readers (same objects, no cross-copy of facts).
  const personalChart = chart
    ? {
        ...chart,
        subject: "personal",
        subject_type: "individual",
      }
    : null;

  return {
    current_question: String(question ?? ""),
    current_context: {
      current_datetime: clock.current_datetime,
      current_date: clock.current_date,
      timezone: clock.timezone,
      conversation: {
        // Same field names as keyClaudeFullContextPack — recent originals must reach Claude.
        recent_conversation_originals:
          contextPack?.recent_conversation_originals ??
          contextPack?.recent_turns ??
          [],
        older_conversation_summary:
          contextPack?.older_conversation_summary ??
          contextPack?.older_summary ??
          null,
        retained_past_originals: contextPack?.retained_past_originals ?? [],
      },
    },
    available_verified_evidence: {
      personal: {
        subject_type: "individual",
        chart: personalChart,
        // KEY(Claude) facts read from originals — prefer over factory OCR; do not auto-merge.
        key_confirmed_source_facts: keyConfirmed,
        // Active claim prep cases for continuity — not customer-facing field names.
        active_claim_cases,
        provenance: personalChart
          ? {
              source: "factory",
              schema: personalChart.schema ?? "verified_customer_chart_v1",
              key_confirmed_count: keyConfirmed.length,
              active_claim_case_count: active_claim_cases.length,
            }
          : null,
        evidence_state: chartEvidenceState(personalChart),
      },
      corporate,
      documents,
      public_evidence,
    },
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

function emptyWebSearchTrace() {
  return {
    web_search_available: true,
    web_search_used: false,
    web_search_count: 0,
    search_result_count: 0,
    search_citation_count: 0,
    search_latency_ms: null,
    claude_messages_request_count: 0,
    phase_b_call_count: 0,
    query_redacted: true,
    query_public_terms_count: null,
  };
}

/** Count web_search blocks without storing query text (PII-safe). */
function accumulateWebSearchTrace(trace, content = [], dataRaw = null) {
  const blocks = Array.isArray(content) ? content : [];
  let searches = 0;
  let results = 0;
  let citations = 0;
  for (const block of blocks) {
    if (block?.type === "server_tool_use" && block?.name === "web_search") searches += 1;
    if (block?.type === "web_search_tool_result") {
      const items = Array.isArray(block.content) ? block.content : [];
      for (const item of items) {
        if (item?.type === "web_search_tool_result_error") continue;
        if (item?.url || item?.title || item?.type === "web_search_result") results += 1;
      }
    }
    if (block?.type === "text" && Array.isArray(block.citations)) {
      citations += block.citations.length;
    }
  }
  const usageSearches = Number(dataRaw?.usage?.server_tool_use?.web_search_requests ?? 0);
  const nextCount = Math.max(trace.web_search_count, searches, usageSearches);
  return {
    ...trace,
    web_search_used: nextCount > 0 || results > 0,
    web_search_count: nextCount,
    search_result_count: trace.search_result_count + results,
    search_citation_count: trace.search_citation_count + citations,
    query_redacted: true,
  };
}

function pickCustomerAnswer(dataRaw) {
  const blocks = Array.isArray(dataRaw?.content) ? dataRaw.content : [];
  // Native Claude answers as plain text (Slice 5 — no emit_claude_full).
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
  corporateGapEvidence = null,
  corporateRecommendationCandidates = null,
  corporateUnknowns = null,
  activeClaimCases = null,
}) {
  const apiKey = String(env.ANTHROPIC_API_KEY ?? "").trim();
  if (!apiKey) {
    return { ok: false, error: "ANTHROPIC_NOT_CONFIGURED" };
  }
  const model = String(env.ANTHROPIC_MODEL ?? env.CLAUDE_MODEL ?? DEFAULT_MODEL).trim();
  const chart = buildVerifiedCustomerChart(reality);
  // Allowlist stays KEY-internal for hard-only — never shown in Claude payload.
  const allowlist = collectVerifiedSpeakAllowlistFromReality(reality);
  const { pack: contextPack } = buildClaudeFullContextPack({
    history,
    question,
  });
  const requestNow = startedAt instanceof Date ? startedAt : new Date(startedAt);
  const userPayload = buildUserPayload({
    question,
    chart,
    contextPack,
    pdfMeta,
    corporateContexts,
    corporateGapEvidence,
    corporateRecommendationCandidates,
    corporateUnknowns,
    publicEvidence: [],
    activeClaimCases,
    now: requestNow,
  });
  const pdfAttached = Boolean(pdfBase64);
  let system = buildSystemPrompt();
  if (pdfAttached) {
    system = `${system}\n${buildConfirmedSourceFactsToolHint(pdfMeta)}`;
  }
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
  let webSearchTrace = emptyWebSearchTrace();
  let publicEvidence = [];
  let confirmedSourceFacts = [];
  let claimCaseUpdates = [];
  let messagesRequestCount = 0;
  const searchWallStarted = Date.now();
  const factDefaults = {
    source_document_id: pdfMeta?.document_id ?? null,
    confirmed_at: buildRequestClock(requestNow, REQUEST_TIMEZONE).current_datetime,
  };
  const claimDefaults = {
    updated_at: buildRequestClock(requestNow, REQUEST_TIMEZONE).current_datetime,
  };

  // Plain text + web_search + claim-case tool; optional facts tool when original attached.
  const answerTools = pdfAttached
    ? [
        ANTHROPIC_WEB_SEARCH_TOOL,
        RECORD_CONFIRMED_SOURCE_FACTS_TOOL,
        RECORD_CLAIM_CASE_UPDATES_TOOL,
      ]
    : [ANTHROPIC_WEB_SEARCH_TOOL, RECORD_CLAIM_CASE_UPDATES_TOOL];
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
    messagesRequestCount += 1;
    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      return {
        ok: false,
        error: `ANTHROPIC_HTTP_${res.status}`,
        detail: String(errText).slice(0, 400),
        model,
        confirmed_source_facts: confirmedSourceFacts,
        claim_case_updates: claimCaseUpdates,
        web_search_trace: {
          ...webSearchTrace,
          claude_messages_request_count: messagesRequestCount,
          phase_b_call_count: 0,
        },
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
    webSearchTrace = accumulateWebSearchTrace(
      webSearchTrace,
      assistantContent,
      streamed.dataRaw,
    );
    const extracted = extractPublicEvidenceFromClaudeContent(assistantContent, {
      retrievedAt: buildRequestClock(new Date(), REQUEST_TIMEZONE).current_datetime,
    });
    if (extracted.length) {
      const seen = new Set(
        publicEvidence.map((e) => `${e.url ?? ""}|${e.title ?? ""}|${e.citation_reference ?? ""}`),
      );
      for (const row of extracted) {
        const key = `${row.url ?? ""}|${row.title ?? ""}|${row.citation_reference ?? ""}`;
        if (seen.has(key)) continue;
        seen.add(key);
        publicEvidence.push(row);
      }
    }

    const cardToolBlocks = assistantContent.filter(
      (b) => b?.type === "tool_use" && KEY_CARD_CLIENT_TOOL_NAMES.has(b?.name),
    );
    if (cardToolBlocks.some((b) => b.name === RECORD_CONFIRMED_SOURCE_FACTS_TOOL.name)) {
      confirmedSourceFacts = mergeKeyConfirmedSourceFacts(
        confirmedSourceFacts,
        extractConfirmedSourceFactsFromContent(assistantContent, factDefaults),
      );
    }
    if (cardToolBlocks.some((b) => b.name === RECORD_CLAIM_CASE_UPDATES_TOOL.name)) {
      claimCaseUpdates = mergeKeyActiveClaimCases(
        claimCaseUpdates,
        extractClaimCaseUpdatesFromContent(assistantContent, claimDefaults),
      );
    }

    const otherClientTools = assistantContent.filter(
      (b) => b?.type === "tool_use" && !KEY_CARD_CLIENT_TOOL_NAMES.has(b?.name),
    );
    const hasToolUse = hasClientToolUse(assistantContent);

    // Card tools only (no customer text yet) — acknowledge and continue for plain answer.
    if (cardToolBlocks.length && !picked.customer_answer && otherClientTools.length === 0) {
      messages = [
        ...messages,
        { role: "assistant", content: assistantContent },
        {
          role: "user",
          content: cardToolBlocks.map((b) => ({
            type: "tool_result",
            tool_use_id: b.id,
            content: JSON.stringify({ ok: true }),
          })),
        },
      ];
      continue;
    }

    // Answer ready (optionally with card tools in same response).
    if (picked.customer_answer && otherClientTools.length === 0) {
      lastPicked = { ...picked, source: picked.source || "plain_text" };
      onAnswerProgress?.(picked.customer_answer);
      messages = [...messages, { role: "assistant", content: assistantContent }];
      break;
    }

    if (picked.customer_answer && hasToolUse) {
      lastPicked = { ...picked, source: picked.source || "plain_text" };
      onAnswerProgress?.(picked.customer_answer);
    }

    if (!assistantContent.length) break;
    if (cardToolBlocks.length && otherClientTools.length === 0) {
      messages = [
        ...messages,
        { role: "assistant", content: assistantContent },
        {
          role: "user",
          content: cardToolBlocks.map((b) => ({
            type: "tool_result",
            tool_use_id: b.id,
            content: JSON.stringify({ ok: true }),
          })),
        },
      ];
    } else {
      messages = [
        ...messages,
        { role: "assistant", content: assistantContent },
        {
          role: "user",
          content: "Continue and provide the final Korean customer answer as plain text.",
        },
      ];
    }

    if (picked.customer_answer && !hasToolUse) break;
  }

  const customer_answer = String(
    lastPicked.customer_answer || streamedAnswer || "",
  ).trim();

  if (webSearchTrace.web_search_used) {
    webSearchTrace = {
      ...webSearchTrace,
      search_latency_ms: Math.max(0, Date.now() - searchWallStarted),
    };
  }
  webSearchTrace = {
    ...webSearchTrace,
    claude_messages_request_count: messagesRequestCount,
    phase_b_call_count: 0,
  };

  return {
    ok: Boolean(customer_answer),
    customer_answer,
    confirmed_source_facts: confirmedSourceFacts,
    claim_case_updates: claimCaseUpdates,
    visual_blocks: [],
    decision: lastPicked.decision,
    session_goal: lastPicked.session_goal,
    answer_source: lastPicked.source || (customer_answer ? "plain_text" : null),
    ttft_ms: lastTtft,
    chart,
    allowlist,
    pdf_attached: Boolean(pdfBase64),
    web_search_trace: webSearchTrace,
    public_evidence: publicEvidence,
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
  const corporateGapEvidence = Array.isArray(corporateLoaded?.corporate_gap_evidence)
    ? corporateLoaded.corporate_gap_evidence
    : [];
  const corporateRecommendationCandidates = Array.isArray(
    corporateLoaded?.corporate_recommendation_candidates,
  )
    ? corporateLoaded.corporate_recommendation_candidates
    : [];
  const corporateUnknowns = Array.isArray(corporateLoaded?.corporate_unknowns)
    ? corporateLoaded.corporate_unknowns
    : [];
  // entityContext from older clients is ignored for data access scope.
  void entityContext;

  const { policies, policy_count } = extractPoliciesFromContext({
    loadedContext,
    customerContextBundle,
    unifiedState,
  });
  const reality = { policies, policy_count };

  // Physical active attachment only — never invent latest document; never keyword-classify the question.
  const explicitDocumentId = String(attachedDocumentId ?? "").trim();
  const allowLatestFallback = false;
  const clientPriorAttach = priorAttachFollowUp === true;

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
  // Stale deleted active id on a normal insurance question must not block verified answers.
  const realPriorAttachFollowUp =
    clientPriorAttach === true &&
    isPriorAttachFollowUpQuestion(question, { history }) === true;
  if (explicitDocumentId && pdf?.meta?.attached !== true) {
    const staleActiveNotFollowUp =
      clientPriorAttach === true && realPriorAttachFollowUp !== true;
    if (!staleActiveNotFollowUp) {
      const usePriorAttachCopy = realPriorAttachFollowUp === true;
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
    // else: stale deleted active on a normal question → Claude-first with verified facts
  }

  // Real prior-attach follow-up but document id missing → reattach prompt.
  if (realPriorAttachFollowUp && !explicitDocumentId && pdf?.meta?.attached !== true) {
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

  // Existing customer-card claim cases — materials only; never invent cross-customer rows.
  let activeClaimCases = [];
  try {
    activeClaimCases = await loadKeyActiveClaimCases({
      supabase: userSupabase,
      customerId,
    });
  } catch (err) {
    console.error("[key_active_claim_cases_load]", String(err?.message ?? err).slice(0, 200));
    activeClaimCases = [];
  }

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
    corporateGapEvidence,
    corporateRecommendationCandidates,
    corporateUnknowns,
    activeClaimCases,
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

  // Slice 8: always prefer full Claude original when no CLOSED replacing hard.
  // sentence_hard_lite must not truncate normal contract-structure answers.
  const alreadyCommitted = Boolean(streamHandlers?._emitted) || Boolean(commitStream.getCommitted());
  let finalText = String(claude.customer_answer ?? "").trim();
  let usedFailure = false;
  let failureReason = null;

  if (!String(finalText ?? "").trim()) {
    finalText = commitStream.getCommitted() || KEY_MONOPOLY_FAILURE_CUSTOMER_TEXT;
    if (!commitStream.getCommitted()) {
      usedFailure = true;
      failureReason = "empty_answer";
    }
  } else if (replacingHard.length > 0 && !alreadyCommitted) {
    // Only monopoly-replace when nothing was already shown to the customer.
    finalText = KEY_MONOPOLY_FAILURE_CUSTOMER_TEXT;
    usedFailure = true;
    failureReason = replacingHard.join(";") || "closed_hard";
  } else if (replacingHard.length > 0 && alreadyCommitted) {
    // E: keep committed text; do not yank.
    finalText = commitStream.getCommitted() || finalText;
    failureReason = `committed_no_replace:${replacingHard.join(";")}`;
  }
  // else: seal Claude original as-is (no sentence_hard_lite truncation).

  // As-is delivery (no polish rewrite). Seal only.
  const sealed = sealKeyCustomerText(finalText);

  // Customer answer is fixed. Persist facts/claim cases only — never rewrite answer on failure.
  let keyConfirmedPersist = { attempted: false, ok: false, stored: 0 };
  const factsToPersist = Array.isArray(claude.confirmed_source_facts)
    ? claude.confirmed_source_facts
    : [];
  if (!usedFailure && factsToPersist.length > 0 && userSupabase && customerId) {
    try {
      keyConfirmedPersist = await persistKeyConfirmedSourceFactsToPolicies({
        supabase: userSupabase,
        customerId,
        facts: factsToPersist,
      });
    } catch (err) {
      keyConfirmedPersist = {
        attempted: true,
        ok: false,
        stored: 0,
        error: String(err?.message ?? err).slice(0, 200),
      };
      console.error("[key_confirmed_source_facts_persist]", keyConfirmedPersist);
    }
  }

  let claimCasePersist = { attempted: false, ok: false, stored: 0 };
  const claimCasesToPersist = Array.isArray(claude.claim_case_updates)
    ? claude.claim_case_updates
    : [];
  if (!usedFailure && claimCasesToPersist.length > 0 && userSupabase && customerId) {
    try {
      claimCasePersist = await persistKeyActiveClaimCases({
        supabase: userSupabase,
        customerId,
        claimCaseUpdates: claimCasesToPersist,
      });
    } catch (err) {
      claimCasePersist = {
        attempted: true,
        ok: false,
        stored: 0,
        error: String(err?.message ?? err).slice(0, 200),
      };
      console.error("[key_active_claim_cases_persist]", claimCasePersist);
    }
  }

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
        key_confirmed_source_facts: factsToPersist,
        active_claim_cases: claimCasesToPersist,
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
          web_search: claude.web_search_trace ?? emptyWebSearchTrace(),
          public_evidence: Array.isArray(claude.public_evidence) ? claude.public_evidence : [],
          confirmed_source_facts_count: factsToPersist.length,
          key_confirmed_persist: keyConfirmedPersist,
          active_claim_cases_hydrated: activeClaimCases.length,
          claim_case_updates_count: claimCasesToPersist.length,
          key_claim_case_persist: claimCasePersist,
          sealed_matches_claude:
            !usedFailure &&
            String(sealed.key_speak_original ?? "") === String(claude.customer_answer ?? "").trim(),
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
          payload: {
            policy_count,
            policy_rows: policies.length,
            active_claim_cases_hydrated: activeClaimCases.length,
          },
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
            web_search: claude.web_search_trace ?? emptyWebSearchTrace(),
            confirmed_source_facts_count: factsToPersist.length,
            claim_case_updates_count: claimCasesToPersist.length,
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
        {
          step: "key_confirmed_source_facts_persist",
          at_ms: relMs(startedAt),
          payload: keyConfirmedPersist,
        },
        {
          step: "key_active_claim_cases_persist",
          at_ms: relMs(startedAt),
          payload: claimCasePersist,
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
        "phase_b_visual",
        "emit_claude_full",
        "claim_bridge_speak",
      ],
      customer_text_path: ["claude_first_direct", "hard_only_check", "sealKeyCustomerText"],
    },
  };
}
