/**
 * KEY official document-memory commits — fact store/recall only.
 * Never builds customer prose, recommendations, or judgments.
 */

import { createHash, randomUUID } from "node:crypto";

export const KEY_DOCUMENT_MEMORY_SCHEMA = "key_latest_document_context_v1";
export const KEY_DOCUMENT_MEMORY_CONFIRMATION_SOURCE = "key_claude_original_document";
export const KEY_DOCUMENT_MEMORY_PERSIST_FAILED = "KEY_DOCUMENT_MEMORY_PERSIST_FAILED";

export const KEY_DOCUMENT_READ_STATUSES = Object.freeze([
  "confirmed_facts",
  "no_confirmable_facts",
  "partial",
  "unreadable",
  "extraction_failed",
]);

const MASKED_PN_RE = /[xX*]{2,}|\*{2,}|\u25CF{2,}|\u2022{2,}/;
const PARTIAL_PN_RE = /\.{2,}|…|\?\?+|_{2,}/;

export function buildKeyDocumentMemoryIdempotencyKey({
  customerId = null,
  sessionId = null,
  sourceTurnId = null,
  documentIds = [],
} = {}) {
  const cid = String(customerId ?? "").trim();
  const sid = String(sessionId ?? "").trim();
  const tid = String(sourceTurnId ?? "").trim();
  const docs = [
    ...new Set(
      (Array.isArray(documentIds) ? documentIds : [])
        .map((id) => String(id ?? "").trim())
        .filter(Boolean),
    ),
  ].sort();
  if (!cid || !sid || !tid || !docs.length) return null;
  return createHash("sha256")
    .update(`${cid}|${sid}|${tid}|${docs.join(",")}`, "utf8")
    .digest("hex");
}

export function normalizeInsurerName(raw = "") {
  return String(raw ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/주식회사|㈜|\(주\)/g, "")
    .replace(/손해보험|생명보험|화재보험|해상보험|보험/g, (m) => {
      if (m.includes("생명")) return "생명";
      if (m.includes("손") || m.includes("화재") || m.includes("해상")) return "손보";
      return "";
    });
}

export function classifyPolicyNumberQuality(raw = "") {
  const s = String(raw ?? "").trim();
  if (!s) return "absent";
  if (MASKED_PN_RE.test(s)) return "masked";
  if (PARTIAL_PN_RE.test(s)) return "partial";
  const compact = s.replace(/\s+/g, "");
  if (compact.length < 3) return "partial";
  if (/[^\w\-./]/.test(compact) && !/^[A-Za-z0-9][A-Za-z0-9\-/]{2,}$/.test(compact)) {
    return "uncertain";
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9\-/]{2,}$/.test(compact)) return "uncertain";
  return "exact_unmasked";
}

export function classifyDocumentReadStatus({
  acceptedCount = 0,
  rejectedCount = 0,
  originalsAttached = false,
  originalsFailed = false,
  extractionFailed = false,
} = {}) {
  if (extractionFailed === true) return "extraction_failed";
  if (originalsFailed === true || (originalsAttached !== true && acceptedCount === 0 && rejectedCount === 0)) {
    if (originalsFailed === true) return "unreadable";
  }
  if (originalsFailed === true) return "unreadable";
  const accepted = Number(acceptedCount) || 0;
  const rejected = Number(rejectedCount) || 0;
  if (accepted > 0 && rejected > 0) return "partial";
  if (accepted > 0) return "confirmed_facts";
  return "no_confirmable_facts";
}

function literalFromFacts(facts, ...types) {
  const want = new Set(types.map((t) => String(t).toLowerCase()));
  for (const f of Array.isArray(facts) ? facts : []) {
    if (!want.has(String(f?.fact_type ?? "").toLowerCase())) continue;
    const lit = String(f?.literal_value ?? f?.literal ?? "").trim();
    if (lit) return lit;
  }
  return null;
}

function groupFactsByDocument(facts = []) {
  const byDoc = new Map();
  for (const f of Array.isArray(facts) ? facts : []) {
    if (!f || typeof f !== "object") continue;
    const did = String(f.source_document_id ?? "").trim();
    if (!did) continue;
    const list = byDoc.get(did) ?? [];
    list.push(f);
    byDoc.set(did, list);
  }
  return byDoc;
}

