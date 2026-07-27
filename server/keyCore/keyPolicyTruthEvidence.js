/**
 * All-customer policy truth evidence — vault scope, ledger count authority, turn meta.
 * No customer-specific counts or filenames hardcoded.
 */

import {
  isPolicyCountOrLedgerQuestion,
  isInsuranceVaultDocumentBoxRecheckQuestion,
  wantsOwnedInsuranceVaultEvidence,
} from "../../src/lib/chatActiveAttachment.js";
import { buildMyInsuranceStatus } from "../../src/lib/keyInsuranceScreenFacts.js";

export {
  isPolicyCountOrLedgerQuestion,
  isInsuranceVaultDocumentBoxRecheckQuestion,
  wantsOwnedInsuranceVaultEvidence,
};

/**
 * Soft customer_reported count from utterance — never SSOT overwrite by itself.
 * Returns integer or null.
 */
export function extractCustomerReportedPolicyCount(question = "") {
  const q = String(question ?? "").replace(/\s+/g, " ").trim();
  if (!q) return null;
  // "나는 12건이야", "파일상으로 12건", "12건이잖아"
  const m =
    q.match(
      /(?:나는|난|저(?:는)?|파일\s*상(?:으로)?|실제(?:로는)?)\s*(\d{1,3})\s*건/,
    ) ||
    q.match(/(\d{1,3})\s*건\s*(?:이잖아|이야|임|맞지|아니야)/);
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isFinite(n) || n < 0 || n > 500) return null;
  return n;
}

/** Active distinct ledger count from policy rows (same helper as left rail). */
export function countActiveDistinctPolicies(policies = []) {
  const status = buildMyInsuranceStatus(policies);
  return {
    active_distinct_count: Number(status?.totalCount ?? 0) || 0,
    confirmed_count: Number(status?.confirmedCount ?? 0) || 0,
    needs_count: Number(status?.needsCount ?? 0) || 0,
  };
}

/**
 * Compact ledger brief for Claude — source-separated, no invented totals.
 */
export function buildVerifiedPolicyLedgerBrief(policies = [], opts = {}) {
  const rows = Array.isArray(policies) ? policies : [];
  const counts = countActiveDistinctPolicies(rows);
  const list = (opts.includeList === false
    ? []
    : rows
        .filter((p) => p && p.is_active !== false && !p.deleted_at)
        .slice(0, 40)
        .map((p, index) => ({
          index: index + 1,
          insurer: String(p.insurer_name ?? "").trim() || null,
          product_name: String(p.product_name ?? "").trim() || null,
          monthly_premium:
            p.monthly_premium != null && Number.isFinite(Number(p.monthly_premium))
              ? Number(p.monthly_premium)
              : null,
          source_document_id:
            p.coverage_summary?.source_document_id != null
              ? String(p.coverage_summary.source_document_id)
              : null,
          verification_status:
            p.coverage_summary?.verification_status ??
            p.coverage_summary?.key_verification_status ??
            (p.source === "signup" ? "customer_reported" : null),
          policy_number:
            p.coverage_summary?.policy_number != null
              ? String(p.coverage_summary.policy_number)
              : null,
        }))
  );
  return {
    authority: "verified_policy_ledger",
    note:
      "Active distinct contract rows on KEY SSOT. This count — not prior chat numbers — is the confirmed count source.",
    ...counts,
    contracts: list,
  };
}

/**
 * PII-safe turn evidence package for seat/audit (no filenames/body text).
 */
