/**
 * P5-STATE / P5-CONTINUITY-01 Phase A — pure session helpers (no Supabase import).
 */
import { normalizeActiveAttachment } from "./chatActiveAttachment.js";

export const LIFEGUARD_HOME_CHAT_PHASE = "lifeguard-home-chat";
export const LIFEGUARD_HOME_CHAT_SOURCE = "lifeguard_home_chat";

export function createLifeguardSessionId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `session-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/** localStorage key for active lifeguard session pointer (cross-tab Day 3 restore). */
export function activeSessionStorageKey(customerId) {
  return `lifeguard_active_session:${customerId}`;
}

export function readActiveSessionId(customerId) {
  if (typeof window === "undefined" || !customerId) return null;
  try {
    return window.localStorage.getItem(activeSessionStorageKey(customerId));
  } catch {
    return null;
  }
}

export function writeActiveSessionId(customerId, sessionId) {
  if (typeof window === "undefined" || !customerId || !sessionId) return;
  try {
    window.localStorage.setItem(activeSessionStorageKey(customerId), sessionId);
  } catch {
    // ignore quota / privacy errors
  }
}

export function resolveActiveLifeguardSessionId({
  recentSessions = [],
  storedId = null,
  snapshotSessionId = null,
} = {}) {
  const ids = new Set((recentSessions ?? []).map((entry) => String(entry.id)));
  // sessionStorage is per-tab — prefer in-flight snapshot so remount before DB
  // recent-index does not drop the just-completed turn.
  if (snapshotSessionId) return String(snapshotSessionId);
  if (storedId && ids.has(String(storedId))) return String(storedId);
  if (recentSessions.length > 0) return String(recentSessions[0].id);
  return createLifeguardSessionId();
}

/** sessionStorage key for in-flight chat snapshot (remount survival). */
export function chatSnapshotStorageKey(customerId) {
  return `lifeguard_chat_snapshot:${customerId}`;
}

/** Soft-deleted document_ids that must not be reinjected as active attach on restore. */
export function clearedActiveAttachmentStorageKey(customerId) {
  return `lifeguard_cleared_active_attachment_ids:${customerId}`;
}

export function readClearedActiveAttachmentIds(customerId) {
  if (typeof window === "undefined" || !customerId) return [];
  try {
    const raw = window.sessionStorage.getItem(clearedActiveAttachmentStorageKey(customerId));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map((id) => String(id ?? "").trim()).filter(Boolean);
  } catch {
    return [];
  }
}

/** Remember a soft-deleted document_id so refresh cannot restore it as prior attach. */
export function rememberClearedActiveAttachmentId(customerId, documentId) {
  if (typeof window === "undefined" || !customerId) return;
  const did = String(documentId ?? "").trim();
  if (!did) return;
  try {
    const prev = readClearedActiveAttachmentIds(customerId);
    if (prev.includes(did)) return;
    const next = [...prev, did].slice(-50);
    window.sessionStorage.setItem(
      clearedActiveAttachmentStorageKey(customerId),
      JSON.stringify(next),
    );
  } catch {
    // ignore quota / privacy errors
  }
}

/** Drop restored active attach when its document_id was soft-deleted this tab. */
export function rejectClearedActiveAttachment(activeAttachment = null, customerId = null) {
  const normalized = normalizeActiveAttachment(activeAttachment);
  if (!normalized) return null;
  const cleared = readClearedActiveAttachmentIds(customerId);
  if (cleared.includes(normalized.active_attachment_id)) return null;
  return normalized;
}

function mapChatSnapshotMessage(row, { preserveThinking = false } = {}) {
  if (!row || (row.role !== "user" && row.role !== "assistant")) return null;
  if (!preserveThinking && row.thinking === true) return null;
  const out = {
    role: row.role,
    content: String(row.content ?? ""),
  };
  if (row.id) out.id = row.id;
  if (preserveThinking && row.thinking === true) out.thinking = true;
  if (row.turnId) out.turnId = String(row.turnId);
  if (row.keyPresence === true) {
    out.keyPresence = true;
    out.keyPresenceSource = row.keyPresenceSource ?? null;
  }
  if (Array.isArray(row.visual_blocks) && row.visual_blocks.length > 0) {
    out.visual_blocks = row.visual_blocks;
  }
  if (row.visual_blocks_gate && typeof row.visual_blocks_gate === "object") {
    out.visual_blocks_gate = row.visual_blocks_gate;
  }
  return out;
}

export function sanitizeMessagesForChatSnapshot(messages = [], { preserveThinking = false } = {}) {
  return (Array.isArray(messages) ? messages : [])
    .map((row) => mapChatSnapshotMessage(row, { preserveThinking }))
    .filter(Boolean);
}

export function readLifeguardChatSnapshot(customerId) {
  if (typeof window === "undefined" || !customerId) return null;
  try {
    const raw = window.sessionStorage.getItem(chatSnapshotStorageKey(customerId));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.sessionId || !Array.isArray(parsed.messages)) return null;
    return {
      sessionId: String(parsed.sessionId),
      // Remount mid-turn may have persisted thinking/wait + partial stream.
      messages: sanitizeMessagesForChatSnapshot(parsed.messages, { preserveThinking: true }),
      activeAttachment: normalizeActiveAttachment(parsed.activeAttachment ?? null),
      updatedAt: parsed.updatedAt ?? null,
      turnId: parsed.turnId ? String(parsed.turnId) : null,
      phase: parsed.phase ? String(parsed.phase) : null,
    };
  } catch {
    return null;
  }
}

export function writeLifeguardChatSnapshot(
  customerId,
  {
    sessionId,
    messages,
    activeAttachment = null,
    preserveThinking = false,
    turnId = null,
    phase = null,
  } = {},
) {
  if (typeof window === "undefined" || !customerId || !sessionId) return;
  const sanitized = sanitizeMessagesForChatSnapshot(messages, { preserveThinking });
  if (sanitized.length === 0) return;
  try {
    const payload = {
      sessionId: String(sessionId),
      messages: sanitized,
      updatedAt: new Date().toISOString(),
      activeAttachment: normalizeActiveAttachment(activeAttachment),
    };
    if (turnId) payload.turnId = String(turnId);
    if (phase) payload.phase = String(phase);
    window.sessionStorage.setItem(chatSnapshotStorageKey(customerId), JSON.stringify(payload));
  } catch {
    // ignore quota / privacy errors
  }
}

/** Module-level in-flight HomeChat turn — survives HomeChat unmount/remount (A). */
let inflightHomeChatTurn = null;
const inflightHomeChatListeners = new Set();

function notifyInflightHomeChatTurn() {
  const snapshot = inflightHomeChatTurn;
  for (const listener of inflightHomeChatListeners) {
    try {
      listener(snapshot);
    } catch {
      // listener errors must not break the turn
    }
  }
}

export function readInflightHomeChatTurn(customerId = null) {
  if (!inflightHomeChatTurn) return null;
  if (customerId && String(inflightHomeChatTurn.customerId) !== String(customerId)) return null;
  return inflightHomeChatTurn;
}

export function subscribeInflightHomeChatTurn(listener) {
  if (typeof listener !== "function") return () => {};
  inflightHomeChatListeners.add(listener);
  return () => {
    inflightHomeChatListeners.delete(listener);
  };
}

export function beginInflightHomeChatTurn({
  customerId,
  sessionId,
  turnId,
  messages = [],
  activeAttachment = null,
} = {}) {
  if (!customerId || !sessionId || !turnId) return null;
  inflightHomeChatTurn = {
    customerId: String(customerId),
    sessionId: String(sessionId),
    turnId: String(turnId),
    messages: Array.isArray(messages) ? messages : [],
    activeAttachment: normalizeActiveAttachment(activeAttachment),
    phase: "awaiting",
    loading: true,
    streaming: false,
    streamedCommitted: false,
  };
  writeLifeguardChatSnapshot(customerId, {
    sessionId,
    messages: inflightHomeChatTurn.messages,
    activeAttachment: inflightHomeChatTurn.activeAttachment,
    preserveThinking: true,
    turnId,
    phase: "awaiting",
  });
  notifyInflightHomeChatTurn();
  return inflightHomeChatTurn;
}

export function patchInflightHomeChatTurn(turnId, patch = {}) {
  if (!inflightHomeChatTurn || String(inflightHomeChatTurn.turnId) !== String(turnId)) return null;
  inflightHomeChatTurn = {
    ...inflightHomeChatTurn,
    ...patch,
    turnId: inflightHomeChatTurn.turnId,
    customerId: inflightHomeChatTurn.customerId,
    sessionId: patch.sessionId ? String(patch.sessionId) : inflightHomeChatTurn.sessionId,
    messages: Array.isArray(patch.messages) ? patch.messages : inflightHomeChatTurn.messages,
  };
  writeLifeguardChatSnapshot(inflightHomeChatTurn.customerId, {
    sessionId: inflightHomeChatTurn.sessionId,
    messages: inflightHomeChatTurn.messages,
    activeAttachment: inflightHomeChatTurn.activeAttachment,
    preserveThinking: true,
    turnId: inflightHomeChatTurn.turnId,
    phase: inflightHomeChatTurn.phase,
  });
  notifyInflightHomeChatTurn();
  return inflightHomeChatTurn;
}

export function endInflightHomeChatTurn(turnId = null) {
  if (!inflightHomeChatTurn) return;
  if (turnId && String(inflightHomeChatTurn.turnId) !== String(turnId)) return;
  inflightHomeChatTurn = null;
  notifyInflightHomeChatTurn();
}

export function isInflightHomeChatTurnActive(customerId = null) {
  const turn = readInflightHomeChatTurn(customerId);
  if (!turn) return false;
  return turn.phase === "awaiting" || turn.phase === "streaming" || turn.phase === "committing";
}

export function clearLifeguardChatSnapshot(customerId) {
  if (typeof window === "undefined" || !customerId) return;
  try {
    window.sessionStorage.removeItem(chatSnapshotStorageKey(customerId));
  } catch {
    // ignore
  }
}

/**
 * T1 investigation — persistable turn trace summary only (no secrets / no customer PII dumps).
 * Built from SSE `done` payload fields already available to the client.
 */
/**
 * Persistable latency marks — numbers/status only (mirrors server/keyLatencyMarks).
 * Kept local so this module stays browser-safe (no server imports).
 */
function buildPersistableLatencyMarks(latencyMarks = null) {
  try {
    if (!latencyMarks || typeof latencyMarks !== "object") return null;
    const pickSpan = (span) => {
      if (!span || typeof span !== "object") return null;
      const enter_ms = typeof span.enter_ms === "number" ? span.enter_ms : null;
      const exit_ms = typeof span.exit_ms === "number" ? span.exit_ms : null;
      const duration_ms = typeof span.duration_ms === "number" ? span.duration_ms : null;
      if (enter_ms == null && exit_ms == null && duration_ms == null) return null;
      return { enter_ms, exit_ms, duration_ms };
    };
    const provider =
      latencyMarks.provider && typeof latencyMarks.provider === "object"
        ? {
            provider_call_count: Number(latencyMarks.provider.provider_call_count) || 0,
            borrowed_provider_call_count:
              Number(latencyMarks.provider.borrowed_provider_call_count) || 0,
            s6_provider_call_count: Number(latencyMarks.provider.s6_provider_call_count) || 0,
            error_types: Array.isArray(latencyMarks.provider.error_types)
              ? latencyMarks.provider.error_types
                  .map((e) => String(e ?? "").trim().slice(0, 64))
                  .filter(Boolean)
                  .slice(0, 8)
              : [],
          }
        : null;
    const s6 =
      latencyMarks.s6_speak && typeof latencyMarks.s6_speak === "object"
        ? {
            ...pickSpan(latencyMarks.s6_speak),
            s6_speak_call_count: Number(latencyMarks.s6_speak.s6_speak_call_count) || 0,
          }
        : null;
    return {
      borrowed_shadow_probe: pickSpan(latencyMarks.borrowed_shadow_probe),
      s6_speak: s6,
      gate: pickSpan(latencyMarks.gate),
      finalize: pickSpan(latencyMarks.finalize),
      seal: pickSpan(latencyMarks.seal),
      provider,
    };
  } catch {
    return null;
  }
}

export function buildPersistableTurnTraceSummary(donePayload = null) {
  const payload = donePayload && typeof donePayload === "object" ? donePayload : {};
  const trace = payload.one_key_core_trace ?? null;
  const steps = Array.isArray(trace?.steps) ? trace.steps : [];
  const speakStep = steps.find((row) => row?.step === "speak") ?? null;
  const speakPayload = speakStep?.payload && typeof speakStep.payload === "object" ? speakStep.payload : {};
  const personaStep = steps.find((row) => row?.step === "persona") ?? null;
  const personaPayload =
    personaStep?.payload && typeof personaStep.payload === "object" ? personaStep.payload : {};
  const keyVoiceTrace =
    speakPayload.key_voice_trace ??
    speakPayload.key_compose_trace?.key_voice_trace ??
    null;
  const shadow = keyVoiceTrace?.borrowed_senses_shadow ?? null;
  const research =
    shadow?.public_research_evidence ??
    keyVoiceTrace?.directive?.public_research_evidence ??
    null;
  const resultCount = Array.isArray(research?.results) ? research.results.length : null;
  const groundedCount = Array.isArray(research?.grounded_place_candidates)
    ? research.grounded_place_candidates.length
    : resultCount;
  const searchCount = Number(research?.search_count);
  const webSearchExecuted =
    research == null
      ? null
      : research.used === true ||
        (Number.isFinite(searchCount) && searchCount > 0) ||
        (typeof resultCount === "number" && resultCount > 0);
  const ghost = Array.isArray(personaPayload.ghost_path_reached)
    ? personaPayload.ghost_path_reached
    : Array.isArray(keyVoiceTrace?.ghost_path_reached)
      ? keyVoiceTrace.ghost_path_reached
      : [];
  const hardRepair =
    keyVoiceTrace?.hard_safety_repair_attempt === true ||
    (keyVoiceTrace?.hard_safety_repair && typeof keyVoiceTrace.hard_safety_repair === "object");

  const stepSummaries = steps.map((row) => ({
    step: row?.step ?? null,
    // Prefer numeric at_ms; legacy `at` may be step name string — ignore non-numeric.
    at_ms: typeof row?.at_ms === "number" ? row.at_ms : typeof row?.at === "number" ? row.at : null,
  }));

  const composeMode =
    speakPayload.compose_mode ??
    speakPayload.key_compose_trace?.compose_mode ??
    payload.compose_mode ??
    null;
  const latencyRaw = payload.response_latency_ms;
  const responseLatencyMs =
    typeof latencyRaw === "number" && Number.isFinite(latencyRaw) ? Math.max(0, latencyRaw) : null;

  const latencyMarksRaw =
    keyVoiceTrace?.latency_marks ??
    speakPayload.latency_marks ??
    personaPayload.latency_marks ??
    null;
  let latencyMarks = null;
  try {
    latencyMarks = buildPersistableLatencyMarks(latencyMarksRaw);
  } catch {
    latencyMarks = null;
  }

  return {
    compose_mode: composeMode == null ? null : String(composeMode),
    response_latency_ms: responseLatencyMs,
    one_key_core_trace_summary: {
      steps: stepSummaries,
      voice_entered:
        speakPayload.key_speak_master === true ||
        Boolean(speakPayload.key_voice_trace) ||
        Boolean(speakPayload.key_compose_trace) ||
        /^key_master/.test(String(composeMode ?? "")),
      gate_ok:
        typeof keyVoiceTrace?.gate_result?.ok === "boolean"
          ? keyVoiceTrace.gate_result.ok
          : typeof shadow?.gate?.ok === "boolean"
            ? shadow.gate.ok
            : null,
      fallback_used: keyVoiceTrace?.fallback_used === true,
      fallback_reason:
        keyVoiceTrace?.fallback_reason == null
          ? null
          : String(keyVoiceTrace.fallback_reason).slice(0, 160),
      borrowed_executed: Number(keyVoiceTrace?.borrowed_senses_calls ?? 0) > 0 || Boolean(shadow?.borrowed),
      borrowed_senses_calls: Number(keyVoiceTrace?.borrowed_senses_calls ?? 0) || 0,
      web_search_executed: webSearchExecuted,
      web_search_result_count: typeof resultCount === "number" ? resultCount : null,
      grounded_candidate_count: typeof groundedCount === "number" ? groundedCount : null,
      research_status: research?.status == null ? null : String(research.status).slice(0, 64),
      research_status_detail:
        research?.status_detail == null ? null : String(research.status_detail).slice(0, 96),
      hard_safety_repair: hardRepair === true,
      final_answer_source:
        shadow?.final_answer_source == null
          ? keyVoiceTrace?.provider == null
            ? null
            : String(keyVoiceTrace.provider).slice(0, 64)
          : String(shadow.final_answer_source).slice(0, 64),
      ghost_path_reached_count: ghost.length,
      response_source:
        payload.response_source == null ? null : String(payload.response_source).slice(0, 64),
      ttft_ms:
        typeof payload.sales_director_trace?.latency?.ttft_ms === "number"
          ? payload.sales_director_trace.latency.ttft_ms
          : null,
      s6_speak_call_count:
        typeof keyVoiceTrace?.latency_marks?.s6_speak?.s6_speak_call_count === "number"
          ? keyVoiceTrace.latency_marks.s6_speak.s6_speak_call_count
          : typeof keyVoiceTrace?.s6_speak_calls === "number"
            ? keyVoiceTrace.s6_speak_calls
            : null,
      latency_marks: latencyMarks,
    },
  };
}

export function isLifeguardHomeChatRow(row) {
  const metadata = row?.metadata ?? row?.metadata_json ?? {};
  const sessionId = metadata.session_id;
  if (!sessionId) return false;
  return (
    metadata.phase === LIFEGUARD_HOME_CHAT_PHASE ||
    metadata.source === LIFEGUARD_HOME_CHAT_SOURCE
  );
}

function rowMetadata(row) {
  return row?.metadata ?? row?.metadata_json ?? {};
}

function previewFromMessage(message) {
  const trimmed = String(message ?? "").trim();
  if (!trimmed) return "새 대화";
  return trimmed.length > 28 ? `${trimmed.slice(0, 28)}…` : trimmed;
}

function rowTimestamp(row) {
  const value = row?.createdAt ?? row?.created_at ?? null;
  const parsed = value ? new Date(value).getTime() : 0;
  return Number.isFinite(parsed) ? parsed : 0;
}

/** P5 Phase A-2 — restore order when async persist inverts timestamps. */
const KEY_PRESENCE_SOURCE_ORDER = {
  document_upload: 0,
  key_initiative: 1,
};

function compareSessionMessageRows(a, b) {
  const ta = rowTimestamp(a);
  const tb = rowTimestamp(b);
  const ma = rowMetadata(a);
  const mb = rowMetadata(b);
  const aKey = ma.key_presence === true;
  const bKey = mb.key_presence === true;
  if (aKey && bKey) {
    const oa = KEY_PRESENCE_SOURCE_ORDER[ma.key_presence_source] ?? 9;
    const ob = KEY_PRESENCE_SOURCE_ORDER[mb.key_presence_source] ?? 9;
    if (oa !== ob) return oa - ob;
  }
  return ta - tb;
}

export function buildSessionMetadata(
  sessionId,
  { activeAttachment = null } = {},
) {
  const metadata = {
    phase: LIFEGUARD_HOME_CHAT_PHASE,
    session_id: sessionId,
    source: LIFEGUARD_HOME_CHAT_SOURCE,
  };
  const normalized = normalizeActiveAttachment(activeAttachment);
  if (normalized) {
    metadata.active_attachment_id = normalized.active_attachment_id;
    if (normalized.active_attachment_mime) {
      metadata.active_attachment_mime = normalized.active_attachment_mime;
    }
    metadata.active_rotation_quarter_turns = normalized.active_rotation_quarter_turns;
  }
  return metadata;
}

/**
 * GO3 — latest short-term session_goal from same-session assistant metadata (active only).
 * Newest assistant row that carries a session_goal slot wins; completed → null.
 */
export function resolveActiveSessionGoalFromMessages(messages = []) {
  const rows = Array.isArray(messages) ? messages : [];
  for (let i = rows.length - 1; i >= 0; i -= 1) {
    const row = rows[i];
    if (row?.role !== "assistant") continue;
    const sg = row.session_goal ?? row.metadata?.session_goal ?? null;
    if (!sg || typeof sg !== "object") continue;
    const status = String(sg.status ?? "").trim();
    if (status === "completed") return null;
    if (status === "active") {
      const goal = String(sg.goal ?? "").trim();
      if (!goal) return null;
      return {
        goal,
        status: "active",
        updated_at: sg.updated_at ?? null,
      };
    }
    return null;
  }
  return null;
}

export function buildAssistantTurnMetadata(
  sessionId,
  {
    visualBlocks = null,
    visualBlocksGate = null,
    composeMode = null,
    responseLatencyMs = null,
    oneKeyCoreTraceSummary = null,
    activeAttachment = null,
    sessionGoal = null,
    keyConsultationRecord = null,
  } = {},
) {
  const metadata = buildSessionMetadata(sessionId, { activeAttachment });
  if (Array.isArray(visualBlocks) && visualBlocks.length > 0) {
    metadata.visual_blocks = visualBlocks;
  }
  if (visualBlocksGate && typeof visualBlocksGate === "object") {
    metadata.visual_blocks_gate = visualBlocksGate;
  }
  if (composeMode != null && String(composeMode).trim()) {
    metadata.compose_mode = String(composeMode).trim().slice(0, 96);
  }
  if (typeof responseLatencyMs === "number" && Number.isFinite(responseLatencyMs)) {
    metadata.response_latency_ms = Math.max(0, Math.round(responseLatencyMs));
  }
  if (oneKeyCoreTraceSummary && typeof oneKeyCoreTraceSummary === "object") {
    metadata.one_key_core_trace_summary = oneKeyCoreTraceSummary;
  }
  // GO3 — short-term work state only; omit when absent (do not invent / clear by null).
  if (
    sessionGoal &&
    typeof sessionGoal === "object" &&
    (String(sessionGoal.status ?? "").trim() === "active" ||
      String(sessionGoal.status ?? "").trim() === "completed")
  ) {
    const status = String(sessionGoal.status).trim();
    const goal =
      sessionGoal.goal == null ? null : String(sessionGoal.goal).trim() || null;
    if (status === "active" && !goal) {
      // invalid active — skip persist
    } else {
      metadata.session_goal = {
        goal,
        status,
        updated_at: sessionGoal.updated_at ?? null,
        ...(sessionGoal.evidence && typeof sessionGoal.evidence === "object"
          ? { evidence: sessionGoal.evidence }
          : {}),
        ...(sessionGoal.source_link && typeof sessionGoal.source_link === "object"
          ? { source_link: sessionGoal.source_link }
          : {}),
      };
    }
  }
  // OUR CLAUDE — consultation kinds (Claude judgment ≠ verified fact).
  if (
    keyConsultationRecord &&
    typeof keyConsultationRecord === "object" &&
    keyConsultationRecord.schema === "key_consultation_record_v1"
  ) {
    metadata.key_consultation_record = keyConsultationRecord;
  }
  return metadata;
}

function sessionMessageIdentityKey(message = {}) {
  return `${message.role}::${String(message.content ?? "").trim()}`;
}

/**
 * Merge DB-restored rows with in-memory messages — preserve visual_blocks when restore omits them
 * and append in-flight turns that are not yet visible in the restored snapshot.
 * B: never let a later restore wipe/empty a streamed customer_answer already shown for the turn.
 */
export function mergeRestoredSessionMessages(inMemory = [], restored = []) {
  if (!Array.isArray(restored) || restored.length === 0) {
    return Array.isArray(inMemory) ? inMemory : [];
  }
  if (!Array.isArray(inMemory) || inMemory.length === 0) {
    return restored;
  }

  const memoryByKey = new Map();
  for (const row of inMemory) {
    memoryByKey.set(sessionMessageIdentityKey(row), row);
  }

  const merged = restored.map((restoredMsg) => {
    const memoryMsg = memoryByKey.get(sessionMessageIdentityKey(restoredMsg));
    if (!memoryMsg) return restoredMsg;

    const memoryBlocks = Array.isArray(memoryMsg.visual_blocks) ? memoryMsg.visual_blocks : [];
    const restoredBlocks = Array.isArray(restoredMsg.visual_blocks) ? restoredMsg.visual_blocks : [];
    if (memoryBlocks.length > 0 && restoredBlocks.length === 0) {
      return {
        ...restoredMsg,
        visual_blocks: memoryBlocks,
        visual_blocks_gate: memoryMsg.visual_blocks_gate ?? restoredMsg.visual_blocks_gate ?? null,
      };
    }
    return restoredMsg;
  });

  const restoredKeys = new Set(restored.map(sessionMessageIdentityKey));
  const trailingInMemory = inMemory.filter((row) => !restoredKeys.has(sessionMessageIdentityKey(row)));
  let next = trailingInMemory.length ? [...merged, ...trailingInMemory] : merged;

  // Same-turn streamed answer may differ in content from a later empty/short DB row.
  const memLast = inMemory[inMemory.length - 1];
  const outLast = next[next.length - 1];
  const memText = String(memLast?.content ?? "").trim();
  const outText = String(outLast?.content ?? "").trim();
  if (
    memLast?.role === "assistant" &&
    memLast.thinking !== true &&
    memText &&
    (outLast?.role !== "assistant" || outText.length < memText.length || !outText)
  ) {
    const memUser = [...inMemory].reverse().find((row) => row?.role === "user");
    const outUser = [...next].reverse().find((row) => row?.role === "user");
    const sameUserTurn =
      memUser &&
      outUser &&
      String(memUser.content ?? "").trim() === String(outUser.content ?? "").trim();
    const sameTurnId =
      memLast.turnId && outLast?.turnId && String(memLast.turnId) === String(outLast.turnId);
    if (sameUserTurn || sameTurnId || outLast?.role !== "assistant") {
      if (outLast?.role === "assistant") {
        next = [...next.slice(0, -1), memLast];
      } else {
        next = [...next, memLast];
      }
    }
  }

  return next;
}

export function buildKeyPresenceMetadata(
  sessionId,
  { keyPresenceSource, anchorDocumentId = null, anchorJobId = null } = {},
) {
  const metadata = {
    ...buildSessionMetadata(sessionId),
    key_presence: true,
    key_presence_source: keyPresenceSource,
  };
  if (anchorDocumentId) metadata.anchor_document_id = anchorDocumentId;
  if (anchorJobId) metadata.anchor_job_id = anchorJobId;
  return metadata;
}

/** Group lifeguard rows into recent session summaries for the sidebar. */
export function buildRecentSessionsFromRows(rows, { limit = 12 } = {}) {
  const bySession = new Map();

  for (const row of rows ?? []) {
    if (!isLifeguardHomeChatRow(row)) continue;
    const metadata = rowMetadata(row);
    const sessionId = String(metadata.session_id);
    if (!sessionId) continue;

    let entry = bySession.get(sessionId);
    if (!entry) {
      entry = {
        id: sessionId,
        preview: "새 대화",
        lastAt: 0,
        firstUserAt: Infinity,
        firstKeyPresenceAt: Infinity,
        firstDocumentUploadAt: Infinity,
        documentUploadPreview: null,
      };
      bySession.set(sessionId, entry);
    }

    const timestamp = rowTimestamp(row);
    if (timestamp > entry.lastAt) entry.lastAt = timestamp;

    if (row.role === "user") {
      const text = String(row.message ?? "").trim();
      if (text && timestamp <= entry.firstUserAt) {
        entry.firstUserAt = timestamp;
        if (!entry.documentUploadPreview) {
          entry.preview = previewFromMessage(text);
        }
      }
    }

    if (row.role === "assistant" && metadata.key_presence === true) {
      const text = String(row.message ?? "").trim();
      if (!text) continue;

      if (metadata.key_presence_source === "document_upload" && timestamp <= entry.firstDocumentUploadAt) {
        entry.firstDocumentUploadAt = timestamp;
        entry.documentUploadPreview = previewFromMessage(text);
        entry.preview = entry.documentUploadPreview;
      } else if (timestamp <= entry.firstKeyPresenceAt && entry.firstUserAt === Infinity && !entry.documentUploadPreview) {
        entry.firstKeyPresenceAt = timestamp;
        entry.preview = previewFromMessage(text);
      }
    }
  }

  return [...bySession.values()]
    .sort((a, b) => b.lastAt - a.lastAt)
    .slice(0, limit)
    .map(({ id, preview, documentUploadPreview }) => ({
      id,
      preview: documentUploadPreview ?? preview,
    }));
}

/** Map persisted rows to chat UI messages for one session. */
export function mapSessionRowsToChatMessages(rows, sessionId) {
  return (rows ?? [])
    .filter(
      (row) =>
        isLifeguardHomeChatRow(row) &&
        String(rowMetadata(row).session_id) === String(sessionId) &&
        (row.role === "user" || row.role === "assistant"),
    )
    .sort(compareSessionMessageRows)
    .map((row) => {
      const metadata = rowMetadata(row);
      const message = {
        id: row.id,
        role: row.role,
        content: row.message,
      };
      if (metadata.key_presence === true) {
        message.keyPresence = true;
        message.keyPresenceSource = metadata.key_presence_source ?? null;
      }
      if (Array.isArray(metadata.visual_blocks) && metadata.visual_blocks.length > 0) {
        message.visual_blocks = metadata.visual_blocks;
      }
      if (metadata.visual_blocks_gate && typeof metadata.visual_blocks_gate === "object") {
        message.visual_blocks_gate = metadata.visual_blocks_gate;
      }
      if (metadata.session_goal && typeof metadata.session_goal === "object") {
        message.session_goal = {
          goal: metadata.session_goal.goal ?? null,
          status: metadata.session_goal.status ?? null,
          updated_at: metadata.session_goal.updated_at ?? null,
        };
        message.metadata = {
          ...(message.metadata && typeof message.metadata === "object"
            ? message.metadata
            : {}),
          session_goal: message.session_goal,
        };
      }
      const active = normalizeActiveAttachment(metadata);
      if (active) {
        message.metadata = {
          ...(message.metadata && typeof message.metadata === "object"
            ? message.metadata
            : {}),
          active_attachment_id: active.active_attachment_id,
          active_attachment_mime: active.active_attachment_mime,
          active_rotation_quarter_turns: active.active_rotation_quarter_turns,
        };
      }
      return message;
    });
}
