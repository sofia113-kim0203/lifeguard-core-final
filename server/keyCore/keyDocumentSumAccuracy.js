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
 * Delivery-layer exact-duplicate hash — bytes/base64 only.
 * Never use stored content_sha256 (stale shared hashes must not drop distinct pages).
 */
export function resolveDeliveryBytesSha(row = null) {
  if (!row || typeof row !== "object") return null;
  if (Buffer.isBuffer(row.bytes) || Buffer.isBuffer(row.original_bytes)) {
    return contentSha256FromBytes(row.bytes || row.original_bytes);
  }
  const b64 = row.pdfBase64 ?? row.base64 ?? row.original_base64 ?? null;
  if (b64) return contentSha256FromBase64(b64);
  return null;
}

/**
 * Original-delivery dedupe: repeated document_id OR identical bytes SHA only.
 * Distinct document_ids with different bytes are all kept for Claude blocks.
 */
export function dedupeRowsForOriginalDelivery(rows = []) {
  const list = Array.isArray(rows) ? rows : [];
  const seenIds = new Set();
  const seenBytesSha = new Set();
  const out = [];
  for (const row of list) {
    if (!row || typeof row !== "object") continue;
    const did = String(row.document_id ?? row.id ?? row.source_document_id ?? "").trim();
    if (did) {
      if (seenIds.has(did)) continue;
      seenIds.add(did);
    }
    const bytesSha = resolveDeliveryBytesSha(row);
    if (bytesSha) {
      if (seenBytesSha.has(bytesSha)) continue;
      seenBytesSha.add(bytesSha);
    }
    out.push({
      ...row,
      document_id: did || null,
      delivery_bytes_sha256: bytesSha || null,
    });
  }
  return out;
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
 * Deterministic monthly-premium sum (calculation layer — not original delivery).
 * - Pages: unique document_id / content sha for read count
 * - Premium: once per verified contract identity; without identity do not invent contract_count
 */
export function sumMonthlyPremiumsDeterministic(rows = []) {
  const uniquePages = dedupeDocumentRowsForRuntimeSum(rows);
  const verifiedPremiums = [];
  const unverifiedPremiums = [];
  const seenVerifiedContracts = new Set();
  const seenUnverifiedDocs = new Set();
  for (const row of uniquePages) {
    const prem = coerceMonthlyPremiumWon(
      row.monthly_premium ?? row.premium ?? row.premium_amount,
    );
    if (prem == null) continue;
    const verifiedKey = contractPremiumDedupeKey(row);
    if (verifiedKey) {
      if (seenVerifiedContracts.has(verifiedKey)) continue;
      seenVerifiedContracts.add(verifiedKey);
      verifiedPremiums.push(prem);
      continue;
    }
    const docKey =
      String(row.document_id ?? row.source_document_id ?? "").trim() ||
      `anon:${unverifiedPremiums.length}`;
    if (seenUnverifiedDocs.has(docKey)) continue;
    seenUnverifiedDocs.add(docKey);
    unverifiedPremiums.push(prem);
  }
  const hasVerifiedIdentity = verifiedPremiums.length > 0;
  // Verified identity → contract-level premiums. Else document-level premiums only;
  // contract_count stays unknown (do not invent merges from filename/size/similarity).
  const premiums = hasVerifiedIdentity ? verifiedPremiums : unverifiedPremiums;
  let sum = 0;
  for (const p of premiums) sum += p;
  return {
    unique_document_count: uniquePages.length,
    unique_contract_count: hasVerifiedIdentity ? seenVerifiedContracts.size : null,
    contract_count_status: hasVerifiedIdentity ? "verified" : "unknown",
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
    /지금\s*올린\s*서류|방금\s*올린\s*서류|아까\s*서류/.test(q) ||
    /합산|합계/.test(q) ||
    /합산\s*금액|보장\s*내역|이것만\s*정리|그\s*서류\s*기준/.test(q) ||
    /그\s*(서류|문서|첨부|파일)|이\s*(서류|문서|첨부)|방금|아까|이어서|그거|그것/.test(q)
  );
}

/**
 * Split customer attachment identities from unique original bytes for Claude.
 * Exact duplicate bytes → keep identity + duplicate_of; do not repeat image block.
 */
export function buildAttachmentIdentityDeliveryPlan({
  identityRows = [],
  defaultSourceScope = "current_turn_attachment",
} = {}) {
  const rows = Array.isArray(identityRows) ? identityRows : [];
  const attachment_identities = [];
  const unique_original_blocks = [];
  const duplicate_map = [];
  const shaToFirstDocumentId = new Map();
  const seenIds = new Set();

  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i];
    if (!row || typeof row !== "object") continue;
    const document_id = String(
      row.document_id ?? row.id ?? row.source_document_id ?? "",
    ).trim();
    if (!document_id || seenIds.has(document_id)) continue;
    seenIds.add(document_id);
    const filename = String(
      row.original_filename ?? row.filename ?? row.name ?? "",
    ).trim();
    const source_scope = String(row.source_scope ?? defaultSourceScope).trim() ||
      defaultSourceScope;
    const bytes_sha256 = resolveDeliveryBytesSha(row);
    let duplicate_of_document_id = null;
    let delivers_original_block = Boolean(row.base64 || row.pdfBase64 || row.bytes);
    if (bytes_sha256 && shaToFirstDocumentId.has(bytes_sha256)) {
      duplicate_of_document_id = shaToFirstDocumentId.get(bytes_sha256);
      delivers_original_block = false;
      duplicate_map.push({
        document_id,
        duplicate_of_document_id,
      });
    } else if (bytes_sha256) {
      shaToFirstDocumentId.set(bytes_sha256, document_id);
    }

    const identity = {
      original_index: attachment_identities.length + 1,
      document_id,
      filename: filename || null,
      source_scope,
      bytes_sha256: bytes_sha256 || null,
      bytes_sha256_prefix: bytes_sha256 ? bytes_sha256.slice(0, 12) : null,
      duplicate_of_document_id,
      delivers_original_block,
    };
    attachment_identities.push(identity);

    if (delivers_original_block) {
      unique_original_blocks.push({
        ...row,
        document_id,
        original_filename: filename || row.original_filename || null,
        source_scope,
        delivery_bytes_sha256: bytes_sha256 || null,
        original_index: identity.original_index,
        base64: row.base64 ?? row.pdfBase64 ?? null,
        mediaType: row.mediaType ?? row.mime_type ?? null,
      });
    }
  }

  return {
    attachment_identities,
    unique_original_blocks,
    duplicate_map,
    attachment_identity_count: attachment_identities.length,
    unique_original_block_count: unique_original_blocks.length,
  };
}

