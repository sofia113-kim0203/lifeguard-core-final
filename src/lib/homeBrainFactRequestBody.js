/**
 * Pure home KEY request body builder (browser + Node unit-test safe).
 */

export function buildHomeBrainFactRequestBody(question, history = [], options = {}) {
  const presenceTurn = options.presence === true || options.presenceTurn === true;
  const trimmed = presenceTurn ? "" : String(question ?? "").trim();
  const documentId = String(options.documentId ?? options.document_id ?? "").trim() || null;
  const priorAttachFollowUp = Boolean(
    options.priorAttachFollowUp ?? options.prior_attach_follow_up ?? false,
  );
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

  return {
    question: trimmed,
    history: presenceTurn ? [] : Array.isArray(history) ? history : [],
    ...(presenceTurn ? { presence: true } : {}),
    ...(documentId && !presenceTurn ? { document_id: documentId } : {}),
    ...(priorAttachFollowUp && !presenceTurn ? { prior_attach_follow_up: true } : {}),
    // GO3: session_id only — server loads session_goal SSOT; never send prior_session_goal.
    ...(sessionId ? { session_id: sessionId } : {}),
    // T2.1 — opaque sealed token only (never plaintext READY CARD JSON).
    ...(handoffToken ? { ready_card_handoff_token: handoffToken } : {}),
    // Unified view — selection hint only; server re-authorizes membership/consent every turn.
    ...(entityId && !presenceTurn ? { entity_id: entityId } : {}),
    ...(entityType && !presenceTurn ? { entity_type: entityType } : {}),
    ...(viewMode && !presenceTurn ? { view_mode: viewMode } : {}),
  };
}
