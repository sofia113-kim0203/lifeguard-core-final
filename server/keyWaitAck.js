/**
 * KEY wait ack — first customer-facing line while final answer is prepared.
 * Not a new engine; deterministic KEY voice before heavy compose completes.
 */

export const KEY_WAIT_ACK_DEFAULT =
  "말씀 주신 내용 잘 받았어요. 함께 확인해 볼게요.";

function normalizeQuestion(question = "") {
  return String(question ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

export function buildKeyWaitAck(question = "") {
  const q = normalizeQuestion(question);
  if (!q) return KEY_WAIT_ACK_DEFAULT;
  if (/^(?:안녕(?:하세요|히)?|하이|헬로|hello)/i.test(q)) {
    return "안녕하세요. 말씀 주신 내용 함께 확인해 볼게요.";
  }
  return KEY_WAIT_ACK_DEFAULT;
}
