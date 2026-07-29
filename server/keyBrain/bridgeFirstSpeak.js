/**
 * P5-B — KEY Bridge sentence scan (speak via keySpeak only).
 */
export const KEY_BRIDGE_DEFAULT_SENTENCE =
  "지난번 같이 보던 기준으로, 오늘은 이어서 살펴볼게요.";

export const KEY_BRIDGE_SPEAK_SCHEMA_VERSION = "key-bridge-speak-p5b-v1";

export const KEY_BRIDGE_FORBIDDEN_PATTERNS = [
  /지난번.*하셨죠/i,
  /대장\s*내시경/i,
  /memory/i,
  /memory_fact/i,
  /저장(?:해|된)/i,
  /기억(?:하고|나요|해\s*드)/i,
  /보험\s*\d+\s*건/i,
  /분석\s*결과\s*요약/i,
  /올려\s*주신\s*(?:자료|증권|문서)/i,
  /파일명/i,
  /시스템\s*알림/i,
  /업로드\s*(?:가\s*)?완료/i,
  /분석\s*중/i,
  /암\s*보험/i,
];

export function scanBridgeSentence(text = "") {
  const trimmed = String(text ?? "").trim();
  if (!trimmed) {
    return { ok: false, reason: "empty" };
  }
  if (trimmed.length > 120) {
    return { ok: false, reason: "too_long" };
  }
  for (const pattern of KEY_BRIDGE_FORBIDDEN_PATTERNS) {
    if (pattern.test(trimmed)) {
      return { ok: false, reason: `forbidden:${pattern.source}` };
    }
  }
  return { ok: true, reason: null };
}
