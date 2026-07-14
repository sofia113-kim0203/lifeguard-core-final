/**
 * Pure home KEY request body builder (browser + Node unit-test safe).
 */

export function buildHomeBrainFactRequestBody(question, history = [], options = {}) {
  const trimmed = String(question ?? "").trim();
  const documentId = String(options.documentId ?? options.document_id ?? "").trim() || null;
  const rotationQuarterTurns = Number(
    options.rotationQuarterTurns ?? options.rotation_quarter_turns ?? 0,
  );
  const priorAttachFollowUp = Boolean(
    options.priorAttachFollowUp ?? options.prior_attach_follow_up ?? false,
  );

  return {
    question: trimmed,
    history: Array.isArray(history) ? history : [],
    ...(documentId ? { document_id: documentId } : {}),
    ...(documentId
      ? {
          rotation_quarter_turns: [0, 1, 2, 3].includes(rotationQuarterTurns)
            ? rotationQuarterTurns
            : 0,
        }
      : {}),
    ...(priorAttachFollowUp ? { prior_attach_follow_up: true } : {}),
  };
}