export function buildContractsFromAcceptedFacts(acceptedFacts = []) {
  const byDoc = groupFactsByDocument(acceptedFacts);
  const contracts = [];
  for (const [documentId, facts] of byDoc.entries()) {
    const insurer_name =
      literalFromFacts(facts, "insurer_name", "insurer") || null;
    const product_name = literalFromFacts(facts, "product_name") || null;
    const policy_number = literalFromFacts(facts, "policy_number") || null;
    const premiumRaw = literalFromFacts(facts, "monthly_premium", "premium");
    const policyholder = literalFromFacts(facts, "policyholder");
    const insured = literalFromFacts(facts, "insured");
    const policy_number_quality = classifyPolicyNumberQuality(policy_number);
    const fact_refs = facts.map((f) => ({
      fact_type: String(f.fact_type ?? "").trim().toLowerCase() || null,
      literal: String(f.literal_value ?? f.literal ?? ""),
      source_document_id: documentId,
      source_page:
        f?.source_locator?.page != null ? f.source_locator.page : null,
      source_location:
        f?.source_locator && typeof f.source_locator === "object"
          ? f.source_locator
          : null,
      verification_status: "key_confirmed_from_original",
    }));
    let monthly_premium = null;
    if (premiumRaw) {
      const n = Number(String(premiumRaw).replace(/[^\d.]/g, ""));
      if (Number.isFinite(n) && n > 0) monthly_premium = n;
    }
    contracts.push({
      insurer_name,
      normalized_insurer_name: normalizeInsurerName(insurer_name || ""),
      product_name,
      policy_number,
      policy_number_quality,
      monthly_premium,
      policyholder,
      insured,
      source_document_id: documentId,
      fact_refs,
    });
  }
  return contracts;
}

export function buildKeyLatestDocumentContext(row = null) {
  if (!row || typeof row !== "object") return null;
  if (String(row.commit_status ?? "") !== "committed") return null;
  const document_ids = Array.isArray(row.document_ids)
    ? row.document_ids.map((id) => String(id)).filter(Boolean)
    : [];
  return {
    schema_version: KEY_DOCUMENT_MEMORY_SCHEMA,
    memory_commit_id: String(row.memory_commit_id ?? ""),
    memory_version:
      row.memory_version == null ? null : Number(row.memory_version),
    customer_id: String(row.customer_id ?? ""),
    session_id: String(row.session_id ?? ""),
    source_turn_id: String(row.source_turn_id ?? ""),
    source_message_id: row.source_message_id ?? null,
    source_turn_ord: row.source_turn_ord ?? null,
    document_ids,
    primary_document_id: String(row.primary_document_id ?? ""),
    read_status: String(row.read_status ?? ""),
    focus_status: String(row.focus_status ?? ""),
    confirmation_source: KEY_DOCUMENT_MEMORY_CONFIRMATION_SOURCE,
    contracts: Array.isArray(row.contracts) ? row.contracts : [],
    rejected_fact_count: Number(row.rejected_fact_count) || 0,
    recorded_at: row.recorded_at ?? null,
    committed_at: row.committed_at ?? null,
    originals_reattached: false,
    note:
      "Same-session KEY official document memory. Not a substitute for CURRENT_ORIGINALS. Other ledger contracts must not replace this focus.",
  };
}

