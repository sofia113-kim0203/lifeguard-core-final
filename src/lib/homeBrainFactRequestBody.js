/**
 * Pure home KEY request body builder (browser + Node unit-test safe).
 */

import { resolveAttachDocumentIdContract } from "./homeBrainAttachDocumentIds.js";
import { resolveOneShotAttachmentRequestScope } from "./originalAttachmentOneShot.js";

/**
 * Isolate attach-authority fields for the request body.
 * Original bytes: current-turn uploads or explicit chip reopen only.
 * Restorable candidates / past active ids must never appear as delivery authority.
 */
export function resolveAttachmentRequestScope({
  attachmentReferenceEnabled = false,
  activeAttachmentIds = null,
  currentTurnDocumentIds = null,
  explicitReopenDocumentIds = null,
  documentId = null,
  documentIds = null,
} = {}) {
  void attachmentReferenceEnabled;
  void activeAttachmentIds;
  void documentId;
  void documentIds;
  const oneShot = resolveOneShotAttachmentRequestScope({
    currentTurnDocumentIds,
    explicitReopenDocumentIds,
  });
  // Wire contract: single id → documentIds empty for compat; multi → full list.
  const contract = resolveAttachDocumentIdContract({
    documentIds: oneShot.documentIds,
  });
  return {
    attachmentReferenceEnabled: false,
    activeAttachmentIds: [],
    currentTurnDocumentIds: oneShot.currentTurnDocumentIds,
    explicitReopenDocumentIds: oneShot.explicitReopenDocumentIds,
    documentId: contract.documentId,
    documentIds: contract.documentIds,
    deliveryReason: oneShot.deliveryReason,
  };
}

