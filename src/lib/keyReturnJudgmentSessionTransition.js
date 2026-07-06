export const KEY_RETURN_JUDGMENT_DEDUPE_PREFIX = "lg_key_return_judgment_";

export function keyReturnJudgmentDedupeKey(customerId, sessionId, anchorJobId) {
  return `${KEY_RETURN_JUDGMENT_DEDUPE_PREFIX}${String(customerId ?? "").trim()}_${String(sessionId ?? "").trim()}_${String(anchorJobId ?? "").trim()}`;
}

export function hasKeyReturnJudgmentDedupe(customerId, sessionId, anchorJobId, storage = null) {
  const key = keyReturnJudgmentDedupeKey(customerId, sessionId, anchorJobId);
  if (!key || key.endsWith("_")) return false;
  const store = storage ?? (typeof localStorage !== "undefined" ? localStorage : null);
  if (!store) return false;
  return store.getItem(key) === "1";
}

export function markKeyReturnJudgmentDedupe(customerId, sessionId, anchorJobId, storage = null) {
  const key = keyReturnJudgmentDedupeKey(customerId, sessionId, anchorJobId);
  if (!key || key.endsWith("_")) return;
  const store = storage ?? (typeof localStorage !== "undefined" ? localStorage : null);
  if (!store) return;
  store.setItem(key, "1");
}

export function threadHasReturnJudgmentMessage(messages = []) {
  return (messages ?? []).some(
    (msg) => msg?.keyPresence === true && msg?.keyPresenceSource === "return_judgment",
  );
}

export function threadHasKeyBridgeMessage(messages = []) {
  return (messages ?? []).some(
    (msg) => msg?.keyPresence === true && msg?.keyPresenceSource === "key_bridge",
  );
}

export function threadHasUserMessageAfterKeyPresence(messages = []) {
  let lastKeyIdx = -1;
  for (let i = 0; i < (messages ?? []).length; i += 1) {
    if (messages[i]?.keyPresence === true) lastKeyIdx = i;
  }
  if (lastKeyIdx < 0) return false;
  for (let i = lastKeyIdx + 1; i < messages.length; i += 1) {
    const msg = messages[i];
    if (msg?.role === "user" && String(msg?.content ?? "").trim()) return true;
  }
  return false;
}

export function resolveReturnJudgmentAnchorFromMessages(messages = []) {
  for (let i = (messages ?? []).length - 1; i >= 0; i -= 1) {
    const msg = messages[i];
    if (msg?.keyPresenceSource === "key_bridge" && msg?.anchorJobId) {
      return String(msg.anchorJobId);
    }
    if (msg?.keyPresenceSource === "key_initiative" && msg?.anchorJobId) {
      return String(msg.anchorJobId);
    }
  }
  return null;
}

export const KEY_RETURN_JUDGMENT_EMITTER_TRACE_KEY = "lg_key_return_judgment_emitter_trace";

export function writeReturnJudgmentEmitterTrace(partial, storage = null) {
  const store = storage ?? (typeof sessionStorage !== "undefined" ? sessionStorage : null);
  if (!store || !partial || typeof partial !== "object") return;
  let prev = null;
  try {
    prev = JSON.parse(store.getItem(KEY_RETURN_JUDGMENT_EMITTER_TRACE_KEY) ?? "null");
  } catch {
    prev = null;
  }
  store.setItem(
    KEY_RETURN_JUDGMENT_EMITTER_TRACE_KEY,
    JSON.stringify({ ...(prev ?? {}), ...partial, updated_at: new Date().toISOString() }),
  );
}

export function shouldAttemptReturnJudgmentEmit({
  threadRestoreReady = false,
  panelView = "chat",
  messages = [],
  uploadInProgress = false,
  trackedJobInFlight = false,
  enabled = true,
} = {}) {
  if (!enabled) return { attempt: false, reason: "disabled" };
  if (!threadRestoreReady) return { attempt: false, reason: "restore_not_ready" };
  if (panelView !== "chat") return { attempt: false, reason: "not_chat_panel" };
  if (uploadInProgress) return { attempt: false, reason: "upload_in_progress" };
  if (trackedJobInFlight) return { attempt: false, reason: "tracked_job_in_flight" };
  if (!threadHasKeyBridgeMessage(messages)) return { attempt: false, reason: "bridge_required_first" };
  if (threadHasReturnJudgmentMessage(messages)) {
    return { attempt: false, reason: "return_judgment_already_in_thread" };
  }
  if (threadHasUserMessageAfterKeyPresence(messages)) {
    return { attempt: false, reason: "user_already_spoke" };
  }
  return { attempt: true, reason: null };
}
