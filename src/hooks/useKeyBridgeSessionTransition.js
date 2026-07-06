import { useEffect, useRef } from "react";
import { requestKeyBridgeIntake } from "../lib/keyBridgeIntake.js";
import {
  hasKeyBridgeDedupe,
  markKeyBridgeDedupe,
  resolveBridgeAnchorFromMessages,
  shouldAttemptBridgeEmit,
  writeBridgeEmitterTrace,
} from "../lib/keyBridgeSessionTransition.js";
import { isAnalysisJobInFlight } from "../lib/keyAnalysisCompleteSessionTransition.js";

async function emitKeyBridgeIntake({
  sessionId,
  customerId,
  messages,
  onKeyChatPresence,
  anchorJobId = null,
}) {
  if (!sessionId || typeof onKeyChatPresence !== "function") return false;

  const resolvedAnchor = anchorJobId ?? resolveBridgeAnchorFromMessages(messages);

  writeBridgeEmitterTrace({
    session_id: sessionId,
    anchor_job_id: resolvedAnchor,
    p5b_intake_call_started_at: new Date().toISOString(),
  });

  if (resolvedAnchor && hasKeyBridgeDedupe(customerId, sessionId, resolvedAnchor)) {
    writeBridgeEmitterTrace({ p5b_intake_skipped: "dedupe", p5b_intake_called: false });
    return false;
  }

  const result = await requestKeyBridgeIntake(sessionId, {
    anchorJobId: resolvedAnchor,
    transitionObservedAt: new Date().toISOString(),
  });

  writeBridgeEmitterTrace({
    p5b_intake_called: true,
    p5b_intake_ok: Boolean(result?.ok),
    p5b_bridge_skipped: Boolean(result?.bridge_skipped),
    p5b_skip_reasons: result?.skip_reasons ?? null,
    p5b_gap_hours: result?.gap_hours ?? null,
  });

  if (!result?.ok || result?.bridge_skipped) return false;

  const sentence = String(result?.bridge_sentence ?? "").trim();
  if (!sentence) return false;

  const emitAnchor = result.anchor_job_id ?? resolvedAnchor;
  if (emitAnchor) {
    markKeyBridgeDedupe(customerId, sessionId, emitAnchor);
  }

  onKeyChatPresence({
    keyBridgeSentence: sentence,
    anchorJobId: emitAnchor ?? null,
  });

  writeBridgeEmitterTrace({
    p5b_bubble_appended: true,
    p5b_bridge_sentence_preview: sentence.slice(0, 120),
  });
  return true;
}

/**
 * P5-B — after P5-A thread restore, attempt KEY Bridge once per session mount.
 */
export function useKeyBridgeSessionTransition({
  sessionId = null,
  customerId = null,
  messages = [],
  threadRestoreReady = false,
  panelView = "chat",
  onKeyChatPresence = null,
  enabled = true,
  uploadInProgress = false,
  trackedAnalysisJobStatus = null,
} = {}) {
  const emittedForMountRef = useRef(null);
  const handlingRef = useRef(false);

  useEffect(() => {
    emittedForMountRef.current = null;
  }, [sessionId, customerId]);

  useEffect(() => {
    const trackedJobInFlight = isAnalysisJobInFlight(trackedAnalysisJobStatus);
    const preflight = shouldAttemptBridgeEmit({
      threadRestoreReady,
      panelView,
      messages,
      uploadInProgress,
      trackedJobInFlight,
      enabled: enabled && Boolean(sessionId && customerId),
    });

    if (!preflight.attempt) {
      writeBridgeEmitterTrace({ p5b_emit_blocked: preflight.reason });
      return undefined;
    }

    const mountKey = `${customerId}:${sessionId}`;
    if (emittedForMountRef.current === mountKey || handlingRef.current) {
      return undefined;
    }

    handlingRef.current = true;
    emittedForMountRef.current = mountKey;

    void emitKeyBridgeIntake({
      sessionId,
      customerId,
      messages,
      onKeyChatPresence,
    }).finally(() => {
      handlingRef.current = false;
    });

    return undefined;
  }, [
    sessionId,
    customerId,
    messages,
    threadRestoreReady,
    panelView,
    onKeyChatPresence,
    enabled,
    uploadInProgress,
    trackedAnalysisJobStatus,
  ]);
}

export {
  hasKeyBridgeDedupe,
  keyBridgeDedupeKey,
  markKeyBridgeDedupe,
  readBridgeEmitterTrace,
  shouldAttemptBridgeEmit,
  threadHasKeyBridgeMessage,
  threadHasKeyPresenceAnchor,
  writeBridgeEmitterTrace,
} from "../lib/keyBridgeSessionTransition.js";
