/**
 * P4-01 — client Speech SSOT (mirrors server/keyAnalysisInitiativeSpeak.js PASS voice).
 */
export const KEY_ANALYSIS_INITIATIVE_PASS_VOICE =
  "자료를 다 살펴봤어요. 먼저 같이 보면 좋을 부분이 하나 있어서 찾아왔어요.";

export function buildKeyAnalysisInitiativeSentence() {
  return KEY_ANALYSIS_INITIATIVE_PASS_VOICE.trim();
}