/** Text block placed immediately before each original (or alone for duplicates). */
export function formatAttachmentIdentityTextBlock(identity = null) {
  if (!identity || typeof identity !== "object") return null;
  const id = String(identity.document_id ?? "").trim();
  if (!id) return null;
  const lines = [
    "[ATTACHMENT_IDENTITY]",
    `original_index=${Number(identity.original_index) || 0}`,
    `document_id=${id}`,
    `filename=${String(identity.filename ?? "").trim() || "unknown"}`,
    `source_scope=${String(identity.source_scope ?? "current_turn_attachment").trim()}`,
    `bytes_sha256_prefix=${String(identity.bytes_sha256_prefix ?? "").trim() || "unknown"}`,
    `duplicate_of_document_id=${
      identity.duplicate_of_document_id
        ? String(identity.duplicate_of_document_id).trim()
        : "none"
    }`,
    `delivers_original_block=${identity.delivers_original_block === true}`,
  ];
  return lines.join("\n");
}

/** Catalog: attachment identities vs unique original blocks (fact table only). */
export function buildAttachmentIdentityCatalogAddendum(plan = null) {
  if (!plan || typeof plan !== "object") return null;
  const identities = Array.isArray(plan.attachment_identities)
    ? plan.attachment_identities
    : [];
  if (!identities.length) return null;
  const lines = [
    "[ATTACHMENT_IDENTITY_CATALOG]",
    `attachment_identity_count=${identities.length}`,
    `unique_original_block_count=${
      Number(plan.unique_original_block_count) ||
      (Array.isArray(plan.unique_original_blocks) ? plan.unique_original_blocks.length : 0)
    }`,
    "고객이 올린 파일 수(attachment identities)와 고유 원본 수(unique original blocks)를 구분한다.",
    "exact duplicate는 원본 이미지를 반복 전송하지 않아도 되며, duplicate_of 관계로 인식한다.",
    "이미 첨부된 파일을 다시 올리라고 요구하지 않는다.",
  ];
  for (const row of identities) {
    lines.push(
      [
        `original_index=${row.original_index}`,
        `document_id=${row.document_id}`,
        `filename=${row.filename || "unknown"}`,
        `source_scope=${row.source_scope || "current_turn_attachment"}`,
        `bytes_sha256_prefix=${row.bytes_sha256_prefix || "unknown"}`,
        `duplicate_of_document_id=${row.duplicate_of_document_id || "none"}`,
        `delivers_original_block=${row.delivers_original_block === true}`,
      ].join(";"),
    );
  }
  if (Array.isArray(plan.duplicate_map) && plan.duplicate_map.length) {
    for (const dup of plan.duplicate_map) {
      lines.push(
        `duplicate_map ${dup.document_id}->${dup.duplicate_of_document_id}`,
      );
    }
  }
  return lines.join("\n");
}

