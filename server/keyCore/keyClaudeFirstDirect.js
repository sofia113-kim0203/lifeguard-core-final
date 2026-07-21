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
  shouldEnablePublicWebSearch,
} from "./keyBorrowedSensesSpeak.js";
import { collectVerifiedSpeakAllowlistFromReality } from "./keyVoiceDirective.js";
import {
  buildClaudeFullContextPack,
  isDeletedDocumentRecheckQuestion,
  mergeCurrentTurnDocumentIntoActiveDocuments,
} from "./keyClaudeFullContextPack.js";

/**
 * Active (non-deleted) documents for Claude history scrub.
 * Fail-closed: missing client/ids/query errors → [] (never null fail-open).
 */
async function loadActiveCustomerDocumentsForHistoryFilter({
  supabase = null,
  customerId = null,
} = {}) {
  const cid = String(customerId ?? "").trim();
  if (!supabase || !cid) return [];
  try {
    const { data, error } = await supabase
      .from("customer_documents")
      .select("id, original_filename")
      .eq("customer_id", cid)
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(80);
    if (error) return [];
    return (Array.isArray(data) ? data : []).map((row) => ({
      id: row?.id != null ? String(row.id) : null,
      original_filename: row?.original_filename ?? null,
    }));
  } catch {
    return [];
  }
}
import {
  buildAnthropicDirectAttachBlock,
  verifyAndFetchCustomerPdfOriginal,
  resolveExplicitCustomerDocumentMention,
  CLAUDE_FULL_PDF_MAX_BYTES,
  isClaudeDirectImageMediaType,
  normalizeClaudeDirectAttachMediaType,
  buildAttachOpsSignals,
} from "./keyClaudeFullDocumentDirect.js";
import {
  isPriorAttachFollowUpQuestion,
  isExplicitDocumentBoxMentionQuestion,
  extractMentionedFilenamesFromChat,
} from "../../src/lib/chatActiveAttachment.js";
import {
  gateKeyVoiceAnswer,
  jailbreakAudit,
  recommendationOrTerminationRisk,
} from "./keyVoiceGate.js";
import { finalizeKeyCustomerText } from "./keyCustomerMonopoly.js";
import { sealKeyCustomerText } from "./keyCustomerTextSeal.js";
import { neutralizeUnsupportedInsurerProductLiterals } from "./keyVerifiedLiteralConflict.js";
import { loadAllowedCorporateContextsForClaude } from "./keyClaudeCorporateContext.js";
import { startSpan, resolveDeployIdentity, buildPersistableLatencyMarks } from "./keyLatencyMarks.js";
import { createImmediateAnswerDeltaStream } from "./keyClaudeFirstSentenceCommit.js";
import {
  decidePdfAttachMode,
  loadCustomerDocumentChunksByDocumentId,
} from "./keyClaudePdfAttachPolicy.js";
import {
  resolveReadyCardForQuestionTurn,
  materialsFromReadyCard,
  buildReadyCardClaudeMeta,
} from "./keyReadyCardBuild.js";
import {
  extractLifeThreadsFromCustomerUtterance,
  mergeLifeThreadHistory,
  formatLifeThreadsForReadyCard,
  selectActiveLifeThreads,
  buildDoNotSurfaceLifeThreadOverlays,
  pickRecentlySurfacedThreadIds,
} from "./keyLifeThread.js";
import {
  KEY_PRESENCE_INTERNAL_QUESTION,
  KEY_PRESENCE_MOVE,
  KEY_PRESENCE_SILENCE_TOKEN,
  buildPresenceContext,
  buildPresenceSystemAddendum,
  buildPresenceUserQuestionLine,
  isPresenceSilenceAnswer,
  markLifeThreadSurfaced,
  resolvePresenceSurfaceFromAnswer,
  shouldInvokePresenceClaude,
  formatPresenceLifeThreadsBrief,
} from "./keyPresenceContext.js";
import { invalidateReadyCardCacheForCustomer } from "./keyReadyCardCache.js";
import {
  runKeyClaimIntakeSidecar,
  resolveClaimIntakeTurnScope,
  isExplicitCorporateClaimUtterance,
} from "./keyClaimIntakeSidecar.js";
import {
  assembleInsuranceClockItemsForHand,
  buildInsuranceClockHandBrief,
  buildInsuranceClockUpdatesFromUtterance,
  filterInsuranceClocksByScope,
  loadInsuranceClockItems,
  persistInsuranceClockItems,
  softInsuranceClockContext,
} from "./keyInsuranceClock.js";
import {
  buildClaimEvidenceHandBrief,
  buildClaimEvidenceUpdatesFromUtterance,
  buildContractPackageEvidenceFromDocs,
  filterClaimEvidenceByScope,
  loadClaimEvidenceItems,
  persistClaimEvidenceItems,
  softClaimEvidenceContext,
  syncClaimEvidenceFromCases,
} from "./keyClaimEvidenceVault.js";
import {
  buildLifeLedgerHandBrief,
  buildLifeLedgerUpdatesFromUtterance,
  filterLifeLedgerByScope,
  loadLifeLedgerItems,
  persistLifeLedgerItems,
  softLifeLedgerContext,
  syncLifeLedgerOutcomesFromClaims,
} from "./keyLifeLedger.js";
import {
  buildInsuranceClocksFromPolicyDateFacts,
  buildPolicyDateFactsFromUtterance,
  loadPolicyDateFacts,
  persistPolicyDateFacts,
} from "./keyPolicyDateFacts.js";
import {
  resolveCustomerViewMode,
  applyCustomerViewModeToUserPayload,
} from "./keyCustomerViewContext.js";
import { createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import {
  normalizeKeyConfirmedSourceFacts,
  mergeKeyConfirmedSourceFacts,
  resolveKeyConfirmableFactsForPersist,
  persistKeyConfirmedSourceFactsToPolicies,
  normalizeKeyCoverageBaselineFacts,
  mergeKeyCoverageBaselineFacts,
  keyValidateCoverageBaselineFacts,
  KEY_BASELINE_FACT_STATUSES,
  persistKeyCoverageBaselineFactsToPolicies,
  normalizeKeyClaimCaseUpdates,
  mergeKeyActiveClaimCases,
  persistKeyActiveClaimCases,
  loadKeyActiveClaimCases,
  filterKeyActiveClaimCasesByScope,
} from "../documentPolicyUploadPersist.js";
import {
  canSupportCorporateClaims,
  loadHolderAuthorityGrants,
} from "../entity/entityAuthorityConsent.js";
import {
  rebuildCustomerMemoryFoundation,
  resolveServiceRoleKey,
  resolveSupabaseUrl,
} from "../customerMemoryFoundation.js";

const DEFAULT_MODEL = "claude-sonnet-4-6";
const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";

/** Curated non-PII tokens used only for Anthropic error fingerprinting. */
const ANTHROPIC_ERROR_FINGERPRINT_KEYWORDS = Object.freeze([
  "tools",
  "tool",
  "tool_choice",
  "input_schema",
  "schema",
  "oneof",
  "anyof",
  "allof",
  "null",
  "nullable",
  "additionalproperties",
  "messages",
  "content",
  "model",
  "max_tokens",
  "temperature",
  "system",
  "web_search",
  "server_tool",
  "invalid",
  "required",
  "properties",
  "type",
  "enum",
  "custom",
  "does not support",
  "unexpected",
  "field required",
  "record_session_goal",
  "record_recommendation_basis",
  "record_confirmed_source_facts",
  "json",
  "array",
  "object",
  "string",
  "credit",
  "balance",
  "billing",
  "credits",
  "upgrade",
  "purchase",
]);

/**
 * Safe fingerprint of Anthropic error.message — keywords + path tokens + short hash.
 * Never returns the raw message or customer content.
 */
export function buildAnthropicErrorMessageFingerprint(errorMessage = "") {
  const raw = String(errorMessage ?? "").slice(0, 800);
  const lower = raw.toLowerCase();
  const matched_keywords = ANTHROPIC_ERROR_FINGERPRINT_KEYWORDS.filter((k) =>
    lower.includes(k),
  ).slice(0, 24);
  const path_tokens = [
    ...raw.matchAll(/\btools\.\d+(?:\.[A-Za-z0-9_]+)+/g),
  ]
    .map((m) => m[0])
    .filter((v, i, a) => a.indexOf(v) === i)
    .slice(0, 6);
  // Curated tokens only — never free-form error text (prevents secret/token leak on wire).
  const token_sample = matched_keywords.slice(0, 24);
  const redacted_preview =
    [...path_tokens, ...matched_keywords].slice(0, 16).join(" | ") || null;
  const message_sha256_16 = createHash("sha256")
    .update(raw)
    .digest("hex")
    .slice(0, 16);
  return {
    message_sha256_16,
    message_len: raw.length,
    matched_keywords,
    path_tokens,
    token_sample,
    redacted_preview,
  };
}

/** Non-PII byte-size bucket for attach diagnostics (never stores bytes/base64). */
export function bucketDocumentBytes(byteLength = null) {
  const n = Number(byteLength);
  if (!Number.isFinite(n) || n <= 0) return "none";
  if (n < 1024) return "lt_1kb";
  if (n < 100 * 1024) return "1kb_100kb";
  if (n < 1024 * 1024) return "100kb_1mb";
  if (n < 5 * 1024 * 1024) return "1mb_5mb";
  if (n < 20 * 1024 * 1024) return "5mb_20mb";
  return "gt_20mb";
}

const ANTHROPIC_MESSAGE_CATEGORIES = Object.freeze([
  "invalid_document",
  "document_too_large",
  "invalid_request",
  "tool_schema",
  "message_shape",
  "rate_or_transient",
  "billing_or_credits",
  "unknown_upstream_400",
]);

/**
 * Classify Anthropic error body into a fixed message_category code.
 * Scans message text for keywords only — never returns or stores the message.
 */
export function classifyAnthropicMessageCategory({
  status = null,
  errorType = null,
  errorMessage = "",
} = {}) {
  const st = Number(status);
  const t = String(errorType ?? "").toLowerCase();
  const m = String(errorMessage ?? "").toLowerCase();
  if (
    /credit\s*balance|too\s*low.*(?:access|api)|plans\s*&\s*billing|purchase\s*credits|billing|insufficient\s*(?:credit|quota|funds)/.test(
      m,
    ) ||
    t.includes("billing")
  ) {
    return "billing_or_credits";
  }
  if (
    st === 429 ||
    st === 529 ||
    t.includes("rate_limit") ||
    t.includes("overloaded") ||
    /rate\s*limit|overloaded|temporarily|try again|timeout/.test(m)
  ) {
    return "rate_or_transient";
  }
  if (
    /too\s*large|maximum.*(?:size|bytes|pages)|request.*(too\s*large|exceed)|payload.*large|max_tokens|context\s*length/.test(
      m,
    )
  ) {
    return "document_too_large";
  }
  if (
    /(?:invalid|corrupt|unable|could not|failed).*(?:pdf|document)|(?:pdf|document).*(?:invalid|corrupt|unable|parse|process)|unsupported\s*media|media_type/.test(
      m,
    )
  ) {
    return "invalid_document";
  }
  if (/tool_choice|input_schema|tools\.|\btools\b.*invalid|invalid.*\btool/.test(m)) {
    return "tool_schema";
  }
  if (
    /messages\.|content\s*block|invalid.*(?:message|content)|content\.\d+|unexpected.*(?:role|block)/.test(
      m,
    )
  ) {
    return "message_shape";
  }
  if (t.includes("invalid_request") || t === "invalid_request_error") {
    return "invalid_request";
  }
  if (st === 400 || !Number.isFinite(st)) return "unknown_upstream_400";
  return "unknown_upstream_400";
}

/**
 * Build codes-only Anthropic upstream diagnostic (no secrets, no PII, no raw message).
 */
export function buildAnthropicUpstreamDiag({
  status = null,
  errText = "",
  pdfAttachedAttempted = false,
  pdfBase64 = null,
  toolCount = null,
  providerCallNumber = null,
  requestPhase = "claude_first_messages_request",
} = {}) {
  let errorType = null;
  let errorCode = null;
  let scanMessage = "";
  const raw = String(errText ?? "");
  try {
    const j = JSON.parse(raw);
    const errObj = j?.error && typeof j.error === "object" ? j.error : j;
    errorType =
      errObj?.type != null
        ? String(errObj.type).slice(0, 80)
        : j?.type != null
          ? String(j.type).slice(0, 80)
          : null;
    errorCode =
      errObj?.code != null
        ? String(errObj.code).slice(0, 80)
        : null;
    scanMessage = String(errObj?.message ?? j?.message ?? "");
  } catch {
    scanMessage = raw;
  }
  // Cap scan buffer; never persist scanMessage on the returned object.
  scanMessage = scanMessage.slice(0, 800);
  const estimatedBytes =
    pdfAttachedAttempted && pdfBase64
      ? Math.floor((String(pdfBase64).length * 3) / 4)
      : 0;
  const message_category = classifyAnthropicMessageCategory({
    status,
    errorType,
    errorMessage: scanMessage,
  });
  const category = ANTHROPIC_MESSAGE_CATEGORIES.includes(message_category)
    ? message_category
    : "unknown_upstream_400";
  const fingerprint = buildAnthropicErrorMessageFingerprint(scanMessage);
  return {
    upstream_status: Number.isFinite(Number(status)) ? Number(status) : null,
    error_type: errorType,
    error_code: errorCode,
    message_category: category,
    request_phase: String(requestPhase ?? "claude_first_messages_request"),
    pdf_attached_attempted: pdfAttachedAttempted === true,
    document_byte_bucket: bucketDocumentBytes(
      pdfAttachedAttempted ? estimatedBytes : 0,
    ),
    tool_count: Number.isFinite(Number(toolCount)) ? Number(toolCount) : null,
    provider_call_number: Number.isFinite(Number(providerCallNumber))
      ? Number(providerCallNumber)
      : null,
    message_fingerprint: fingerprint,
  };
}

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
                "policyholder|insured|beneficiary|beneficiaries|insurer|insurer_name|product_name|premium|monthly_premium|coverage_name|coverage_amount|payment_period|insurance_period|effective_from|change_date|policy_number|policy.renewal_date|policy.maturity_date|policy.effective_from|renewal_date|maturity_date",
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
/**
 * Same Claude-first call — internal 7-item coverage baseline analysis (not customer text).
 * KEY validates before storage; never self-verify.
 */
export const RECORD_COVERAGE_BASELINE_FACTS_TOOL = Object.freeze({
  name: "record_coverage_baseline_facts",
  description:
    "원본 첨부 문서의 담보를 KEY 7개 기준선 항목으로 분석해 내부 보관한다. 고객 답변이 아니다. 추측·시장수치·업계기준금액 금지. 확인되지 않은 필드는 생략하거나 unresolved_reason만 남긴다. status는 KEY가 검증하므로 넣지 않는다.",
  input_schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      coverage_baseline_facts: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            source_document_id: { type: "string" },
            source_locator: {
              type: "object",
              additionalProperties: false,
              properties: {
                page: {},
                section: { type: "string" },
                line: { type: "string" },
                table_row: { type: "string" },
                source_text: { type: "string" },
                x: {},
                y: {},
              },
            },
            original_coverage_name: { type: "string" },
            baseline_item_id: {
              type: "string",
              description:
                "cancer_diagnosis|cerebrovascular_diagnosis|ischemic_heart_diagnosis|caregiving|hospital_daily|surgery|major_treatment|null",
            },
            major_treatment_region: {
              type: "string",
              description: "cancer|brain_heart|null — major_treatment만. 동시 지정 금지.",
            },
            structured_axis_id: { type: "string" },
            coverage_amount: {},
            payment_unit: { type: "string" },
            payment_frequency: { type: "string" },
            maximum_payment_days: {},
            coverage_period: { type: "string" },
            renewal: {},
            reduction_condition: { type: "string" },
            confidence: {},
            unresolved_reason: { type: "string" },
          },
          required: ["original_coverage_name"],
        },
      },
    },
    required: ["coverage_baseline_facts"],
  },
});

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

/**
 * Internal save-tool hint for original attach (image or PDF).
 * Not a fill-pressure reading script — Claude already has the original bytes.
 */
function buildConfirmedSourceFactsToolHint(pdfMeta = null) {
  const docId =
    pdfMeta?.document_id != null && String(pdfMeta.document_id).trim()
      ? String(pdfMeta.document_id).trim()
      : null;
  return [
    "원본 첨부가 있다. 고객 답변은 평문 한국어로만 작성한다 (형식·톤 재작성 금지).",
    "접수·예고 문장으로 답하지 않는다. '기록하고 분석하겠습니다', '먼저 확인하겠습니다', '분석해 드릴게요'처럼 나중에 하겠다는 말은 금지한다.",
    "같은 응답에서 원본에 명시된 계약 사실만 record_confirmed_source_facts 도구로 내부 보관한다. 빈 배열 금지. 최소 insurer(또는 insurer_name)와 product_name(또는 monthly_premium/premium)을 넣는다. 이 도구는 고객에게 말하지 않는다.",
    "같은 응답에서 담보별 KEY 7개 기준선 분석은 record_coverage_baseline_facts로 내부 보관한다. 고객에게 도구명·JSON·내부 필드명을 말하지 않는다.",
    "기준선 귀속: 일반암 정액 진단비→cancer_diagnosis, 광의 뇌혈관/허혈성심장 진단비→각 진단비, 일반 질병·상해 수술→surgery, 암 수술·항암·방사선·표적·면역→major_treatment+cancer, 뇌혈관·허혈성심장 치료 명시→major_treatment+brain_heart, 유사암·모호한 로봇수술만→baseline_item_id null + unresolved_reason.",
    "한 담보는 baseline_item_id 하나만. cancer와 brain_heart를 동시에 지정하지 않는다. 수술과 주요치료에 이중 표시하지 않는다.",
    "literal_value는 원문 그대로 둔다.",
    docId ? `source_document_id 기본값: ${docId}` : "source_document_id를 알면 반드시 넣는다.",
  ].join("\n");
}

function isImageAttachMeta(pdfMeta = null) {
  const mime = pdfMeta?.mime_type ? String(pdfMeta.mime_type).toLowerCase() : "";
  return pdfMeta?.attached === true && mime.startsWith("image/");
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

function extractCoverageBaselineFactsFromContent(content = [], defaults = {}) {
  const blocks = Array.isArray(content) ? content : [];
  let facts = [];
  for (const block of blocks) {
    if (block?.type !== "tool_use") continue;
    if (block?.name !== RECORD_COVERAGE_BASELINE_FACTS_TOOL.name) continue;
    facts = mergeKeyCoverageBaselineFacts(
      facts,
      normalizeKeyCoverageBaselineFacts(block?.input?.coverage_baseline_facts, defaults),
    );
  }
  return facts;
}

const KEY_CARD_CLIENT_TOOL_NAMES = new Set([
  RECORD_CONFIRMED_SOURCE_FACTS_TOOL.name,
  RECORD_COVERAGE_BASELINE_FACTS_TOOL.name,
  RECORD_CLAIM_CASE_UPDATES_TOOL.name,
]);

/**
 * GO3 — same Claude-first response only. Short-term session work state (not decision/memory).
 * Never drives an extra provider round-trip for tool_result.
 */
export const RECORD_SESSION_GOAL_TOOL = Object.freeze({
  name: "record_session_goal",
  description:
    "선택. 현재 대화 세션의 단기 작업 목표만 내부 기록한다. 고객에게 보이는 답변이 아니다. " +
    "허용 예: 가입 계약 확인, 보험료 부담을 줄일 선택지 비교, 수술 보험금 청구 가능성 확인. " +
    "금지: 감정·성격 추정, 미확정 해지/가입 의도, 건강·계약·가족 사실, 추천 결론/근거, 장기 프로필. " +
    "고객 답변에 목표를 억지로 언급하지 않는다. status는 active 또는 completed.",
  input_schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      goal: {
        type: ["string", "null"],
        description: "짧은 단기 작업 목표. completed면 null 허용.",
      },
      status: {
        type: "string",
        enum: ["active", "completed"],
      },
    },
    required: ["status"],
  },
});

const SESSION_GOAL_TOOL_NAME = RECORD_SESSION_GOAL_TOOL.name;
export const SESSION_GOAL_MAX_CHARS = 80;

/**
 * GO4A — same Claude-first response only. Trace-only recommendation evidence link.
 * Never persists, never reinjects, never rewrites customer_answer, never Continue.
 */
export const RECORD_RECOMMENDATION_BASIS_TOOL = Object.freeze({
  name: "record_recommendation_basis",
  description:
    "선택. 이번 고객 답변에 보험 추천·보완·방향 제안이 있을 때만, 같은 응답에서 내부 근거를 기록한다. " +
    "고객에게 보이는 답변이 아니다. evidence_refs는 available_verified_evidence 또는 " +
    "이번 응답에서 KEY가 검증한 coverage baseline 항목만. " +
    "부족액·가입/해지 확정·임의 고객 사실 금지. 추천이 없으면 호출하지 않는다.",
  input_schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      recommendations: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            recommendation_id: { type: "string" },
            recommendation_type: { type: "string" },
            evidence_refs: { type: "array", items: { type: "string" } },
            gap_or_axis: { type: "string" },
            why_relevant: { type: "string" },
            uncertainty: { type: "string" },
          },
          required: [
            "recommendation_id",
            "recommendation_type",
            "evidence_refs",
            "gap_or_axis",
            "why_relevant",
            "uncertainty",
          ],
        },
      },
    },
    required: ["recommendations"],
  },
});

const RECOMMENDATION_BASIS_TOOL_NAME = RECORD_RECOMMENDATION_BASIS_TOOL.name;

/**
 * Assemble Claude-first answer tools from confirmed turn context only.
 * No new keyword/intent router — document attach bytes, loaded claim cases,
 * and the existing public web-search path decide inclusion.
 * Tool definitions and validation stay intact; this only chooses which schemas to send.
 */
