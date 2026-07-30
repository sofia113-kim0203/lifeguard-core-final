/**
 * Server restore of the active insurance-document counseling case.
 * Client document_id is a hint only — conversation metadata + ownership win.
 * Never dumps the full vault; never invents a latest document without a prior case link.
 */
import { extractActiveDocumentCaseIdFromMetadata } from "../../src/lib/chatActiveAttachment.js";

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

/**
 * Resolve active insurance document case for Claude-first vault gating.
 * Priority:
 * 1) verified request document_id
 * 2) same session recent active attachment / analysis case
 * 3) verified prior attachment/analysis relation (same customer)
 * 4) none → document-less general question
 */
export async function resolveActiveInsuranceDocumentCase({
  supabase = null,
  customerId = null,
  sessionId = null,
  clientDocumentId = null,
  limit = 80,
  verifyOwned = verifyOwnedActiveDocument,
} = {}) {
  const cid = String(customerId ?? "").trim();
  const clientId = String(clientDocumentId ?? "").trim();

  if (clientId) {
    const owned = await verifyOwned({
      supabase,
      customerId: cid,
      documentId: clientId,
    });
    if (owned) {
      return {
        documentId: clientId,
        caseSource: "request_document_id",
        reason: "client_verified",
        restored: false,
      };
    }
    // Foreign / deleted client hint — never honor; fall through to server records.
  }

  if (!supabase || !cid) {
    return {
      documentId: null,
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
      return {
        documentId: null,
        caseSource: null,
        reason: "query_failed",
        restored: false,
      };
    }
    rows = Array.isArray(data) ? data : [];
  } catch {
    return {
      documentId: null,
      caseSource: null,
      reason: "query_exception",
      restored: false,
    };
  }

  const sid = String(sessionId ?? "").trim();
  const tried = new Set(clientId ? [clientId] : []);

  const consider = async (sessionOnly) => {
    for (const row of rows) {
      const meta =
        row?.metadata_json && typeof row.metadata_json === "object"
          ? row.metadata_json
          : {};
      const rowSid = String(meta.session_id ?? "").trim();
      if (sessionOnly) {
        if (!sid || rowSid !== sid) continue;
      } else if (sid && rowSid === sid) {
        continue;
      }
      const documentId = extractActiveDocumentCaseIdFromMetadata(meta);
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
        caseSource: sessionOnly
          ? "session_active_insurance_case"
          : "prior_attachment_analysis_relation",
        reason: sessionOnly
          ? "session_metadata_active_attachment"
          : "customer_recent_active_attachment",
        restored: true,
      };
    }
    return null;
  };

  if (sid) {
    const sessionHit = await consider(true);
    if (sessionHit) return sessionHit;
  }
  const priorHit = await consider(false);
  if (priorHit) return priorHit;

  return {
    documentId: null,
    caseSource: null,
    reason: "no_active_case",
    restored: false,
  };
}
