/**
 * Document scope + runtime sum accuracy (no DB merge/delete).
 * Dedupe order: document_id → stored content_sha256 → SHA-256 of original bytes.
 * Never dedupe by filename+size alone.
 */

import { createHash } from "crypto";

/** Tom-locked vault/history scope phrases only (+ close spacing variants). */
export function isExplicitVaultScopeQuestion(question = "") {
  const q = String(question ?? "")
    .replace(/\s+/g, " ")
    .trim();
  if (!q) return false;
  return (
    /보관\s*문서/.test(q) ||
    /이전\s*계약(?:\s*비교)?/.test(q) ||
    /전체\s*보험/.test(q) ||
    /과거\s*자료/.test(q)
  );
}

/**
 * When this request carries document_ids and customer did not ask vault/history scope,
 * analysis must use only those documents.
 */
export function shouldPreferRequestDocumentScopeOnly({
  documentIds = null,
  question = "",
  wantsVaultEvidence = false,
} = {}) {
  const ids = Array.isArray(documentIds)
    ? documentIds.map((id) => String(id ?? "").trim()).filter(Boolean)
    : [];
  if (ids.length === 0) return false;
  if (wantsVaultEvidence === true) return false;
  if (isExplicitVaultScopeQuestion(question)) return false;
  return true;
}

export function contentSha256FromBytes(buf) {
  if (!Buffer.isBuffer(buf) || buf.length === 0) return null;
  return createHash("sha256").update(buf).digest("hex");
}

export function contentSha256FromBase64(base64 = "") {
  const raw = String(base64 ?? "").trim();
  if (!raw) return null;
  try {
    const buf = Buffer.from(raw, "base64");
    return contentSha256FromBytes(buf);
  } catch {
    return null;
  }
}

/**
 * Resolve content hash for a runtime row.
 * Order: stored content_sha256 → bytes/base64 SHA-256. Never filename+size.
 */
export function resolveRuntimeContentSha(row = null) {
  if (!row || typeof row !== "object") return null;
  const stored = String(
    row.content_sha256 ?? row.source_content_sha256 ?? row.sha256 ?? "",
  )
    .trim()
    .toLowerCase();
  if (stored) return stored;
  if (Buffer.isBuffer(row.bytes) || Buffer.isBuffer(row.original_bytes)) {
    return contentSha256FromBytes(row.bytes || row.original_bytes);
  }
  const b64 = row.pdfBase64 ?? row.base64 ?? row.original_base64 ?? null;
  if (b64) return contentSha256FromBase64(b64);
  return null;
}

/**
 * Runtime dedupe for sum/count. Preserves first-seen order.
 * - repeated same document_id → keep first
 * - same content_sha256 (stored or from bytes) → keep first
 * - same filename+size alone → keep BOTH (not duplicates)
 */
export function dedupeDocumentRowsForRuntimeSum(rows = []) {
  const list = Array.isArray(rows) ? rows : [];
  const seenIds = new Set();
  const seenSha = new Set();
  const out = [];
  for (const row of list) {
    if (!row || typeof row !== "object") continue;
    const did = String(row.document_id ?? row.id ?? row.source_document_id ?? "").trim();
    if (did) {
      if (seenIds.has(did)) continue;
      seenIds.add(did);
    }
    const sha = resolveRuntimeContentSha(row);
    if (sha) {
      if (seenSha.has(sha)) continue;
      seenSha.add(sha);
    }
    out.push({
      ...row,
      document_id: did || null,
      content_sha256: sha || row.content_sha256 || row.source_content_sha256 || null,
    });
  }
  return out;
}

/** Integer monthly premium only — ignore non-finite / negative. */
export function coerceMonthlyPremiumWon(value) {
  if (value == null || value === "") return null;
  if (typeof value === "number" && Number.isFinite(value)) {
    const n = Math.round(value);
    return n >= 0 ? n : null;
  }
  const raw = String(value).replace(/,/g, "").replace(/[^\d.-]/g, "").trim();
  if (!raw) return null;
  const n = Math.round(Number(raw));
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
}