export function buildClaudeFirstAnswerTools({
  pdfAttached = false,
  activeClaimCases = null,
  question = "",
  history = [],
} = {}) {
  const tools = [];
  const hasDoc = pdfAttached === true;
  const hasClaim =
    Array.isArray(activeClaimCases) && activeClaimCases.length > 0;
  // Document-read / contract-confirm turns: web_search off by default (existing path).
  const includeWeb =
    !hasDoc && shouldEnablePublicWebSearch({ question, history });

  if (includeWeb) tools.push(ANTHROPIC_WEB_SEARCH_TOOL);
  if (hasDoc) {
    tools.push(RECORD_CONFIRMED_SOURCE_FACTS_TOOL, RECORD_COVERAGE_BASELINE_FACTS_TOOL);
  }
  if (hasClaim) tools.push(RECORD_CLAIM_CASE_UPDATES_TOOL);
  // GO3 + GO4A optional tools — never force an extra provider round-trip.
  tools.push(RECORD_SESSION_GOAL_TOOL, RECORD_RECOMMENDATION_BASIS_TOOL);
  return tools;
}

export function listClaudeFirstAnswerToolNames(opts = {}) {
  return buildClaudeFirstAnswerTools(opts)
    .map((t) => t?.name)
    .filter(Boolean);
}

const FORBIDDEN_RECOMMENDATION_BASIS_PAYLOAD_RE =
  /가입하세요|해지해도\s*됩니다|무조건\s*(?:이\s*)?상품|갈아타세요|01[016789]-?\d{3,4}-?\d{4}|[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}|\d{1,3}(?:,\d{3})+\s*원|부족(?:액|금액)?\s*\d/i;

function emptyRecommendationBasisTrace() {
  return {
    recommendation_basis_tool_seen: false,
    recommendation_basis_count: 0,
    recommendation_basis_rejected_count: 0,
    recommendation_basis_reject_reasons: [],
    recommendation_basis_ok: true,
  };
}

/**
 * Build structural evidence catalog from this turn's Claude user payload +
 * same-response KEY-validated coverage baseline rows only.
 * Returns ref → { axes: string[], document_ids: string[] } (no PII payloads).
 */
export function buildRecommendationEvidenceCatalog({
  userPayload = null,
  validatedBaselineFacts = [],
} = {}) {
  const catalog = new Map();
  const allowedDocuments = new Set();

  const addRef = (ref, { axes = [], document_ids = [] } = {}) => {
    const key = String(ref ?? "").trim();
    if (!key) return;
    const prev = catalog.get(key) ?? { axes: new Set(), document_ids: new Set() };
    for (const a of axes) {
      const axis = String(a ?? "").trim();
      if (axis) prev.axes.add(axis);
    }
    for (const d of document_ids) {
      const doc = String(d ?? "").trim();
      if (doc) {
        prev.document_ids.add(doc);
        allowedDocuments.add(doc);
      }
    }
    catalog.set(key, prev);
  };

  const evidence =
    userPayload?.available_verified_evidence &&
    typeof userPayload.available_verified_evidence === "object"
      ? userPayload.available_verified_evidence
      : null;
  const personal = evidence?.personal && typeof evidence.personal === "object"
    ? evidence.personal
    : null;
  const chart = personal?.chart && typeof personal.chart === "object" ? personal.chart : null;

  for (const doc of Array.isArray(evidence?.documents) ? evidence.documents : []) {
    const did = String(doc?.document_id ?? doc?.id ?? "").trim();
    if (did) allowedDocuments.add(did);
  }

  const contracts = Array.isArray(chart?.contracts) ? chart.contracts : [];
  for (const c of contracts) {
    const cid = String(c?.contract_id ?? "").trim();
    const idx = c?.index;
    const axes = [];
    const coverages = Array.isArray(c?.coverages)
      ? c.coverages
      : Array.isArray(c?.verified_fields?.coverages)
        ? c.verified_fields.coverages
        : [];
    for (const cov of coverages) {
      const label =
        typeof cov === "string"
          ? cov
          : cov?.name ?? cov?.coverage_name ?? cov?.label ?? null;
      if (label != null && String(label).trim()) axes.push(String(label).trim());
    }
    if (cid) {
      addRef(`personal.contract:${cid}`, { axes: axes.length ? axes : ["contract"] });
      for (const label of axes) {
        addRef(`personal.coverage:${cid}:${label}`, { axes: [label] });
      }
    }
    if (idx != null && Number.isFinite(Number(idx))) {
      addRef(`personal.contract_index:${Number(idx)}`, {
        axes: axes.length ? axes : ["contract"],
      });
    }
  }

  const facts = Array.isArray(personal?.key_confirmed_source_facts)
    ? personal.key_confirmed_source_facts
    : Array.isArray(chart?.key_confirmed_source_facts)
      ? chart.key_confirmed_source_facts
      : [];
  for (const f of facts) {
    const ft = String(f?.fact_type ?? "").trim();
    if (!ft) continue;
    const doc = String(f?.source_document_id ?? "").trim();
    addRef(`personal.fact:${ft}`, {
      axes: [ft],
      document_ids: doc ? [doc] : [],
    });
    if (doc) {
      addRef(`personal.fact:${ft}@${doc}`, { axes: [ft], document_ids: [doc] });
    }
  }

  for (const corp of Array.isArray(evidence?.corporate) ? evidence.corporate : []) {
    const eid = String(corp?.entity_id ?? "").trim();
    if (!eid) continue;
    for (const g of Array.isArray(corp?.gap_evidence) ? corp.gap_evidence : []) {
      const item = String(g?.item ?? "").trim();
      if (!item) continue;
      addRef(`corporate.gap:${eid}:${item}`, { axes: [item] });
    }
    for (const r of Array.isArray(corp?.recommendation_candidates)
      ? corp.recommendation_candidates
      : []) {
      const item = String(r?.item ?? "").trim();
      if (!item) continue;
      addRef(`corporate.rec:${eid}:${item}`, { axes: [item] });
    }
  }

  const baselineRows = Array.isArray(validatedBaselineFacts) ? validatedBaselineFacts : [];
  for (const row of baselineRows) {
    const status = String(row?.status ?? "").trim();
    // GO4A: KEY-confirmed baseline only — PENDING (structured_details_incomplete) excluded.
    if (status !== KEY_BASELINE_FACT_STATUSES.VERIFIED) {
      continue;
    }
    const item = String(row?.baseline_item_id ?? "").trim();
    if (!item) continue;
    const doc = String(row?.source_document_id ?? "").trim();
    addRef(`baseline:${item}`, { axes: [item], document_ids: doc ? [doc] : [] });
    if (doc) {
      addRef(`baseline:${item}@${doc}`, { axes: [item], document_ids: [doc] });
    }
  }

  return { catalog, allowedDocuments };
}

function classifyRecommendationBasisRow(row, catalogState) {
  if (!row || typeof row !== "object") return "invalid_schema";
  const recommendation_id = String(row.recommendation_id ?? "").trim();
  const recommendation_type = String(row.recommendation_type ?? "").trim();
  const gap_or_axis = String(row.gap_or_axis ?? "").trim();
  const why_relevant = String(row.why_relevant ?? "").trim();
  const uncertainty = String(row.uncertainty ?? "").trim();
  const refs = Array.isArray(row.evidence_refs)
    ? row.evidence_refs.map((r) => String(r ?? "").trim()).filter(Boolean)
    : null;

  if (
    !recommendation_id ||
    !recommendation_type ||
    !gap_or_axis ||
    !why_relevant ||
    !uncertainty ||
    refs == null
  ) {
    return "invalid_schema";
  }
  if (refs.length === 0) return "empty_refs";

  const blob = [recommendation_type, gap_or_axis, why_relevant, uncertainty, ...refs].join(" ");
  if (FORBIDDEN_RECOMMENDATION_BASIS_PAYLOAD_RE.test(blob)) return "forbidden_payload";

  const { catalog, allowedDocuments } = catalogState;
  const citedAxes = new Set();
  for (const ref of refs) {
    let meta = catalog.get(ref);
    if (!meta) {
      const at = ref.lastIndexOf("@");
      if (at > 0) {
        const base = ref.slice(0, at);
        const docFromRef = ref.slice(at + 1).trim();
        if (
          catalog.has(base) &&
          docFromRef &&
          !docFromRef.includes(":") &&
          allowedDocuments.size > 0 &&
          !allowedDocuments.has(docFromRef)
        ) {
          return "foreign_document_ref";
        }
      }
      return "unknown_ref";
    }
    for (const doc of meta.document_ids) {
      if (allowedDocuments.size > 0 && !allowedDocuments.has(doc)) {
        return "foreign_document_ref";
      }
    }
    for (const axis of meta.axes) citedAxes.add(axis);
  }

  if (!citedAxes.has(gap_or_axis)) return "axis_mismatch";
  return null;
}

/** Extract + structurally validate. Trace-only — never returns customer text or raw why_relevant. */
export function extractRecommendationBasisFromContent(
  content = [],
  { userPayload = null, validatedBaselineFacts = [] } = {},
) {
  const blocks = Array.isArray(content) ? content : [];
  let found = null;
  for (const block of blocks) {
    if (block?.type === "tool_use" && block?.name === RECOMMENDATION_BASIS_TOOL_NAME) {
      found = block.input && typeof block.input === "object" ? block.input : null;
    }
  }
  if (!found) {
    return emptyRecommendationBasisTrace();
  }

  const catalogState = buildRecommendationEvidenceCatalog({
    userPayload,
    validatedBaselineFacts,
  });
  const rows = Array.isArray(found.recommendations) ? found.recommendations : null;
  if (rows == null) {
    return {
      recommendation_basis_tool_seen: true,
      recommendation_basis_count: 0,
      recommendation_basis_rejected_count: 1,
      recommendation_basis_reject_reasons: ["invalid_schema"],
      recommendation_basis_ok: false,
    };
  }
  if (rows.length === 0) {
    return {
      recommendation_basis_tool_seen: true,
      recommendation_basis_count: 0,
      recommendation_basis_rejected_count: 1,
      recommendation_basis_reject_reasons: ["invalid_schema"],
      recommendation_basis_ok: false,
    };
  }

  const reasonCounts = new Map();
  let accepted = 0;
  let rejected = 0;
  for (const row of rows) {
    const reason = classifyRecommendationBasisRow(row, catalogState);
    if (reason) {
      rejected += 1;
      reasonCounts.set(reason, (reasonCounts.get(reason) ?? 0) + 1);
    } else {
      accepted += 1;
    }
  }
  const reject_reasons = [...reasonCounts.keys()].sort();
  return {
    recommendation_basis_tool_seen: true,
    recommendation_basis_count: accepted,
    recommendation_basis_rejected_count: rejected,
    recommendation_basis_reject_reasons: reject_reasons,
    recommendation_basis_ok: rejected === 0 && accepted > 0,
  };
}

function validateSameResponseBaselineForCatalog(
  normalizedFacts = [],
  { ownedDocumentIds = [] } = {},
) {
  const validated = keyValidateCoverageBaselineFacts(normalizedFacts, {
    ownedDocumentIds,
  });
  return (Array.isArray(validated) ? validated : []).filter((row) => {
    const status = String(row?.status ?? "").trim();
    return (
      status === KEY_BASELINE_FACT_STATUSES.VERIFIED &&
      String(row?.baseline_item_id ?? "").trim()
    );
  });
}

/**
 * Explicit abort of prior short-term goal.
 * Avoids 그 얘기 말고도 / quoted phrases / incidental fragments.
 */
export function shouldDiscardStaleSessionGoal(question = "") {
  let q = String(question ?? "")
    .replace(/\s+/g, " ")
    .trim();
  if (!q) return false;
  // Quoted spans do not count as customer abort directives.
  q = q
    .replace(/"[^"]*"/g, " ")
    .replace(/'[^']*'/g, " ")
    .replace(/“[^”]*”/g, " ")
    .replace(/‘[^’]*’/g, " ")
    .replace(/「[^」]*」/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!q) return false;
  // (?!도) blocks "그 얘기 말고도"
  if (/그\s*얘기\s*말고(?!도)/.test(q)) return true;
  if (/그\s*주제\s*말고(?!도)/.test(q)) return true;
  if (/이건\s*됐어/.test(q)) return true;
  if (/다른\s*얘기/.test(q)) return true;
  if (/이제\s*그만/.test(q)) return true;
  if (/그건\s*나중에/.test(q)) return true;
  if (/그만\s*하자/.test(q)) return true;
  return false;
}

/** Reason code only — never echo goal text into traces. */
export function classifySessionGoalRejectReason(goal = "", status = "active") {
  const st = String(status ?? "").trim();
  if (st !== "active" && st !== "completed") return "invalid_status";
  let g = goal == null ? null : String(goal).trim() || null;
  if (st === "completed") return null;
  if (!g) return "empty_goal";
  if (g.length > SESSION_GOAL_MAX_CHARS) return "too_long";
  if (/[\r\n]/.test(g) || /•|^\s*[-*]\s+/m.test(g) || /\d+\.\s+\S/.test(g)) {
    return "multiline_or_list";
  }
  if (/그리고|,|\/|;|·/.test(g) && /확인|비교|청구|선택/.test(g) && g.split(/그리고|,|\/|;|·/).length > 2) {
    return "multi_goal";
  }
  if (/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(g)) return "pii_email";
  if (/01[016789]-?\d{3,4}-?\d{4}/.test(g)) return "pii_phone";
  if (/\d{6}-?[1-4]\d{6}/.test(g)) return "pii_rrn";
  if (/\d{1,3}(,?\d{3})+\s*원|\d+\s*원|\d+\s*%/.test(g)) return "literal_money_or_rate";
  if (/(삼성|현대|KB|메리츠|한화|교보|DB|흥국|라이나|AIA|푸르덴셜)\s*(생명|화재|손해|보험)?/.test(g)) {
    return "literal_product_or_insurer";
  }
  if (/[가-힣]{2,4}\s*(님|씨)/.test(g)) return "literal_person_name";
  if (/감정|성격|불안|화나|우울|외로|성향|성격상/.test(g)) return "emotion_or_personality";
  if (
    /해지하려는|해지할\s*것\s*같|해지하고\s*싶어\s*하는\s*것\s*같|가입하려는\s*것\s*같|해지\s*의도/.test(
      g,
    )
  ) {
    return "uncertain_cancel_intent";
  }
  if (/건강\s*상태|가족\s*관계|수익자\s*는|계약자\s*는|장기\s*프로필|고객\s*프로필|페르소나/.test(g)) {
    return "fact_or_profile";
  }
  if (/가입하세요|해지해도|추천\s*결론|반드시\s*가입|이\s*상품이\s*맞/.test(g)) {
    return "recommend_verdict";
  }
  return null;
}

export function isForbiddenSessionGoalText(goal = "") {
  return classifySessionGoalRejectReason(goal, "active") != null;
}

/** Server stamps updated_at. Returns null when tool input must not be persisted. */
export function normalizeSessionGoalRecord(raw = null, { now = new Date() } = {}) {
  if (!raw || typeof raw !== "object") return null;
  const status = String(raw.status ?? "").trim();
  if (status !== "active" && status !== "completed") return null;
  let goal = raw.goal == null ? null : String(raw.goal).replace(/\s+/g, " ").trim() || null;
  if (status === "active") {
    if (classifySessionGoalRejectReason(goal, "active")) return null;
  } else if (goal && classifySessionGoalRejectReason(goal, "active")) {
    goal = null;
  }
  const stamp = now instanceof Date ? now : new Date(now);
  const updated_at = Number.isFinite(stamp.getTime())
    ? stamp.toISOString()
    : new Date().toISOString();
  return { goal, status, updated_at };
}

export function extractSessionGoalFromContent(content = [], { now = new Date() } = {}) {
  const blocks = Array.isArray(content) ? content : [];
  let found = null;
  for (const block of blocks) {
    if (block?.type === "tool_use" && block?.name === SESSION_GOAL_TOOL_NAME) {
      found = block.input && typeof block.input === "object" ? block.input : null;
    }
  }
  if (!found) return { record: null, tool_seen: false, rejected: false, reject_reason: null };
  const status = String(found.status ?? "").trim();
  const reject_reason =
    status === "active"
      ? classifySessionGoalRejectReason(found.goal, "active")
      : status !== "completed"
        ? "invalid_status"
        : null;
  const record = normalizeSessionGoalRecord(found, { now });
  if (!record) {
    return {
      record: null,
      tool_seen: true,
      rejected: true,
      reject_reason: reject_reason || "rejected",
    };
  }
  return { record, tool_seen: true, rejected: false, reject_reason: null };
}

/** Soft hydrate from server SSOT active goal only. */
export function resolveSessionGoalForContext(priorGoal = null, question = "") {
  if (!priorGoal || typeof priorGoal !== "object") return null;
  if (String(priorGoal.status ?? "").trim() !== "active") return null;
  const goal = String(priorGoal.goal ?? "").trim();
  if (!goal || isForbiddenSessionGoalText(goal)) return null;
  if (shouldDiscardStaleSessionGoal(question)) return null;
  return {
    goal,
    status: "active",
    updated_at: priorGoal.updated_at ?? null,
  };
}

/**
 * Server SSOT — latest assistant metadata_json.session_goal for customer_id + session_id.
 * Newest slot with session_goal wins; completed stops lookback (no revive of older active).
 */
export async function loadLatestSessionGoalFromConversations({
  supabase = null,
  customerId = null,
  sessionId = null,
  limit = 40,
} = {}) {
  const cid = String(customerId ?? "").trim();
  const sid = String(sessionId ?? "").trim();
  if (!supabase || !cid || !sid) {
    return { goal: null, reason: "missing_scope" };
  }
  try {
    const { data, error } = await supabase
      .from("customer_conversations")
      .select("role, metadata_json, created_at")
      .eq("customer_id", cid)
      .eq("role", "assistant")
      .order("created_at", { ascending: false })
      .limit(Math.max(1, Number(limit) || 40));
    if (error) return { goal: null, reason: "query_failed" };
    for (const row of data ?? []) {
      const meta = row?.metadata_json && typeof row.metadata_json === "object"
        ? row.metadata_json
        : {};
      if (String(meta.session_id ?? "").trim() !== sid) continue;
      const sg = meta.session_goal;
      if (!sg || typeof sg !== "object") continue;
      const status = String(sg.status ?? "").trim();
      if (status === "completed") return { goal: null, reason: "completed_slot" };
      if (status === "active") {
        const g = String(sg.goal ?? "").trim();
        if (!g || isForbiddenSessionGoalText(g)) {
          return { goal: null, reason: "invalid_active_slot" };
        }
        return {
          goal: {
            goal: g,
            status: "active",
            updated_at: sg.updated_at ?? null,
          },
          reason: "active",
        };
      }
      return { goal: null, reason: "invalid_slot" };
    }
    return { goal: null, reason: "none" };
  } catch {
    return { goal: null, reason: "query_exception" };
  }
}

/**
 * Soft customer-wide active goal (any session) — preference / open task continuity.
 * Does not invent; never above current question. Same forbidden-goal filter as SSOT.
 */
export async function loadLatestActiveCustomerGoalFromConversations({
  supabase = null,
  customerId = null,
  excludeSessionId = null,
  limit = 60,
} = {}) {
  const cid = String(customerId ?? "").trim();
  if (!supabase || !cid) {
    return { goal: null, reason: "missing_scope" };
  }
  const excludeSid = String(excludeSessionId ?? "").trim();
  try {
    const { data, error } = await supabase
      .from("customer_conversations")
      .select("role, metadata_json, created_at")
      .eq("customer_id", cid)
      .eq("role", "assistant")
      .order("created_at", { ascending: false })
      .limit(Math.max(1, Number(limit) || 60));
    if (error) return { goal: null, reason: "query_failed" };
    for (const row of data ?? []) {
      const meta =
        row?.metadata_json && typeof row.metadata_json === "object" ? row.metadata_json : {};
      if (excludeSid && String(meta.session_id ?? "").trim() === excludeSid) continue;
      const sg = meta.session_goal;
      if (!sg || typeof sg !== "object") continue;
      const status = String(sg.status ?? "").trim();
      if (status === "completed") continue;
      if (status !== "active") continue;
      const g = String(sg.goal ?? "").trim();
      if (!g || isForbiddenSessionGoalText(g)) continue;
      return {
        goal: {
          goal: g,
          status: "active",
          updated_at: sg.updated_at ?? null,
          source_session_id: String(meta.session_id ?? "").trim() || null,
        },
        reason: "customer_active",
      };
    }
    return { goal: null, reason: "none" };
  } catch {
    return { goal: null, reason: "query_exception" };
  }
}

/**
 * Prior consultation pack for revisit — system KEY provides related history to Claude.
 * Separates customer speech / Claude speech / open goals. Never promotes judgment to verified fact.
 */
