/**
 * Server restore of the active insurance-document counseling case.
 * Client document_id is a hint only — conversation metadata + ownership win.
 * Never dumps the full vault; never invents a latest document without a prior case link.
 *
 * Prior-original scope (enforceAttachmentScope):
 * - current-turn uploads may attach
 * - prior originals attach only when attachment reference is enabled AND id ∈ active_attachment_ids
 * - request_document_id alone / conversation handoff / session case must not reattach prior originals
 */
import {
  extractActiveDocumentCaseIdFromMetadata,
  extractActiveAttachmentIdsFromMetadata,
  pickActiveInsuranceDocumentCaseFromConversationRows,
} from "../../src/lib/chatActiveAttachment.js";

export {
  extractActiveDocumentCaseIdFromMetadata,
  pickActiveInsuranceDocumentCaseFromConversationRows,
} from "../../src/lib/chatActiveAttachment.js";

function normalizeDocumentIds(documentIds = null, documentId = null) {
  return [
    ...new Set(
      [
        ...(Array.isArray(documentIds) ? documentIds : []),
        documentId,
      ]
        .map((id) => String(id ?? "").trim())
        .filter(Boolean),
    ),
  ];
}

async function verifyOwnedActiveDocument({
  supabase = null,
  customerId = null,
  documentId = null,
} = {}) {
  const cid = String(customerId ?? "").trim();
  const did = String(documentId ?? "").trim();
  if (!supabase || !cid || !did) return false;
  try {
    const { data, error } = await supabase
      .from("customer_documents")
      .select("id, customer_id, deleted_at")
      .eq("id", did)
      .eq("customer_id", cid)
      .is("deleted_at", null)
      .maybeSingle();
    if (error || !data) return false;
    return String(data.customer_id ?? "").trim() === cid;
  } catch {
    return false;
  }
}

async function filterOwnedDocumentIds({
  supabase = null,
  customerId = null,
  documentIds = [],
  verifyOwned = verifyOwnedActiveDocument,
} = {}) {
  const out = [];
  for (const raw of Array.isArray(documentIds) ? documentIds : []) {
    const id = String(raw ?? "").trim();
    if (!id || out.includes(id)) continue;
    const owned = await verifyOwned({
      supabase,
      customerId,
      documentId: id,
    });
    if (owned) out.push(id);
  }
  return out;
}

/**
 * Resolve attachable insurance document ids for Claude original delivery.
 * When enforceAttachmentScope is true, conversation/session restore cannot authorize originals.
 */