export async function beginKeyDocumentMemoryCommit({
  supabase = null,
  customerId = null,
  sessionId = null,
  sourceTurnId = null,
  sourceMessageId = null,
  sourceTurnOrd = null,
  documentIds = [],
  readStatus = "no_confirmable_facts",
  rejectedFactCount = 0,
} = {}) {
  const cid = String(customerId ?? "").trim();
  const sid = String(sessionId ?? "").trim();
  const tid = String(sourceTurnId ?? "").trim();
  const docs = [
    ...new Set(
      (Array.isArray(documentIds) ? documentIds : [])
        .map((id) => String(id ?? "").trim())
        .filter(Boolean),
    ),
  ];
  const idempotency_key = buildKeyDocumentMemoryIdempotencyKey({
    customerId: cid,
    sessionId: sid,
    sourceTurnId: tid,
    documentIds: docs,
  });
  if (!supabase || !idempotency_key) {
    return {
      ok: false,
      reason: !supabase ? "no_supabase" : "invalid_scope",
      idempotency_key,
    };
  }
  const status = KEY_DOCUMENT_READ_STATUSES.includes(readStatus)
    ? readStatus
    : "no_confirmable_facts";

  const { data: existing } = await supabase
    .from("key_document_memory_commits")
    .select("*")
    .eq("customer_id", cid)
    .eq("idempotency_key", idempotency_key)
    .maybeSingle();

  if (existing?.commit_status === "committed") {
    return {
      ok: true,
      already_committed: true,
      row: existing,
      memory_commit_id: existing.memory_commit_id,
      idempotency_key,
    };
  }

  if (existing?.id) {
    const { data: updated, error } = await supabase
      .from("key_document_memory_commits")
      .update({
        commit_status: "preparing",
        read_status: status,
        rejected_fact_count: Math.max(0, Number(rejectedFactCount) || 0),
        failure_code: null,
        failure_stage: null,
        updated_at: new Date().toISOString(),
      })
      .eq("customer_id", cid)
      .eq("id", existing.id)
      .select("*")
      .single();
    if (error) {
      return { ok: false, reason: "begin_update_failed", error: error.message, idempotency_key };
    }
    return {
      ok: true,
      already_committed: false,
      row: updated,
      memory_commit_id: updated.memory_commit_id,
      idempotency_key,
    };
  }

  const memory_commit_id = randomUUID();
  const insertRow = {
    schema_version: KEY_DOCUMENT_MEMORY_SCHEMA,
    customer_id: cid,
    session_id: sid,
    source_turn_id: tid,
    source_message_id: sourceMessageId ? String(sourceMessageId) : null,
    source_turn_ord:
      sourceTurnOrd == null || sourceTurnOrd === ""
        ? null
        : Number(sourceTurnOrd),
    memory_commit_id,
    idempotency_key,
    commit_status: "preparing",
    memory_version: null,
    recorded_at: new Date().toISOString(),
    committed_at: null,
    document_ids: docs,
    primary_document_id: docs[0],
    read_status: status,
    focus_status: "active",
    confirmation_source: KEY_DOCUMENT_MEMORY_CONFIRMATION_SOURCE,
    contracts: [],
    rejected_fact_count: Math.max(0, Number(rejectedFactCount) || 0),
  };
  const { data: inserted, error: insertError } = await supabase
    .from("key_document_memory_commits")
    .insert(insertRow)
    .select("*")
    .single();
  if (insertError) {
    return {
      ok: false,
      reason: "begin_insert_failed",
      error: insertError.message,
      idempotency_key,
    };
  }
  return {
    ok: true,
    already_committed: false,
    row: inserted,
    memory_commit_id: inserted.memory_commit_id,
    idempotency_key,
  };
}

export async function commitKeyDocumentMemory({
  supabase = null,
  customerId = null,
  memoryCommitId = null,
  contracts = [],
  readStatus = "no_confirmable_facts",
  rejectedFactCount = 0,
} = {}) {
  const cid = String(customerId ?? "").trim();
  const mid = String(memoryCommitId ?? "").trim();
  if (!supabase || !cid || !mid) {
    return { ok: false, reason: "missing_scope" };
  }
  const payloadContracts = Array.isArray(contracts) ? contracts : [];
  const status = KEY_DOCUMENT_READ_STATUSES.includes(readStatus)
    ? readStatus
    : "no_confirmable_facts";

  const { data, error } = await supabase.rpc("lifeguard_commit_key_document_memory", {
    p_customer_id: cid,
    p_memory_commit_id: mid,
    p_contracts: payloadContracts,
    p_read_status: status,
    p_rejected_fact_count: Math.max(0, Number(rejectedFactCount) || 0),
  });
  if (error) {
    return { ok: false, reason: "rpc_failed", error: error.message };
  }
  const row = Array.isArray(data) ? data[0] : data;
  if (!row || row.ok !== true) {
    return {
      ok: false,
      reason: row?.reason ?? "commit_rejected",
      memory_commit_id: mid,
    };
  }
  return {
    ok: true,
    memory_commit_id: row.memory_commit_id,
    memory_version: row.memory_version,
    commit_status: row.commit_status,
    already_committed: row.already_committed === true,
  };
}

export async function failKeyDocumentMemoryCommit({
  supabase = null,
  customerId = null,
  memoryCommitId = null,
  failureCode = "persist_failed",
  failureStage = "commit",
} = {}) {
  const cid = String(customerId ?? "").trim();
  const mid = String(memoryCommitId ?? "").trim();
  if (!supabase || !cid || !mid) {
    return { ok: false, reason: "missing_scope" };
  }
  const { data, error } = await supabase
    .from("key_document_memory_commits")
    .update({
      commit_status: "failed",
      failure_code: String(failureCode ?? "persist_failed").slice(0, 120),
      failure_stage: String(failureStage ?? "commit").slice(0, 80),
      updated_at: new Date().toISOString(),
    })
    .eq("customer_id", cid)
    .eq("memory_commit_id", mid)
    .neq("commit_status", "committed")
    .select("memory_commit_id, commit_status")
    .maybeSingle();
  if (error) {
    return { ok: false, reason: "fail_update_failed", error: error.message };
  }
  return {
    ok: true,
    memory_commit_id: data?.memory_commit_id ?? mid,
    commit_status: data?.commit_status ?? "failed",
  };
}

