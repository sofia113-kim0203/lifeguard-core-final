/**
 * P2-01 — KEY Presence (Speech only).
 * Customer sees Speech. Transform generic AI phrasing → KEY talking to me.
 * No new Factory · Memory · Gap · Recommendation.
 */

export const P2_01_SLICE_ID = "P2-01";
export const P2_01_SLICE_NAME = "KEY Presence";

/** Legacy generic filler — must not appear in customer-facing KEY Speech after P2-01. */
export const LEGACY_GENERIC_AI_SPEECH_RE =
  /확인된\s*범위\s*안에서만\s*조심스럽게/;

/** AI-template signals Jerry measures: Before "AI answered" → After "KEY talked to me". */
export const GENERIC_AI_SPEECH_SIGNAL_RES = [
  LEGACY_GENERIC_AI_SPEECH_RE,
  /세부\s*담보·한도는\s*이\s*범위\s*밖입니다/,
  /지금\s*알\s*수\s*있는\s*범위와\s*모르는\s*범위를\s*나눠\s*두는\s*편이\s*낫습니다/,
  /걱정되는\s*축부터\s*차례로\s*짚어\s*보면\s*됩니다/,
];

/** KEY Presence signals — first-person companion voice. */
export const KEY_SPEECH_PRESENCE_SIGNAL_RES = [
  /(?:제가|함께|같이|말씀드릴게요|볼게요|이어(?:가|서)|받(?:았|아)|말씀\s*주신)/,
];

const SPEECH_REWRITES = [
  {
    pattern: /확인된\s*범위\s*안에서만\s*조심스럭게\s*말씀드릴\s*수\s*있습니다\.?/g,
    replacement: "지금 확인된 내용부터 말씀드릴게요.",
  },
  {
    pattern: /확인된\s*범위\s*안에서만\s*조심스럽게\s*말씀드릴\s*수\s*있습니다\.?/g,
    replacement: "지금 확인된 내용부터 말씀드릴게요.",
  },
  {
    pattern: /세부\s*담보·한도는\s*이\s*범위\s*밖입니다\.?/g,
    replacement: "세부 담보·한도는 아직 제가 같이 확인하지 못했어요.",
  },
  {
    pattern: /지금\s*알\s*수\s*있는\s*범위와\s*모르는\s*범위를\s*나눠\s*두는\s*편이\s*낫습니다\.?/g,
    replacement: "확인된 부분과 아직 확인 전인 부분을 나눠 말씀드릴게요.",
  },
  {
    pattern: /걱정되는\s*축부터\s*차례로\s*짚어\s*보면\s*됩니다\.?/g,
    replacement: "지금 걸리는 부분부터 제가 같이 볼게요.",
  },
  {
    pattern: /지금\s*확인된\s*범위부터\s*같이\s*보면\s*됩니다\.?/g,
    replacement: "지금 확인된 내용부터 제가 같이 볼게요.",
  },
  {
    pattern: /담보\s*구조와\s*한도까지는\s*이\s*정보만으로는\s*확인\s*전입니다\.?/g,
    replacement: "담보 구조와 한도까지는 아직 제가 같이 확인하지 못했어요.",
  },
  {
    pattern: /상품명·가입\s*목록만으로는\s*세부\s*담보·한도까지는\s*확인\s*전입니다\.?/g,
    replacement: "지금 자료만으로는 세부 담보·한도까지는 제가 단정하기 어려워요.",
  },
];

function normalizeText(text = "") {
  return String(text ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

export function hasGenericAiSpeech(text = "") {
  const body = normalizeText(text);
  if (!body) return false;
  return GENERIC_AI_SPEECH_SIGNAL_RES.some((pattern) => pattern.test(body));
}

export function hasKeySpeechPresenceSignals(text = "") {
  const body = normalizeText(text);
  if (!body) return false;
  return KEY_SPEECH_PRESENCE_SIGNAL_RES.some((pattern) => pattern.test(body));
}

/**
 * P2-01 — final Speech polish for KEY orchestrator answers.
 * @returns {{ text: string, applied: boolean, rewrites: number }}
 */
export function applyKeySpeechPresence(text = "", _context = {}) {
  let cleaned = normalizeText(text);
  if (!cleaned) {
    return { text: cleaned, applied: false, rewrites: 0 };
  }

  let rewrites = 0;
  for (const { pattern, replacement } of SPEECH_REWRITES) {
    const next = cleaned.replace(pattern, replacement);
    if (next !== cleaned) {
      rewrites += 1;
      cleaned = next;
    }
  }

  cleaned = normalizeText(cleaned);
  return {
    text: cleaned,
    applied: rewrites > 0,
    rewrites,
  };
}
