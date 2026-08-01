/**
 * All-customer policy truth evidence — vault scope, ledger count authority, turn meta.
 * Canonical confirmed_contracts is sole confirmed count/list authority.
 */

import {
  isPolicyCountOrLedgerQuestion,
  isInsuranceVaultDocumentBoxRecheckQuestion,
  isMultiDocumentVaultRecallQuestion,
  wantsOwnedInsuranceVaultEvidence,
  shouldRunOwnedVaultRecall,
  shouldProvideOwnedInsuranceVaultOriginals,
} from "../../src/lib/chatActiveAttachment.js";
import {
  buildMyInsuranceStatus,
  projectCanonicalContracts,
} from "../../src/lib/keyInsuranceScreenFacts.js";

export {
  isPolicyCountOrLedgerQuestion,
  isInsuranceVaultDocumentBoxRecheckQuestion,
  isMultiDocumentVaultRecallQuestion,
  wantsOwnedInsuranceVaultEvidence,
  shouldRunOwnedVaultRecall,
  shouldProvideOwnedInsuranceVaultOriginals,
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
    needs_count: projection.personal_review_candidate_count,
    review_candidate_count: projection.personal_review_candidate_count,
    personal_review_candidate_count: projection.personal_review_candidate_count,
    foreign_rows_excluded: projection.foreign_rows_excluded,
    raw_source_row_count: projection.raw_source_row_count,
  };
}

function mapVerifiedDocumentCoverages(p = null) {
  const summary =
    p?.coverage_summary && typeof p.coverage_summary === "object"
      ? p.coverage_summary
      : {};
  const facts = Array.isArray(summary.key_coverage_baseline_facts)
    ? summary.key_coverage_baseline_facts
    : [];
  const out = [];
  for (const fact of facts) {
    if (!fact || typeof fact !== "object") continue;
    if (String(fact.status ?? "").toLowerCase() !== "verified") continue;
    const coverage_name =
      String(fact.original_coverage_name ?? fact.coverage_name ?? "").trim() || null;
    const coverage_amount =
      fact.coverage_amount != null && fact.coverage_amount !== ""
        ? fact.coverage_amount
        : null;
    if (!coverage_name && coverage_amount == null) continue;
    out.push({
      coverage_name,
      coverage_amount,
      status: "verified",
      source_document_id:
        fact.source_document_id != null
          ? String(fact.source_document_id)
          : summary.source_document_id != null
            ? String(summary.source_document_id)
            : null,
    });
  }
  return out;
}

function mapContractRow(p, index) {
  const summary =
    p?.coverage_summary && typeof p.coverage_summary === "object"
      ? p.coverage_summary
      : {};
  const coverages = mapVerifiedDocumentCoverages(p);
  const contractIdRaw = p?.id ?? p?.policy_id ?? p?.contract_id ?? null;
  const contract_id =
    contractIdRaw != null && String(contractIdRaw).trim()
      ? String(contractIdRaw).trim()
      : null;
  return {
    index: index + 1,
    contract_id,
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
    // Internal/full ledger may carry coverages; Claude C projection strips them.
    coverages,
  };
}

/**
 * Claude C projection only — confirmed contract skeleton authority.
 * Keeps one confirmed_contracts list (coverage bodies stripped).
 * Drops review/alias contract arrays — those details live on Block B chart.
 * Does not mutate the source ledger brief.
 */
export function projectClaudeVerifiedPolicyLedgerBrief(ledgerBrief = null) {
  if (!ledgerBrief || typeof ledgerBrief !== "object") {
    return ledgerBrief ?? null;
  }
  const stripRow = (row) => {
    if (!row || typeof row !== "object" || Array.isArray(row)) return row;
    const out = { ...row };
    delete out.coverages;
    return out;
  };
  const out = { ...ledgerBrief };
  if (Array.isArray(ledgerBrief.confirmed_contracts)) {
    out.confirmed_contracts = ledgerBrief.confirmed_contracts.map(stripRow);
  }
  for (const key of [
    "personal_confirmed_contracts",
    "contracts",
    "review_candidates",
    "personal_review_candidates",
    "verified_document_coverages",
  ]) {
    if (Object.prototype.hasOwnProperty.call(out, key)) {
      delete out[key];
    }
  }
  out.note =
    "Confirmed contracts use strong identity only. active_distinct_count / confirmed_count are the only confirmed contract-count hard slots. review_candidate_count and personal_review_candidate_count are counts only — never customer confirmed totals. Review-candidate contract/coverage detail authority is Block B chart (review_candidates + verified_document_coverages), not this ledger. Do not invent, restore, copy, or summarize review rows here. Coverage bodies are omitted from confirmed_contracts.";
  return out;
}

