/**
 * Server restore of the active insurance-document counseling case.
 * Client document_id is a hint only — conversation metadata + ownership win.
 * Never dumps the full vault; never invents a latest document without a prior case link.
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
 * Resolve active insurance document case for Claude-first vault gating.
 * Priority:
 * 1) verified request document_id(s)
 * 2) same session recent active attachment / analysis case (multi-id snapshot)
 * 3) verified prior attachment/analysis relation (same customer)
 * 4) none → document-less general question
 */
export async function resolveActiveInsuranceDocumentCase({
  supabase = null,
  customerId = null,
  sessionId = null,
  clientDocumentId = null,
  clientDocumentIds = null,
  limit = 80,
  verifyOwned = verifyOwnedActiveDocument,
} = {}) {
  const cid = String(customerId ?? "").trim();
  const clientIds = [
    ...new Set(
      [
        ...(Array.isArray(clientDocumentIds) ? clientDocumentIds : []),
        clientDocumentId,
      ]
        .map((id) => String(id ?? "").trim())
        .filter(Boolean),
    ),
  ];
  const clientId = clientIds[0] || "";

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
