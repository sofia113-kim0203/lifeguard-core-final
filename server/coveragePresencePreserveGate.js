/**
 * P10-3F — coverage_presence factual preserve text gate (shared, no customer/question hardcoding).
 */

/** HUL generic counseling intros must never be preserved as Claude FT factual answers. */
export const HUL_GENERIC_COUNSELING_INTRO_PATTERNS = [
  /보험\s*얘기\s*전에/,
  /상태부터\s*맞춰볼게요/,
  /겹치는\s*곳은\s*두껍고/,
];

/** Direct coverage-presence answer signals: presence / uncertainty / confirmation need. */
const COVERAGE_PRESENCE_DIRECT_ANSWER_SIGNALS = [
  /있/,
  /가입/,
  /보장/,
  /관련/,
  /확인/,
  /보여|보이(?:는|면|요|는\s*편)?/,
  /어려/,
  /필요/,
];

export function isGenericHulCounselingIntro(text = "") {
  const body = String(text ?? "").trim();
  if (!body) return false;
  return HUL_GENERIC_COUNSELING_INTRO_PATTERNS.some((pattern) => pattern.test(body));
}

export function hasCoveragePresenceFactualAnswer(text = "") {
  const body = String(text ?? "").trim();
  if (!body || isGenericHulCounselingIntro(body)) return false;
  const hitCount = COVERAGE_PRESENCE_DIRECT_ANSWER_SIGNALS.filter((pattern) => pattern.test(body)).length;
  return hitCount >= 2;
}