export function buildTurnEvidencePackageMeta({
  evidence_scope = null,
  vaultRecall = null,
  attachments = null,
  candidate_document_count = null,
} = {}) {
  const attachRows = Array.isArray(attachments)
    ? attachments
    : Array.isArray(vaultRecall?.attachments)
      ? vaultRecall.attachments
      : [];
  const failed = Array.isArray(vaultRecall?.failed) ? vaultRecall.failed : [];
  const listing = Array.isArray(vaultRecall?.listing) ? vaultRecall.listing : [];
  const attached_document_ids = attachRows
    .map((r) => String(r.document_id ?? r.id ?? "").trim())
    .filter(Boolean)
    .slice(0, 24);
  const attached_sha256 = attachRows
    .map((r) => String(r.content_sha256 ?? r.sha256 ?? "").trim().toLowerCase())
    .filter(Boolean)
    .slice(0, 24);
  const failed_document_ids = failed
    .map((r) => String(r.document_id ?? "").trim())
    .filter(Boolean)
    .slice(0, 24);
  const excluded_reasons = [];
  if (vaultRecall?.mode === "choose") {
    excluded_reasons.push(String(vaultRecall.reason ?? "choose_required"));
  }
  if (vaultRecall?.mode === "empty") excluded_reasons.push("vault_empty");
  if (vaultRecall?.mode === "unavailable") {
    excluded_reasons.push(String(vaultRecall.reason ?? "unavailable"));
  }
  for (const row of failed) {
    if (row?.reason) excluded_reasons.push(String(row.reason).slice(0, 64));
  }
  return {
    evidence_scope: evidence_scope || "none",
    candidate_document_count:
      candidate_document_count != null
        ? Number(candidate_document_count) || 0
        : listing.length || 0,
    attached_document_count: attached_document_ids.length,
    attached_document_ids,
    attached_sha256,
    failed_document_ids,
    excluded_reasons: [...new Set(excluded_reasons)].slice(0, 16),
    image_or_document_block_count: attached_document_ids.length,
    vault_mode: vaultRecall?.mode ?? null,
    vault_reason: vaultRecall?.reason ? String(vaultRecall.reason).slice(0, 80) : null,
    partial_originals:
      attached_document_ids.length > 0 &&
      (failed_document_ids.length > 0 ||
        vaultRecall?.mode === "choose" ||
        (listing.length > 0 && attached_document_ids.length < listing.length)),
  };
}

/**
 * System addendum for count/list questions — ledger authority, history blocked.
 */
export function buildPolicyCountAuthorityAddendum({
  ledgerBrief = null,
  evidenceMeta = null,
  customerReportedCount = null,
} = {}) {
  const n =
    ledgerBrief && Number.isFinite(Number(ledgerBrief.active_distinct_count))
      ? Number(ledgerBrief.active_distinct_count)
      : null;
  const attached = Number(evidenceMeta?.attached_document_count ?? 0) || 0;
  const partial = evidenceMeta?.partial_originals === true;
  const lines = [
    "계약 건수·가입 건수·보험 목록 질문에서는 VERIFIED_POLICY_LEDGER.active_distinct_count만 확정 숫자 근거다.",
    "이전 KEY/Claude 답변에 나온 건수(예: 과거 대화의 N건)는 대화 맥락일 뿐 현재 확정 근거로 쓰지 않는다.",
    "고객이 말한 건수는 CUSTOMER_REPORTED_FACTS로만 존중하고, 원본·장부 검증 없이 SSOT나 확정 건수를 덮어쓰지 않는다.",
  ];
  if (n != null) {
    lines.push(
      `현재 KEY 계약 장부의 활성 distinct 계약 수: ${n}건. 확정 답변의 숫자는 이 값을 쓴다.`,
    );
  }
  if (partial || (attached > 0 && evidenceMeta?.failed_document_ids?.length)) {
    lines.push(
      "관련 원본 일부가 연결되지 않았거나 다운로드 실패했다. 전체 건수로 단정하지 말고, 현재 연결된 원본·장부 범위와 확인 불가를 구분해 말한다.",
    );
  }
  if (customerReportedCount != null) {
    lines.push(
      `고객이 이번 발화에서 언급한 건수(customer_reported): ${customerReportedCount}건 — 정정으로 존중하되 장부 확정값으로 승격하지 않는다.`,
    );
  }
  return lines.join("\n");
}

/**
 * Source-separation block for Claude user payload current_context.
 */
export function buildSourceSeparatedTruthContext({
  ledgerBrief = null,
  customerReportedCount = null,
  evidenceMeta = null,
  countQuestion = false,
} = {}) {
  return {
    VERIFIED_POLICY_LEDGER: ledgerBrief,
    CUSTOMER_REPORTED_FACTS:
      customerReportedCount != null
        ? {
            policy_count: customerReportedCount,
            verification_status: "customer_reported",
            note: "Customer utterance only — not SSOT overwrite.",
          }
        : null,
    EVIDENCE_PACKAGE: evidenceMeta,
    COUNT_QUESTION: countQuestion === true,
    HISTORY_COUNTS_NOT_AUTHORITY: true,
    SOURCE_SEPARATION_RULE:
      "Do not mix CURRENT_ORIGINALS, VERIFIED_POLICY_LEDGER, CUSTOMER_REPORTED_FACTS, prior KEY answers, inference, and unknown.",
  };
}
