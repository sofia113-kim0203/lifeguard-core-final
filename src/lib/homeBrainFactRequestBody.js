/**
 * Pure home KEY request body builder (browser + Node unit-test safe).
 */

export function buildHomeBrainFactRequestBody(question, history = [], options = {}) {
  const trimmed = String(question ?? "").trim();
  const documentId = String(options.documentId ?? options.document_id ?? "").trim() || null;
  const priorAttachFollowUp = Boolean(
    options.priorAttachFollowUp ?? options.prior_attach_follow_up ?? false,
  );
  const sessionId = String(options.sessionId ?? options.session_id ?? "").trim() || null;

  return {
    question: trimmed,
    history: Array.isArray(history) ? history : [],
    ...(documentId ? { document_id: documentId } : {}),
    ...(priorAttachFollowUp ? { prior_attach_follow_up: true } : {}),
    // GO3: session_id only — server loads session_goal SSOT; never send prior_session_goal.
    ...(sessionId ? { session_id: sessionId } : {}),
  };
}
