/**
 * Pure home KEY request body builder (browser + Node unit-test safe).
 */

export function buildHomeBrainFactRequestBody(question, history = [], options = {}) {
  const trimmed = String(question ?? "").trim();
  const documentId = String(options.documentId ?? options.document_id ?? "").trim() || null;
  const priorAttachFollowUp = Boolean(
    options.priorAttachFollowUp ?? options.prior_attach_follow_up ?? false,
  );

  return {
    question: trimmed,
    history: Array.isArray(history) ? history : [],
    ...(documentId ? { document_id: documentId } : {}),
    ...(priorAttachFollowUp ? { prior_attach_follow_up: true } : {}),
  };
}