/**
 * Fact-only deterministic totals for Claude input. Never writes customer prose / NO_PREMIUM_SPEAK.
 */
export function buildDeterministicTotalsAuthorityAddendum(totals = null) {
  if (!totals || typeof totals !== "object") return null;
  const sum = Number(totals.monthly_premium_sum);
  const identityCount = Number(
    totals.attachment_identity_count ??
      (Array.isArray(totals.requested_document_ids)
        ? totals.requested_document_ids.length
        : NaN),
  );
  const uniqueBlockCount = Number(
    totals.unique_original_block_count ?? totals.unique_document_count,
  );
  const premiumCount = Number(totals.premium_row_count);
  const contractStatus = String(totals.contract_count_status ?? "").trim();
  const contractCount = Number(totals.unique_contract_count);
  const originalsAvailable =
    totals.originals_available === true ||
    (Number.isFinite(identityCount) && identityCount > 0) ||
    (Number.isFinite(uniqueBlockCount) && uniqueBlockCount > 0) ||
    (Array.isArray(totals.requested_document_ids) &&
      totals.requested_document_ids.length > 0);
  const verified =
    contractStatus === "verified" &&
    Number.isFinite(contractCount) &&
    contractCount > 0 &&
    Number.isFinite(premiumCount) &&
    premiumCount > 0 &&
    Number.isFinite(sum);
  const partial =
    !verified &&
    Number.isFinite(premiumCount) &&
    premiumCount > 0 &&
    Number.isFinite(sum);

  if (
    !verified &&
    !partial &&
    !originalsAvailable &&
    !Number.isFinite(identityCount)
  ) {
    return null;
  }

  const lines = [
    "[DETERMINISTIC_DOCUMENT_TOTALS]",
    "아래는 KEY 결정론 사실표이다. 고객 문장은 Claude가 원본과 함께 직접 작성한다.",
    "시스템이 고객 답변 문장·금액·재첨부 요청·부족 단정을 미리 쓰지 않는다.",
  ];
  if (Array.isArray(totals.requested_document_ids) && totals.requested_document_ids.length) {
    lines.push(
      `included_document_ids=${totals.requested_document_ids
        .map((id) => String(id ?? "").trim())
        .filter(Boolean)
        .join(",")}`,
    );
  }
  if (Number.isFinite(identityCount) && identityCount > 0) {
    lines.push(`attachment_identity_count=${Math.round(identityCount)}`);
  }
  if (Number.isFinite(uniqueBlockCount) && uniqueBlockCount > 0) {
    lines.push(`unique_original_block_count=${Math.round(uniqueBlockCount)}`);
  }

  if (verified) {
    lines.push("deterministic_total_status=verified");
    lines.push("deterministic_extraction_complete=true");
    lines.push(`unique_contract_count=${Math.round(contractCount)}`);
    lines.push("contract_count_status=verified");
    lines.push(`monthly_premium_total=${Math.round(sum)}`);
    lines.push(
      "calculation_note=same_verified_contract_pages_share_one_monthly_premium",
    );
    if (Array.isArray(totals.premiums) && totals.premiums.length) {
      lines.push(`premiums=[${totals.premiums.map((p) => Math.round(Number(p))).join(",")}]`);
      lines.push("premium_source=deterministic_code_from_scoped_originals");
    }
  } else if (partial) {
    lines.push("deterministic_total_status=partial");
    lines.push("deterministic_extraction_complete=true");
    lines.push("unique_contract_count=unknown");
    lines.push("contract_count_status=unknown");
    lines.push(`monthly_premium_total=${Math.round(sum)}`);
    if (Array.isArray(totals.premiums) && totals.premiums.length) {
      lines.push(`premiums=[${totals.premiums.map((p) => Math.round(Number(p))).join(",")}]`);
      lines.push("premium_source=deterministic_code_from_scoped_originals");
    }
  } else if (originalsAvailable) {
    // Originals exist but extraction incomplete — never signal "no premium / cannot compute / need more files".
    lines.push("deterministic_total_status=unknown");
    lines.push("deterministic_extraction_complete=false");
    lines.push("originals_available=true");
    lines.push("inspect_originals_before_concluding=true");
    lines.push("unique_contract_count=unknown");
    lines.push("contract_count_status=unknown");
  } else {
    lines.push("deterministic_total_status=unknown");
    lines.push("deterministic_extraction_complete=false");
    lines.push("originals_available=false");
  }

  if (totals.processing && totals.processing.complete === false) {
    lines.push(
      `processing_incomplete total=${totals.processing.total_count} processed=${totals.processing.processed_count} remaining=${totals.processing.remaining_count} reason=${totals.processing.stop_reason || "incomplete"}`,
    );
  }
  return lines.join("\n");
}