export async function loadActiveKeyDocumentMemoryCommit({
  supabase = null,
  customerId = null,
  sessionId = null,
} = {}) {
  const cid = String(customerId ?? "").trim();
  const sid = String(sessionId ?? "").trim();
  if (!supabase || !cid || !sid) {
    return { ok: false, row: null, reason: "missing_scope" };
  }
  const { data, error } = await supabase
    .from("key_document_memory_commits")
    .select("*")
    .eq("customer_id", cid)
    .eq("session_id", sid)
    .eq("commit_status", "committed")
    .eq("focus_status", "active")
    .order("memory_version", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    return { ok: false, row: null, reason: "query_failed", error: error.message };
  }
  return { ok: true, row: data ?? null, reason: data ? "hit" : "miss" };
}

/**
 * Customer-wide committed+active rows (excludes superseded/closed/failed).
 * Ownership: customer_id filter only — caller must pass the authenticated customer id.
 */
export async function loadActiveKeyDocumentMemoryCommitsForCustomer({
  supabase = null,
  customerId = null,
  limit = 12,
} = {}) {
  const cid = String(customerId ?? "").trim();
  if (!supabase || !cid) {
    return { ok: false, rows: [], reason: "missing_scope" };
  }
  const { data, error } = await supabase
    .from("key_document_memory_commits")
    .select("*")
    .eq("customer_id", cid)
    .eq("commit_status", "committed")
    .eq("focus_status", "active")
    .order("memory_version", { ascending: false })
    .limit(Math.max(1, Number(limit) || 12));
  if (error) {
    return {
      ok: false,
      rows: [],
      reason: "query_failed",
      error: error.message,
    };
  }
  const rows = Array.isArray(data) ? data : [];
  return { ok: true, rows, reason: rows.length ? "hit" : "miss" };
}

/**
 * Official memory recall order:
 * 1) current session committed+active
 * 2) else same customer's latest committed+active (cross-session)
 * Never returns superseded/closed/failed. Ownership mismatch → unused.
 */
export async function resolveOfficialDocumentMemoryForTurn({
  supabase = null,
  customerId = null,
  sessionId = null,
} = {}) {
  const cid = String(customerId ?? "").trim();
  const sid = String(sessionId ?? "").trim();
  if (!supabase || !cid) {
    return {
      ok: false,
      row: null,
      reason: "missing_scope",
      cross_session_recall: false,
      error: null,
    };
  }

  if (sid) {
    const sessionLoad = await loadActiveKeyDocumentMemoryCommit({
      supabase,
      customerId: cid,
      sessionId: sid,
    });
    if (!sessionLoad.ok) {
      return {
        ok: false,
        row: null,
        reason: sessionLoad.reason ?? "query_failed",
        cross_session_recall: false,
        error: sessionLoad.error ?? null,
      };
    }
    if (sessionLoad.row) {
      if (String(sessionLoad.row.customer_id ?? "") !== cid) {
        return {
          ok: true,
          row: null,
          reason: "ownership_mismatch",
          cross_session_recall: false,
          error: null,
        };
      }
      return {
        ok: true,
        row: sessionLoad.row,
        reason: "hit",
        cross_session_recall: false,
        error: null,
      };
    }
  }

  const customerLoad = await loadActiveKeyDocumentMemoryCommitsForCustomer({
    supabase,
    customerId: cid,
    limit: 12,
  });
  if (!customerLoad.ok) {
    return {
      ok: false,
      row: null,
      reason: customerLoad.reason ?? "query_failed",
      cross_session_recall: true,
      error: customerLoad.error ?? null,
    };
  }
  const owned = (customerLoad.rows || []).filter(
    (row) => String(row?.customer_id ?? "") === cid,
  );
  if (!owned.length) {
    return {
      ok: true,
      row: null,
      reason: "miss",
      cross_session_recall: false,
      error: null,
    };
  }
  // Prefer row whose session matches when present; else highest version among owned actives.
  // Contract focus selection happens later in buildKeyRelevantMemoryPacket — not version-alone
  // picking of a different contract. Here we only choose which memory commit row to load.
  const sameSession = sid
    ? owned.find((row) => String(row.session_id ?? "") === sid)
    : null;
  const row = sameSession || owned[0];
  return {
    ok: true,
    row,
    reason: "hit",
    cross_session_recall: !sameSession && String(row.session_id ?? "") !== sid,
    error: null,
  };
}