/**
 * Contract-level premium key — pages of the same contract share one premium.
 * Prefer policy_number; else insurer+product+premium fingerprint.
 */
export function contractPremiumDedupeKey(row = null) {
  if (!row || typeof row !== "object") return null;
  const pn = String(row.policy_number ?? row.contract_number ?? "")
    .trim()
    .toLowerCase();
  if (pn) return `pn:${pn}`;
  const insurer = String(row.insurer ?? row.insurer_name ?? "")
    .trim()
    .toLowerCase();
  const product = String(row.product_name ?? row.product ?? "")
    .trim()
    .toLowerCase();
  const prem = coerceMonthlyPremiumWon(
    row.monthly_premium ?? row.premium ?? row.premium_amount,
  );
  if (insurer && product && prem != null) {
    return `fp:${insurer}|${product}|${prem}`;
  }
  if (prem != null && (insurer || product)) {
    return `fp:${insurer}|${product}|${prem}`;
  }
  return null;
}

/**
 * Deterministic monthly-premium sum.
 * - Pages: keep all unique document_id / content sha for read count
 * - Premium: count once per contract (same contract's pages share one premium)
 */
export function sumMonthlyPremiumsDeterministic(rows = []) {
  const uniquePages = dedupeDocumentRowsForRuntimeSum(rows);
  const premiums = [];
  const seenContracts = new Set();
  for (const row of uniquePages) {
    const prem = coerceMonthlyPremiumWon(
      row.monthly_premium ?? row.premium ?? row.premium_amount,
    );
    if (prem == null) continue;
    const contractKey =
      contractPremiumDedupeKey(row) ||
      `doc:${String(row.document_id ?? row.source_document_id ?? "").trim() || premiums.length}`;
    if (seenContracts.has(contractKey)) continue;
    seenContracts.add(contractKey);
    premiums.push(prem);
  }
  let sum = 0;
  for (const p of premiums) sum += p;
  return {
    unique_document_count: uniquePages.length,
    unique_contract_count: seenContracts.size,
    premium_row_count: premiums.length,
    premiums,
    monthly_premium_sum: sum,
  };
}

export function buildDeterministicDocumentTotals({
  rows = [],
  processing = null,
} = {}) {
  const summed = sumMonthlyPremiumsDeterministic(rows);
  const proc =
    processing && typeof processing === "object"
      ? {
          total_count: Number(processing.total_count) || 0,
          processed_count: Number(processing.processed_count) || 0,
          remaining_count: Number(processing.remaining_count) || 0,
          complete: processing.complete === true,
          stop_reason:
            processing.stop_reason != null
              ? String(processing.stop_reason).slice(0, 120)
              : null,
        }
      : null;
  return {
    ...summed,
    processing: proc,
    authority: "deterministic_code_not_claude_arithmetic",
  };
}

export function buildIncompleteProcessingNotice({
  total_count = 0,
  processed_count = 0,
  remaining_count = 0,
  stop_reason = null,
} = {}) {
  const total = Math.max(0, Number(total_count) || 0);
  const processed = Math.max(0, Number(processed_count) || 0);
  const remaining =
    remaining_count != null && Number.isFinite(Number(remaining_count))
      ? Math.max(0, Number(remaining_count))
      : Math.max(0, total - processed);
  if (remaining <= 0 && !stop_reason) return null;
  const reason = stop_reason ? String(stop_reason).slice(0, 120) : "processing_incomplete";
  return {
    complete: false,
    total_count: total,
    processed_count: processed,
    remaining_count: remaining,
    stop_reason: reason,
    customer_speak_hint:
      `전체 ${total}건 중 ${processed}건만 처리했고 ${remaining}건이 남았습니다` +
      `(사유: ${reason}). 완료라고 말하지 않는다.`,
  };
}

/**
 * Pre-Claude vault source scope only — Claude writes the customer wording.
 * Do not post-edit customer_answer after Claude.
 */