/**
 * Attach-scope: block unrelated vault / unrelated past contracts from driving the answer.
 * Related verified memory/chart and conversation thread stay available.
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
    "이번 턴의 첨부 분석 우선 근거는 현재/직전 관련 첨부 원본이다.",
    "무관한 보관함(vault) 문서, 현재 질문과 관계없는 과거 계약, 삭제·비활성 문서를 자동으로 섞지 않는다.",
    "관련 verified customer facts / chart / memory / prior consultation은 유지한다.",
    "원본과 관련 기억이 충돌하면 현재 첨부 원본을 우선한다.",
    `current_attach_document_ids=${ids.join(",")}`,
    `current_attach_document_count=${ids.length}`,
    "source_scope=current_turn_attachment (unless a row is marked vault_document or previous_turn_attachment)",
    "첨부된 원본 개수만큼 모두 읽는다. 이미 첨부된 페이지를 다시 올리라고 요구하지 않는다.",
    "읽은 사실 전부 나열하지 말고, 현재 고객 질문에 필요한 범위만 답한다.",
    "같은 계약의 여러 페이지는 모두 읽고, 월 보험료 계산은 검증된 계약 identity 기준 1회다.",
  ];
  void totals;
  return lines.join("\n");
}

/**
 * KEY × Claude context contract — CURRENT / THREAD / CUSTOMER / TIME / SOURCE.
 * Fact labels only; Claude writes customer wording.
 */
export function buildKeyClaudeContextContractAddendum({
  now = null,
  timeZone = null,
  attachmentIdentities = [],
  history = [],
} = {}) {
  const nowDate =
    now instanceof Date && !Number.isNaN(now.getTime())
      ? now
      : now
        ? new Date(now)
        : new Date();
  const iso = Number.isNaN(nowDate.getTime())
    ? new Date().toISOString()
    : nowDate.toISOString();
  const tz =
    String(timeZone ?? "").trim() ||
    Intl.DateTimeFormat().resolvedOptions().timeZone ||
    "Asia/Seoul";
  const identities = Array.isArray(attachmentIdentities) ? attachmentIdentities : [];
  const turns = Array.isArray(history) ? history : [];
  const recent = turns.slice(-6).map((t, i) => {
    const role = t?.role === "assistant" ? "assistant" : "user";
    const ts = String(t?.created_at ?? t?.timestamp ?? t?.at ?? "").trim() || "unknown";
    return `${i + 1}:${role}@${ts}`;
  });
  const lines = [
    "[KEY_CLAUDE_CONTEXT_CONTRACT]",
    "CURRENT: 현재 고객 질문 + 현재 첨부 identity 전체 + 고유 원본 + 첨부 순서",
    "THREAD: 직전 관련 고객 질문·Claude 답변·첨부가 올라온 턴·메시지 순서를 유지한다",
    "CUSTOMER: 관련 verified facts / chart / memory / prior consultation을 첨부 질문이라는 이유만으로 비우지 않는다",
    "TIME: 방금/아까/현재/이전/오늘을 구분할 때 아래 시각을 사용한다",
    `reference_now_iso=${iso}`,
    `user_timezone=${tz}`,
    "SOURCE: current_turn_attachment | previous_turn_attachment | vault_document | verified_customer_fact | conversation_context",
  ];
  if (identities.length) {
    lines.push(`attachment_upload_order=${identities.map((r) => r.document_id).join(",")}`);
    for (const row of identities) {
      lines.push(
        [
          `upload_order=${row.original_index}`,
          `document_id=${row.document_id}`,
          `source_scope=${row.source_scope || "current_turn_attachment"}`,
          `duplicate_of=${row.duplicate_of_document_id || "none"}`,
        ].join(";"),
      );
    }
  }
  if (recent.length) {
    lines.push(`recent_thread_timestamps=${recent.join("|")}`);
  }
  lines.push(
    "계약일·갱신일·만기일이 원본/검증 사실에 있으면 해당 날짜를 기준으로 설명한다.",
  );
  return lines.join("\n");
}