export async function loadLatestCommittedKeyDocumentMemory({
  supabase = null,
  customerId = null,
} = {}) {
  const cid = String(customerId ?? "").trim();
  if (!supabase || !cid) {
    return { ok: false, row: null, reason: "missing_scope" };
  }
  const { data, error } = await supabase
    .from("key_document_memory_commits")
    .select("*")
    .eq("customer_id", cid)
    .eq("commit_status", "committed")
    .order("memory_version", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    return { ok: false, row: null, reason: "query_failed", error: error.message };
  }
  return { ok: true, row: data ?? null, reason: data ? "hit" : "miss" };
}

/**
 * Distinguish:
 * - ok+hit: committed row present (memory_version >= 1)
 * - ok+miss: query succeeded, zero rows (memory_version = 0)
 * - !ok: missing_scope / query_failed — caller must NOT treat as fresh empty
 */
export async function loadLatestCommittedMemoryVersion({
  supabase = null,
  customerId = null,
} = {}) {
  const loaded = await loadLatestCommittedKeyDocumentMemory({ supabase, customerId });
  if (!loaded.ok) {
    return {
      ok: false,
      memory_version: null,
      reason: loaded.reason ?? "query_failed",
      error: loaded.error ?? null,
    };
  }
  if (!loaded.row) {
    return {
      ok: true,
      memory_version: 0,
      reason: "miss",
      error: null,
    };
  }
  const v = loaded.row.memory_version;
  return {
    ok: true,
    memory_version: v == null ? 0 : Number(v) || 0,
    reason: "hit",
    error: null,
  };
}

/**
 * Document-turn memory persist with limited retries (no Claude / no re-fetch).
 */
export async function persistOfficialDocumentMemoryWithRetry({
  supabase = null,
  customerId = null,
  sessionId = null,
  sourceTurnId = null,
  sourceMessageId = null,
  sourceTurnOrd = null,
  documentIds = [],
  acceptedFacts = [],
  rejectedFactCount = 0,
  originalsFailed = false,
  extractionFailed = false,
  sleepImpl = (ms) => new Promise((r) => setTimeout(r, ms)),
  maxAttempts = 3,
  delaysMs = [0, 250, 750],
} = {}) {
  const contracts = buildContractsFromAcceptedFacts(acceptedFacts);
  const read_status = classifyDocumentReadStatus({
    acceptedCount: contracts.reduce((n, c) => n + (c.fact_refs?.length || 0), 0) > 0
      ? acceptedFacts.length
      : acceptedFacts.length,
    rejectedCount: rejectedFactCount,
    originalsAttached: true,
    originalsFailed,
    extractionFailed,
  });
  // Prefer contracts length for confirmed_facts when facts grouped.
  const finalReadStatus =
    contracts.length > 0
      ? rejectedFactCount > 0
        ? "partial"
        : "confirmed_facts"
      : read_status === "confirmed_facts"
        ? "no_confirmable_facts"
        : read_status;

  let lastError = null;
  let memory_commit_id = null;
  let begin = null;
  for (let i = 0; i < maxAttempts; i += 1) {
    const wait = Number(delaysMs[i] ?? 0) || 0;
    if (wait > 0) await sleepImpl(wait);
    begin = await beginKeyDocumentMemoryCommit({
      supabase,
      customerId,
      sessionId,
      sourceTurnId,
      sourceMessageId,
      sourceTurnOrd,
      documentIds,
      readStatus: finalReadStatus,
      rejectedFactCount,
    });
    if (!begin.ok) {
      lastError = begin;
      continue;
    }
    memory_commit_id = begin.memory_commit_id;
    if (begin.already_committed === true) {
      return {
        ok: true,
        memory_commit_id,
        memory_version: begin.row?.memory_version ?? null,
        commit_status: "committed",
        already_committed: true,
        context: buildKeyLatestDocumentContext(begin.row),
        attempts: i + 1,
      };
    }
    const committed = await commitKeyDocumentMemory({
      supabase,
      customerId,
      memoryCommitId: memory_commit_id,
      contracts,
      readStatus: finalReadStatus,
      rejectedFactCount,
    });
    if (committed.ok) {
      const active = await loadActiveKeyDocumentMemoryCommit({
        supabase,
        customerId,
        sessionId,
      });
      return {
        ok: true,
        memory_commit_id: committed.memory_commit_id,
        memory_version: committed.memory_version,
        commit_status: "committed",
        already_committed: committed.already_committed === true,
        context: buildKeyLatestDocumentContext(active.row),
        attempts: i + 1,
      };
    }
    lastError = committed;
  }
  if (memory_commit_id) {
    await failKeyDocumentMemoryCommit({
      supabase,
      customerId,
      memoryCommitId: memory_commit_id,
      failureCode: lastError?.reason ?? "persist_failed",
      failureStage: "commit_retry_exhausted",
    });
  }
  return {
    ok: false,
    memory_commit_id,
    commit_status: "failed",
    reason: lastError?.reason ?? "persist_failed",
    error: lastError?.error ?? null,
    attempts: maxAttempts,
  };
}

