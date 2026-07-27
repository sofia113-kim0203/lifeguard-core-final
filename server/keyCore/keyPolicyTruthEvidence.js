/**
 * All-customer policy truth evidence — vault scope, ledger count authority, turn meta.
 * Canonical confirmed_contracts is sole confirmed count/list authority.
 */

import {
  isPolicyCountOrLedgerQuestion,
  isInsuranceVaultDocumentBoxRecheckQuestion,
  wantsOwnedInsuranceVaultEvidence,
} from "../../src/lib/chatActiveAttachment.js";
import {
  buildMyInsuranceStatus,
  projectCanonicalContracts,
} from "../../src/lib/keyInsuranceScreenFacts.js";

export {
  isPolicyCountOrLedgerQuestion,
  isInsuranceVaultDocumentBoxRecheckQuestion,
  wantsOwnedInsuranceVaultEvidence,
  projectCanonicalContracts,
};

/**
 * Soft customer_reported count from utterance — never SSOT overwrite by itself.
 * Returns integer or null.
 */
export function extractCustomerReportedPolicyCount(question = "") {
  const q = String(question ?? "").replace(/\s+/g, " ").trim();
  if (!q) return null;
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

/** Active distinct = confirmed_contracts.length (strong identity only). */
export function countActiveDistinctPolicies(policies = [], opts = {}) {
  const projection = projectCanonicalContracts(policies, opts);
  return {
    active_distinct_count: projection.active_distinct_count,
    confirmed_count: projection.active_distinct_count,
    needs_count: projection.review_candidate_count,
    review_candidate_count: projection.review_candidate_count,
    raw_source_row_count: projection.raw_source_row_count,
  };
}

function mapContractRow(p, index) {
  const summary =
    p?.coverage_summary && typeof p.coverage_summary === "object"
      ? p.coverage_summary
      : {};
  return {
    index: index + 1,
    insurer: String(p.insurer_name ?? "").trim() || null,
    product_name: String(p.product_name ?? "").trim() || null,
    monthly_premium:
      p.monthly_premium != null && Number.isFinite(Number(p.monthly_premium))
        ? Number(p.monthly_premium)
        : null,
    source_document_id:
      summary.source_document_id != null
        ? String(summary.source_document_id)
        : p.source_document_id != null
          ? String(p.source_document_id)
          : null,
    source_content_sha256:
      summary.source_content_sha256 != null
        ? String(summary.source_content_sha256)
        : p.source_content_sha256 != null
          ? String(p.source_content_sha256)
          : null,
    contract_identity_key: p.contract_identity_key ?? null,
    source_fact_key: p.source_fact_key ?? null,
    verification_status:
      summary.verification_status ??
      summary.key_verification_status ??
      (p.source === "signup" ? "customer_reported" : null),
    policy_number:
      summary.policy_number != null
        ? String(summary.policy_number)
        : p.policy_number != null
          ? String(p.policy_number)
          : null,
  };
}

/**
 * Compact ledger brief for Claude — confirmed list only (not raw rows).
 */
export function buildVerifiedPolicyLedgerBrief(policies = [], opts = {}) {
  const projection = projectCanonicalContracts(policies, opts);
  const includeList = opts.includeList !== false;
  const confirmedList = includeList
    ? projection.confirmed_contracts.map((p, index) => mapContractRow(p, index))
    : [];
  const reviewList = includeList
    ? projection.review_candidates
        .slice(0, 40)
        .map((p, index) => ({
          ...mapContractRow(p, index),
          review_reason: p.review_reason ?? "weak_identity",
        }))
    : [];

  return {
    authority: "verified_policy_ledger",
    note:
      "Confirmed contracts use strong identity only. raw_source_row_count is diagnostic — never customer contract count.",
    active_distinct_count: projection.active_distinct_count,
    confirmed_count: projection.active_distinct_count,
    review_candidate_count: projection.review_candidate_count,
    raw_source_row_count: projection.raw_source_row_count,
    confirmed_contracts: confirmedList,
    // Compat: contracts === confirmed_contracts
    contracts: confirmedList,
    review_candidates: reviewList,
    needs_count: projection.review_candidate_count,
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
  if (vaultRecall?.mode === "partial_attach") {
    excluded_reasons.push(String(vaultRecall.reason ?? "partial_attach"));
  }
  if (vaultRecall?.mode === "empty") excluded_reasons.push("vault_empty");
  if (vaultRecall?.mode === "unavailable") {
    excluded_reasons.push(String(vaultRecall.reason ?? "unavailable"));
  }
  for (const row of failed) {
    if (row?.reason) excluded_reasons.push(String(row.reason).slice(0, 64));
  }
  const excluded = Array.isArray(vaultRecall?.excluded) ? vaultRecall.excluded : [];
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
    excluded_document_count: excluded.length,
    excluded_reasons: [...new Set(excluded_reasons)].slice(0, 16),
    image_or_document_block_count: attached_document_ids.length,
    vault_mode: vaultRecall?.mode ?? null,
    vault_reason: vaultRecall?.reason ? String(vaultRecall.reason).slice(0, 80) : null,
    partial_originals:
      attached_document_ids.length > 0 &&
      (failed_document_ids.length > 0 ||
        vaultRecall?.mode === "partial_attach" ||
        vaultRecall?.mode === "choose" ||
        (listing.length > 0 && attached_document_ids.length < listing.length)),
  };
}

/**
 * System addendum for count/list questions — confirmed_n authority; raw rows never count.
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
  const reviewN =
    ledgerBrief && Number.isFinite(Number(ledgerBrief.review_candidate_count))
      ? Number(ledgerBrief.review_candidate_count)
      : null;
  const rawN =
    ledgerBrief && Number.isFinite(Number(ledgerBrief.raw_source_row_count))
      ? Number(ledgerBrief.raw_source_row_count)
      : null;
  const attached = Number(evidenceMeta?.attached_document_count ?? 0) || 0;
  const partial = evidenceMeta?.partial_originals === true;
  const lines = [
    "계약 건수·가입 건수·보험 목록 질문에서는 VERIFIED_POLICY_LEDGER.active_distinct_count(= confirmed_contracts.length)만 확정 숫자 근거다.",
    "원행(raw_source_row_count)·보험사+상품+보험료 그룹 수는 확정 계약 수가 아니다. 고객에게 원행 수를 건수로 말하지 않는다.",
    "이전 KEY/Claude 답변에 나온 건수는 대화 맥락일 뿐 현재 확정 근거로 쓰지 않는다.",
    "고객이 말한 건수는 CUSTOMER_REPORTED_FACTS로만 존중하고, 원본·장부 검증 없이 SSOT나 확정 건수를 덮어쓰지 않는다.",
  ];
  if (n != null) {
    lines.push(
      `현재 KEY 확정 계약 수(confirmed_n / active_distinct_count): ${n}건. 확정 답변의 숫자는 이 값을 쓴다.`,
    );
  }
  if (reviewN != null && reviewN > 0) {
    lines.push(
      `확인이 필요한 후보(review_candidate_count): ${reviewN}건. 확정 건수와 분리해 말한다.`,
    );
  }
  if (rawN != null && n != null && rawN !== n) {
    lines.push(
      `내부 진단용 raw_source_row_count=${rawN} — 고객 답변·확정 건수에 쓰지 않는다.`,
    );
  }
  if (n === 0 && (reviewN > 0 || (rawN != null && rawN > 0))) {
    lines.push(
      "확정 identity가 부족하면 그룹 수나 원행 수를 확정 계약 수로 말하지 말고, 확인 필요·원본 확인을 안내한다.",
    );
  }
  if (partial || (attached > 0 && evidenceMeta?.failed_document_ids?.length)) {
    lines.push(
      "관련 원본 일부가 연결되지 않았거나 일부만 첨부됐다. 전체 건수로 단정하지 말고 범위를 구분해 말한다.",
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
      "Do not mix CURRENT_ORIGINALS, VERIFIED_POLICY_LEDGER, CUSTOMER_REPORTED_FACTS, prior KEY answers, inference, and unknown. confirmed_contracts only for confirmed counts; review_candidates are not confirmed.",
  };
}

// Re-export screen status for consumers that import from this module historically.
export { buildMyInsuranceStatus };