/**
 * Claude inference / evaluation must not auto-promote to confirmed KEY facts.
 */
export function buildCustomerConfirmationBoundaryAddendum() {
  return [
    "[CUSTOMER_CONFIRMATION_BOUNDARY]",
    "원본에서 직접 확인된 사실과 KEY 결정론 계산만 confirmed fact 후보이다.",
    "Claude의 계약 동일성 추론, 보장 충분성 평가, 두텁다/유리하다, 누락 문서 판단, 고객 의도 추정은 고객 확인 또는 별도 검증 없이 confirmed로 승격하지 않는다.",
    "관계 판단·평가·추론은 답변에 쓸 수 있으나 KEY 사실 저장 대상이 아니다.",
  ].join("\n");
}

/** Drop evaluation / inference literals from confirmed-fact persist candidates. */
export function isClaudeInferenceOrEvaluationLiteral(value = "") {
  const t = String(value ?? "").trim();
  if (!t) return false;
  return (
    /두텁|유리하|충분하|부족한\s*문서|다시\s*올려|재첨부|의도상|추정|같은\s*계약으로\s*보|장기적으로\s*유리/.test(
      t,
    ) || /missing_page|duplicate_page|sufficiency|advantageous|thick_coverage/i.test(t)
  );
}

/** Per-document source_scope catalog for Claude (KEY provides labels only). */
export function buildDocumentSourceScopeCatalogAddendum(entries = []) {
  const list = Array.isArray(entries) ? entries : [];
  const lines = ["[DOCUMENT_SOURCE_SCOPE_CATALOG]"];
  let n = 0;
  for (const row of list) {
    const id = String(row?.document_id ?? "").trim();
    const scope = String(row?.source_scope ?? "").trim();
    if (!id || !scope) continue;
    lines.push(`document_id=${id};source_scope=${scope}`);
    n += 1;
  }
  if (!n) return null;
  lines.push("출처 표현은 Claude가 작성한다. KEY가 답변 뒤에서 고치지 않는다.");
  return lines.join("\n");
}

/**
 * Pre-Claude evaluation principle only — no post-answer rewrite Gate.
 */
export function buildUnsupportedEvaluationAuthorityAddendum() {
  return [
    "[EVALUATION_AUTHORITY]",
    "보장 구조·금액·기간 등 원본 사실은 설명할 수 있다.",
    "충분하다·두텁다·유리하다·좋은 설계 같은 평가는 시장 기준·고객의 검증된 필요·비교 근거가 있을 때만 한다.",
    "근거가 없으면 사실 구조와 확인할 사항만 설명한다.",
    "전체 증권·별도 실손·사망 보장·3/3 페이지가 확인되지 않은 상태에서 없음·가입 안 됨·충분함·갈아탈 필요 없음·유리함·보험료 적정을 확정하지 않는다.",
    "확인되지 않은 담보는 '확인되지 않습니다'로 말하고 unknown/null로 유지한다.",
    "모델 일반 지식만으로 자녀 실손 월 1~2만 원대, 4세대 실손 구조 동일, 체증형 담보가 어릴수록 유리하다 같은 확정을 만들지 않는다.",
  ].join("\n");
}

/**
 * Final Claude user-content block: customer question is the highest response priority.
 * Verbatim question only — KEY must not summarize or rewrite meaning.
 */
