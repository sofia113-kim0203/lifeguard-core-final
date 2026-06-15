/**
 * P2 Central Brain — public exports.
 */
export {
  CENTRAL_BRAIN_MODES,
  isCentralBrainActive,
  isCentralBrainEnabled,
  isAdvisorBrainEnabled,
  resolveCentralBrainMode,
  routeCentralBrain,
} from "./centralBrainRouter.js";

export { planCentralBrainEvidence } from "./centralBrainPlanner.js";

export {
  buildReadOnlyToolRunFromBundle,
  loadCentralBrainEvidence,
} from "./centralBrainEvidenceLoader.js";

export {
  buildCentralBrainAssistantMetadata,
  detectInternalNameLeak,
  mergeConversationMetadata,
  normalizeCentralBrainResponse,
} from "./centralBrainResponseNormalizer.js";

export { routeThroughCentralBrain, runCentralBrainTurn } from "./centralBrainOrchestrator.js";

/**
 * Voice entry flow (design):
 *   voiceInput → speechToText() → transcript → routeThroughCentralBrain()
 * Central Brain does not branch on text vs voice — only the transcript string matters.
 */