export async function resolveActiveInsuranceDocumentCase({
  supabase = null,
  customerId = null,
  sessionId = null,
  clientDocumentId = null,
  clientDocumentIds = null,
  attachmentReferenceEnabled = false,
  activeAttachmentIds = null,
  currentTurnDocumentIds = null,
  enforceAttachmentScope = false,
  limit = 80,
  verifyOwned = verifyOwnedActiveDocument,
} = {}) {
  const cid = String(customerId ?? "").trim();
  const clientIds = normalizeDocumentIds(clientDocumentIds, clientDocumentId);
  const clientId = clientIds[0] || "";

  if (enforceAttachmentScope === true) {
    const currentTurnIds = normalizeDocumentIds(currentTurnDocumentIds);
    const activeIds =
      attachmentReferenceEnabled === true
        ? normalizeDocumentIds(activeAttachmentIds)
        : [];
    const authorizedPool = normalizeDocumentIds([...currentTurnIds, ...activeIds]);

    if (!authorizedPool.length) {
      return {
        documentId: null,
        documentIds: [],
        caseSource: null,
        reason: "no_active_attachment_scope",
        restored: false,
      };
    }

    if (!supabase || !cid) {
      const selected =
        clientIds.length > 0
          ? clientIds.filter((id) => authorizedPool.includes(id))
          : authorizedPool.slice();
      if (!selected.length) {
        return {
          documentId: null,
          documentIds: [],
          caseSource: null,
          reason: "request_document_id_outside_active_scope",
          restored: false,
        };
      }
      return {
        documentId: selected[0],
        documentIds: selected,
        caseSource: currentTurnIds.length
          ? "current_turn_document_ids"
          : "active_attachment_ids",
        reason: "client_unverified_scoped_no_db",
        restored: false,
      };
    }

    const ownedPool = await filterOwnedDocumentIds({
      supabase,
      customerId: cid,
      documentIds: authorizedPool,
      verifyOwned,
    });
    if (!ownedPool.length) {
      return {
        documentId: null,
        documentIds: [],
        caseSource: null,
        reason: "authorized_attachment_scope_unowned",
        restored: false,
      };
    }

    const ownedClient = await filterOwnedDocumentIds({
      supabase,
      customerId: cid,
      documentIds: clientIds,
      verifyOwned,
    });
    const selected =
      ownedClient.length > 0
        ? ownedClient.filter((id) => ownedPool.includes(id))
        : ownedPool.slice();

    if (!selected.length) {
      return {
        documentId: null,
        documentIds: [],
        caseSource: null,
        reason: "request_document_id_outside_active_scope",
        restored: false,
      };
    }

    const ownedCurrent = ownedPool.filter((id) => currentTurnIds.includes(id));
    return {
      documentId: selected[0],
      documentIds: selected,
      caseSource: ownedCurrent.length
        ? "current_turn_document_ids"
        : attachmentReferenceEnabled === true
          ? "active_attachment_ids"
          : "request_document_id",
      reason:
        ownedClient.length > 0
          ? "client_verified_in_active_scope"
          : "authorized_attachment_scope",
      restored: false,
    };
  }

  if (!supabase || !cid) {
    if (clientIds.length) {
      return {
        documentId: clientIds[0],
        documentIds: clientIds.slice(),
        caseSource: "request_document_id",
        reason: "client_unverified_no_db",
        restored: false,
      };
    }
    return {
      documentId: null,
      documentIds: [],
      caseSource: null,
      reason: "missing_scope",
      restored: false,
    };
  }

  let rows = [];
  try {
    const { data, error } = await supabase
      .from("customer_conversations")
      .select("role, metadata_json, created_at")
      .eq("customer_id", cid)
      .order("created_at", { ascending: false })
      .limit(Math.max(1, Number(limit) || 80));
    if (error) {
      rows = [];
    } else {
      rows = Array.isArray(data) ? data : [];
    }
  } catch {
    rows = [];
  }

  const sid = String(sessionId ?? "").trim();
  const picked = pickActiveInsuranceDocumentCaseFromConversationRows({
    rows,
    sessionId: sid || null,
  });
  const snapshotIds = Array.isArray(picked?.documentIds)
    ? picked.documentIds
    : picked?.documentId
      ? [picked.documentId]
      : [];

  if (clientIds.length) {
    const ownedClient = await filterOwnedDocumentIds({
      supabase,
      customerId: cid,
      documentIds: clientIds,
      verifyOwned,
    });
    if (ownedClient.length) {
      // Singular follow-up id that belongs to prior multi-attach → restore full snapshot.
      let merged = ownedClient.slice();
      if (
        ownedClient.length === 1 &&
        snapshotIds.length > 1 &&
        snapshotIds.includes(ownedClient[0])
      ) {
        const ownedSnap = await filterOwnedDocumentIds({
          supabase,
          customerId: cid,
          documentIds: snapshotIds,
          verifyOwned,
        });
        if (ownedSnap.length > 1) merged = ownedSnap;
      } else if (clientIds.length > 1) {
        merged = ownedClient;
      }
      return {
        documentId: merged[0],
        documentIds: merged,
        caseSource: "request_document_id",
        reason:
          merged.length > ownedClient.length
            ? "client_verified_expanded_snapshot"
            : "client_verified",
        restored: merged.length > ownedClient.length,
      };
    }
    // Foreign / deleted client hint — never honor; fall through to server records.
  }

  if (snapshotIds.length) {
    const ownedIds = await filterOwnedDocumentIds({
      supabase,
      customerId: cid,
      documentIds: snapshotIds,
      verifyOwned,
    });
    if (ownedIds.length) {
      return {
        documentId: ownedIds[0],
        documentIds: ownedIds,
        caseSource: picked.caseSource,
        reason: picked.reason,
        restored: true,
      };
    }
  }

  // Fallback: walk newest rows and verify first owned id (legacy single-id path).
  const tried = new Set();
  for (const row of rows) {
    const meta =
      row?.metadata_json && typeof row.metadata_json === "object"
        ? row.metadata_json
        : {};
    const ids = extractActiveAttachmentIdsFromMetadata(meta);
    for (const documentId of ids) {
      if (!documentId || tried.has(documentId)) continue;
      tried.add(documentId);
      const owned = await verifyOwned({
        supabase,
        customerId: cid,
        documentId,
      });
      if (!owned) continue;
      return {
        documentId,
        documentIds: [documentId],
        caseSource: "prior_attachment_analysis_relation",
        reason: "customer_recent_active_attachment",
        restored: true,
      };
    }
  }

  return {
    documentId: null,
    documentIds: [],
    caseSource: null,
    reason: "no_active_case",
    restored: false,
  };
}