export function buildHomeBrainFactRequestBody(question, history = [], options = {}) {
  const presenceTurn = options.presence === true || options.presenceTurn === true;
  const trimmed = presenceTurn ? "" : String(question ?? "").trim();
  const scope = presenceTurn
    ? {
        attachmentReferenceEnabled: false,
        activeAttachmentIds: [],
        currentTurnDocumentIds: [],
        explicitReopenDocumentIds: [],
        documentId: null,
        documentIds: [],
      }
    : resolveAttachmentRequestScope({
        attachmentReferenceEnabled:
          options.attachmentReferenceEnabled ?? options.attachment_reference_enabled ?? false,
        activeAttachmentIds: options.activeAttachmentIds ?? options.active_attachment_ids,
        currentTurnDocumentIds: options.currentTurnDocumentIds ?? options.current_turn_document_ids,
        explicitReopenDocumentIds:
          options.explicitReopenDocumentIds ?? options.explicit_reopen_document_ids,
        documentId: options.documentId ?? options.document_id,
        documentIds: options.documentIds ?? options.document_ids,
      });
  const documentId = scope.documentId;
  const documentIds = scope.documentIds;
  const priorAttachFollowUp = Boolean(
    options.priorAttachFollowUp ?? options.prior_attach_follow_up ?? false,
  );
  const currentTurnDocumentIds = scope.currentTurnDocumentIds;
  const explicitReopenDocumentIds = scope.explicitReopenDocumentIds || [];
  const sessionId = String(options.sessionId ?? options.session_id ?? "").trim() || null;
  const handoffToken = String(
    options.readyCardHandoffToken ?? options.ready_card_handoff_token ?? "",
  ).trim() || null;
  const entityId = String(options.entityId ?? options.entity_id ?? "").trim() || null;
  const entityType = String(options.entityType ?? options.entity_type ?? "").trim() || null;
  const viewModeRaw = String(options.viewMode ?? options.view_mode ?? "")
    .trim()
    .toLowerCase();
  const viewMode =
    viewModeRaw === "personal" || viewModeRaw === "corporate" || viewModeRaw === "both"
      ? viewModeRaw
      : null;
  const clientTurnId =
    String(options.clientTurnId ?? options.client_turn_id ?? "").trim() || null;
  // C1 Pointer Hand — v1 max one internal contract id (server re-checks ownership).
  const pointedRaw = options.pointedContractIds ?? options.pointed_contract_ids;
  const pointedContractIds = Array.isArray(pointedRaw)
    ? pointedRaw
        .map((id) => String(id ?? "").trim())
        .filter(Boolean)
        .slice(0, 1)
    : [];
  const verifiedRaw = options.threadVerifiedFactRefs ?? options.thread_verified_fact_refs;
  const threadVerifiedFactRefs = Array.isArray(verifiedRaw)
    ? verifiedRaw
        .filter((row) => row && typeof row === "object")
        .map((row) => ({
          contract_id:
            row.contract_id != null
              ? String(row.contract_id).trim() || null
              : row.contract_ref != null
                ? String(row.contract_ref).trim() || null
                : null,
          coverage_name: String(row.coverage_name ?? row.coverage_ref ?? "").trim(),
          field: String(row.field ?? "amount").trim() || "amount",
        }))
        .filter((row) => row.coverage_name)
        .slice(0, 8)
    : [];
  const threadHandoffMemo = compactThreadHandoffMemoForRequest(
    options.threadHandoffMemo ?? options.thread_handoff_memo ?? null,
    threadVerifiedFactRefs,
  );

  return {
    question: trimmed,
    history: presenceTurn ? [] : Array.isArray(history) ? history : [],
    ...(presenceTurn ? { presence: true } : {}),
    ...(documentId && !presenceTurn ? { document_id: documentId } : {}),
    ...(documentIds.length > 1 && !presenceTurn ? { document_ids: documentIds } : {}),
    ...(!presenceTurn ? { attachment_reference_enabled: false } : {}),
    ...(currentTurnDocumentIds.length && !presenceTurn
      ? { current_turn_document_ids: currentTurnDocumentIds }
      : {}),
    ...(explicitReopenDocumentIds.length && !presenceTurn
      ? { explicit_reopen_document_ids: explicitReopenDocumentIds }
      : {}),
    ...(priorAttachFollowUp && !presenceTurn ? { prior_attach_follow_up: true } : {}),
    // GO3: session_id only — server loads session_goal SSOT; never send prior_session_goal.
    ...(sessionId ? { session_id: sessionId } : {}),
    // T2.1 — opaque sealed token only (never plaintext READY CARD JSON).
    ...(handoffToken ? { ready_card_handoff_token: handoffToken } : {}),
    // Unified view — selection hint only; server re-authorizes membership/consent every turn.
    ...(entityId && !presenceTurn ? { entity_id: entityId } : {}),
    ...(entityType && !presenceTurn ? { entity_type: entityType } : {}),
    ...(viewMode && !presenceTurn ? { view_mode: viewMode } : {}),
    ...(clientTurnId ? { client_turn_id: clientTurnId } : {}),
    ...(pointedContractIds.length && !presenceTurn
      ? { pointed_contract_ids: pointedContractIds }
      : {}),
    ...(threadVerifiedFactRefs.length && !presenceTurn
      ? { thread_verified_fact_refs: threadVerifiedFactRefs }
      : {}),
    ...(threadHandoffMemo ? { thread_handoff_memo: threadHandoffMemo } : {}),
  };
}

function compactThreadHandoffMemoForRequest(raw, fallbackRefs = []) {
  if (!raw || typeof raw !== "object") return null;
  const amountRe = /\d+\s*만|\d+\s*원|월\s*\d|coverage_amount/i;
  const urlRe = /https?:\/\/|www\./i;
  const cleanField = (v, max) => {
    const s = String(v ?? "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, max);
    if (!s || amountRe.test(s) || urlRe.test(s)) return null;
    return s;
  };
  const speech = String(raw.customer_speech ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 240);
  const interest = cleanField(raw.interest ?? raw.concern, 80);
  const unresolved = cleanField(raw.unresolved ?? raw.open, 80);
  const refsRaw = Array.isArray(raw.verified_fact_refs) ? raw.verified_fact_refs : fallbackRefs;
  const refs = refsRaw
    .filter((row) => row && typeof row === "object")
    .map((row) => ({
      contract_id:
        row.contract_id != null
          ? String(row.contract_id).trim() || null
          : row.contract_ref != null
            ? String(row.contract_ref).trim() || null
            : null,
      coverage_name: String(row.coverage_name ?? row.coverage_ref ?? "").trim(),
      field: String(row.field ?? "amount").trim() || "amount",
    }))
    .filter((row) => row.coverage_name)
    .slice(0, 8);
  if (!interest && !speech && !unresolved && !refs.length) return null;
  return {
    schema: "key_handoff_memo_v1",
    interest,
    customer_speech: speech || null,
    unresolved,
    verified_fact_refs: refs,
    not_verified_fact: true,
  };
}