export async function loadCustomerPriorConsultationForClaude({
  supabase = null,
  customerId = null,
  currentSessionId = null,
  limit = 24,
} = {}) {
  const cid = String(customerId ?? "").trim();
  const currentSid = String(currentSessionId ?? "").trim();
  if (!supabase || !cid) {
    return { prior: null, reason: "missing_scope" };
  }
  try {
    // customer_conversations column is `message` (not content). Filter by customer_id only.
    const { data, error } = await supabase
      .from("customer_conversations")
      .select("role, message, metadata_json, created_at")
      .eq("customer_id", cid)
      .order("created_at", { ascending: false })
      .limit(Math.max(4, Number(limit) || 24));
    if (error) return { prior: null, reason: "query_failed" };

  const turns = [];
  const open_goals = [];
  const open_tasks = [];
  const lifeThreadRows = [];
  const seenGoal = new Set();
  for (const row of data ?? []) {
      const meta =
        row?.metadata_json && typeof row.metadata_json === "object" ? row.metadata_json : {};
      const sid = String(meta.session_id ?? "").trim();
      const role = String(row?.role ?? "").trim();
      const sameSession = Boolean(currentSid && sid === currentSid);
      const rec =
        role === "assistant" && meta.key_consultation_record && typeof meta.key_consultation_record === "object"
          ? meta.key_consultation_record
          : null;
      // T5 — LIFE THREAD may continue inside the same session; always collect by customer_id.
      if (rec && Array.isArray(rec.life_threads)) {
        for (const th of rec.life_threads) {
          if (th && typeof th === "object") lifeThreadRows.push(th);
        }
      }
      if (sameSession) continue;
      const content = String(row?.message ?? "").trim().slice(0, 600);
      if ((role === "user" || role === "assistant") && content) {
        turns.push({
          role,
          content,
          session_id: sid || null,
          created_at: row?.created_at ?? null,
        });
      }
      if (role === "assistant") {
        const sg = meta.session_goal;
        if (sg && typeof sg === "object" && String(sg.status ?? "") === "active") {
          const g = String(sg.goal ?? "").trim();
          if (g && !isForbiddenSessionGoalText(g) && !seenGoal.has(g)) {
            seenGoal.add(g);
            open_goals.push({ goal: g, status: "active", updated_at: sg.updated_at ?? null });
            open_tasks.push({ kind: "session_goal", detail: g });
          }
        }
        if (rec && Array.isArray(rec.next_tasks)) {
          for (const t of rec.next_tasks.slice(0, 4)) {
            const detail = String(t?.detail ?? t ?? "").trim();
            if (detail) open_tasks.push({ kind: "next_task", detail: detail.slice(0, 200) });
          }
        }
      }
      if (turns.length >= 16) break;
    }
    turns.reverse();
    const life_threads_all = mergeLifeThreadHistory(lifeThreadRows);
    // T5.1 — Claude/READY CARD soft inject gets active only; resolved stays in conversation history.
    const life_threads = selectActiveLifeThreads(life_threads_all, { customerId: cid });
    if (!turns.length && !open_goals.length && !life_threads_all.length) {
      return { prior: null, reason: "none" };
    }
    return {
      prior: {
        related_turns: turns.slice(-12),
        open_goals: open_goals.slice(0, 3),
        open_tasks: open_tasks.slice(0, 6),
        life_threads,
        life_threads_history: life_threads_all,
        note: "prior_consultation_reference_only_not_verified_fact",
      },
      reason: "ok",
    };
  } catch {
    return { prior: null, reason: "query_exception" };
  }
}

/**
 * Source link for goal / outcomes / consultation record.
 * Prefer source_turn_id → message_id → session_id + turn_ord.
 */
export function resolveConsultationSourceLink({
  sourceTurnId = null,
  messageId = null,
  sessionId = null,
  turnOrd = null,
} = {}) {
  const sid = String(sessionId ?? "").trim() || null;
  const ord =
    turnOrd == null || turnOrd === ""
      ? null
      : Number.isFinite(Number(turnOrd))
        ? Number(turnOrd)
        : null;
  const st = String(sourceTurnId ?? "").trim();
  if (st) {
    return {
      method: "source_turn_id",
      source_turn_id: st,
      message_id: null,
      session_id: sid,
      turn_ord: ord,
    };
  }
  const mid = String(messageId ?? "").trim();
  if (mid) {
    return {
      method: "message_id",
      source_turn_id: null,
      message_id: mid,
      session_id: sid,
      turn_ord: ord,
    };
  }
  if (sid && ord != null) {
    return {
      method: "session_turn_ord",
      source_turn_id: null,
      message_id: null,
      session_id: sid,
      turn_ord: ord,
    };
  }
  if (sid) {
    return {
      method: "session_id",
      source_turn_id: null,
      message_id: null,
      session_id: sid,
      turn_ord: ord,
    };
  }
  return {
    method: "none",
    source_turn_id: null,
    message_id: null,
    session_id: null,
    turn_ord: ord,
  };
}

/**
 * KEY post-writer — explicit customer preference/goal from utterance only.
 * Never parse Claude answer. Returns short goal string or null.
 */
export function extractCustomerStatedGoalFromUtterance(question = "") {
  const q = String(question ?? "").trim();
  if (!q) return null;
  // Customer preference markers only (싶어/할래/하고 싶) — reject Claude-like advice prose.
  const rules = [
    {
      re: /새\s*보험부터\s*가입하기보다.{0,40}기존\s*보험을?\s*먼저.{0,24}(보고\s*싶|보고\s*싶어|확인할래|확인하고\s*싶)/,
      goal: "기존 보험을 먼저 보고 싶음",
    },
    {
      re: /기존\s*보험을?\s*먼저.{0,24}(제대로\s*)?(보고\s*싶|보고\s*싶어|확인할래|확인하고\s*싶)/,
      goal: "기존 보험을 먼저 보고 싶음",
    },
    {
      re: /기존\s*보험\s*먼저.{0,16}(보고\s*싶|보고\s*싶어|확인할래|확인하고\s*싶)/,
      goal: "기존 보험을 먼저 보고 싶음",
    },
    {
      re: /(먼저\s*보고\s*싶|먼저\s*확인하고\s*싶).{0,20}기존\s*보험/,
      goal: "기존 보험을 먼저 보고 싶음",
    },
  ];
  for (const rule of rules) {
    if (!rule.re.test(q)) continue;
    if (isForbiddenSessionGoalText(rule.goal)) return null;
    return rule.goal;
  }
  return null;
}

/**
 * Explicit customer result phrases only — never Claude judgment/recommendation text.
 */
export function extractCustomerStatedOutcomesFromUtterance(question = "") {
  const q = String(question ?? "").trim();
  if (!q) return [];
  const out = [];
  if (
    /유지하기로\s*했|당분간\s*유지|기존\s*보험은?\s*.{0,24}유지하기로|유지하기로\s*결정/.test(q)
  ) {
    out.push({
      kind: "policy_keep_decision",
      detail: "기존 보험 유지 결정",
      evidence: { customer_utterance: q.slice(0, 240) },
    });
  }
  if (/서류.{0,16}(오늘\s*)?(올렸|올렸고|업로드했|제출했)|오늘\s*올렸/.test(q)) {
    out.push({
      kind: "document_upload_stated",
      detail: "서류 제출 발언",
      evidence: { customer_utterance: q.slice(0, 240) },
    });
  }
  if (/청구.{0,12}(접수|넣었|했어|신청했)|클레임.{0,8}(접수|넣었)/.test(q)) {
    out.push({
      kind: "claim_filed_stated",
      detail: "청구 접수 발언",
      evidence: { customer_utterance: q.slice(0, 240) },
    });
  }
  if (/결과\s*서류|결과\s*문서|확인서.{0,8}(받았|올렸)/.test(q)) {
    out.push({
      kind: "result_document_stated",
      detail: "결과 문서 발언",
      evidence: { customer_utterance: q.slice(0, 240) },
    });
  }
  return out;
}

/**
 * System-confirmed turn events (upload / contract / claim) — not Claude text.
 */
export function collectSystemConfirmedOutcomes({
  pdfAttached = false,
  documentId = null,
  systemEvents = null,
} = {}) {
  const out = [];
  const docId = String(documentId ?? "").trim() || null;
  if (pdfAttached === true && docId) {
    out.push({
      kind: "document_uploaded",
      detail: `document:${docId.slice(0, 80)}`,
      evidence: { document_id: docId, system_event: true },
    });
  }
  const events = Array.isArray(systemEvents) ? systemEvents : [];
  for (const ev of events) {
    if (!ev || typeof ev !== "object") continue;
    const kind = String(ev.kind ?? "").trim();
    if (!kind) continue;
    if (kind === "document_uploaded" && docId) continue; // already from pdf attach
    out.push({
      kind,
      detail: String(ev.detail ?? kind).slice(0, 200),
      evidence:
        ev.evidence && typeof ev.evidence === "object"
          ? { ...ev.evidence, system_event: true }
          : { system_event: true },
    });
  }
  return out;
}