/**
 * Compact ledger brief for Claude — confirmed list only (not raw rows).
 */
export function buildVerifiedPolicyLedgerBrief(policies = [], opts = {}) {
  const projection = projectCanonicalContracts(policies, opts);
  const includeList = opts.includeList !== false;
  const confirmedList = includeList
    ? projection.personal_confirmed_contracts.map((p, index) => mapContractRow(p, index))
    : [];
  // Claude / customer personal review only — foreign stays in projection.review_candidates (audit).
  const reviewList = includeList
    ? projection.personal_review_candidates
        .slice(0, 40)
        .map((p, index) => ({
          ...mapContractRow(p, index),
          review_reason: p.review_reason ?? "weak_identity",
        }))
    : [];

  const verified_document_coverages = [];
  const seen = new Set();
  for (const row of [...confirmedList, ...reviewList]) {
    for (const cov of row.coverages ?? []) {
      const key = `${row.product_name || ""}::${cov.coverage_name || ""}::${cov.coverage_amount ?? ""}`;
      if (seen.has(key)) continue;
      seen.add(key);
      verified_document_coverages.push({
        ...cov,
        insurer: row.insurer ?? null,
        product_name: row.product_name ?? null,
        chart_surface: row.review_reason ? "review_candidate" : "confirmed_contract",
      });
    }
  }

  return {
    authority: "verified_policy_ledger",
    note:
      "Confirmed contracts use strong identity only. personal_review_candidates only for customer/Claude review. raw_source_row_count and audit review_candidates are diagnostic — never customer contract count. verified_document_coverages are already-verified document facts — speak them without asking to re-attach originals; do not promote review rows into confirmed counts.",
    active_distinct_count: projection.active_distinct_count,
    confirmed_count: projection.active_distinct_count,
    review_candidate_count: projection.personal_review_candidate_count,
    personal_review_candidate_count: projection.personal_review_candidate_count,
    foreign_rows_excluded: projection.foreign_rows_excluded,
    raw_source_row_count: projection.raw_source_row_count,
    confirmed_contracts: confirmedList,
    personal_confirmed_contracts: confirmedList,
    // Compat: contracts === confirmed_contracts
    contracts: confirmedList,
    review_candidates: reviewList,
    personal_review_candidates: reviewList,
    verified_document_coverages,
    needs_count: projection.personal_review_candidate_count,
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
  case_source = null,
  case_restored = false,
  case_document_id = null,
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
  const stage = vaultRecall?.stage_counts && typeof vaultRecall.stage_counts === "object"
    ? vaultRecall.stage_counts
    : null;
  const shaDupes = Number(stage?.sha_dupes_skipped) || 0;
  const candidateCount =
    candidate_document_count != null
      ? Number(candidate_document_count) || 0
      : listing.length || 0;
  const attachedCount = attached_document_ids.length;
  const droppedCount = Math.max(
    0,
    failed_document_ids.length + excluded.length + shaDupes,
  );
  const dropped_by_reason = {
    fetch_failed: failed_document_ids.length,
    excluded: excluded.length,
    sha_dupes_skipped: shaDupes,
    ...(stage?.failed_reason_counts && typeof stage.failed_reason_counts === "object"
      ? { failed_reason_counts: stage.failed_reason_counts }
      : {}),
    cap_stop: stage?.cap_stop === true,
    budget_stop: stage?.budget_stop === true,
  };
  const caseSource =
    case_source != null && String(case_source).trim()
      ? String(case_source).trim().slice(0, 64)
      : null;
  const caseDocumentId =
    case_document_id != null && String(case_document_id).trim()
      ? String(case_document_id).trim()
      : null;
  return {
    evidence_scope: evidence_scope || "none",
    // Authority for "how many originals were read this turn" — not prior assistant prose.
    candidate_count: candidateCount,
    attached_count: attachedCount,
    dropped_count: droppedCount,
    dropped_by_reason,
    candidate_document_count: candidateCount,
    attached_document_count: attachedCount,
    attached_document_ids,
    attached_sha256,
    failed_document_ids,
    excluded_document_count: excluded.length,
    excluded_reasons: [...new Set(excluded_reasons)].slice(0, 16),
    image_or_document_block_count: attachedCount,
    vault_mode: vaultRecall?.mode ?? null,
    vault_reason: vaultRecall?.reason ? String(vaultRecall.reason).slice(0, 80) : null,
    case_source: caseSource,
    case_restored: case_restored === true,
    case_document_id: caseDocumentId,
    partial_originals:
      attachedCount > 0 &&
      (failed_document_ids.length > 0 ||
        vaultRecall?.mode === "partial_attach" ||
        vaultRecall?.mode === "choose" ||
        (listing.length > 0 && attachedCount < listing.length)),
    read_scope_authority:
      "EVIDENCE_PACKAGE.attached_count is the only authority for this turn's original-read count; prior assistant claims are not verified fact",
  };
}

/**
 * Follow-up chat authority: already-ledgered verified coverages need no PDF re-attach.
 */
export function buildVerifiedCoverageAuthorityAddendum({
  ledgerBrief = null,
  chart = null,
} = {}) {
  void ledgerBrief; // ledger is contract authority only — coverage body lives on Block B chart
  const rows = Array.isArray(chart?.verified_document_coverages)
    ? chart.verified_document_coverages
    : [];
  if (rows.length === 0) return null;
  const unique = [];
  const seen = new Set();
  for (const row of rows) {
    const key = `${row?.coverage_name || ""}::${row?.coverage_amount ?? ""}::${row?.product_name || ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(row);
  }
  if (unique.length === 0) return null;
  return [
    "VERIFIED_DOCUMENT_COVERAGES_AUTHORITY",
    "담보 상세 권위는 verified_customer_chart(Block B)다.",
    "확정 계약 담보는 verified_document_coverages와 confirmed chart surfaces를 사용한다.",
    "검토 후보 담보는 B의 review_candidates / verified_document_coverages만 사용한다.",
    "VERIFIED_POLICY_LEDGER(C)는 confirmed_contracts 골격과 건수 하드슬롯만 제공한다.",
    "C에서 검토 후보 배열·담보 본문을 읽거나 복원하지 않는다.",
    "그 담보명·보장금액은 문서 사실로 말한다.",
    "이미 있는 금액을 위해 원본 재첨부·재업로드를 요구하지 않는다.",
    "review_candidate / weak identity여도 이미 검증된 담보금액은 유지한다.",
    "C에 계약이 있으나 B 담보가 없으면 담보 상세는 unknown이며 없다고 확정하지 않는다.",
    `present_count=${unique.length}`,
  ].join("\n");
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
      "확정 identity가 부족하면 그룹 수나 원행 수를 확정 계약 수로 말하지 말고, 확인 필요·원본 확인을 안내한다. 담보 상세는 verified_customer_chart.verified_document_coverages(Block B)만 사용하며 C 장부에서 담보를 추정·복원하지 않는다.",
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
    // Claude C: contract skeleton only (coverage bodies stripped at projection boundary).
    VERIFIED_POLICY_LEDGER: projectClaudeVerifiedPolicyLedgerBrief(ledgerBrief),
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
      "Do not mix CURRENT_ORIGINALS, VERIFIED_POLICY_LEDGER, CUSTOMER_REPORTED_FACTS, prior KEY answers, inference, and unknown. Confirmed contract count/list/status: VERIFIED_POLICY_LEDGER.confirmed_contracts + active_distinct_count only. Review-candidate detail and all coverage detail: Block B chart only (review_candidates / verified_document_coverages). Do not read review arrays or coverage bodies from the ledger; do not invent, restore, copy, or summarize them into C; contracts without B coverages keep contract facts with coverage detail unknown.",
  };
}

// Re-export screen status for consumers that import from this module historically.
export { buildMyInsuranceStatus };