export function buildCurrentCustomerRequestPriorityBlock(question = "") {
  const q = String(question ?? "");
  if (!q.trim()) return "";
  return [
    "[CURRENT_CUSTOMER_REQUEST — HIGHEST RESPONSE PRIORITY]",
    q,
    "[RESPONSE_SCOPE]",
    "최종 답변의 범위는 현재 고객 요청이 결정한다.",
    "원본 문서, 고객 차트, 대화 기록, 기억, 계산 결과, 공공 근거는 답변을 위한 근거이지 고객에게 전부 설명해야 할 작업 목록이 아니다.",
    "고객이 요청한 내용만 답한다.",
    "고객이 요청하지 않은 다음 내용을 임의로 추가하지 않는다.",
    "- 전체 담보 목록",
    "- 문서 전체 분석",
    "- 누락 페이지 안내",
    "- 이상 항목 지적",
    "- 재업로드 요구",
    "- 유지·해지 판단",
    "- 추가 상담 제안",
    "- 부모·가족 전체 보험 분석",
    "단, 요청한 답을 만들 수 없는 필수 정보가 실제로 없거나 명백한 안전 위험이 있을 때만 필요한 제한을 설명한다.",
    "현재 질문을 KEY가 요약하거나 다른 의미로 바꾸지 않는다. 고객 원문을 그대로 전달한다.",
    "합계만/금액만/결론만/간단히/이것만/중복만/빠진 페이지만/필요한 보장만/상품만 추천해줘/전체 분석해줘/자세히 설명해줘 같은 표현은 Claude가 직접 이해하고 그 범위에 맞춰 답한다.",
    "답변 후 표나 문장을 잘라내지 않는다. KEY는 답변을 뒤에서 삭제·교체·재작성하지 않는다.",
  ].join("\n");
}

/**
 * Soft system reminder: full-document dump is not the default job.
 * Product/company/search recommendation guidance is NOT here — only via explicit product gate.
 */
export function buildQuestionScopedAnalysisAuthorityAddendum() {
  return [
    "[QUESTION_SCOPED_ANALYSIS]",
    "첨부 원본·차트·대화·기억·계산·공공 근거는 충분히 제공된다. 그러나 전부 설명하는 것이 기본 작업이 아니다.",
    "전체 담보 목록, 문서 전체 분석, 누락 페이지 안내, 이상 항목 지적, 재업로드 요구, 유지·해지 판단, 추가 상담 제안, 후속 질문은 고객이 그 분석을 요청한 경우에만 수행한다.",
    "확인된 근거만 사용한다. 확인되지 않으면 확인되지 않았다고 말한다. 근거 없는 확정·미확인 보험료·미확인 가입 가능 여부를 꾸며내지 않는다.",
  ].join("\n");
}

/**
 * Product/company/public-search recommendation guidance — only for explicit product requests.
 * Appended when buildCurrentInsuranceProductShowcaseAddendum is non-empty (same gate).
 */
export function buildExplicitInsuranceProductRecommendationGuidanceAddendum() {
  return [
    "[EXPLICIT_INSURANCE_PRODUCT_RECOMMENDATION]",
    "검증된 필요와 현재 공공 상품 근거가 있으면",
    "필요한 보장과 구체적 회사·상품 후보를 근거·출처·확인일과 함께 추천한다.",
    "회사명·상품명 자체를 회피하지 않는다.",
    "추천 후보와 최종 가입·인수·보험료·유지·해지 판단을 분리한다.",
    "근거 없는 확정 추천·미확인 보험료·미확인 가입 가능 여부·판매 여부 미확인 상품을 꾸며내지 않는다.",
  ].join("\n");
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
 * Strip unrelated vault / past-doc dump from a built user payload.
 * Keeps related verified chart, confirmed facts, prior consultation, clock, memory.
 * Pure — for attach-scope-only turns and unit tests.
 */
export function stripNonAttachEvidenceFromUserPayload(payload = null) {
  if (!payload || typeof payload !== "object") return payload;
  const next = { ...payload };
  const ctx =
    next.current_context && typeof next.current_context === "object"
      ? { ...next.current_context }
      : {};
  // Keep prior_consultation / insurance_clock / life_threads / related chart facts.
  // Drop only past-original dumps that pull unrelated vault/history prose into attach turns.
  if (ctx.conversation && typeof ctx.conversation === "object") {
    ctx.conversation = {
      ...ctx.conversation,
      retained_past_originals: [],
    };
  }
  next.current_context = ctx;
  const evidence =
    next.available_verified_evidence && typeof next.available_verified_evidence === "object"
      ? { ...next.available_verified_evidence }
      : {};
  // Keep personal.chart + key_confirmed_source_facts (related CUSTOMER context).
  // Prefer attached document rows; do not invent vault rows here.
  evidence.documents = Array.isArray(evidence.documents)
    ? evidence.documents.filter(
        (d) => d?.attached === true || d?.source_scope === "current_turn_attachment",
      )
    : [];
  next.available_verified_evidence = evidence;
  return next;
}
