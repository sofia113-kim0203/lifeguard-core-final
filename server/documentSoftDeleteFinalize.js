/**
 * I-6 — soft-delete post-steps via service_role (document_id).
 * RPC remains SSOT for tombstone + in-transaction policy retire.
 * Customer JWT must not re-SELECT soft-deleted rows to finish cleanup.
 */

import { scrubInsuranceMemoryForRetiredPolicies } from "./customerMemoryFoundation.js";

export const STORAGE_BUCKET = "customer-documents";

export const DOCUMENT_SOFT_DELETE_FINALIZE_REASON = Object.freeze({
  DOCUMENT_NOT_FOUND: "document_not_found",
  DOCUMENT_NOT_SOFT_DELETED: "document_not_soft_deleted",
  OWNERSHIP_MISMATCH: "ownership_mismatch",
  POLICY_RETIRE_FAILED: "policy_retire_failed",
  CLAIM_SCRUB_FAILED: "claim_scrub_failed",
  STORAGE_REMOVE_FAILED: "storage_remove_failed",
  MEMORY_SCRUB_FAILED: "memory_scrub_failed",
});

export function isStorageRemoveAlreadyGoneError(error = null) {
  const msg = String(error?.message ?? error ?? "").toLowerCase();
  if (!msg) return false;
  return (
    msg.includes("not found") ||
    msg.includes("no such file") ||
    msg.includes("object not found") ||
    msg.includes("404")
  );
}

export function claimCaseReferencesSourceDocument(row, documentId) {
  const did = String(documentId ?? "").trim();
  if (!did || !row || typeof row !== "object") return false;
  const medical =
    row.medical_event && typeof row.medical_event === "object" ? row.medical_event : {};
  if (String(medical.source_document_id ?? "").trim() === did) return true;
  if (String(row.source_document_id ?? "").trim() === did) return true;
  const key = String(row.claim_case_key ?? "").trim();
  if (key.startsWith(`doc:${did}:`)) return true;
  return false;
}

async function retirePoliciesForSourceDocumentIds(
  customerId,
  documentIds,
  client,
  retiredReason = "source_document_deleted",
) {
  const cid = String(customerId ?? "").trim();
  const idSet = new Set(
    (Array.isArray(documentIds) ? documentIds : [])
      .map((id) => String(id ?? "").trim())
      .filter(Boolean),
  );
  if (!cid || idSet.size === 0) {
    return { ok: false, attempted: false, retired: 0, reason: "missing_ids" };
  }
  const { data: rows, error: selectError } = await client
    .from("profile_insurance_policies")
    .select("id, coverage_summary, is_active")
    .eq("customer_id", cid)
    .is("deleted_at", null);
  if (selectError) {
    return { ok: false, attempted: true, retired: 0, error: selectError.message };
  }
  const matches = (Array.isArray(rows) ? rows : []).filter((row) => {
    if (row?.is_active === false) return false;
    const summary =
      row?.coverage_summary && typeof row.coverage_summary === "object"
        ? row.coverage_summary
        : {};
    if (String(summary.retired_reason ?? "").trim()) return false;
    return idSet.has(String(summary.source_document_id ?? "").trim());
  });
  if (matches.length === 0) {
    return {
      ok: true,
      attempted: true,
      retired: 0,
      retired_policy_ids: [],
      reason: "no_active_source_policies",
    };
  }
  const retiredAt = new Date().toISOString();
  let retired = 0;
  const retiredPolicyIds = [];
  const errors = [];
  for (const row of matches) {
    const summary =
      row.coverage_summary && typeof row.coverage_summary === "object"
        ? row.coverage_summary
        : {};
    const { error: updateError } = await client
      .from("profile_insurance_policies")
      .update({
        is_active: false,
        coverage_summary: {
          ...summary,
          retired_at: retiredAt,
          retired_reason: retiredReason,
        },
        updated_at: retiredAt,
      })
      .eq("id", row.id)
      .eq("customer_id", cid);
    if (updateError) {
      errors.push({ policy_id: row.id, message: updateError.message });
      continue;
    }
    retired += 1;
    retiredPolicyIds.push(String(row.id));
  }
  return {
    ok: errors.length === 0,
    attempted: true,
    retired,
    retired_policy_ids: retiredPolicyIds,
    match_count: matches.length,
    errors,
  };
}

