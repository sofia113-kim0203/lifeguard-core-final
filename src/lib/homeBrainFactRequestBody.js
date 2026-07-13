/**
 * Pure home KEY request body builder (browser + Node unit-test safe).
 */
import { buildHomeBrainEntityRequestFields } from "./chatActiveEntity.js";

/** Personal omits entity fields; corporate passes type+id only (selection hint). */
export function buildHomeBrainFactRequestBody(question, history = [], options = {}) {
  const trimmed = String(question ?? "").trim();
  const documentId = String(options.documentId ?? options.document_id ?? "").trim() || null;
  const rotationQuarterTurns = Number(
    options.rotationQuarterTurns ?? options.rotation_quarter_turns ?? 0,
  );
  const priorAttachFollowUp = Boolean(
    options.priorAttachFollowUp ?? options.prior_attach_follow_up ?? false,
  );
  const entityFields = buildHomeBrainEntityRequestFields({
    entity_type: options.entityType ?? options.entity_type ?? null,
    entity_id: options.entityId ?? options.entity_id ?? null,
    active_entity_type: options.active_entity_type ?? null,
    active_entity_id: options.active_entity_id ?? null,
  });

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
    ...entityFields,
  };
}