export function buildDocumentMemoryPersistFailedPayload({
  memoryCommitId = null,
  errorMessage = null,
} = {}) {
  return {
    reason: KEY_DOCUMENT_MEMORY_PERSIST_FAILED,
    answer_sealed: true,
    memory_commit_id: memoryCommitId ? String(memoryCommitId) : null,
    commit_status: "failed",
    error_message:
      String(errorMessage ?? "").trim() ||
      "답변은 준비됐지만 KEY 공식 기억 저장이 완료되지 않았습니다. 기억 저장을 다시 시도해 주세요.",
  };
}

/** True when a KEY document-memory row is rooted in the given document id. */
export function keyDocumentMemoryReferencesDocument(row, documentId) {
  const did = String(documentId ?? "").trim();
  if (!did || !row || typeof row !== "object") return false;
  if (String(row.primary_document_id ?? "").trim() === did) return true;
  const ids = Array.isArray(row.document_ids) ? row.document_ids : [];
  return ids.some((id) => String(id ?? "").trim() === did);
}

/**
 * S3 — After soft-delete finalize: supersede active KEY document-memory commits
 * that originate from the deleted document. Does not touch unrelated memory.
 * Fail-closed: query/update errors → ok:false (caller must not treat delete as clean).
 */
export async function supersedeKeyDocumentMemoryForDeletedDocument({
  supabase = null,
  customerId = null,
  documentId = null,
} = {}) {
  const cid = String(customerId ?? "").trim();
  const did = String(documentId ?? "").trim();
  if (!supabase || !cid || !did) {
    return {
      ok: false,
      attempted: false,
      superseded: 0,
      reason: "missing_ids",
      memory_commit_ids: [],
    };
  }

  const { data, error } = await supabase
    .from("key_document_memory_commits")
    .select(
      "id, memory_commit_id, document_ids, primary_document_id, focus_status, commit_status",
    )
    .eq("customer_id", cid)
    .eq("focus_status", "active");

  if (error) {
    return {
      ok: false,
      attempted: true,
      superseded: 0,
      reason: "query_failed",
      error: error.message,
      memory_commit_ids: [],
    };
  }

  const matches = (Array.isArray(data) ? data : []).filter((row) =>
    keyDocumentMemoryReferencesDocument(row, did),
  );
  if (matches.length === 0) {
    return {
      ok: true,
      attempted: true,
      superseded: 0,
      reason: "no_active_document_memory",
      memory_commit_ids: [],
    };
  }

  const rowIds = matches.map((row) => row.id).filter(Boolean);
  const now = new Date().toISOString();
  const { data: updated, error: updateError } = await supabase
    .from("key_document_memory_commits")
    .update({
      focus_status: "superseded",
      updated_at: now,
    })
    .eq("customer_id", cid)
    .eq("focus_status", "active")
    .in("id", rowIds)
    .select("id, memory_commit_id");

  if (updateError) {
    return {
      ok: false,
      attempted: true,
      superseded: 0,
      reason: "supersede_failed",
      error: updateError.message,
      memory_commit_ids: [],
    };
  }

  const rows = Array.isArray(updated) ? updated : [];
  return {
    ok: true,
    attempted: true,
    superseded: rows.length,
    reason: "superseded",
    memory_commit_ids: rows
      .map((row) => String(row.memory_commit_id ?? "").trim())
      .filter(Boolean),
  };
}