async function retireOrphanSourceDeletedPoliciesForCustomer(customerId, client) {
  const cid = String(customerId ?? "").trim();
  if (!cid) {
    return { ok: false, attempted: false, retired: 0, reason: "missing_ids" };
  }
  const { data: activeDocs, error: docsError } = await client
    .from("customer_documents")
    .select("id")
    .eq("customer_id", cid)
    .is("deleted_at", null);
  if (docsError) {
    return { ok: false, attempted: true, retired: 0, error: docsError.message };
  }
  const activeIds = new Set(
    (Array.isArray(activeDocs) ? activeDocs : [])
      .map((row) => String(row?.id ?? "").trim())
      .filter(Boolean),
  );
  const { data: rows, error: selectError } = await client
    .from("profile_insurance_policies")
    .select("id, coverage_summary, is_active")
    .eq("customer_id", cid)
    .is("deleted_at", null);
  if (selectError) {
    return { ok: false, attempted: true, retired: 0, error: selectError.message };
  }
  const orphanSourceIds = [
    ...new Set(
      (Array.isArray(rows) ? rows : [])
        .filter((row) => {
          if (row?.is_active === false) return false;
          const summary =
            row?.coverage_summary && typeof row.coverage_summary === "object"
              ? row.coverage_summary
              : {};
          if (String(summary.retired_reason ?? "").trim()) return false;
          const sourceId = String(summary.source_document_id ?? "").trim();
          if (!sourceId) return false;
          return !activeIds.has(sourceId);
        })
        .map((row) => String(row.coverage_summary?.source_document_id ?? "").trim())
        .filter(Boolean),
    ),
  ];
  if (orphanSourceIds.length === 0) {
    return {
      ok: true,
      attempted: true,
      retired: 0,
      retired_policy_ids: [],
      reason: "no_orphan_source_policies",
    };
  }
  return retirePoliciesForSourceDocumentIds(
    cid,
    orphanSourceIds,
    client,
    "source_document_deleted_backfill",
  );
}

async function scrubProfileClaimCasesForDeletedDocument(customerId, documentId, client) {
  const did = String(documentId ?? "").trim();
  if (!customerId || !did) {
    return { ok: false, attempted: false, removed: 0, reason: "missing_ids" };
  }
  const { data: row, error: selectError } = await client
    .from("profile_health")
    .select("customer_id, details_json")
    .eq("customer_id", customerId)
    .maybeSingle();
  if (selectError) {
    return { ok: false, attempted: true, removed: 0, error: selectError.message };
  }
  if (!row?.customer_id) {
    return { ok: true, attempted: true, removed: 0, reason: "no_profile_health_row" };
  }
  const details =
    row.details_json && typeof row.details_json === "object" ? row.details_json : {};
  const existing = Array.isArray(details.key_active_claim_cases)
    ? details.key_active_claim_cases
    : [];
  const next = existing.filter((c) => !claimCaseReferencesSourceDocument(c, did));
  const removed = Math.max(0, existing.length - next.length);
  if (removed === 0) {
    return { ok: true, attempted: true, removed: 0, case_count: existing.length };
  }
  const { error: updateError } = await client
    .from("profile_health")
    .update({
      details_json: { ...details, key_active_claim_cases: next },
      updated_at: new Date().toISOString(),
    })
    .eq("customer_id", customerId);
  if (updateError) {
    return { ok: false, attempted: true, removed: 0, error: updateError.message };
  }
  return { ok: true, attempted: true, removed, case_count: next.length };
}