export function buildVaultDocumentSourceScopeAddendum() {
  return [
    "[DOCUMENT_SOURCE_SCOPE]",
    "source_scope=vault_document",
    "이번 회수 원본은 보관함(문서함)에 있던 문서이다. 현재 턴 신규 첨부·방금 올린 파일이 아니다.",
    '고객에게는 "보관 중이던 문서"로 출처를 설명한다.',
    '"이번에 올린 문서", "올려주신 문서", "방금 첨부한 문서"라고 표현하지 않는다.',
    "출처 문장은 Claude가 직접 작성한다. 시스템/Hand가 답변 뒤에서 고치지 않는다.",
  ].join("\n");
}

/** Soft follow-up that must keep prior multi-attach snapshot. */
export function isAttachContextFollowUpQuestion(question = "") {
  const q = String(question ?? "")
    .replace(/\s+/g, " ")
    .trim();
  if (!q) return false;
  return (
    /합산|합계/.test(q) ||
    /그\s*(서류|문서|첨부|파일)|이\s*(서류|문서|첨부)|방금|아까|이어서|그거|그것/.test(q)
  );
}

export function buildDeterministicTotalsAuthorityAddendum(totals = null) {
  if (!totals || typeof totals !== "object") return null;
  const sum = Number(totals.monthly_premium_sum);
  const count = Number(totals.unique_document_count);
  const premiumCount = Number(totals.premium_row_count);
  const noPremiums =
    totals.no_computable_premiums_in_current_attach === true ||
    (Number.isFinite(premiumCount) && premiumCount <= 0);
  if (!Number.isFinite(sum) && !Number.isFinite(count) && !noPremiums) return null;
  const lines = [
    "[DETERMINISTIC_DOCUMENT_TOTALS]",
    "보험료·건수 합계는 아래 결정론 코드 결과만 사용한다. 직접 더하거나 어림하지 않는다.",
    "아래 값을 읽고 고객 문장을 Claude가 직접 작성한다. 시스템이 답변 뒤에서 문장·금액을 고치지 않는다.",
  ];
  if (Array.isArray(totals.requested_document_ids) && totals.requested_document_ids.length) {
    lines.push(
      `included_document_ids=${totals.requested_document_ids
        .map((id) => String(id ?? "").trim())
        .filter(Boolean)
        .join(",")}`,
    );
  }
  if (Number.isFinite(count)) {
    lines.push(`unique_document_count=${Math.round(count)}`);
  }
  const contractCount = Number(totals.unique_contract_count);
  if (Number.isFinite(contractCount) && contractCount > 0) {
    lines.push(`unique_contract_count=${Math.round(contractCount)}`);
    lines.push(
      "같은 계약의 여러 페이지는 모두 읽되, 월 보험료는 계약 단위로 1회만 센다.",
    );
  }
  if (noPremiums) {
    lines.push("computable_premiums=false");
    lines.push(
      "원본을 모두 읽은 뒤에도 보험료 숫자가 없으면 그때만 \"계산할 숫자 없음\"으로 끝낸다.",
    );
    lines.push("과거 계약·장부·약관·보관 문서의 금액으로 합계를 채우지 않는다.");
    lines.push('"계산할 숫자 없음"과 원화 금액을 같은 답변에 함께 쓰지 않는다.');
  } else if (Number.isFinite(sum)) {
    lines.push("computable_premiums=true");
    lines.push(`monthly_premium_sum=${Math.round(sum)}`);
    lines.push('"계산할 숫자 없음"이라고 말하지 않는다.');
  }
  if (Array.isArray(totals.premiums) && totals.premiums.length) {
    lines.push(`premiums=[${totals.premiums.map((p) => Math.round(Number(p))).join(",")}]`);
    lines.push("premium_source=deterministic_code_from_scoped_originals");
  }
  if (totals.processing && totals.processing.complete === false) {
    lines.push(
      `processing_incomplete total=${totals.processing.total_count} processed=${totals.processing.processed_count} remaining=${totals.processing.remaining_count} reason=${totals.processing.stop_reason || "incomplete"}`,
    );
    lines.push("완료·전부 확인했다고 말하지 않는다. 전체 수·처리 수·남은 수·중단 이유를 말한다.");
  }
  return lines.join("\n");
}