export function collectConsultationOutcomes({
  question = "",
  pdfAttached = false,
  documentId = null,
  systemEvents = null,
  sourceLink = null,
} = {}) {
  const merged = [
    ...extractCustomerStatedOutcomesFromUtterance(question),
    ...collectSystemConfirmedOutcomes({ pdfAttached, documentId, systemEvents }),
  ];
  const seen = new Set();
  const out = [];
  for (const item of merged) {
    const key = `${item.kind}|${item.detail}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      ...item,
      ...(sourceLink && typeof sourceLink === "object" ? { source_link: sourceLink } : {}),
    });
  }
  return out;
}

/** Structured consultation memory kinds (A–F) for assistant metadata — not verified fact. */
export function buildKeyConsultationRecord({
  question = "",
  claudeAnswer = "",
  sessionGoal = null,
  recommendationBasisCount = 0,
  pdfAttached = false,
  documentId = null,
  outcomes = undefined,
  systemEvents = null,
  sourceLink = null,
  customerId = null,
  lifeThreads = undefined,
  now = null,
  presenceTurn = null,
} = {}) {
  const rawQ = String(question ?? "").trim();
  const isPresence =
    presenceTurn && typeof presenceTurn === "object"
      ? true
      : rawQ === KEY_PRESENCE_INTERNAL_QUESTION;
  // Presence internal marker must never be stored as a customer fact/utterance.
  const q = isPresence ? "" : rawQ.slice(0, 800);
  const a = String(claudeAnswer ?? "").trim().slice(0, 1200);
  const goal =
    sessionGoal && typeof sessionGoal === "object" && String(sessionGoal.goal ?? "").trim()
      ? {
          goal: String(sessionGoal.goal).trim().slice(0, 240),
          status: String(sessionGoal.status ?? "active"),
          ...(sessionGoal.source_link && typeof sessionGoal.source_link === "object"
            ? { source_link: sessionGoal.source_link }
            : sourceLink && typeof sourceLink === "object"
              ? { source_link: sourceLink }
              : {}),
          ...(sessionGoal.evidence && typeof sessionGoal.evidence === "object"
            ? { evidence: sessionGoal.evidence }
            : {}),
        }
      : null;
  const next_tasks = [];
  if (goal?.goal) next_tasks.push({ kind: "session_goal", detail: goal.goal });
  if (pdfAttached && documentId) {
    next_tasks.push({ kind: "document_followup", detail: `document:${String(documentId).slice(0, 80)}` });
  }
  const resolvedOutcomes = Array.isArray(outcomes)
    ? outcomes
    : collectConsultationOutcomes({
        question: q,
        pdfAttached,
        documentId,
        systemEvents,
        sourceLink,
      });
  // T5 — customer-utterance LIFE THREAD only (never Claude answer text).
  // Presence turn: never extract LIFE THREAD from Claude's opening line.
  const resolvedLifeThreads = Array.isArray(lifeThreads)
    ? lifeThreads
    : isPresence
      ? []
      : extractLifeThreadsFromCustomerUtterance(q, {
          customerId,
          sourceLink,
          now: now ?? new Date(),
        });
  return {
    schema: "key_consultation_record_v1",
    customer_utterance: q || null,
    verified_fact_refs: documentId
      ? [{ kind: "document", id: String(documentId) }]
      : [],
    claude_judgment: {
      answer_preview: a || null,
      recommendation_basis_count: Number(recommendationBasisCount) || 0,
      not_verified_customer_fact: true,
    },
    unverified_items: [],
    next_tasks,
    outcomes: resolvedOutcomes,
    life_threads: resolvedLifeThreads,
    session_goal: goal,
    ...(sourceLink && typeof sourceLink === "object" ? { source_link: sourceLink } : {}),
    ...(isPresence && presenceTurn && typeof presenceTurn === "object"
      ? { presence_turn: presenceTurn }
      : isPresence
        ? { presence_turn: { move: KEY_PRESENCE_MOVE, presence_turn: true } }
        : {}),
  };
}

/** What may be written to assistant metadata this turn (never invents on failure). */
export function resolvePersistableSessionGoal({
  discardRequested = false,
  usedFailure = false,
  claudeGoal = null,
  now = new Date(),
} = {}) {
  const stamp = now instanceof Date ? now : new Date(now);
  const updated_at = Number.isFinite(stamp.getTime())
    ? stamp.toISOString()
    : new Date().toISOString();
  if (discardRequested === true) {
    return { goal: null, status: "completed", updated_at };
  }
  if (usedFailure === true) return null;
  if (claudeGoal && typeof claudeGoal === "object") return claudeGoal;
  return null;
}

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

/** Drop deleted/retired rows so Claude never treats them as current verified facts. */
function isClaudeFirstInactivePolicyRow(policy = null) {
  if (!policy || typeof policy !== "object") return true;
  const summary =
    policy.coverage_summary && typeof policy.coverage_summary === "object"
      ? policy.coverage_summary
      : {};
  if (String(summary.retired_reason ?? policy.retired_reason ?? "").trim()) return true;
  if (policy.deleted_at != null && policy.deleted_at !== "") return true;
  const status = String(policy.policy_status ?? summary.policy_status ?? "")
    .trim()
    .toLowerCase();
  if (status.includes("retired")) return true;
  return false;
}

export function extractPoliciesFromContext({
  loadedContext = null,
  customerContextBundle = null,
  unifiedState = null,
} = {}) {
  const fromLoaded = Array.isArray(loadedContext?.policies) ? loadedContext.policies : null;
  const fromBundle = Array.isArray(customerContextBundle?.policies)
    ? customerContextBundle.policies
    : null;
  const fromUnified = Array.isArray(unifiedState?.policies) ? unifiedState.policies : null;
  const hasPolicyArray = fromLoaded != null || fromBundle != null || fromUnified != null;
  const declared =
    Number(
      loadedContext?.policy_count ??
        customerContextBundle?.policy_count ??
        customerContextBundle?.active_policy_count ??
        unifiedState?.policy_count ??
        unifiedState?.active_policy_count ??
        0,
    ) || 0;
  if (!hasPolicyArray) {
    return { policies: [], policy_count: declared };
  }
  const raw = fromLoaded ?? fromBundle ?? fromUnified ?? [];
  const policies = raw.filter((p) => !isClaudeFirstInactivePolicyRow(p));
  return { policies, policy_count: policies.length };
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

/** Anthropic Sonnet 4.6 / Sonnet 5 family — docs minimum for prompt cache. */
export const ANTHROPIC_PROMPT_CACHE_MIN_TOKENS_SONNET = 1024;

/** Default 5-minute ephemeral cache breakpoint (Anthropic default TTL). */
export const ANTHROPIC_PROMPT_CACHE_CONTROL_5M = Object.freeze({
  type: "ephemeral",
});

/**
 * Phase 1 — split userPayload into stable evidence (B) vs turn-variable (C).
 * Field values unchanged; packaging only. No deletion/summary/rewrite.
 */
export function splitUserPayloadForPromptCache(userPayload = null) {
  const payload =
    userPayload && typeof userPayload === "object" ? userPayload : {};
  const evidence =
    payload.available_verified_evidence &&
    typeof payload.available_verified_evidence === "object"
      ? payload.available_verified_evidence
      : {
          personal: {
            subject_type: "individual",
            chart: null,
            key_confirmed_source_facts: [],
            active_claim_cases: [],
            provenance: null,
            evidence_state: "unknown",
          },
          corporate: [],
          documents: [],
          public_evidence: [],
        };
  const context =
    payload.current_context && typeof payload.current_context === "object"
      ? payload.current_context
      : {};
  return {
    block_b: { available_verified_evidence: evidence },
    block_c: {
      current_question: String(payload.current_question ?? ""),
      current_context: context,
    },
  };
}

/**
 * Build Anthropic system + user content with explicit cache breakpoints.
 * A = system text (unchanged). B = evidence JSON. C = question/context (+ optional PDF).
 * Cache marker only on B end so prefix = A+B (A alone is typically under min tokens).
 */
export function buildClaudeFirstCachedRequestParts({
  systemText = "",
  userPayload = null,
  pdfBase64 = null,
  mediaType = null,
  cacheControl = ANTHROPIC_PROMPT_CACHE_CONTROL_5M,
} = {}) {
  const { block_b, block_c } = splitUserPayloadForPromptCache(userPayload);
  const system = [
    {
      type: "text",
      text: String(systemText ?? ""),
    },
  ];
  const content = [
    {
      type: "text",
      text: JSON.stringify(block_b, null, 2),
      cache_control: cacheControl && typeof cacheControl === "object"
        ? { ...cacheControl }
        : { ...ANTHROPIC_PROMPT_CACHE_CONTROL_5M },
    },
  ];
  const attachBlock = pdfBase64
    ? buildAnthropicDirectAttachBlock({ base64: pdfBase64, mediaType })
    : null;
  if (attachBlock) content.push(attachBlock);
  content.push({
    type: "text",
    text: JSON.stringify(block_c, null, 2),
  });
  return {
    system,
    messages: [{ role: "user", content }],
    cache_breakpoints: 1,
    cache_strategy: "A_plus_B_via_B_marker",
  };
}

export function pickAnthropicUsageNumbers(usage = null) {
  if (!usage || typeof usage !== "object") {
    return {
      input_tokens: null,
      output_tokens: null,
      cache_creation_input_tokens: null,
      cache_read_input_tokens: null,
      cache_creation_ephemeral_5m_input_tokens: null,
    };
  }
  const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  const ephemeral5m =
    usage.cache_creation && typeof usage.cache_creation === "object"
      ? num(usage.cache_creation.ephemeral_5m_input_tokens)
      : null;
  return {
    input_tokens: num(usage.input_tokens),
    output_tokens: num(usage.output_tokens),
    cache_creation_input_tokens: num(usage.cache_creation_input_tokens),
    cache_read_input_tokens: num(usage.cache_read_input_tokens),
    cache_creation_ephemeral_5m_input_tokens: ephemeral5m,
  };
}

function systemPromptCharCount(system) {
  if (typeof system === "string") return system.length;
  if (Array.isArray(system)) {
    return system.reduce((n, b) => n + String(b?.text ?? "").length, 0);
  }
  return 0;
}

export function buildSystemPrompt({ presenceTurn = false } = {}) {
  const lines = [
    // OUR CLAUDE — 보험 설계사 KEY 제품 정체성 (사후 검열용 gate 아님)
    "너는 고객이 만나는 유일한 보험 설계사 KEY다.",
    "보험 전문성을 바탕으로 고객의 삶·건강·가족·재산을 오래 지키고, 필요한 보험을 근거와 함께 고객에게 딱 맞게 안내한다.",
    "고객의 현재 질문과 감정, 전체 대화의 흐름을 먼저 이해한다. 질문에 직접 답하고, 설계사답게 친절하고 쉽게 설명하며, 필요한 내용을 충분히 마무리한다. 한두 문장으로 대화를 끊지 않는다.",
    "일상 대화·안부·맛집·생활 정보에도 질문 자체에 충실히 답한다. 순수한 일상 질문 한가운데 보험을 기계적으로 끼워 넣지 않는다. 인사나 맛집 질문에 갑자기 보험료 절감 이야기를 삽입하지 않는다.",
    "그러나 고객의 말에서 삶·건강·가족·재산·돈·보장·계약·서류·사고·질병·걱정과 같이 보험으로 연결할 수 있는 신호가 보이면, 보험 설계사답게 자연스럽게 상담으로 이끈다.",
    "보험 유도는 고객의 걱정과 현재 상황을 먼저 이해한 뒤, 지금 보장에서 함께 확인하면 좋은 점·필요한 서류·다음 점검을 제안하는 방식으로 한다. 실제 필요성이 확인되면 가입·유지·정리·보완을 근거와 함께 자신 있게 제안한다.",
    "보험 유도는 강요가 아니다. 근거 없는 상품 추천, 고객이 거절했는데 밀어붙이는 행동, '지금 가입하세요/해지해도 됩니다/무조건 이 상품' 같은 확정 지시, 모든 대화를 보험으로 끝내려는 기계적 행동은 하지 않는다.",
    "고객이 지금은 일상 이야기만 하고 싶어 하거나 보험 상담을 원하지 않으면 그 선택을 존중한다. 나중에 필요할 때 보험과 보장을 함께 볼 수 있다는 관계는 자연스럽게 남긴다.",
    "제공된 질문, 대화, 검증 사실, 원본 첨부, 이전 상담 참고를 충분히 보고 스스로 이해하고, 필요한 경우 조사·검색·비교·계산·판단하여 답한다.",
    "네가 완성한 답변이 고객이 듣는 최종 KEY 답변이다. 별도 추천 엔진·고정 답변 골격·필수 질문지·답변 재작성 없이, 한 번에 이해·비교·판단·답변한다. 답변의 길이·구조·표현·표·후속 질문은 고객에게 가장 도움이 되는 방식으로 네가 자유롭게 결정한다.",
    "검증된 고객 계약 사실과 법령·공공 기준을 구분하고, 고객 계약·담보·보험료 사실은 available_verified_evidence의 현재 검증 자료에만 근거한다.",
    "과거 대화·이전 KEY 답변·삭제·retired 자료에 나온 계약·담보·보험료를 현재 사실처럼 말하지 않는다. 검증되지 않은 값을 '실손·운전자만 보유', '암·뇌·심장 없음', 특정 월 보험료 합계처럼 단정하지 않는다.",
    "계약상 수익자와 법정상속인을 같은 개념으로 취급하지 않는다. 가족관계·자금 부담자를 이름만으로 추정하지 않는다.",
    "보험 추천·맞춤 추천 질문에서는 정보 부족 감사·상황 요약 표·공백 표·나이·성별·가족·소득 필수 질문지로 답변을 축소하거나 멈추지 않는다. 현재 자료로 할 수 있는 판단과 추천을 첫 문장부터 바로 말한다.",
    "확인된 계약·담보는 정확히 설명하고, 부족·보완이 검증된 축은 구체적으로 추천한다. 확인되지 않은 부분은 '없음/미가입/공백'이 아니라 '확인되지 않음'으로 말한다.",
    "자료가 부족할 때에는 대화를 짧게 포기하지 않고, 지금 판단 가능한 범위와 다음에 필요한 자료·확인 방법을 안내한다. 추가 질문은 정말 필요한 것 하나만 자연스럽게 묻는다.",
    "고정된 표·제목·문단 순서·'현재 확인된 상황 요약'·'지금 자료로 보이는 공백'·'추천을 제대로 드리려면' 같은 감사 템플릿을 강요하지 않는다.",
    "자동조회·본인인증 기능이 실제 작동하는 것처럼 말하지 않는다. 내보험다보여·보험다보여 안내를 자동으로 붙이지 않는다. 추가 자료가 정말 필요할 때만 보험증권 또는 보장내역서 업로드를 한 번 자연스럽게 요청할 수 있다. 추천 답변을 내보험다보여 안내로 끝내지 않는다.",
    "입력이 충분하면 지분·금액·구조의 의미를 직접 계산·판단한다. 무조건 전문가에게만 넘기며 판단을 회피하지 않는다.",
    "같은 고객과 같은 대화를 이어서 본다. 앞에서 확인한 사실·걱정·목표·약속을 잊고 매번 처음 만난 사람처럼 대하지 않는다.",
    "고객에게 내부 필드명·시스템 경로를 말하지 않는다.",
    "의료사건·수술·입원·병원비·진단이 보이면 고객카드 계약과 비교해 청구 필요성을 직접 판단한다. 근거가 충분하면 선제적으로 청구 확인을 제안한다. 청구했습니다/접수 완료/심사 중/지급됐습니다는 확인 근거 없이 고객에게 말하지 않는다.",
    "입력 current_context.session_goal이 있어도 참고용이다. 현재 고객 질문·최근 원문 대화·검증된 고객 사실이 항상 우선이며, 목표가 답변 방향을 강제하지 않는다.",
    "입력 current_context.prior_consultation이 있으면 같은 고객의 이전 상담·목표·미완료 과제 참고다. 현재 질문이 항상 우선이며, 처음부터 다시 묻지 말고 자연스럽게 이어간다. Claude 상담 의견을 검증된 계약 사실처럼 말하지 않는다.",
    "입력 current_context.insurance_clock이 있으면 KEY가 소유한 보험 기한 참고다. upcoming·overdue·unknown_date·completed_recent만 사용한다. 날짜를 새로 발명하지 말고, unknown_date는 정확한 날짜를 확인한다. completed·cancelled는 현재 할 일처럼 말하지 않는다. 법정 시효·‘보통 3년’ 같은 일반론을 고객 고유 due_at처럼 말하지 않는다.",
    "입력 current_context.claim_evidence가 있으면 KEY가 소유한 청구 증거 패키지 참고다. held/submitted/insurer/outcome과 verification_status(original·customer_reported·insurer_verified·unverified)만 사용한다. 문서에 없는 사실·거절 사유를 만들지 말고, 고객 진술을 보험사 확인처럼 말하지 않는다. 원본·추출·해석을 섞지 않는다.",
    "입력 current_context.life_ledger가 있으면 KEY가 소유한 고객 장기 맥락 참고다. goals·decisions·open_questions·outcomes만 사용한다. 참고용이며 답변 템플릿·강제 추천·답변 차단에 쓰지 않는다. 저장되지 않은 목표·선호를 만들지 말고, 고객이 말하지 않은 의사를 단정하지 않는다.",
  ];
  if (presenceTurn === true) {
    lines.push(buildPresenceSystemAddendum());
  } else {
    lines.push(
      "입력 current_context.life_threads가 있으면 고객이 이전에 직접 말한 삶의 사건·예정·감정 참고다. 현재 질문이 항상 우선이다. 확인되지 않은 결과·감정을 만들지 말고, 고객에게 먼저 꺼내 묻지 않는다(Presence 금지).",
    );
  }
  return lines.join("\n");
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

/** Seat/audit only — never dumps full corporate payloads or secrets. */
function maskIdTail(id) {
  const s = String(id ?? "").trim();
  return s.length > 8 ? `${s.slice(0, 8)}…${s.slice(-4)}` : s || null;
}

/** Verified corporate insurer/product tokens only — never personal chart allowlist. */
export function collectCorporateInsurerProductAllowlist(corporateContexts = null) {
  const out = new Set();
  const rows = normalizeCorporateContexts(corporateContexts);
  for (const row of rows) {
    const facts = [
      ...(Array.isArray(row?.verified_facts) ? row.verified_facts : []),
      ...(Array.isArray(row?.partial_facts) ? row.partial_facts : []),
    ];
    for (const fact of facts) {
      const key = String(fact?.key ?? fact?.fact_key ?? "").toLowerCase();
      const val = String(fact?.value ?? fact?.fact_value ?? "").trim();
      if (!val) continue;
      if (/insurer|보험사|carrier|product|상품/.test(key)) out.add(val);
    }
    const fields =
      row?.chart?.fields && typeof row.chart.fields === "object" ? row.chart.fields : {};
    for (const [name, field] of Object.entries(fields)) {
      if (field?.status !== "known" || field?.value == null || field.value === "") continue;
      if (/insurer|보험사|product|상품/.test(String(name))) {
        out.add(String(field.value).trim());
      }
    }
  }
  return [...out].filter(Boolean);
}

export function buildCorporateHandSeatAudit({
  corporateContexts = null,
  selectedEntityId = null,
  authorizationDenied = false,
} = {}) {
  const contexts = normalizeCorporateContexts(corporateContexts);
  const docs = contexts.flatMap((c) =>
    Array.isArray(c?.documents)
      ? c.documents
      : Array.isArray(c?.chart?.documents)
        ? c.chart.documents
        : [],
  );
  const chartKnown = [];
  for (const c of contexts) {
    const fields = c?.chart?.fields && typeof c.chart.fields === "object" ? c.chart.fields : {};
    for (const [k, v] of Object.entries(fields)) {
      if (v?.status === "known" && v?.value != null && v.value !== "") chartKnown.push(k);
    }
  }
  return {
    hand: "loadAllowedCorporateContextsForClaude",
    ready_corporate: contexts.length > 0,
    contexts_count: contexts.length,
    documents_count: docs.length,
    document_ownership_source: "customer_documents.entity_id",
    selected_entity_id_masked: maskIdTail(selectedEntityId),
    authorization_denied: authorizationDenied === true,
    chart_known_fields: [...new Set(chartKnown)].slice(0, 24),
    display_names: contexts
      .map((c) => String(c?.display_name ?? "").trim())
      .filter(Boolean)
      .slice(0, 6),
    available_verified_evidence_corporate: contexts.length > 0,
  };
}

/** Slice 3 — corporate claim Hand audit (stored cases may remain; access gated). */
export function buildCorporateClaimHandSeatAudit({
  claimCases = null,
  selectedEntityId = null,
  corporateClaimAllowed = false,
  authorizationDenied = false,
  omitForPersonalTurn = false,
} = {}) {
  if (omitForPersonalTurn === true) {
    return {
      hand: "key_claim_intake_sidecar_corporate",
      ready_corporate_claim: false,
      contexts_count: 0,
      claim_scope: null,
      entity_id_masked: null,
      status: null,
      next_action: null,
      source: null,
      insurer_verified: false,
      authorization_denied: false,
      claim_support_required: true,
      omitted_reason: "personal_claim_turn",
    };
  }
  const eid = String(selectedEntityId ?? "").trim() || null;
  const denied = authorizationDenied === true || (eid && corporateClaimAllowed !== true);
  const visible =
    denied || !eid
      ? []
      : filterKeyActiveClaimCasesByScope(claimCases, {
          claim_scope: "corporate",
          entity_id: eid,
        });
  const row = visible[0] ?? null;
  return {
    hand: "key_claim_intake_sidecar_corporate",
    ready_corporate_claim: visible.length > 0,
    contexts_count: visible.length,
    claim_scope: row?.claim_scope ?? (visible.length ? "corporate" : null),
    entity_id_masked: maskIdTail(row?.entity_id ?? eid),
    status: row?.status ?? null,
    next_action: row?.next_action ?? null,
    source: row?.source ?? null,
    insurer_verified: row?.insurer_verified === true,
    authorization_denied: denied === true,
    claim_support_required: true,
  };
}

/**
 * Claim entity resolution — never inherit chart's single-entity auto-select on personal turns.
 * Allow: explicit client entity · clear corporate question with exactly one loaded context.
 */
export function resolveClaimSelectedEntityId({
  selectedEntityIdHint = null,
  question = "",
  corporateContexts = [],
} = {}) {
  const explicit = String(selectedEntityIdHint ?? "").trim() || null;
  if (explicit) return explicit;
  if (!isExplicitCorporateClaimUtterance(question)) return null;
  const contexts = Array.isArray(corporateContexts) ? corporateContexts : [];
  if (contexts.length !== 1) return null;
  return String(contexts[0]?.entity_id ?? "").trim() || null;
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
  const listing = Array.isArray(pdfMeta.document_box_listing)
    ? pdfMeta.document_box_listing
        .filter((row) => row && (row.document_id || row.original_filename))
        .map((row) => ({
          document_id: row.document_id ?? null,
          original_filename: row.original_filename ?? null,
          evidence_state: "listed_in_customer_document_box",
          attached: false,
        }))
    : [];
  const reviewScope =
    typeof pdfMeta.document_review_scope === "string" && pdfMeta.document_review_scope.trim()
      ? pdfMeta.document_review_scope.trim().slice(0, 240)
      : null;
  const evidenceStatus =
    typeof pdfMeta.document_evidence_status === "string" &&
    pdfMeta.document_evidence_status.trim()
      ? pdfMeta.document_evidence_status.trim().slice(0, 64)
      : null;
  const attachMode =
    typeof pdfMeta.pdf_attach_mode === "string" && pdfMeta.pdf_attach_mode.trim()
      ? pdfMeta.pdf_attach_mode.trim().slice(0, 40)
      : null;
  const reviewFields = {
    ...(reviewScope ? { document_review_scope: reviewScope } : {}),
    ...(evidenceStatus ? { evidence_status: evidenceStatus } : {}),
    ...(attachMode ? { pdf_attach_mode: attachMode } : {}),
    verified_insurance_fact: false,
  };
  if (!attached && !pdfMeta.document_id && listing.length === 0 && !reviewScope) return [];
  // Image original reads: minimal identity only — no orientation / OCR / chart notes.
  if (attached && isImage) {
    return [
      {
        document_id: pdfMeta.document_id ?? null,
        original_filename: pdfMeta.original_filename ?? null,
        mime_type: mime,
        attached: true,
        evidence_state: "attached",
        // C: document parties are not the logged-in customer profile.
        document_subject_vs_customer:
          "Document insured/policyholder facts belong to the contract document, not automatic customer profile fields.",
        ...reviewFields,
      },
      ...listing.filter((row) => String(row.document_id) !== String(pdfMeta.document_id ?? "")),
    ];
  }
  if (attached || pdfMeta.document_id || reviewScope) {
    return [
      {
        document_id: pdfMeta.document_id ?? null,
        original_filename: pdfMeta.original_filename ?? null,
        mime_type: mime,
        attached,
        note: attached
          ? "Original PDF is attached as a document block."
          : pdfMeta.note ??
            (pdfMeta.reuse_without_bytes === true
              ? "Prior document context reused; full original not rebroadcast this turn."
              : "No document attached for this turn."),
        evidence_state: attached
          ? "attached"
          : pdfMeta.reuse_without_bytes === true
            ? "reused_without_full_original"
            : "missing",
        document_subject_vs_customer:
          "Document insured/policyholder facts belong to the contract document, not automatic customer profile fields.",
        ...reviewFields,
      },
      ...listing.filter((row) => String(row.document_id) !== String(pdfMeta.document_id ?? "")),
    ];
  }
  return listing;
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
    const chartUnknowns = Array.isArray(corporate?.chart?.unknown_items)
      ? corporate.chart.unknown_items
      : [];
    const mergedUnknowns = [
      ...new Set([
        ...(Array.isArray(corporate.unknowns) ? corporate.unknowns : []),
        ...entityUnknowns,
        ...chartUnknowns,
      ]),
    ];
    const docs = Array.isArray(corporate.documents)
      ? corporate.documents
      : Array.isArray(corporate?.chart?.documents)
        ? corporate.chart.documents
        : [];
    return {
      subject_type: "corporate",
      entity_id: entityId,
      entity_name: corporate.display_name ?? null,
      membership_role: corporate.membership_role ?? null,
      entity_status: corporate.entity_status ?? null,
      is_qa_test_entity: corporate.is_qa_test_entity === true,
      customer_grade: corporate.customer_grade ?? null,
      chart: corporate.chart ?? null,
      documents: docs,
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
  selectedCorporateEntityId = null,
  publicEvidence = null,
  activeClaimCases = null,
  insuranceClockBrief = null,
  claimEvidenceBrief = null,
  lifeLedgerBrief = null,
  sessionGoal = null,
  priorConsultation = null,
  now = null,
  readyCardMeta = null,
  presenceContext = null,
} = {}) {
  const clock = buildRequestClock(now ?? new Date(), REQUEST_TIMEZONE);
  const documents = buildDocumentsEvidence(pdfMeta);
  const public_evidence = Array.isArray(publicEvidence) ? publicEvidence : [];
  const ready_card =
    readyCardMeta && typeof readyCardMeta === "object" ? readyCardMeta : null;
  const softSessionGoal =
    sessionGoal &&
    typeof sessionGoal === "object" &&
    String(sessionGoal.status ?? "").trim() === "active" &&
    String(sessionGoal.goal ?? "").trim()
      ? {
          goal: String(sessionGoal.goal).trim(),
          status: "active",
          updated_at: sessionGoal.updated_at ?? null,
          subject_scope: "personal_or_unscoped",
        }
      : null;
  const softLifeThreads = formatLifeThreadsForReadyCard(
    Array.isArray(priorConsultation?.life_threads)
      ? priorConsultation.life_threads
      : [],
    { limit: 6 },
  );
  const softPrior =
    priorConsultation && typeof priorConsultation === "object"
      ? {
          related_turns: Array.isArray(priorConsultation.related_turns)
            ? priorConsultation.related_turns.slice(0, 12)
            : [],
          open_goals: Array.isArray(priorConsultation.open_goals)
            ? priorConsultation.open_goals.slice(0, 3)
            : [],
          open_tasks: Array.isArray(priorConsultation.open_tasks)
            ? priorConsultation.open_tasks.slice(0, 6)
            : [],
          life_threads: softLifeThreads,
          subject_scope: "personal_only",
          note: "prior_consultation_reference_only_not_verified_fact_not_corporate",
        }
      : null;
  const softClock = softInsuranceClockContext(insuranceClockBrief);
  const softClaimEvidence = softClaimEvidenceContext(claimEvidenceBrief);
  const softLifeLedger = softLifeLedgerContext(lifeLedgerBrief);

  // Image original read: question + conversation + original image only.
  // No factory chart / OCR / contracts / corporate / claim cards mixed in.
  if (isImageAttachMeta(pdfMeta)) {
    return {
      current_question: String(question ?? ""),
      current_context: {
        current_datetime: clock.current_datetime,
        current_date: clock.current_date,
        timezone: clock.timezone,
        conversation: {
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
        ...(softSessionGoal ? { session_goal: softSessionGoal } : {}),
        ...(softPrior ? { prior_consultation: softPrior } : {}),
        ...(softLifeThreads.length ? { life_threads: softLifeThreads } : {}),
        ...(presenceContext && typeof presenceContext === "object"
          ? { presence_context: presenceContext }
          : {}),
        ...(ready_card ? { ready_card } : {}),
      },
      available_verified_evidence: {
        personal: {
          subject_type: "individual",
          chart: null,
          key_confirmed_source_facts: [],
          active_claim_cases: [],
          provenance: null,
          evidence_state: "unknown",
        },
        corporate: [],
        documents,
        public_evidence: [],
      },
    };
  }

  const corporate = buildCorporateEvidenceEntries({
    corporateContexts,
    corporateGapEvidence,
    corporateRecommendationCandidates,
    corporateUnknowns,
  });
  const selectedEntity =
    String(selectedCorporateEntityId ?? "").trim() ||
    (corporate.length === 1 ? String(corporate[0]?.entity_id ?? "").trim() : "") ||
    null;
  const selectedCorporate = selectedEntity
    ? corporate.find((c) => String(c?.entity_id ?? "").trim() === selectedEntity) ?? null
    : null;
  const corporateTurnContext = {
    selected_entity_id: selectedCorporate?.entity_id ?? null,
    authorization_verified: Boolean(selectedCorporate?.entity_id),
    is_qa_test_entity: selectedCorporate?.is_qa_test_entity === true,
    // No corporate-scoped prior/goal store in this slice — do not pretend personal prior is corporate.
    corporate_prior_consultation: {
      status: "unknown",
      note: "no_corporate_scoped_prior_do_not_treat_personal_prior_as_corporate",
    },
    corporate_session_goal: {
      status: "unknown",
      note: "no_corporate_scoped_session_goal",
    },
  };
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

  // Personal document listing only — corporate docs live under available_verified_evidence.corporate[].documents.
  const personalDocuments = (Array.isArray(documents) ? documents : []).filter(
    (d) => !d?.entity_id,
  );

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
      corporate_turn: corporateTurnContext,
      // Soft reference only — never above current_question / conversation / verified evidence.
      ...(softSessionGoal ? { session_goal: softSessionGoal } : {}),
      ...(softPrior ? { prior_consultation: softPrior } : {}),
      ...(softLifeThreads.length ? { life_threads: softLifeThreads } : {}),
      ...(presenceContext && typeof presenceContext === "object"
        ? { presence_context: presenceContext }
        : {}),
      ...(softClock ? softClock : {}),
      ...(softClaimEvidence ? softClaimEvidence : {}),
      ...(softLifeLedger ? softLifeLedger : {}),
      ...(ready_card ? { ready_card } : {}),
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
      documents: personalDocuments,
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

/**
 * Anthropic-valid ack blocks for every client tool_use in an assistant turn.
 * Continue is still gated by card tools; GO3/GO4 tools only need matching tool_result ids.
 */
export function buildClaudeFirstToolResultAckBlocks(assistantContent = []) {
  return (Array.isArray(assistantContent) ? assistantContent : [])
    .filter((b) => b?.type === "tool_use" && b?.id != null && String(b.id).trim())
    .map((b) => ({
      type: "tool_result",
      tool_use_id: b.id,
      content: JSON.stringify({ ok: true }),
    }));
}

/** PII-safe fingerprint of question text — length / sha256 / newlines only (never raw text). */
export function fingerprintRawQuestion(question = "") {
  const q = String(question ?? "");
  return {
    question_chars: q.length,
    question_sha256: createHash("sha256").update(q, "utf8").digest("hex"),
    question_newline_count: (q.match(/\n/g) || []).length,
  };
}

/**
 * Count how many times the question appears as a JSON string value in Claude user payload.
 * Uses JSON-escaped form so newlines match stringify packaging (not raw newline search).
 */
export function countCurrentQuestionOccurrences(userPayloadText = "", question = "") {
  const q = String(question ?? "");
  const src = String(userPayloadText ?? "");
  if (!q || !src) return 0;
  const needle = JSON.stringify(q); // includes surrounding quotes + escapes
  let count = 0;
  let idx = 0;
  while (idx < src.length) {
    const at = src.indexOf(needle, idx);
    if (at < 0) break;
    count += 1;
    idx = at + Math.max(1, needle.length);
  }
  return count;
}

/** PII-safe empty-answer input counts only — never store prompt/body text. */
function buildEmptyAnswerInputDiag({
  question = null,
  contextPack = null,
  chart = null,
  softGoal = null,
  priorConsultation = null,
  pdfBase64 = null,
  system = "",
  body = null,
  userPayload = null,
} = {}) {
  const recent = Array.isArray(contextPack?.recent_conversation_originals)
    ? contextPack.recent_conversation_originals
    : Array.isArray(contextPack?.recent_turns)
      ? contextPack.recent_turns
      : [];
  const retained = Array.isArray(contextPack?.retained_past_originals)
    ? contextPack.retained_past_originals
    : [];
  const facts = Array.isArray(chart?.key_confirmed_source_facts)
    ? chart.key_confirmed_source_facts
    : [];
  const contracts = Array.isArray(chart?.contracts) ? chart.contracts : [];
  const relatedTurns = Array.isArray(priorConsultation?.related_turns)
    ? priorConsultation.related_turns
    : [];
  let request_body_chars = 0;
  let user_payload_text = "";
  try {
    request_body_chars = body != null ? JSON.stringify(body).length : 0;
  } catch {
    request_body_chars = 0;
  }
  try {
    user_payload_text =
      userPayload != null ? JSON.stringify(userPayload) : "";
  } catch {
    user_payload_text = "";
  }
  const tools_sent = Array.isArray(body?.tools) ? body.tools.length : 0;
  const qFp = fingerprintRawQuestion(question);
  const current_question_occurrences = countCurrentQuestionOccurrences(
    user_payload_text,
    question,
  );
  const ready_card_present =
    userPayload?.current_context?.ready_card != null &&
    typeof userPayload.current_context.ready_card === "object";
  return {
    question_present: String(question ?? "").trim().length > 0,
    ...qFp,
    current_question_occurrences,
    ready_card_separated: ready_card_present,
    conversation_message_count: recent.length + retained.length,
    verified_fact_count: facts.length,
    verified_policy_count: contracts.length,
    prior_consultation_count: relatedTurns.length,
    active_goal_present: Boolean(
      softGoal &&
        typeof softGoal === "object" &&
        String(softGoal.goal ?? "").trim(),
    ),
    original_attachment_count: pdfBase64 ? 1 : 0,
    system_prompt_chars: systemPromptCharCount(system),
    request_body_chars,
    tools_sent,
  };
}

/** PII-safe Anthropic response shape — lengths/counts only, never answer text. */
function buildEmptyAnswerResponseDiag({
  http_status = null,
  sse_event_counts = null,
  cumulative_text_delta_chars = 0,
  stop_reason = null,
  dataRaw = null,
  picked = null,
} = {}) {
  const content = Array.isArray(dataRaw?.content) ? dataRaw.content : [];
  const content_block_type_counts = {
    text: 0,
    tool_use: 0,
    server_tool_use: 0,
    thinking: 0,
    other: 0,
  };
  const text_block_lengths = [];
  for (const block of content) {
    const type = String(block?.type ?? "");
    if (type === "text") {
      content_block_type_counts.text += 1;
      text_block_lengths.push(String(block?.text ?? "").length);
    } else if (type === "tool_use") {
      content_block_type_counts.tool_use += 1;
    } else if (type === "server_tool_use") {
      content_block_type_counts.server_tool_use += 1;
    } else if (type === "thinking") {
      content_block_type_counts.thinking += 1;
    } else {
      content_block_type_counts.other += 1;
    }
  }
  const pick_before_text_chars = text_block_lengths.reduce((a, n) => a + n, 0);
  const pick_after_text_chars = String(picked?.customer_answer ?? "").length;
  const resolvedStop =
    stop_reason != null
      ? String(stop_reason)
      : dataRaw?.stop_reason != null
        ? String(dataRaw.stop_reason)
        : null;
  return {
    http_status: Number.isFinite(Number(http_status)) ? Number(http_status) : null,
    sse_event_counts: sse_event_counts ?? {
      message_start: 0,
      content_block_start: 0,
      content_block_delta: 0,
      content_block_stop: 0,
      message_delta: 0,
      message_stop: 0,
      other: 0,
    },
    content_block_type_counts,
    text_block_lengths,
    has_thinking_block: content_block_type_counts.thinking > 0,
    has_tool_block:
      content_block_type_counts.tool_use > 0 ||
      content_block_type_counts.server_tool_use > 0,
    stop_reason: resolvedStop,
    cumulative_text_delta_chars: Number(cumulative_text_delta_chars) || 0,
    pick_before_text_chars,
    pick_after_text_chars,
  };
}

function emptySseEventCounts() {
  return {
    message_start: 0,
    content_block_start: 0,
    content_block_delta: 0,
    content_block_stop: 0,
    message_delta: 0,
    message_stop: 0,
    other: 0,
  };
}

function bumpSseEventCount(counts, type) {
  const key = String(type ?? "");
  if (Object.prototype.hasOwnProperty.call(counts, key)) counts[key] += 1;
  else counts.other += 1;
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
      sse_event_counts: emptySseEventCounts(),
      cumulative_text_delta_chars: 0,
      stop_reason: dataRaw?.stop_reason != null ? String(dataRaw.stop_reason) : null,
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
  const sse_event_counts = emptySseEventCounts();
  let cumulative_text_delta_chars = 0;
  let stop_reason = null;

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
      bumpSseEventCount(sse_event_counts, type);
      if (type === "message_start" && evt.message) {
        message = evt.message;
        if (Array.isArray(message.content)) contentBlocks = [...message.content];
        if (message?.stop_reason != null) stop_reason = String(message.stop_reason);
        if (message?.usage && typeof message.usage === "object") {
          usage = { ...(usage ?? {}), ...message.usage };
        }
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
          const deltaText = String(delta.text ?? "");
          cumulative_text_delta_chars += deltaText.length;
          contentBlocks[idx].text = `${contentBlocks[idx].text ?? ""}${deltaText}`;
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
        if (evt.delta?.stop_reason != null) stop_reason = String(evt.delta.stop_reason);
      }
    }
  }

  const content = finalizeClaudeFirstStreamContentBlocks(contentBlocks);

  return {
    dataRaw: {
      ...(message && typeof message === "object" ? message : {}),
      content,
      usage: usage ?? message?.usage ?? null,
      ...(stop_reason != null ? { stop_reason } : {}),
    },
    ttft_ms,
    streamed_answer: streamedAnswer,
    answer_complete_before_end: answerComplete,
    sse_event_counts,
    cumulative_text_delta_chars,
    stop_reason,
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
 * Never trusts client-provided image bytes. Never decode/rotate/resize/re-encode.
 */
export function buildClaudeImageAttachFromStorageOriginal({
  storageBase64 = null,
  storageMediaType = null,
} = {}) {
  const stored = String(storageBase64 ?? "").trim();
  const storedMime = normalizeClaudeDirectAttachMediaType(storageMediaType);

  if (!stored || !storedMime) {
    return {
      ok: false,
      reason: "storage_image_missing",
      base64: null,
      mediaType: null,
      claude_image_source: null,
      rotated: false,
      attach_signals: buildAttachOpsSignals({
        attachment_requested: true,
        attachment_attached: false,
        attachment_failed: true,
        attachment_failure_code: "storage_image_missing",
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
      rotated: false,
      attach_signals: buildAttachOpsSignals({
        attachment_requested: true,
        attachment_attached: true,
        attachment_failed: false,
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
      rotated: false,
      attach_signals: buildAttachOpsSignals({
        attachment_requested: true,
        attachment_attached: false,
        attachment_failed: true,
        attachment_failure_code: "mime_not_image",
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
      rotated: false,
      attach_signals: buildAttachOpsSignals({
        attachment_requested: true,
        attachment_attached: false,
        attachment_failed: true,
        attachment_failure_code: "image_too_large",
        attachment_block_built: false,
      }),
    };
  }

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
      rotated: false,
      attach_signals: buildAttachOpsSignals({
        attachment_requested: true,
        attachment_attached: false,
        attachment_failed: true,
        attachment_failure_code: "block_build_failed",
        attachment_block_built: false,
      }),
    };
  }

  return {
    ok: true,
    base64: stored,
    mediaType: storedMime,
    claude_image_source: "storage_original",
    rotated: false,
    attach_signals: buildAttachOpsSignals({
      attachment_requested: true,
      attachment_attached: true,
      attachment_failed: false,
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
  allowLatestFallback = true,
} = {}) {
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
          attach_signals: buildAttachOpsSignals({
            attachment_requested: true,
            attachment_attached: false,
            attachment_failed: true,
            attachment_failure_code: failCode,
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
          attach_signals: buildAttachOpsSignals({
            attachment_requested: true,
            attachment_attached: true,
            attachment_failed: false,
            attachment_block_built: true,
          }),
        },
      };
    }

    const built = buildClaudeImageAttachFromStorageOriginal({
      storageBase64: fetched.pdfBase64,
      storageMediaType: fetched.mediaType,
    });
    if (!built.ok || !built.base64) {
      return {
        pdfBase64: null,
        mediaType: null,
        meta: {
          attached: false,
          document_id: documentId,
          note: built.reason ?? "image_attach_failed",
          attach_signals:
            built.attach_signals ??
            buildAttachOpsSignals({
              attachment_requested: true,
              attachment_attached: false,
              attachment_failed: true,
              attachment_failure_code: built.reason ?? "image_attach_failed",
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
        attach_signals:
          built.attach_signals ??
          buildAttachOpsSignals({
            attachment_requested: true,
            attachment_attached: true,
            attachment_failed: false,
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
        attach_signals: buildAttachOpsSignals({
          attachment_requested: true,
          attachment_attached: false,
          attachment_failed: true,
          attachment_failure_code: "attach_error",
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
  selectedCorporateEntityId = null,
  activeClaimCases = null,
  activeDocuments = null,
  /** Insurance Clock Hand brief — KEY-owned dates only. */
  insuranceClockBrief = null,
  claimEvidenceBrief = null,
  lifeLedgerBrief = null,
  /** Server-SSOT soft goal only — never from client body. */
  sessionGoalForContext = null,
  /** Soft prior consultation pack — never verified fact. */
  priorConsultationForContext = null,
  /** Prepared document excerpts (document_extracted_unverified). */
  documentEvidence = null,
  /** Triangle T2 READY CARD meta for Claude (status / as-of / miss note). */
  readyCardMeta = null,
  /** Triangle T6 Presence materials (listen_focus). */
  presenceContext = null,
  presenceTurn = false,
  /** Unified view mode — filters personal/corporate packs before Claude. */
  customerViewModeForPayload = null,
}) {
  const apiKey = String(env.ANTHROPIC_API_KEY ?? "").trim();
  if (!apiKey) {
    return {
      ok: false,
      error: "ANTHROPIC_NOT_CONFIGURED",
      empty_answer_diag: { input: null, response: null },
    };
  }
  const model = String(env.ANTHROPIC_MODEL ?? env.CLAUDE_MODEL ?? DEFAULT_MODEL).trim();
  const imageOriginalRead = isImageAttachMeta(pdfMeta) && Boolean(pdfBase64);
  const chart = imageOriginalRead ? null : buildVerifiedCustomerChart(reality);
  // Allowlist stays KEY-internal for hard-only — never shown in Claude payload.
  const allowlist = imageOriginalRead
    ? { allowed_numbers: [], allowed_entities: [] }
    : collectVerifiedSpeakAllowlistFromReality(reality);
  // Soft-deleted source turns must not re-enter Claude conversation pack.
  // Loader miss (null) → [] fail-closed. This-turn explicit document_id stays active.
  // Deleted-doc recheck (no current attach bytes) forces full attach scrub.
  const deletedDocRecheck =
    !pdfBase64 && isDeletedDocumentRecheckQuestion(question) === true;
  const currentTurnDocument =
    pdfMeta?.document_id || pdfMeta?.original_filename
      ? {
          document_id: pdfMeta?.document_id ?? null,
          original_filename: pdfMeta?.original_filename ?? null,
        }
      : null;
  const activeDocsForPack = mergeCurrentTurnDocumentIntoActiveDocuments(
    Array.isArray(activeDocuments) ? activeDocuments : [],
    deletedDocRecheck ? null : currentTurnDocument,
  );
  const { pack: contextPack } = buildClaudeFullContextPack({
    history,
    question,
    activeDocuments: activeDocsForPack,
    currentTurnDocument: deletedDocRecheck ? null : currentTurnDocument,
    forceScrubAttachSegments: deletedDocRecheck,
    scrubIdentityReadouts: deletedDocRecheck,
    documentEvidence: Array.isArray(documentEvidence) ? documentEvidence : [],
  });
  const requestNow = startedAt instanceof Date ? startedAt : new Date(startedAt);
  const softGoal =
    sessionGoalForContext && typeof sessionGoalForContext === "object"
      ? sessionGoalForContext
      : null;
  const userPayloadBuilt = buildUserPayload({
    question: presenceTurn === true ? buildPresenceUserQuestionLine() : question,
    chart: presenceTurn === true ? null : chart,
    contextPack,
    pdfMeta: presenceTurn === true ? null : pdfMeta,
    corporateContexts:
      presenceTurn === true || imageOriginalRead ? null : corporateContexts,
    corporateGapEvidence:
      presenceTurn === true || imageOriginalRead ? null : corporateGapEvidence,
    corporateRecommendationCandidates:
      presenceTurn === true || imageOriginalRead
        ? null
        : corporateRecommendationCandidates,
    corporateUnknowns:
      presenceTurn === true || imageOriginalRead ? null : corporateUnknowns,
    selectedCorporateEntityId:
      presenceTurn === true || imageOriginalRead ? null : selectedCorporateEntityId,
    publicEvidence: [],
    activeClaimCases:
      presenceTurn === true || imageOriginalRead ? null : activeClaimCases,
    insuranceClockBrief:
      presenceTurn === true || imageOriginalRead ? null : insuranceClockBrief,
    claimEvidenceBrief:
      presenceTurn === true || imageOriginalRead ? null : claimEvidenceBrief,
    lifeLedgerBrief:
      presenceTurn === true || imageOriginalRead ? null : lifeLedgerBrief,
    sessionGoal: presenceTurn === true ? null : softGoal,
    priorConsultation:
      priorConsultationForContext && typeof priorConsultationForContext === "object"
        ? priorConsultationForContext
        : null,
    now: requestNow,
    readyCardMeta: presenceTurn === true || imageOriginalRead ? null : readyCardMeta,
    presenceContext:
      presenceTurn === true && presenceContext && typeof presenceContext === "object"
        ? presenceContext
        : null,
  });
  const userPayload =
    presenceTurn === true || imageOriginalRead
      ? userPayloadBuilt
      : applyCustomerViewModeToUserPayload(userPayloadBuilt, customerViewModeForPayload);
  const pdfAttached = presenceTurn === true ? false : Boolean(pdfBase64);
  // Customer-answer Anthropic request: text-only — no tools / tool_choice / tool-hint prompts.
  // Fact save · consultation · visual blocks remain KEY work after this answer (no second call).
  const systemText = buildSystemPrompt({ presenceTurn: presenceTurn === true });
  // Phase 1 prompt cache: A (system) + B (evidence) cached via B breakpoint; C variable + PDF uncached.
  const cachedParts = buildClaudeFirstCachedRequestParts({
    systemText,
    userPayload,
    pdfBase64: presenceTurn === true ? null : pdfBase64,
    mediaType: presenceTurn === true ? null : pdfMediaType,
    cacheControl: ANTHROPIC_PROMPT_CACHE_CONTROL_5M,
  });
  const system = cachedParts.system;
  let messages = cachedParts.messages;

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
  let providerUsage = pickAnthropicUsageNumbers(null);
  // Mid-turn client tool extraction skipped on customer-answer path (tools not sent).
  const confirmedSourceFacts = [];
  const coverageBaselineFacts = [];
  const claimCaseUpdates = [];
  const sessionGoalRecord = null;
  const sessionGoalToolSeen = false;
  const sessionGoalRejected = false;
  const sessionGoalRejectReason = null;
  const recommendationBasisTrace = emptyRecommendationBasisTrace();
  let messagesRequestCount = 0;
  const searchWallStarted = Date.now();

  // SINGLE provider call only — no Continue / tool_result re-call / force tool_choice.
  let emptyAnswerDiag = {
    input: null,
    response: null,
  };
  for (let turn = 0; turn < 1; turn += 1) {
    const body = {
      model,
      max_tokens: 4096,
      temperature: 0.4,
      system,
      messages,
      stream: true,
    };
    emptyAnswerDiag.input = buildEmptyAnswerInputDiag({
      question,
      contextPack,
      chart,
      softGoal,
      priorConsultation: priorConsultationForContext,
      pdfBase64,
      system,
      body,
      userPayload,
    });

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
      const anthropic_upstream_diag = buildAnthropicUpstreamDiag({
        status: res.status,
        errText,
        pdfAttachedAttempted: pdfAttached === true,
        pdfBase64,
        toolCount: 0,
        providerCallNumber: messagesRequestCount,
        requestPhase: "claude_first_messages_request",
      });
      emptyAnswerDiag.response = buildEmptyAnswerResponseDiag({
        http_status: res.status,
        sse_event_counts: emptySseEventCounts(),
        cumulative_text_delta_chars: 0,
        stop_reason: null,
        dataRaw: null,
        picked: { customer_answer: "" },
      });
      return {
        ok: false,
        error: `ANTHROPIC_HTTP_${res.status}`,
        anthropic_upstream_diag,
        empty_answer_diag: emptyAnswerDiag,
        model,
        confirmed_source_facts: confirmedSourceFacts,
        coverage_baseline_facts: coverageBaselineFacts,
        claim_case_updates: claimCaseUpdates,
        pdf_attached: false,
        pdf_attached_attempted: pdfAttached === true,
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
    providerUsage = pickAnthropicUsageNumbers(streamed.dataRaw?.usage ?? null);

    const picked = pickCustomerAnswer(streamed.dataRaw);
    emptyAnswerDiag.response = buildEmptyAnswerResponseDiag({
      http_status: res.status ?? 200,
      sse_event_counts: streamed.sse_event_counts,
      cumulative_text_delta_chars: streamed.cumulative_text_delta_chars,
      stop_reason: streamed.stop_reason,
      dataRaw: streamed.dataRaw,
      picked,
    });
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

    // Text answer only — never second Anthropic call for tools / Continue.
    if (picked.customer_answer) {
      lastPicked = { ...picked, source: picked.source || "plain_text" };
      onAnswerProgress?.(picked.customer_answer);
      break;
    }

    if (!assistantContent.length) break;
    // Fail closed — empty customer answer, no Continue / tool_result re-call.
    break;
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
    coverage_baseline_facts: coverageBaselineFacts,
    claim_case_updates: claimCaseUpdates,
    visual_blocks: [],
    // GO3: decision never generated/persisted on Claude-first.
    decision: null,
    session_goal: sessionGoalRecord,
    session_goal_tool_seen: sessionGoalToolSeen,
    session_goal_rejected: sessionGoalRejected,
    session_goal_reject_reason: sessionGoalRejectReason,
    session_goal_injected: Boolean(softGoal),
    recommendation_basis_tool_seen:
      recommendationBasisTrace.recommendation_basis_tool_seen === true,
    recommendation_basis_count: recommendationBasisTrace.recommendation_basis_count ?? 0,
    recommendation_basis_rejected_count:
      recommendationBasisTrace.recommendation_basis_rejected_count ?? 0,
    recommendation_basis_reject_reasons: Array.isArray(
      recommendationBasisTrace.recommendation_basis_reject_reasons,
    )
      ? recommendationBasisTrace.recommendation_basis_reject_reasons
      : [],
    recommendation_basis_ok: recommendationBasisTrace.recommendation_basis_ok !== false,
    decision_persisted: false,
    answer_source: lastPicked.source || (customer_answer ? "plain_text" : null),
    ttft_ms: lastTtft,
    chart,
    allowlist,
    pdf_attached: Boolean(pdfBase64),
    web_search_trace: webSearchTrace,
    public_evidence: publicEvidence,
    empty_answer_diag: emptyAnswerDiag,
    provider_usage: providerUsage,
    prompt_cache: {
      strategy: cachedParts.cache_strategy,
      breakpoints: cachedParts.cache_breakpoints,
      control: ANTHROPIC_PROMPT_CACHE_CONTROL_5M,
    },
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
  priorAttachFollowUp = false,
  sessionId = null,
  readyCardHandoffToken = null,
  presenceTurn = false,
  env = process.env,
  fetchImpl = fetch,
  startedAt = Date.now(),
  streamHandlers = null,
  loadAllowedCorporateContextsForClaudeImpl = loadAllowedCorporateContextsForClaude,
} = {}) {
  const span = startSpan(startedAt);
  const isPresenceTurn = presenceTurn === true;

  // GO3 SSOT — never trust client prior_session_goal; load from conversations only.
  const discardRequested =
    isPresenceTurn === true ? false : shouldDiscardStaleSessionGoal(question) === true;

  // Client entity_id is a selection hint only — membership re-verified in corporate Hand.
  const selectedEntityIdHint =
    String(
      entityContext?.entity_id ??
        entityContext?.selected_entity_id ??
        entityContext?.conversationContext?.entity_id ??
        entityContext?.passthrough_audit?.entity_id ??
        "",
    ).trim() || null;
  const viewModeHint =
    String(
      entityContext?.view_mode ?? entityContext?.passthrough_audit?.view_mode ?? "",
    )
      .trim()
      .toLowerCase() || null;
  const customerViewMode = resolveCustomerViewMode({
    question,
    selectedEntityIdHint,
    viewModeHint,
  });
  // Personal view: do not load corporate packs (single membership must not auto-surface).
  const corporateLoadEntityId =
    customerViewMode.mode === "personal"
      ? null
      : customerViewMode.entity_id || selectedEntityIdHint;

  // Triangle T2/T2.1 — handoff token → memory → parallel rebuild. Never trust client card JSON.
  const readyResolved = await resolveReadyCardForQuestionTurn({
    userSupabase,
    customerId,
    sessionId,
    authUserId,
    selectedEntityId: corporateLoadEntityId,
    loadedContext,
    unifiedState,
    customerContextBundle,
    discardGoal: discardRequested,
    backgroundRefresh: true,
    handoffToken: readyCardHandoffToken,
    env,
    buildDeps: {
      extractPoliciesFromContext,
      loadLatestSessionGoalFromConversations,
      loadLatestActiveCustomerGoalFromConversations,
      loadCustomerPriorConsultationForClaude,
      loadAllowedCorporateContextsForClaude: loadAllowedCorporateContextsForClaudeImpl,
      loadKeyActiveClaimCases,
      loadActiveCustomerDocuments: loadActiveCustomerDocumentsForHistoryFilter,
    },
  });
  const readyCard = readyResolved?.card ?? null;
  const readyCardStatus = String(readyResolved?.ready_card_status ?? "miss");
  const readyCardMs =
    typeof readyResolved?.ready_card_ms === "number" ? readyResolved.ready_card_ms : null;
  const readyCardSource = String(readyResolved?.ready_card_source ?? "rebuilt_miss");
  const readyCardHit = readyResolved?.ready_card_hit === true;
  const tokenValidationMs =
    typeof readyResolved?.token_validation_ms === "number"
      ? readyResolved.token_validation_ms
      : null;
  const tokenRejectReason = readyResolved?.token_reject_reason ?? null;
  const readyBuildMs =
    typeof readyResolved?.ready_card_build_ms === "number"
      ? readyResolved.ready_card_build_ms
      : typeof readyCard?.build_ms === "number" && Number.isFinite(readyCard.build_ms)
        ? readyCard.build_ms
        : null;
  const readyMaterials = materialsFromReadyCard(readyCard);
  const readyCardMeta = buildReadyCardClaudeMeta(readyCard, readyCardStatus);

  // Hit/stale/miss: materials always come from READY CARD path (miss rebuilds in parallel).
  let ssotGoal = discardRequested ? null : readyMaterials.ssotGoal;
  let ssotReason = discardRequested
    ? "discard_requested"
    : !customerId
      ? "missing_scope"
      : readyMaterials.ssotReason;
  let priorConsultationForContext = readyMaterials.priorConsultation;
  let priorConsultationReason = readyMaterials.priorConsultationReason;
  // Slice 2 — never trust READY CARD corporate slice for consent/delegation.
  // Revocation and selectedEntityId must be re-checked every turn (fail-closed).
  let corporateContexts = [];
  let corporateGapEvidence = [];
  let corporateRecommendationCandidates = [];
  let corporateUnknowns = [];
  let corporateAuthorizationDenied = false;
  if (customerViewMode.mode !== "personal") {
    try {
      const freshCorp = await loadAllowedCorporateContextsForClaudeImpl({
        userSupabase,
        customerId,
        authUserId,
        selectedEntityId: corporateLoadEntityId,
      });
      corporateContexts = Array.isArray(freshCorp?.corporate_contexts)
        ? freshCorp.corporate_contexts
        : [];
      corporateGapEvidence = Array.isArray(freshCorp?.corporate_gap_evidence)
        ? freshCorp.corporate_gap_evidence
        : [];
      corporateRecommendationCandidates = Array.isArray(
        freshCorp?.corporate_recommendation_candidates,
      )
        ? freshCorp.corporate_recommendation_candidates
        : [];
      corporateUnknowns = Array.isArray(freshCorp?.corporate_unknowns)
        ? freshCorp.corporate_unknowns
        : [];
      corporateAuthorizationDenied = freshCorp?.authorization_denied === true;
    } catch {
      corporateContexts = [];
      corporateGapEvidence = [];
      corporateRecommendationCandidates = [];
      corporateUnknowns = [];
      corporateAuthorizationDenied = true;
    }
  }
  // Chart Hand may use single-context select only on corporate/both turns — never personal.
  const selectedCorporateEntityId =
    customerViewMode.mode === "personal" || corporateAuthorizationDenied
      ? null
      : String(corporateLoadEntityId ?? "").trim() ||
        (Array.isArray(corporateContexts) && corporateContexts.length === 1
          ? String(corporateContexts[0]?.entity_id ?? "").trim() || null
          : null);
  const corporateHandSeatAudit = buildCorporateHandSeatAudit({
    corporateContexts,
    selectedEntityId: selectedCorporateEntityId,
    authorizationDenied: corporateAuthorizationDenied,
  });
  const activeClaimCasesFromCard = readyMaterials.activeClaimCases;
  const activeDocumentsFromCard = readyMaterials.activeDocuments;
  const insuranceClockItemsFromCard = Array.isArray(readyMaterials.insuranceClockItems)
    ? readyMaterials.insuranceClockItems
    : null;
  const insuranceClockBriefFromCard =
    readyMaterials.insuranceClockBrief &&
    typeof readyMaterials.insuranceClockBrief === "object"
      ? readyMaterials.insuranceClockBrief
      : null;

  const sessionGoalForContext = discardRequested
    ? null
    : resolveSessionGoalForContext(ssotGoal, question);

  const extracted = extractPoliciesFromContext({
    loadedContext,
    customerContextBundle,
    unifiedState,
  });
  // Prefer live turn-context policies when present; else READY CARD brief.
  const policies =
    extracted.policies.length > 0 ? extracted.policies : readyMaterials.policies;
  const policy_count =
    extracted.policies.length > 0
      ? extracted.policy_count
      : readyMaterials.policy_count;
  const reality = { policies, policy_count };

  // Triangle T6 — Presence materials (listen_focus). No PDF parallel Claude.
  const lifeThreadsForPresence = Array.isArray(priorConsultationForContext?.life_threads)
    ? priorConsultationForContext.life_threads
    : [];
  const presenceContextBuilt = isPresenceTurn
    ? buildPresenceContext({
        now: startedAt instanceof Date ? startedAt : new Date(startedAt),
        visitKind:
          Array.isArray(priorConsultationForContext?.related_turns) &&
          priorConsultationForContext.related_turns.length > 0
            ? "revisit"
            : lifeThreadsForPresence.length > 0
              ? "revisit"
              : "first_visit",
        lastVisitAt: priorConsultationForContext?.related_turns?.[0]?.at ?? null,
        lifeThreads: lifeThreadsForPresence,
        customerId,
        readyCardVersion: readyCard?.card_version ?? null,
        maxCandidates: 3,
      })
    : null;
  const presenceGate = isPresenceTurn
    ? shouldInvokePresenceClaude({ presenceContext: presenceContextBuilt })
    : { ok: false, reason: "not_presence" };

  if (isPresenceTurn && presenceGate.ok !== true) {
    const emitMark = span.end();
    const quietMs = relMs(startedAt);
    const quietResult = {
      ok: true,
      customerText: "",
      keySpeakOriginal: "",
      visualBlocks: [],
      key_monopoly_failure: false,
      failure_reason: null,
      presence_quiet: true,
      presence_skip_reason: presenceGate.reason,
      agentTurn: {
        text: "",
        responseSource: ONE_KEY_CORE_RESPONSE_SOURCE.QUESTION,
        consultationIntent: { intent: "key_presence_listen_focus" },
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
            presence_turn: true,
            presence_move: KEY_PRESENCE_MOVE,
            presence_quiet: true,
            presence_skip_reason: presenceGate.reason,
            provider_calls: 0,
            tools: 0,
            latency_marks: {
              claude_full_emit: emitMark,
              ttft_ms: null,
              customer_done_ms: quietMs,
              ...resolveDeployIdentity(env),
            },
          },
        },
      },
      oneKeyCoreTrace: {
        schema_version: "one-key-core-trace-claude-first-v1",
        steps: [
          {
            step: "presence_quiet",
            at_ms: quietMs,
            payload: { reason: presenceGate.reason, claude_call_started: false },
          },
        ],
        legacy_paths_blocked: ["interpret", "decision", "planner", "s3_s6_compose"],
      },
    };
    try {
      streamHandlers?.onEarlyCustomerDone?.(quietResult);
    } catch {
      /* non-blocking */
    }
    return quietResult;
  }

  // Physical active attachment only — never invent latest document; never keyword-classify the question.
  // Presence must not mix PDF/document Claude work into the login opener.
  let explicitDocumentId = isPresenceTurn
    ? ""
    : String(attachedDocumentId ?? "").trim();
  let documentMentionResolve = null;
  // B: explicit 내 문서 / filename pointer → lookup owned document (no silent latest invent).
  if (!isPresenceTurn && !explicitDocumentId && userSupabase && customerId) {
    const mentionedFilenames = extractMentionedFilenamesFromChat(question, history);
    const wantsBox =
      isExplicitDocumentBoxMentionQuestion(question) ||
      mentionedFilenames.length > 0 ||
      isPriorAttachFollowUpQuestion(question, { history, priorAttachFollowUp });
    if (wantsBox) {
      documentMentionResolve = await resolveExplicitCustomerDocumentMention({
        supabase: userSupabase,
        customerId,
        question,
        history,
        mentionedFilenames,
      });
      if (documentMentionResolve?.ok && documentMentionResolve.documentId) {
        explicitDocumentId = String(documentMentionResolve.documentId).trim();
      }
    }
  }
  const allowLatestFallback = false;
  const clientPriorAttach = priorAttachFollowUp === true;

  // Triangle T1 — prepared excerpts when available; never invent verified facts from chunks.
  let documentChunksForClaude = [];
  let pdfFetchMs = null;
  if (explicitDocumentId && userSupabase && customerId) {
    const chunkLoadStarted = Date.now();
    documentChunksForClaude = await loadCustomerDocumentChunksByDocumentId({
      supabase: userSupabase,
      customerId,
      documentId: explicitDocumentId,
      limit: 40,
    });
    // chunk load is not Storage PDF fetch; pdf_fetch_ms set only on original fetch below.
    void chunkLoadStarted;
  }

  const attachModeDecision = decidePdfAttachMode({
    documentId: explicitDocumentId || null,
    priorAttachFollowUp: clientPriorAttach,
    question,
    chunkCount: documentChunksForClaude.length,
    mediaType: null,
  });

  let pdf = {
    pdfBase64: null,
    mediaType: null,
    meta: {
      attached: false,
      document_id: explicitDocumentId || null,
      reuse_without_bytes: false,
      pdf_attach_mode: attachModeDecision.mode,
      document_review_scope: attachModeDecision.review_scope,
      document_evidence_status: attachModeDecision.evidence_status,
      note: attachModeDecision.reason,
      attach_signals: buildAttachOpsSignals({
        attachment_requested: Boolean(explicitDocumentId),
        attachment_attached: false,
        attachment_failed: false,
        attachment_block_built: false,
      }),
    },
  };

  if (explicitDocumentId && attachModeDecision.attach_full_base64 === true) {
    const fetchStarted = Date.now();
    pdf = await resolveOptionalPdfAttachment({
      userSupabase,
      customerId,
      loadedContext,
      unifiedState,
      attachedDocumentId: explicitDocumentId || null,
      env,
      allowLatestFallback,
    });
    pdfFetchMs = Math.max(0, Date.now() - fetchStarted);
    pdf = {
      ...pdf,
      meta: {
        ...(pdf?.meta && typeof pdf.meta === "object" ? pdf.meta : {}),
        pdf_attach_mode: attachModeDecision.mode,
        document_review_scope: attachModeDecision.review_scope,
        document_evidence_status: attachModeDecision.evidence_status,
        reuse_without_bytes: false,
      },
    };
  } else if (explicitDocumentId && attachModeDecision.attach_full_base64 === false) {
    // T1: skip Storage original rebroadcast; keep document identity + scope for Claude.
    pdf = {
      pdfBase64: null,
      mediaType: null,
      meta: {
        attached: false,
        document_id: explicitDocumentId,
        reuse_without_bytes: true,
        pdf_attach_mode: attachModeDecision.mode,
        document_review_scope: attachModeDecision.review_scope,
        document_evidence_status: attachModeDecision.evidence_status,
        note: attachModeDecision.reason,
        attach_signals: buildAttachOpsSignals({
          attachment_requested: true,
          attachment_attached: false,
          attachment_failed: false,
          attachment_block_built: false,
        }),
      },
    };
  }

  // Explicit attach requested this turn but processing failed → fail-closed.
  // Intentional T1 reuse (no bytes) is not a failure.
  // Stale deleted active id on a normal insurance question must not block verified answers.
  const realPriorAttachFollowUp =
    clientPriorAttach === true &&
    isPriorAttachFollowUpQuestion(question, {
      history,
      priorAttachFollowUp: clientPriorAttach,
    }) === true;
  if (
    explicitDocumentId &&
    pdf?.meta?.attached !== true &&
    pdf?.meta?.reuse_without_bytes !== true
  ) {
    const staleActiveNotFollowUp =
      clientPriorAttach === true && realPriorAttachFollowUp !== true;
    if (!staleActiveNotFollowUp) {
      const usePriorAttachCopy = realPriorAttachFollowUp === true;
      const failureNote = usePriorAttachCopy
        ? "prior_attach_missing"
        : String(pdf?.meta?.note ?? "").trim() || "attach_process_failed";
      // No KEY substitute sentences — empty customer text + failure_reason only.
      const outlet = finalizeKeyCustomerText("", {
        failureMode: true,
        startedAt,
      });
      const emitMark = span.end();
      const attachPersistGoal = resolvePersistableSessionGoal({
        discardRequested,
        usedFailure: true,
        claudeGoal: null,
        now: startedAt instanceof Date ? startedAt : new Date(startedAt),
      });
      return {
        ok: true,
        customerText: outlet.customerText,
        keySpeakOriginal: outlet.keySpeakOriginal,
        visualBlocks: [],
        key_monopoly_failure: true,
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
          decision: null,
          session_goal: attachPersistGoal,
          decision_persisted: false,
          key_compose_trace: {
            compose_mode: "key_claude_first_direct",
            key_voice_trace: {
              provider: "claude_first_direct",
              used_failure_mode: true,
              fallback_reason: failureNote,
              session_goal_discard_requested: discardRequested === true,
              session_goal_ssot_reason: ssotReason,
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

  // Real prior-attach follow-up but document id missing → empty failure (no reattach KEY copy).
  if (realPriorAttachFollowUp && !explicitDocumentId && pdf?.meta?.attached !== true) {
    const outlet = finalizeKeyCustomerText("", {
      failureMode: true,
      startedAt,
    });
    const emitMark = span.end();
    return {
      ok: true,
      customerText: outlet.customerText,
      keySpeakOriginal: outlet.keySpeakOriginal,
      visualBlocks: [],
      key_monopoly_failure: true,
      failure_reason: "prior_attach_missing",
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
            used_failure_mode: true,
            fallback_reason: "prior_attach_missing",
            prior_attach_follow_up: true,
            pdf_attached: false,
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
  // T4 — pass Claude original through immediately (no sentence/paragraph wait).
  let sseEmittedText = "";
  const commitStream = createImmediateAnswerDeltaStream({
    onCommit(chunk) {
      const slice = String(chunk ?? "");
      if (!slice) return { keep: true };
      sseEmittedText += slice;
      if (streamHandlers?.onDelta) {
        streamHandlers.onDelta(slice);
        streamHandlers._emitted = true;
        if (firstTokenMs == null && slice.trim()) {
          firstTokenMs = relMs(startedAt);
          streamHandlers.onFirstToken?.(firstTokenMs);
        }
      }
      return { keep: true };
    },
  });

  // Existing customer-card claim cases — READY CARD reuse; never invent cross-customer rows.
  let activeClaimCasesAll = Array.isArray(activeClaimCasesFromCard)
    ? activeClaimCasesFromCard
    : [];
  if (!Array.isArray(activeClaimCasesFromCard)) {
    try {
      activeClaimCasesAll = await loadKeyActiveClaimCases({
        supabase: userSupabase,
        customerId,
      });
    } catch (err) {
      console.error("[key_active_claim_cases_load]", String(err?.message ?? err).slice(0, 200));
      activeClaimCasesAll = [];
    }
  }

  // Insurance Clock Slice 1 — KEY-owned deadlines; Claude explains only.
  let insuranceClockItemsAll = Array.isArray(insuranceClockItemsFromCard)
    ? insuranceClockItemsFromCard
    : [];
  if (!Array.isArray(insuranceClockItemsFromCard) && userSupabase && customerId) {
    try {
      const [stored, policyDateFacts] = await Promise.all([
        loadInsuranceClockItems({
          supabase: userSupabase,
          customerId,
        }),
        loadPolicyDateFacts({
          supabase: userSupabase,
          customerId,
        }),
      ]);
      insuranceClockItemsAll = assembleInsuranceClockItemsForHand({
        storedClocks: stored,
        corporateContexts,
        policies,
        policyDateFacts,
        customerId,
        entityId: selectedCorporateEntityId,
        mode: "both",
      });
    } catch (err) {
      console.error("[key_insurance_clock_load]", String(err?.message ?? err).slice(0, 200));
      insuranceClockItemsAll = [];
    }
  }
  const viewModeForClock = String(customerViewMode?.mode ?? "personal");
  const insuranceClockItemsScoped = filterInsuranceClocksByScope(insuranceClockItemsAll, {
    entityId: selectedCorporateEntityId,
    mode:
      viewModeForClock === "corporate"
        ? "corporate"
        : viewModeForClock === "both"
          ? "both"
          : "personal",
  });
  const insuranceClockBrief =
    insuranceClockBriefFromCard && viewModeForClock === "both"
      ? insuranceClockBriefFromCard
      : buildInsuranceClockHandBrief(insuranceClockItemsScoped);

  // Evidence Vault Slice 1 — claim evidence package; Claude explains only.
  let claimEvidenceItemsAll = Array.isArray(readyMaterials.claimEvidenceItems)
    ? readyMaterials.claimEvidenceItems
    : [];
  if (!Array.isArray(readyMaterials.claimEvidenceItems) && userSupabase && customerId) {
    try {
      claimEvidenceItemsAll = await loadClaimEvidenceItems({
        supabase: userSupabase,
        customerId,
      });
    } catch (err) {
      console.error("[key_claim_evidence_load]", String(err?.message ?? err).slice(0, 200));
      claimEvidenceItemsAll = [];
    }
  }
  const claimEvidenceItemsScoped = filterClaimEvidenceByScope(claimEvidenceItemsAll, {
    entityId: selectedCorporateEntityId,
    mode:
      viewModeForClock === "corporate"
        ? "corporate"
        : viewModeForClock === "both"
          ? "both"
          : "personal",
  });
  const claimEvidenceBrief =
    readyMaterials.claimEvidenceBrief && viewModeForClock === "both"
      ? readyMaterials.claimEvidenceBrief
      : buildClaimEvidenceHandBrief({
          cases: activeClaimCasesAll,
          evidenceItems: claimEvidenceItemsScoped,
        });

  // Life Ledger Slice 1 — soft long-context; Claude judges freely (no control).
  let lifeLedgerItemsAll = Array.isArray(readyMaterials.lifeLedgerItems)
    ? readyMaterials.lifeLedgerItems
    : [];
  if (!Array.isArray(readyMaterials.lifeLedgerItems) && userSupabase && customerId) {
    try {
      lifeLedgerItemsAll = await loadLifeLedgerItems({
        supabase: userSupabase,
        customerId,
      });
    } catch (err) {
      console.error("[key_life_ledger_load]", String(err?.message ?? err).slice(0, 200));
      lifeLedgerItemsAll = [];
    }
  }
  const lifeLedgerItemsScoped = filterLifeLedgerByScope(lifeLedgerItemsAll, {
    entityId: selectedCorporateEntityId,
    mode:
      viewModeForClock === "corporate"
        ? "corporate"
        : viewModeForClock === "both"
          ? "both"
          : "personal",
  });
  const lifeLedgerBrief =
    readyMaterials.lifeLedgerBrief && viewModeForClock === "both"
      ? readyMaterials.lifeLedgerBrief
      : buildLifeLedgerHandBrief(lifeLedgerItemsScoped);

  // Slice 3 D — claim entity ≠ chart auto-select. Personal turns stay personal.
  const claimSelectedEntityId = resolveClaimSelectedEntityId({
    selectedEntityIdHint,
    question,
    corporateContexts,
  });

  // Slice 3 — claim_support gate (membership/chart consent is not enough).
  let corporateClaimAllowed = false;
  if (claimSelectedEntityId && authUserId && userSupabase) {
    const selectedCtx = (Array.isArray(corporateContexts) ? corporateContexts : []).find(
      (c) => String(c?.entity_id ?? "").trim() === claimSelectedEntityId,
    );
    const scopesFromBrief = Array.isArray(
      selectedCtx?.authority_brief?.allowed_scopes_entity_level,
    )
      ? selectedCtx.authority_brief.allowed_scopes_entity_level
      : [];
    if (scopesFromBrief.includes("claim_support")) {
      corporateClaimAllowed = true;
    } else {
      try {
        const grantPack = await loadHolderAuthorityGrants({
          supabase: userSupabase,
          entityId: claimSelectedEntityId,
          holderUserId: authUserId,
        });
        corporateClaimAllowed = canSupportCorporateClaims(grantPack);
      } catch {
        corporateClaimAllowed = false;
      }
    }
  }

  const claimTurnScope = resolveClaimIntakeTurnScope({
    question,
    existingCases: activeClaimCasesAll,
    entityId: claimSelectedEntityId,
    corporateClaimAllowed,
    attachedDocumentId:
      String(pdf?.meta?.document_id ?? attachedDocumentId ?? "").trim() || null,
  });
  const claimHandDenied = claimTurnScope.authorization_denied === true;
  const personalClaimTurn =
    claimTurnScope.claim_scope === "personal" && claimHandDenied !== true;
  // Hydrate only the turn-scoped cases — never mix personal ↔ corporate.
  let activeClaimCases =
    claimTurnScope.claim_scope === "corporate" &&
    claimTurnScope.entity_id &&
    !claimHandDenied
      ? filterKeyActiveClaimCasesByScope(activeClaimCasesAll, {
          claim_scope: "corporate",
          entity_id: claimTurnScope.entity_id,
        })
      : filterKeyActiveClaimCasesByScope(activeClaimCasesAll, {
          claim_scope: "personal",
          entity_id: null,
        });
  // Corporate claim Hand only on corporate turns / denial — never via single-entity chart select.
  const corporateClaimHandSeatAudit = buildCorporateClaimHandSeatAudit({
    claimCases: activeClaimCasesAll,
    selectedEntityId: claimSelectedEntityId,
    corporateClaimAllowed,
    authorizationDenied:
      claimHandDenied ||
      (Boolean(claimSelectedEntityId) &&
        !personalClaimTurn &&
        corporateClaimAllowed !== true),
    omitForPersonalTurn: personalClaimTurn,
  });

  const pdfMetaForClaude = {
    ...(pdf?.meta && typeof pdf.meta === "object" ? pdf.meta : {}),
    ...(Array.isArray(documentMentionResolve?.listing) && documentMentionResolve.listing.length
      ? { document_box_listing: documentMentionResolve.listing }
      : {}),
    document_mention_resolve: documentMentionResolve?.reason ?? null,
  };

  // Active documents for history pack filter — prefer READY CARD; fall back only if absent.
  const activeDocumentsForHistory = Array.isArray(activeDocumentsFromCard)
    ? activeDocumentsFromCard
    : await loadActiveCustomerDocumentsForHistoryFilter({
        supabase: userSupabase,
        customerId,
      });

  const questionClaudeStartMs = relMs(startedAt);
  const claude = await callClaudeFirstDirect({
    question: isPresenceTurn ? KEY_PRESENCE_INTERNAL_QUESTION : question,
    history: isPresenceTurn ? [] : history,
    reality,
    env,
    fetchImpl,
    startedAt,
    onFirstContent: (ms) => {
      if (firstTokenMs == null) firstTokenMs = ms;
    },
    onAnswerProgress: (text) => {
      // Do not paint silence token to the customer stream.
      if (isPresenceTurn && isPresenceSilenceAnswer(text)) return;
      const result = commitStream.pushAnswerText(text);
      if (result?.aborted) {
        sentenceStreamAborted = true;
        sentenceAbortReason = commitStream.getAbortReason();
      }
    },
    pdfBase64: isPresenceTurn ? null : pdf.pdfBase64,
    pdfMediaType: isPresenceTurn ? null : pdf.mediaType,
    pdfMeta: isPresenceTurn ? null : pdfMetaForClaude,
    corporateContexts: isPresenceTurn ? null : corporateContexts,
    corporateGapEvidence: isPresenceTurn ? null : corporateGapEvidence,
    corporateRecommendationCandidates: isPresenceTurn
      ? null
      : corporateRecommendationCandidates,
    corporateUnknowns: isPresenceTurn ? null : corporateUnknowns,
    selectedCorporateEntityId: isPresenceTurn ? null : selectedCorporateEntityId,
    activeClaimCases: isPresenceTurn ? null : activeClaimCases,
    activeDocuments: isPresenceTurn ? [] : activeDocumentsForHistory,
    insuranceClockBrief: isPresenceTurn ? null : insuranceClockBrief,
    claimEvidenceBrief: isPresenceTurn ? null : claimEvidenceBrief,
    lifeLedgerBrief: isPresenceTurn ? null : lifeLedgerBrief,
    sessionGoalForContext: isPresenceTurn ? null : sessionGoalForContext,
    priorConsultationForContext,
    documentEvidence: isPresenceTurn ? [] : documentChunksForClaude,
    readyCardMeta: isPresenceTurn ? null : readyCardMeta,
    presenceContext: isPresenceTurn ? presenceContextBuilt : null,
    presenceTurn: isPresenceTurn,
    customerViewModeForPayload: isPresenceTurn
      ? null
      : {
          ...customerViewMode,
          // Post-auth only — never echo unauthorized client entity_id into Claude packs.
          entity_id: corporateAuthorizationDenied
            ? null
            : selectedCorporateEntityId || null,
          authorization_denied: corporateAuthorizationDenied === true,
        },
  });
  const emitMark = span.end();
  const claudeCompleteMs = relMs(startedAt);
  const pdfPayloadBytes = pdf?.pdfBase64
    ? Math.floor((String(pdf.pdfBase64).length * 3) / 4)
    : 0;
  const pdfAttachmentCount = pdf?.pdfBase64 ? 1 : 0;
  const requestBodyChars =
    Number(claude?.empty_answer_diag?.input?.request_body_chars) || null;
  const triangleT0 = {
    customer_question_received_ms: 0,
    ready_card_ms: readyCardMs,
    ready_card_build_ms: readyBuildMs,
    ready_card_status: ["hit", "stale", "miss"].includes(readyCardStatus)
      ? readyCardStatus
      : "miss",
    ready_card_source: readyCardSource.slice(0, 32),
    ready_card_hit: readyCardHit,
    token_validation_ms: tokenValidationMs,
    token_reject_reason: tokenRejectReason
      ? String(tokenRejectReason).slice(0, 48)
      : null,
    question_claude_start_ms: questionClaudeStartMs,
    anthropic_first_byte_ms: claude.ttft_ms ?? firstTokenMs ?? null,
    first_delta_sent_ms: firstTokenMs ?? claude.ttft_ms ?? null,
    claude_complete_ms: claudeCompleteMs,
    persist_start_ms: null,
    persist_complete_ms: null,
    pdf_fetch_ms: pdfFetchMs,
    pdf_payload_bytes: pdfPayloadBytes,
    pdf_attachment_count: pdfAttachmentCount,
    pdf_attach_mode: String(pdfMetaForClaude?.pdf_attach_mode ?? attachModeDecision.mode ?? ""),
    request_body_chars: requestBodyChars,
    input_tokens: claude?.provider_usage?.input_tokens ?? null,
    output_tokens: claude?.provider_usage?.output_tokens ?? null,
    cache_creation_input_tokens:
      claude?.provider_usage?.cache_creation_input_tokens ?? null,
    cache_read_input_tokens: claude?.provider_usage?.cache_read_input_tokens ?? null,
    cache_creation_ephemeral_5m_input_tokens:
      claude?.provider_usage?.cache_creation_ephemeral_5m_input_tokens ?? null,
  };
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

  // T6 — intentional Presence silence is a successful quiet turn (provider_calls=1, no bubble).
  const presenceRawAnswer = String(claude?.customer_answer ?? "").trim();
  const presenceChoseSilence =
    isPresenceTurn &&
    (presenceRawAnswer === KEY_PRESENCE_SILENCE_TOKEN ||
      (claude?.ok === true && presenceRawAnswer === ""));

  if ((!claude.ok || !claude.customer_answer) && !presenceChoseSilence) {
    // Empty customer text — keep failure_reason + anthropic_upstream_diag; never invent KEY copy.
    const sealed = sealKeyCustomerText("");
    const emptyPersistGoal = resolvePersistableSessionGoal({
      discardRequested,
      usedFailure: true,
      claudeGoal: claude.session_goal ?? null,
      now: startedAt instanceof Date ? startedAt : new Date(startedAt),
    });
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
        decision: null,
        session_goal: emptyPersistGoal,
        decision_persisted: false,
        key_compose_trace: {
          compose_mode: "key_claude_first_direct",
          key_voice_trace: {
            used_failure_mode: true,
            fallback_reason: claude.error ?? "claude_first_empty",
            decision_persisted: false,
            session_goal_discard_requested: discardRequested === true,
            session_goal_ssot_reason: ssotReason,
            anthropic_upstream_diag: claude.anthropic_upstream_diag ?? null,
            empty_answer_diag: claude.empty_answer_diag ?? null,
            web_search: claude.web_search_trace ?? null,
            pdf_attached: claude.pdf_attached === true,
            pdf_attached_attempted: claude.pdf_attached_attempted === true,
            recommendation_basis_tool_seen: claude.recommendation_basis_tool_seen === true,
            recommendation_basis_count: Number(claude.recommendation_basis_count ?? 0) || 0,
            recommendation_basis_rejected_count:
              Number(claude.recommendation_basis_rejected_count ?? 0) || 0,
            recommendation_basis_reject_reasons: Array.isArray(
              claude.recommendation_basis_reject_reasons,
            )
              ? claude.recommendation_basis_reject_reasons
              : [],
            recommendation_basis_ok: claude.recommendation_basis_ok !== false,
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
            payload: {
              error: claude.error ?? "empty",
              ttft_ms: firstTokenMs ?? claude.ttft_ms,
              anthropic_upstream_diag: claude.anthropic_upstream_diag ?? null,
              empty_answer_diag: claude.empty_answer_diag ?? null,
            },
          },
        ],
        legacy_paths_blocked: ["interpret", "decision", "planner", "s3_s6_compose"],
      },
    };
  }

  let finalText = presenceChoseSilence
    ? ""
    : String(claude.customer_answer ?? "");
  if (isPresenceTurn && isPresenceSilenceAnswer(finalText)) {
    finalText = "";
  }
  let usedFailure = false;
  let failureReason = null;
  // Trace-only hard scan — OUR CLAUDE: never evaluate/shorten/replace a normal Claude answer.
  let safety = hardOnlySafetyCheck(presenceChoseSilence ? "" : claude.customer_answer, {
    allowed_numbers: claude.allowlist?.allowed_numbers ?? [],
    allowed_entities: claude.allowlist?.allowed_entities ?? [],
  });
  let replacingHard = [];
  let alreadyCommitted =
    Boolean(streamHandlers?._emitted) || Boolean(commitStream.getCommitted());

  if (!String(finalText ?? "").trim()) {
    finalText = presenceChoseSilence ? "" : commitStream.getCommitted() || "";
    if (
      !presenceChoseSilence &&
      !String(commitStream.getCommitted() ?? "").trim()
    ) {
      usedFailure = true;
      failureReason = "empty_answer";
    }
  }
  // Fact-alignment: strip only unverified insurer/product literals (no full rewrite, no 2nd Claude).
  // Corporate turns: do not let personal-policy allowlist authorize corp insurer/product claims.
  const corporateLiteralAllow = collectCorporateInsurerProductAllowlist(corporateContexts);
  const literalAllowEntities =
    Array.isArray(corporateContexts) && corporateContexts.length > 0
      ? corporateLiteralAllow
      : claude.allowlist?.allowed_entities ?? [];
  const literalGuard = presenceChoseSilence
    ? {
        text: "",
        changed: false,
        stripped_count: 0,
        stripped_forms: [],
        reason: "presence_silence",
      }
    : neutralizeUnsupportedInsurerProductLiterals(finalText, {
        allowedEntities: literalAllowEntities,
      });
  if (literalGuard.changed) {
    finalText = literalGuard.text;
  }
  const keyVerifiedLiteralConflict = {
    conflict: literalGuard.stripped_count > 0,
    reason: literalGuard.reason,
    stripped_count: literalGuard.stripped_count,
    stripped_forms: literalGuard.stripped_forms,
    allowlist_scope:
      Array.isArray(corporateContexts) && corporateContexts.length > 0
        ? "corporate_verified_only"
        : "personal_reality_allowlist",
    full_rewrite: false,
    second_claude_call: false,
  };
  // Seal after fact-alignment strip only (no monopoly stub, no soft rewrite, no truncation).
  // Presence silence seals empty (token never shown / never stored as customer fact).
  const sealed = sealKeyCustomerText(finalText);
  // Catch up any trailing gap so streamed text matches sealed before customer done.
  if (!sentenceStreamAborted && sealed.key_speak_original) {
    const sealedCatchUp = commitStream.catchUpFinalAnswer(sealed.key_speak_original);
    if (sealedCatchUp?.aborted) {
      sentenceStreamAborted = true;
      sentenceAbortReason = commitStream.getAbortReason() ?? sentenceAbortReason;
    }
  }
  const streamedEqualsSealed =
    String(sseEmittedText ?? "") === String(sealed.key_speak_original ?? "");
  const customerDoneMs = relMs(startedAt);

  // KEY LIFE LEDGER — before early done so client can persist session_goal / life_threads.
  // Source + goal + LIFE THREAD from customer utterance only (never Claude answer).
  const sourceLink = resolveConsultationSourceLink({
    sourceTurnId: null,
    messageId: null,
    sessionId,
    turnOrd: Array.isArray(history) ? history.length + 1 : 1,
  });
  const nowStamp = startedAt instanceof Date ? startedAt : new Date(startedAt);
  const customerStatedGoalText =
    !isPresenceTurn && !usedFailure && discardRequested !== true
      ? extractCustomerStatedGoalFromUtterance(question)
      : null;
  const customerUtteranceGoal =
    customerStatedGoalText && !isForbiddenSessionGoalText(customerStatedGoalText)
      ? {
          goal: customerStatedGoalText,
          status: "active",
          updated_at: Number.isFinite(nowStamp.getTime())
            ? nowStamp.toISOString()
            : new Date().toISOString(),
          evidence: {
            kind: "customer_utterance",
            text: String(question ?? "").trim().slice(0, 240),
          },
          source_link: sourceLink,
        }
      : null;

  const persistableSessionGoal = resolvePersistableSessionGoal({
    discardRequested,
    usedFailure,
    claudeGoal: customerUtteranceGoal,
    now: nowStamp,
  });

  // T6 — Presence surface / do_not_surface overlays (never store Claude guesses as facts).
  let presenceTurnMeta = null;
  let lifeThreadsForRecord = undefined;
  if (isPresenceTurn && !usedFailure) {
    const surface = resolvePresenceSurfaceFromAnswer(
      sealed.key_speak_original,
      presenceContextBuilt?.active_life_thread_candidates ?? [],
    );
    const stamped = Number.isFinite(nowStamp.getTime())
      ? nowStamp.toISOString()
      : new Date().toISOString();
    let threads = mergeLifeThreadHistory(lifeThreadsForPresence);
    if (surface.surfaced && surface.life_thread_id) {
      threads = threads.map((t) =>
        String(t.thread_id) === String(surface.life_thread_id)
          ? markLifeThreadSurfaced(t, { at: nowStamp })
          : t,
      );
    }
    lifeThreadsForRecord = threads;
    presenceTurnMeta = {
      presence_turn: true,
      move: KEY_PRESENCE_MOVE,
      ready_card_version: readyCard?.card_version ?? null,
      life_thread_id: surface.life_thread_id,
      source_type: surface.source_type,
      claude_original: String(sealed.key_speak_original ?? "").slice(0, 1200),
      surfaced_at: surface.surfaced || surface.source_type ? stamped : null,
      silence: presenceChoseSilence === true || !String(sealed.key_speak_original ?? "").trim(),
    };
  } else if (!isPresenceTurn && !usedFailure) {
    const extracted = extractLifeThreadsFromCustomerUtterance(question, {
      customerId,
      sourceLink,
      now: nowStamp,
    });
    const recentIds = pickRecentlySurfacedThreadIds(lifeThreadsForPresence, {
      limit: 1,
    });
    const dns = buildDoNotSurfaceLifeThreadOverlays(question, {
      customerId,
      candidateThreadIds: recentIds,
      now: nowStamp,
    });
    lifeThreadsForRecord = [...extracted, ...dns];
  }

  const keyConsultationRecord = usedFailure
    ? null
    : buildKeyConsultationRecord({
        question: isPresenceTurn ? KEY_PRESENCE_INTERNAL_QUESTION : question,
        claudeAnswer: sealed.key_speak_original,
        sessionGoal: isPresenceTurn ? null : persistableSessionGoal,
        recommendationBasisCount: Number(claude.recommendation_basis_count ?? 0) || 0,
        pdfAttached: isPresenceTurn ? false : claude.pdf_attached === true,
        documentId: isPresenceTurn ? null : pdf?.meta?.document_id ?? null,
        sourceLink,
        customerId,
        now: nowStamp,
        lifeThreads: lifeThreadsForRecord,
        presenceTurn: presenceTurnMeta,
      });

  // T5.1 / T6 — LIFE THREAD write/status/surface change invalidates stale READY CARD.
  if (
    customerId &&
    Array.isArray(keyConsultationRecord?.life_threads) &&
    keyConsultationRecord.life_threads.length > 0
  ) {
    try {
      invalidateReadyCardCacheForCustomer(customerId);
    } catch {
      /* non-blocking */
    }
  }

  // T4 — customer screen completes before fact persist / probe (request stays open).
  // T5.1 — include inject evidence on early done (no second done event).
  const earlyLifeThreadsBrief = isPresenceTurn
    ? formatPresenceLifeThreadsBrief(lifeThreadsForRecord ?? lifeThreadsForPresence, {
        customerId,
        surfacedId: presenceTurnMeta?.life_thread_id ?? null,
      })
    : formatLifeThreadsForReadyCard(
        Array.isArray(priorConsultationForContext?.life_threads)
          ? priorConsultationForContext.life_threads
          : [],
        { limit: 6, activeOnly: true, customerId },
      );
  if (typeof streamHandlers?.onEarlyCustomerDone === "function") {
    try {
      streamHandlers.onEarlyCustomerDone({
        ok: true,
        answerText: sealed.key_speak_original,
        key_speak_original: sealed.key_speak_original,
        response_source: ONE_KEY_CORE_RESPONSE_SOURCE.QUESTION,
        key_monopoly_failure: usedFailure === true,
        failure_reason: failureReason,
        customer_done_ms: customerDoneMs,
        streamed_equals_sealed: streamedEqualsSealed,
        session_goal: persistableSessionGoal,
        key_consultation_record: keyConsultationRecord,
        presence_quiet: isPresenceTurn && !String(sealed.key_speak_original ?? "").trim(),
        sales_director_trace: {
          one_key_core: true,
          compose_mode: "key_claude_first_direct",
          session_goal: persistableSessionGoal,
          key_consultation_record: keyConsultationRecord,
          key_compose_trace: {
            compose_mode: "key_claude_first_direct",
            key_voice_trace: {
              provider: "claude_first_direct",
              presence_turn: isPresenceTurn === true,
              presence_move: isPresenceTurn ? KEY_PRESENCE_MOVE : null,
              presence_source_type: presenceTurnMeta?.source_type ?? null,
              presence_life_thread_id: presenceTurnMeta?.life_thread_id ?? null,
              provider_calls: 1,
              tools: 0,
              corporate_hand: corporateHandSeatAudit,
              corporate_claim_hand: corporateClaimHandSeatAudit,
              key_verified_literal_conflict: keyVerifiedLiteralConflict,
              life_threads_injected_count: earlyLifeThreadsBrief.length,
              life_threads_brief: earlyLifeThreadsBrief,
              life_threads_attach_reason:
                readyResolved?.life_threads_attach_reason ?? null,
              ready_card_source: readyCardSource,
              latency_marks: {
                ttft_ms: firstTokenMs ?? claude.ttft_ms ?? null,
                triangle_t0: {
                  customer_question_received_ms: 0,
                  anthropic_first_byte_ms: claude.ttft_ms ?? firstTokenMs ?? null,
                  first_delta_sent_ms: firstTokenMs ?? claude.ttft_ms ?? null,
                  claude_complete_ms: claudeCompleteMs,
                  customer_done_ms: customerDoneMs,
                  persist_start_ms: null,
                  persist_complete_ms: null,
                  streamed_equals_sealed: streamedEqualsSealed,
                  ready_card_source: readyCardSource,
                  ready_card_hit: readyCardHit,
                  life_threads_injected_count: earlyLifeThreadsBrief.length,
                },
                ...resolveDeployIdentity(env),
              },
            },
          },
        },
      });
      streamHandlers._earlyCustomerDone = true;
    } catch (err) {
      console.error(
        "[early_customer_done]",
        String(err?.message ?? err).slice(0, 200),
      );
    }
  }

  // T4 marks — customer done already signaled; persist must not rewrite answer.
  triangleT0.customer_done_ms = customerDoneMs;
  triangleT0.streamed_equals_sealed = streamedEqualsSealed;
  triangleT0.persist_start_ms = relMs(startedAt);

  // Customer answer is fixed. Persist facts/baseline/claim cases only — never rewrite answer on failure.
  // GO1: KEY confirm gate — active doc + ownership + schema + source match — before persist.
  let keyConfirmedPersist = { attempted: false, ok: false, stored: 0 };
  let keyConfirmedFactGate = {
    attempted: false,
    accepted_count: 0,
    rejected_reason_counts: {},
    ownership_ok: false,
    ownership_query_count: 0,
    active_document_present: false,
  };
  let factsToPersist = [];
  if (!usedFailure && userSupabase && customerId) {
    const rawFacts = Array.isArray(claude.confirmed_source_facts)
      ? claude.confirmed_source_facts
      : [];
    const activeDocumentId =
      String(pdf?.meta?.document_id ?? "").trim() || null;
    const resolved = await resolveKeyConfirmableFactsForPersist({
      supabase: userSupabase,
      customerId,
      activeDocumentId,
      facts: rawFacts,
    });
    keyConfirmedFactGate = resolved.gate;
    factsToPersist = resolved.accepted;

    if (factsToPersist.length > 0) {
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
  }

  // Hand after KEY seal + policy persist — never rewrite customer_answer.
  // profile_health_policy rebuild so insurance.* memory can form from active policies.
  let keyMemoryRebuild = {
    attempted: false,
    ok: false,
    reason: "not_run",
    customer_id: customerId ? String(customerId) : null,
  };
  if (keyConfirmedPersist?.ok === true && customerId) {
    keyMemoryRebuild.attempted = true;
    try {
      const supabaseUrl = resolveSupabaseUrl(env);
      const serviceRoleKey = resolveServiceRoleKey(env);
      if (!supabaseUrl || !serviceRoleKey) {
        keyMemoryRebuild = {
          attempted: true,
          ok: false,
          reason: "service_role_not_configured",
          customer_id: String(customerId),
        };
        console.error("[key_policy_memory_rebuild]", keyMemoryRebuild);
      } else {
        const admin = createClient(supabaseUrl, serviceRoleKey, {
          auth: { persistSession: false, autoRefreshToken: false },
        });
        const rebuild = await rebuildCustomerMemoryFoundation({
          supabase: admin,
          supabaseUrl,
          serviceRoleKey,
          customerId: String(customerId),
          includeConversation: false,
        });
        const profileBody = rebuild?.profile_health_policy?.body ?? null;
        const insuranceKeys = Array.isArray(profileBody?.fact_keys)
          ? profileBody.fact_keys
              .map((key) => String(key ?? "").trim())
              .filter((key) => key.startsWith("insurance."))
              .slice(0, 24)
          : [];
        keyMemoryRebuild = {
          attempted: true,
          ok: rebuild?.ok === true,
          reason: "profile_health_policy_rebuild",
          customer_id: String(customerId),
          scope: "profile_health_policy",
          facts_changed: profileBody?.facts_changed ?? null,
          insurance_fact_keys: insuranceKeys,
          updated_policy_ids: Array.isArray(keyConfirmedPersist?.updated_policy_ids)
            ? keyConfirmedPersist.updated_policy_ids
            : [],
        };
        if (keyMemoryRebuild.ok !== true) {
          console.error("[key_policy_memory_rebuild]", keyMemoryRebuild);
        }
      }
    } catch (err) {
      keyMemoryRebuild = {
        attempted: true,
        ok: false,
        reason: err?.code ?? "memory_rebuild_failed",
        customer_id: String(customerId),
        error: String(err?.message ?? err).slice(0, 200),
        partial: err?.partial === true,
      };
      console.error("[key_policy_memory_rebuild]", keyMemoryRebuild);
    }
  }

  let keyBaselinePersist = { attempted: false, ok: false, stored: 0 };
  const baselineFactsToPersist = Array.isArray(claude.coverage_baseline_facts)
    ? claude.coverage_baseline_facts
    : [];
  if (!usedFailure && baselineFactsToPersist.length > 0 && userSupabase && customerId) {
    try {
      const ownedDocumentIds = [
        ...new Set(
          baselineFactsToPersist
            .map((f) => (f?.source_document_id != null ? String(f.source_document_id).trim() : ""))
            .filter(Boolean),
        ),
      ];
      keyBaselinePersist = await persistKeyCoverageBaselineFactsToPolicies({
        supabase: userSupabase,
        customerId,
        facts: baselineFactsToPersist,
        ownedDocumentIds,
      });
    } catch (err) {
      keyBaselinePersist = {
        attempted: true,
        ok: false,
        stored: 0,
        error: String(err?.message ?? err).slice(0, 200),
      };
      console.error("[key_coverage_baseline_facts_persist]", keyBaselinePersist);
    }
  }

  let claimCasePersist = { attempted: false, ok: false, stored: 0 };
  let claimIntakeSidecar = {
    attempted: false,
    ok: false,
    reason: "not_run",
    action: "skip",
    stored: 0,
  };
  let insuranceClockPersist = { attempted: false, ok: false, stored: 0 };
  let insuranceClockSidecar = {
    attempted: false,
    ok: false,
    reason: "not_run",
    action: "skip",
    stored: 0,
  };
  // Slice 1A — KEY post-answer claim intake (no tools / no second Claude).
  // Failures must never rewrite sealed customer answer.
  let claimCasesToPersist = Array.isArray(claude.claim_case_updates)
    ? claude.claim_case_updates
    : [];
  let claimIntakeBlockRan = false;
  if (!usedFailure && !isPresenceTurn && userSupabase && customerId) {
    claimIntakeBlockRan = true;
    try {
      const sidecar = await runKeyClaimIntakeSidecar({
        // Pass full card cases — sidecar scopes personal vs corporate itself.
        question,
        existingCases: activeClaimCasesAll,
        attachedDocumentId:
          String(pdf?.meta?.document_id ?? attachedDocumentId ?? "").trim() || null,
        attachedDocumentEntityId:
          String(pdf?.meta?.entity_id ?? pdf?.meta?.document_entity_id ?? "").trim() ||
          null,
        messageId: null,
        sessionId,
        customerId,
        supabase: userSupabase,
        entityId: claimSelectedEntityId,
        corporateClaimAllowed,
        persistImpl: persistKeyActiveClaimCases,
      });
      const sidecarRow =
        Array.isArray(sidecar?.updates) && sidecar.updates[0]
          ? sidecar.updates[0]
          : null;
      claimIntakeSidecar = {
        attempted: sidecar?.attempted === true,
        ok: sidecar?.ok === true,
        reason: sidecar?.reason ?? null,
        action: sidecar?.action ?? "skip",
        stored: Number(sidecar?.stored ?? 0) || 0,
        case_count: sidecar?.case_count ?? null,
        claim_case_key: sidecar?.claim_case_key ?? null,
        claim_scope: sidecar?.claim_scope ?? sidecarRow?.claim_scope ?? null,
        entity_id: sidecar?.entity_id ?? sidecarRow?.entity_id ?? null,
        authorization_denied: sidecar?.authorization_denied === true,
        error: sidecar?.error ?? null,
        // Slice 1B — prep/evidence marks for seats (no customer-answer rewrite).
        status: sidecarRow?.status ?? null,
        source: sidecarRow?.source ?? null,
        available_documents: Array.isArray(sidecarRow?.available_documents)
          ? sidecarRow.available_documents.slice(0, 24)
          : [],
        missing_documents: Array.isArray(sidecarRow?.missing_documents)
          ? sidecarRow.missing_documents.slice(0, 24)
          : [],
        next_action: sidecarRow?.next_action ?? null,
        source_document_ids: Array.isArray(sidecarRow?.source_document_ids)
          ? sidecarRow.source_document_ids.slice(0, 24)
          : [],
        evidence_document_ids: Array.isArray(sidecarRow?.evidence)
          ? sidecarRow.evidence
              .map((e) => {
                const m = /^document_id:(.+)$/.exec(String(e ?? ""));
                return m ? m[1] : null;
              })
              .filter(Boolean)
              .slice(0, 24)
          : [],
        insurer_verified: sidecarRow?.insurer_verified === true,
        denial_reason: sidecarRow?.denial_reason ?? null,
        payout_amount_text: sidecarRow?.payout_amount_text ?? null,
        submission_number: sidecarRow?.submission_number ?? null,
        submission_date_text: sidecarRow?.submission_date_text ?? null,
      };
      if (Array.isArray(sidecar?.updates) && sidecar.updates.length > 0) {
        claimCasesToPersist = sidecar.updates;
      }
      if (sidecar?.persist && typeof sidecar.persist === "object") {
        claimCasePersist = sidecar.persist;
      }
      if (sidecar?.ok === true) {
        try {
          invalidateReadyCardCacheForCustomer(customerId);
        } catch {
          /* non-blocking */
        }
      }
    } catch (err) {
      claimIntakeSidecar = {
        attempted: true,
        ok: false,
        reason: "sidecar_threw",
        action: "skip",
        stored: 0,
        error: String(err?.message ?? err).slice(0, 200),
      };
      console.error("[key_claim_intake_sidecar]", claimIntakeSidecar);
    }
  }

  // Insurance Clock Slice 1 + Policy Date Foundation — post-answer (no answer rewrite).
  if (!usedFailure && !isPresenceTurn && userSupabase && customerId) {
    try {
      const clockEntityId =
        claimTurnScope.claim_scope === "corporate" && claimTurnScope.entity_id
          ? claimTurnScope.entity_id
          : null;
      const clockMessageId = `clkmsg_${customerId.slice(0, 8)}_${Date.now().toString(36)}`;
      let clockBuilt = buildInsuranceClockUpdatesFromUtterance({
        question,
        existingCases: activeClaimCasesAll,
        existingClocks: insuranceClockItemsAll,
        customerId,
        entityId: clockEntityId,
        messageId: clockMessageId,
        now: startedAt instanceof Date ? startedAt : new Date(startedAt),
      });
      let policyDateFactTrace = null;
      const dateBuilt = buildPolicyDateFactsFromUtterance({
        question,
        customerId,
        entityId: clockEntityId,
        messageId: clockMessageId,
      });
      if (dateBuilt?.ok === true && Array.isArray(dateBuilt.updates) && dateBuilt.updates.length) {
        const datePersist = await persistPolicyDateFacts({
          supabase: userSupabase,
          customerId,
          factUpdates: dateBuilt.updates,
        });
        policyDateFactTrace = {
          ok: datePersist?.ok === true,
          stored: Number(datePersist?.stored ?? 0) || 0,
          fact_key: dateBuilt.updates[0]?.fact_key ?? null,
          date_value: dateBuilt.updates[0]?.date_value ?? null,
          source: dateBuilt.updates[0]?.source ?? null,
        };
        const clocksFromDates = buildInsuranceClocksFromPolicyDateFacts({
          facts: dateBuilt.updates,
          customerId,
        });
        if (clocksFromDates.length) {
          clockBuilt = {
            ok: true,
            reason: dateBuilt.reason,
            action: "create",
            updates: clocksFromDates,
          };
        }
      }
      insuranceClockSidecar = {
        attempted: true,
        ok: clockBuilt?.ok === true,
        reason: clockBuilt?.reason ?? null,
        action: clockBuilt?.action ?? "skip",
        stored: 0,
        clock_type: clockBuilt?.updates?.[0]?.clock_type ?? null,
        status: clockBuilt?.updates?.[0]?.status ?? null,
        due_at: clockBuilt?.updates?.[0]?.due_at ?? null,
        source: clockBuilt?.updates?.[0]?.source ?? null,
        ...(policyDateFactTrace ? { policy_date_fact: policyDateFactTrace } : {}),
      };
      if (clockBuilt?.ok === true && Array.isArray(clockBuilt.updates) && clockBuilt.updates.length) {
        insuranceClockPersist = await persistInsuranceClockItems({
          supabase: userSupabase,
          customerId,
          clockUpdates: clockBuilt.updates,
        });
        insuranceClockSidecar.stored = Number(insuranceClockPersist?.stored ?? 0) || 0;
        insuranceClockSidecar.persist_ok = insuranceClockPersist?.ok === true;
        if (insuranceClockPersist?.ok === true) {
          try {
            invalidateReadyCardCacheForCustomer(customerId);
          } catch {
            /* non-blocking */
          }
        }
      }
    } catch (err) {
      insuranceClockSidecar = {
        attempted: true,
        ok: false,
        reason: "sidecar_threw",
        action: "skip",
        stored: 0,
        error: String(err?.message ?? err).slice(0, 200),
      };
      console.error("[key_insurance_clock_sidecar]", insuranceClockSidecar);
    }
  }

  // Evidence Vault Slice 1 — post-answer (no answer rewrite; no Claim status invent).
  let claimEvidenceSidecar = {
    attempted: false,
    ok: false,
    reason: null,
    action: "skip",
    stored: 0,
  };
  let claimEvidencePersist = null;
  if (!usedFailure && !isPresenceTurn && userSupabase && customerId) {
    try {
      const evEntityId =
        claimTurnScope.claim_scope === "corporate" && claimTurnScope.entity_id
          ? claimTurnScope.entity_id
          : null;
      const evMessageId = `evmsg_${customerId.slice(0, 8)}_${Date.now().toString(36)}`;
      const casesForEv = Array.isArray(claimCasesToPersist) && claimCasesToPersist.length
        ? claimCasesToPersist
        : activeClaimCasesAll;
      const syncUpdates = syncClaimEvidenceFromCases({
        cases: casesForEv,
        documents: activeDocumentsForHistory,
        existingEvidence: claimEvidenceItemsAll,
        customerId,
        now: startedAt instanceof Date ? startedAt : new Date(startedAt),
      });
      // Contract Package — post-answer capture from explicit doc labels only (no OCR promote).
      const contractUpdates = buildContractPackageEvidenceFromDocs({
        documents: activeDocumentsForHistory,
        existingEvidence: [...claimEvidenceItemsAll, ...syncUpdates],
        customerId,
        entityId: evEntityId,
        now: startedAt instanceof Date ? startedAt : new Date(startedAt),
      });
      const uttered = buildClaimEvidenceUpdatesFromUtterance({
        question,
        existingCases: casesForEv,
        existingEvidence: [
          ...claimEvidenceItemsAll,
          ...syncUpdates,
          ...contractUpdates,
        ],
        customerId,
        entityId: evEntityId,
        messageId: evMessageId,
        now: startedAt instanceof Date ? startedAt : new Date(startedAt),
      });
      const updates = [
        ...syncUpdates,
        ...contractUpdates,
        ...(uttered?.ok === true && Array.isArray(uttered.updates) ? uttered.updates : []),
      ];
      claimEvidenceSidecar = {
        attempted: true,
        ok: updates.length > 0,
        reason:
          updates.length > 0
            ? uttered?.ok === true
              ? uttered.reason
              : "synced_from_claim_documents"
            : uttered?.reason || "no_evidence_updates",
        action: updates.length > 0 ? "create" : "skip",
        stored: 0,
        evidence_type: updates[0]?.evidence_type ?? null,
        verification_status: updates[0]?.verification_status ?? null,
      };
      if (updates.length) {
        claimEvidencePersist = await persistClaimEvidenceItems({
          supabase: userSupabase,
          customerId,
          evidenceUpdates: updates,
        });
        claimEvidenceSidecar.stored = Number(claimEvidencePersist?.stored ?? 0) || 0;
        claimEvidenceSidecar.persist_ok = claimEvidencePersist?.ok === true;
        if (claimEvidencePersist?.ok === true) {
          try {
            invalidateReadyCardCacheForCustomer(customerId);
          } catch {
            /* non-blocking */
          }
        }
      }
    } catch (err) {
      claimEvidenceSidecar = {
        attempted: true,
        ok: false,
        reason: "sidecar_threw",
        action: "skip",
        stored: 0,
        error: String(err?.message ?? err).slice(0, 200),
      };
      console.error("[key_claim_evidence_sidecar]", claimEvidenceSidecar);
    }
  }

  // Life Ledger Slice 1 — post-answer soft memory (no answer rewrite / no Claude control).
  let lifeLedgerSidecar = {
    attempted: false,
    ok: false,
    reason: null,
    action: "skip",
    stored: 0,
  };
  let lifeLedgerPersist = null;
  if (!usedFailure && !isPresenceTurn && userSupabase && customerId) {
    try {
      const llEntityId =
        claimTurnScope.claim_scope === "corporate" && claimTurnScope.entity_id
          ? claimTurnScope.entity_id
          : null;
      const llMessageId = `llmsg_${customerId.slice(0, 8)}_${Date.now().toString(36)}`;
      const casesForLl = Array.isArray(claimCasesToPersist) && claimCasesToPersist.length
        ? claimCasesToPersist
        : activeClaimCasesAll;
      const outcomeUpdates = syncLifeLedgerOutcomesFromClaims({
        cases: casesForLl,
        existingLedger: lifeLedgerItemsAll,
        customerId,
        now: startedAt instanceof Date ? startedAt : new Date(startedAt),
      });
      const uttered = buildLifeLedgerUpdatesFromUtterance({
        question,
        existingLedger: [...lifeLedgerItemsAll, ...outcomeUpdates],
        customerId,
        entityId: llEntityId,
        messageId: llMessageId,
        now: startedAt instanceof Date ? startedAt : new Date(startedAt),
      });
      const updates = [
        ...outcomeUpdates,
        ...(uttered?.ok === true && Array.isArray(uttered.updates) ? uttered.updates : []),
      ];
      lifeLedgerSidecar = {
        attempted: true,
        ok: updates.length > 0,
        reason:
          updates.length > 0
            ? uttered?.ok === true
              ? uttered.reason
              : "synced_claim_outcomes"
            : uttered?.reason || "no_ledger_updates",
        action: updates.length > 0 ? "create" : "skip",
        stored: 0,
        ledger_type: updates[0]?.type ?? null,
        source: updates[0]?.source ?? null,
      };
      if (updates.length) {
        lifeLedgerPersist = await persistLifeLedgerItems({
          supabase: userSupabase,
          customerId,
          ledgerUpdates: updates,
        });
        lifeLedgerSidecar.stored = Number(lifeLedgerPersist?.stored ?? 0) || 0;
        lifeLedgerSidecar.persist_ok = lifeLedgerPersist?.ok === true;
        if (lifeLedgerPersist?.ok === true) {
          try {
            invalidateReadyCardCacheForCustomer(customerId);
          } catch {
            /* non-blocking */
          }
        }
      }
    } catch (err) {
      lifeLedgerSidecar = {
        attempted: true,
        ok: false,
        reason: "sidecar_threw",
        action: "skip",
        stored: 0,
        error: String(err?.message ?? err).slice(0, 200),
      };
      console.error("[key_life_ledger_sidecar]", lifeLedgerSidecar);
    }
  }

  if (
    !usedFailure &&
    claimCasesToPersist.length > 0 &&
    userSupabase &&
    customerId &&
    !claimIntakeBlockRan
  ) {
    // Legacy empty tool path only — keep fail-closed persist helper available.
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

  // If nothing was streamed (e.g. empty path), emit once.
  if (streamHandlers?.onDelta && !streamHandlers._emitted) {
    streamHandlers.onDelta(sealed.key_speak_original);
    streamHandlers._emitted = true;
    sseEmittedText = String(sealed.key_speak_original ?? "");
    streamHandlers.onFirstToken?.(firstTokenMs ?? claude.ttft_ms ?? relMs(startedAt));
  }

  triangleT0.persist_complete_ms = relMs(startedAt);
  triangleT0.streamed_equals_sealed =
    String(sseEmittedText ?? "") === String(sealed.key_speak_original ?? "");

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
        key_coverage_baseline_facts: baselineFactsToPersist,
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
      decision: null,
      session_goal: persistableSessionGoal,
      decision_persisted: false,
      key_consultation_record: keyConsultationRecord,
      prior_consultation_reason: priorConsultationReason,
      key_compose_trace: {
        compose_mode: "key_claude_first_direct",
        key_voice_trace: {
          provider: "claude_first_direct",
          used_failure_mode: usedFailure,
          fallback_reason: failureReason,
          focused_correction_count: 0,
          hard_safety_repair_attempt: 0,
          s6_speak_calls: 0,
          provider_calls: usedFailure ? 0 : 1,
          tools: 0,
          corporate_hand: corporateHandSeatAudit,
          corporate_claim_hand: corporateClaimHandSeatAudit,
          soft_reasons_ignored: safety.soft,
          hard_reasons: safety.hard,
          replacing_hard_reasons: replacingHard,
          normal_answer_post_replace: false,
          key_consultation_record: keyConsultationRecord,
          prior_consultation_injected: Boolean(priorConsultationForContext),
          prior_consultation_reason: priorConsultationReason,
          life_threads_injected_count: Array.isArray(
            priorConsultationForContext?.life_threads,
          )
            ? priorConsultationForContext.life_threads.length
            : 0,
          life_threads_brief: formatLifeThreadsForReadyCard(
            Array.isArray(priorConsultationForContext?.life_threads)
              ? priorConsultationForContext.life_threads
              : [],
            { limit: 6, activeOnly: true, customerId },
          ),
          life_threads_attach_reason: readyResolved?.life_threads_attach_reason ?? null,
          ready_card_source: readyCardSource,
          source_link: sourceLink,
          session_goal_writer: customerUtteranceGoal
            ? "customer_utterance"
            : persistableSessionGoal?.status === "completed"
              ? "discard"
              : null,
          jailbreak_detail: safety.jailbreak_detail,
          answer_source: claude.answer_source ?? null,
          decision_persisted: false,
          session_goal_tool_seen: claude.session_goal_tool_seen === true,
          session_goal_rejected: claude.session_goal_rejected === true,
          session_goal_reject_reason: claude.session_goal_reject_reason ?? null,
          session_goal_injected: claude.session_goal_injected === true,
          session_goal_ssot_reason: ssotReason,
          session_goal_discard_requested: discardRequested === true,
          session_goal_status: persistableSessionGoal?.status ?? null,
          recommendation_basis_tool_seen: claude.recommendation_basis_tool_seen === true,
          recommendation_basis_count: Number(claude.recommendation_basis_count ?? 0) || 0,
          recommendation_basis_rejected_count:
            Number(claude.recommendation_basis_rejected_count ?? 0) || 0,
          recommendation_basis_reject_reasons: Array.isArray(
            claude.recommendation_basis_reject_reasons,
          )
            ? claude.recommendation_basis_reject_reasons
            : [],
          recommendation_basis_ok: claude.recommendation_basis_ok !== false,
          pdf_attached: claude.pdf_attached === true,
          attach_signals: pdf?.meta?.attach_signals ?? null,
          web_search: claude.web_search_trace ?? emptyWebSearchTrace(),
          public_evidence: Array.isArray(claude.public_evidence) ? claude.public_evidence : [],
          empty_answer_diag: claude.empty_answer_diag ?? null,
          confirmed_source_facts_count: factsToPersist.length,
          key_confirmed_fact_gate: keyConfirmedFactGate,
          key_confirmed_persist: keyConfirmedPersist,
          key_coverage_baseline_persist: keyBaselinePersist,
          key_verified_literal_conflict: keyVerifiedLiteralConflict,
          key_memory_rebuild: keyMemoryRebuild,
          active_claim_cases_hydrated: activeClaimCases.length,
          claim_case_updates_count: claimCasesToPersist.length,
          key_claim_case_persist: claimCasePersist,
          key_claim_intake_sidecar: claimIntakeSidecar,
          insurance_clock_hydrated: insuranceClockItemsScoped.length,
          insurance_clock_brief: {
            upcoming: insuranceClockBrief?.upcoming?.length ?? 0,
            overdue: insuranceClockBrief?.overdue?.length ?? 0,
            unknown_date: insuranceClockBrief?.unknown_date?.length ?? 0,
            completed_recent: insuranceClockBrief?.completed_recent?.length ?? 0,
          },
          key_insurance_clock_sidecar: insuranceClockSidecar,
          key_insurance_clock_persist: insuranceClockPersist,
          claim_evidence_hydrated: claimEvidenceItemsScoped.length,
          claim_evidence_brief: {
            package_count: claimEvidenceBrief?.packages?.length ?? 0,
            item_count: claimEvidenceBrief?.item_count ?? 0,
          },
          key_claim_evidence_sidecar: claimEvidenceSidecar,
          key_claim_evidence_persist: claimEvidencePersist,
          life_ledger_hydrated: lifeLedgerItemsScoped.length,
          life_ledger_brief: {
            goals: lifeLedgerBrief?.goals?.length ?? 0,
            decisions: lifeLedgerBrief?.decisions?.length ?? 0,
            open_questions: lifeLedgerBrief?.open_questions?.length ?? 0,
            outcomes: lifeLedgerBrief?.outcomes?.length ?? 0,
          },
          key_life_ledger_sidecar: lifeLedgerSidecar,
          key_life_ledger_persist: lifeLedgerPersist,
          sealed_matches_claude:
            !usedFailure &&
            String(sealed.key_speak_original ?? "") === String(claude.customer_answer ?? ""),
          streamed_equals_sealed:
            String(sseEmittedText ?? "") === String(sealed.key_speak_original ?? ""),
          sentence_commit: {
            mode: "immediate_delta_t4",
            aborted: sentenceStreamAborted,
            abort_reason: sentenceAbortReason,
            committed_len: String(commitStream.getCommitted() ?? "").length,
            already_committed: alreadyCommitted,
            catch_up_appended: commitStream.didCatchUpAppend?.() === true,
            catch_up_reason: sentenceCatchUp?.reason ?? null,
          },
          latency_marks: buildPersistableLatencyMarks({
            claude_full_emit: emitMark,
            ttft_ms: firstTokenMs ?? claude.ttft_ms ?? null,
            triangle_t0: triangleT0,
            ...resolveDeployIdentity(env),
          }),
          pdf_attach_mode: triangleT0.pdf_attach_mode,
          document_review_scope: pdfMetaForClaude?.document_review_scope ?? null,
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
            ready_card_status: readyCardStatus,
            ready_card_ms: readyCardMs,
            ready_card_source: readyCardSource,
            ready_card_hit: readyCardHit,
            token_validation_ms: tokenValidationMs,
            token_reject_reason: tokenRejectReason,
            ready_card_materials_connected: readyCard?.materials_connected === true,
            corporate_hand: corporateHandSeatAudit,
            corporate_claim_hand: corporateClaimHandSeatAudit,
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
            corporate_hand: corporateHandSeatAudit,
            corporate_claim_hand: corporateClaimHandSeatAudit,
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
          step: "key_verified_literal_conflict",
          at_ms: relMs(startedAt),
          payload: keyVerifiedLiteralConflict,
        },
        {
          step: "key_confirmed_fact_gate",
          at_ms: relMs(startedAt),
          payload: keyConfirmedFactGate,
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
        {
          step: "key_insurance_clock_persist",
          at_ms: relMs(startedAt),
          payload: insuranceClockPersist,
        },
        {
          step: "key_claim_evidence_persist",
          at_ms: relMs(startedAt),
          payload: claimEvidencePersist,
        },
        {
          step: "key_life_ledger_persist",
          at_ms: relMs(startedAt),
          payload: lifeLedgerPersist,
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