/**
 * Complete post-RPC soft-delete cleanup for one owned document.
 * Requires document.deleted_at set (RPC SSOT). Fail-closed otherwise.
 */
export async function finalizeCustomerDocumentSoftDelete({
  admin,
  customerId,
  documentId,
  storageRemove = null,
  scrubInsuranceMemory = null,
} = {}) {
  const cid = String(customerId ?? "").trim();
  const did = String(documentId ?? "").trim();
  if (!admin || !cid || !did) {
    return {
      success: false,
      reason: DOCUMENT_SOFT_DELETE_FINALIZE_REASON.DOCUMENT_NOT_FOUND,
      documentId: did || null,
      customerId: cid || null,
      soft_delete_ok: false,
      current_insurance_invalidated: false,
      clear_active_attachment: false,
      error_message: "문서를 찾을 수 없습니다.",
    };
  }

  const { data: document, error: readError } = await admin
    .from("customer_documents")
    .select("id, customer_id, storage_path, deleted_at")
    .eq("id", did)
    .maybeSingle();

  if (readError || !document) {
    return {
      success: false,
      reason: DOCUMENT_SOFT_DELETE_FINALIZE_REASON.DOCUMENT_NOT_FOUND,
      documentId: did,
      customerId: cid,
      soft_delete_ok: false,
      current_insurance_invalidated: false,
      clear_active_attachment: false,
      error_message: "문서를 찾을 수 없습니다.",
    };
  }

  if (String(document.customer_id) !== cid) {
    return {
      success: false,
      reason: DOCUMENT_SOFT_DELETE_FINALIZE_REASON.OWNERSHIP_MISMATCH,
      documentId: did,
      customerId: cid,
      soft_delete_ok: false,
      current_insurance_invalidated: false,
      clear_active_attachment: false,
      error_message: "문서를 찾을 수 없습니다.",
    };
  }

  if (!document.deleted_at) {
    return {
      success: false,
      reason: DOCUMENT_SOFT_DELETE_FINALIZE_REASON.DOCUMENT_NOT_SOFT_DELETED,
      documentId: did,
      customerId: cid,
      soft_delete_ok: false,
      current_insurance_invalidated: false,
      clear_active_attachment: false,
      error_message: "문서 삭제가 아직 완료되지 않았습니다. 다시 시도해 주세요.",
    };
  }

  const deletedAt = document.deleted_at;
  const softDeleteOk = true;
  const currentInsuranceInvalidated = true;
  const clearActiveAttachment = true;

  const policyRetire = await retirePoliciesForSourceDocumentIds(
    cid,
    [did],
    admin,
    "source_document_deleted",
  );
  const orphanRetire = await retireOrphanSourceDeletedPoliciesForCustomer(cid, admin);
  if (policyRetire?.ok !== true || orphanRetire?.ok !== true) {
    return {
      success: false,
      reason: DOCUMENT_SOFT_DELETE_FINALIZE_REASON.POLICY_RETIRE_FAILED,
      documentId: did,
      customerId: cid,
      deletedAt,
      soft_delete_ok: softDeleteOk,
      current_insurance_invalidated: currentInsuranceInvalidated,
      clear_active_attachment: clearActiveAttachment,
      policy_retire: policyRetire,
      orphan_policy_retire: orphanRetire,
      claim_cases_scrub: null,
      storage_remove_ok: null,
      error_message: "일부 관련 기록을 정리하지 못했습니다. 다시 시도해 주세요.",
    };
  }

  const claimCasesScrub = await scrubProfileClaimCasesForDeletedDocument(cid, did, admin);
  if (!claimCasesScrub.ok) {
    return {
      success: false,
      reason: DOCUMENT_SOFT_DELETE_FINALIZE_REASON.CLAIM_SCRUB_FAILED,
      documentId: did,
      customerId: cid,
      deletedAt,
      soft_delete_ok: softDeleteOk,
      current_insurance_invalidated: currentInsuranceInvalidated,
      clear_active_attachment: clearActiveAttachment,
      policy_retire: policyRetire,
      orphan_policy_retire: orphanRetire,
      claim_cases_scrub: claimCasesScrub,
      storage_remove_ok: null,
      error_message: "일부 관련 기록을 정리하지 못했습니다. 다시 시도해 주세요.",
    };
  }

  const removeFn =
    storageRemove ??
    (async (storagePath) => {
      const { error } = await admin.storage.from(STORAGE_BUCKET).remove([storagePath]);
      if (error && !isStorageRemoveAlreadyGoneError(error)) {
        return { ok: false, error };
      }
      return { ok: true, already_gone: Boolean(error) };
    });

  let storageRemoveOk = true;
  if (document.storage_path) {
    const storageResult = await removeFn(document.storage_path);
    storageRemoveOk = storageResult?.ok === true;
    if (!storageRemoveOk) {
      return {
        success: false,
        reason: DOCUMENT_SOFT_DELETE_FINALIZE_REASON.STORAGE_REMOVE_FAILED,
        documentId: did,
        customerId: cid,
        deletedAt,
        soft_delete_ok: softDeleteOk,
        current_insurance_invalidated: currentInsuranceInvalidated,
        clear_active_attachment: clearActiveAttachment,
        policy_retire: policyRetire,
        orphan_policy_retire: orphanRetire,
        claim_cases_scrub: claimCasesScrub,
        storage_remove_ok: false,
        error_message:
          "파일 정보는 제외되었습니다. 원본 정리에 실패해 다시 시도해 주세요.",
      };
    }
  }

  const retiredPolicyIds = [
    ...new Set([
      ...(Array.isArray(policyRetire?.retired_policy_ids) ? policyRetire.retired_policy_ids : []),
      ...(Array.isArray(orphanRetire?.retired_policy_ids) ? orphanRetire.retired_policy_ids : []),
    ]),
  ];

  let memoryScrub;
  try {
    memoryScrub = scrubInsuranceMemory
      ? await scrubInsuranceMemory({ retiredPolicyIds })
      : await scrubInsuranceMemoryForRetiredPolicies({
          supabase: admin,
          customerId: cid,
          retiredPolicyIds,
        });
  } catch (err) {
    memoryScrub = {
      ok: false,
      reason: "memory_scrub_threw",
      error_message: err instanceof Error ? err.message : String(err),
    };
  }
  if (memoryScrub?.ok !== true) {
    return {
      success: false,
      reason: DOCUMENT_SOFT_DELETE_FINALIZE_REASON.MEMORY_SCRUB_FAILED,
      documentId: did,
      customerId: cid,
      deletedAt,
      soft_delete_ok: softDeleteOk,
      current_insurance_invalidated: currentInsuranceInvalidated,
      clear_active_attachment: clearActiveAttachment,
      policy_retire: policyRetire,
      orphan_policy_retire: orphanRetire,
      claim_cases_scrub: claimCasesScrub,
      storage_remove_ok: storageRemoveOk,
      retired_policy_ids: retiredPolicyIds,
      memory_scrub: memoryScrub,
      error_message: "일부 관련 기록을 정리하지 못했습니다. 다시 시도해 주세요.",
    };
  }

  return {
    success: true,
    reason: null,
    documentId: did,
    customerId: cid,
    deletedAt,
    soft_delete_ok: softDeleteOk,
    current_insurance_invalidated: currentInsuranceInvalidated,
    clear_active_attachment: clearActiveAttachment,
    policy_retire: policyRetire,
    orphan_policy_retire: orphanRetire,
    claim_cases_scrub: claimCasesScrub,
    storage_remove_ok: storageRemoveOk,
    retired_policy_ids: retiredPolicyIds,
    memory_scrub: memoryScrub,
    error_message: null,
    finalize_via: "service_role_document_id",
  };
}