/**
 * Current-turn attachment analysis — exclude vault + chart + ledger + past doc summaries
 * unless customer explicitly asked vault/history scope.
 */
export function buildAttachAnalysisScopeAuthorityAddendum({
  documentIds = [],
  totals = null,
} = {}) {
  const ids = Array.isArray(documentIds)
    ? documentIds.map((id) => String(id ?? "").trim()).filter(Boolean)
    : [];
  if (!ids.length) return null;
  const lines = [
    "[ATTACH_ANALYSIS_SCOPE_ONLY]",
    "이번 턴 답변 근거는 현재 요청에 첨부된 원본뿐이다.",
    "고객 차트, 확인 계약 요약, 장부, 과거 문서/약관 요약, 보관함 목록을 근거로 쓰지 않는다.",
    '"지금까지 올라온 서류 전체", 과거 계약명, 약관명, 보관 문서를 언급하지 않는다.',
    `current_attach_document_ids=${ids.join(",")}`,
  ];
  lines.push(
    "같은 계약의 여러 페이지는 모두 읽고, 월 보험료는 계약당 1회만 말한다.",
  );
  lines.push('"계산할 숫자 없음"과 원화 금액을 같은 답변에 함께 쓰지 않는다.');
  const premiumCount = Number(totals?.premium_row_count);
  if (
    totals?.no_computable_premiums_in_current_attach === true ||
    (Number.isFinite(premiumCount) && premiumCount <= 0)
  ) {
    lines.push(
      "첨부 원본을 읽은 뒤에도 보험료가 없으면 그때만 \"계산할 숫자 없음\"으로 끝내고, 과거 자료로 채우지 않는다.",
    );
  }
  return lines.join("\n");
}

/** True when prose cites vault/history contracts outside attach scope. */
export function answerMentionsOutOfAttachHistoryScope(answer = "") {
  const t = String(answer ?? "");
  if (!t.trim()) return false;
  return (
    /지금까지\s*올라온\s*서류\s*전체/.test(t) ||
    /한화\s*손보|세이프\s*단체\s*보험|단체보험\s*약관/.test(t) ||
    /보관\s*문서|문서함(?:에\s*있는)?\s*(?:다른|과거|이전)/.test(t) ||
    /이전\s*계약|과거\s*(?:자료|문서|약관)/.test(t)
  );
}

/**
 * Strip chart / ledger / past-doc summary evidence from a built user payload.
 * Pure — for attach-scope-only turns and unit tests.
 */
export function stripNonAttachEvidenceFromUserPayload(payload = null) {
  if (!payload || typeof payload !== "object") return payload;
  const next = { ...payload };
  const ctx =
    next.current_context && typeof next.current_context === "object"
      ? { ...next.current_context }
      : {};
  delete ctx.policy_truth;
  delete ctx.ready_card;
  delete ctx.prior_consultation;
  delete ctx.life_threads;
  delete ctx.insurance_clock;
  if (ctx.conversation && typeof ctx.conversation === "object") {
    ctx.conversation = {
      ...ctx.conversation,
      retained_past_originals: [],
      older_conversation_summary: null,
    };
  }
  next.current_context = ctx;
  const evidence =
    next.available_verified_evidence && typeof next.available_verified_evidence === "object"
      ? { ...next.available_verified_evidence }
      : {};
  const personal =
    evidence.personal && typeof evidence.personal === "object"
      ? { ...evidence.personal }
      : { subject_type: "individual" };
  personal.chart = null;
  personal.key_confirmed_source_facts = [];
  personal.provenance = null;
  personal.evidence_state = "unknown";
  evidence.personal = personal;
  // Keep only this-turn attached document rows (already filtered by caller when possible).
  evidence.documents = Array.isArray(evidence.documents)
    ? evidence.documents.filter((d) => d?.attached === true)
    : [];
  next.available_verified_evidence = evidence;
  return next;
}
