import { useEffect, useRef } from "react";
import { requestKeyReturnJudgmentIntake } from "../lib/keyReturnJudgmentIntake.js";
import {
  hasKeyReturnJudgmentDedupe,
  markKeyReturnJudgmentDedupe,
  resolveReturnJudgmentAnchorFromMessages,
  shouldAttemptReturnJudgmentEmit,
  writeReturnJudgmentEmitterTrace,
} from "../lib/keyReturnJudgmentSessionTransition.js";
import { isAnalysisJobInFlight } from "../lib/keyAnalysisCompleteSessionTransition.js";

async function emitKeyReturnJudgmentIntake({
  sessionId,
  customerId,
  messages,
  onKeyChatPresence,
  anchorJobId = null,
}) {
  if (!sessionId || typeof onKeyChatPresence !== "function") return false;

  const resolvedAnchor = anchorJobId ?? resolveReturnJudgmentAnchorFromMessages(messages);

  writeReturnJudgmentEmitterTrace({
    session_id: sessionId,
    anchor_job_id: resolvedAnchor,
    p5c_intake_call_started_at: new Date().toISOString(),
  });

  if (resolvedAnchor && hasKeyReturnJudgmentDedupe(customerId, sessionId, resolvedAnchor)) {
    writeReturnJudgmentEmitterTrace({ p5c_intake_skipped: "dedupe", p5c_intake_called: false });
    return false;
  }

  const result = await requestKeyReturnJudgmentIntake(sessionId, {
    anchorJobId: resolvedAnchor,
    transitionObservedAt: new Date().toISOString(),
  });

  writeReturnJudgmentEmitterTrace({
    p5c_intake_called: true,
    p5c_intake_ok: Boolean(result?.ok),
    p5c_return_judgment_skipped: Boolean(result?.return_judgment_skipped),
    p5c_skip_reasons: result?.skip_reasons ?? null,
  });

  if (!result?.ok || result?.return_judgment_skipped) return false;

  const sentence = String(result?.return_judgment_sentence ?? "").trim();
  if (!sentence) return false;

  const emitAnchor = result.anchor_job_id ?? resolvedAnchor;
  if (emitAnchor) {
    markKeyReturnJudgmentDedupe(customerId, sessionId, emitAnchor);
  }

  onKeyChatPresence({
    keyReturnJudgmentSentence: sentence,
    anchorJobId: emitAnchor ?? null,
  });

  writeReturnJudgmentEmitterTrace({
    p5c_bubble_appended: true,
    p5c_sentence_preview: sentence.slice(0, 120),
  });
  return true;
}

/**
 * P5-C — after P5-B Bridge, attempt RETURN_JUDGMENT once per session mount.
 */
export function useKeyReturnJudgmentSessionTransition({
  sessionId = null,
  customerId = null,
  messages = [],
  threadRestoreReady = false,
  panelView = "chat",
  onKeyChatPresence = null,
  enabled = true,
  uploadInProgress = false,
  trackedAnalysisJobStatus = null,
  bridgeSettled = false,
} = {}) {
  const emittedForMountRef = useRef(null);
  const handlingRef = useRef(false);

  useEffect(() => {
    emittedForMountRef.current = null;
  }, [sessionId, customerId]);

  useEffect(() => {
    const trackedJobInFlight = isAnalysisJobInFlight(trackedAnalysisJobStatus);
    const preflight = shouldAttemptReturnJudgmentEmit({
      threadRestoreReady: threadRestoreReady && bridgeSettled,
      panelView,
      messages,
      uploadInProgress,
      trackedJobInFlight,
      enabled: enabled && Boolean(sessionId && customerId),
    });

    if (!preflight.attempt) {
      writeReturnJudgmentEmitterTrace({ p5c_emit_blocked: preflight.reason });
      return undefined;
    }

    const mountKey = `${customerId}:${sessionId}`;
    if (emittedForMountRef.current === mountKey || handlingRef.current) {
      return undefined;
    }

    handlingRef.current = true;
    emittedForMountRef.current = mountKey;

    void emitKeyReturnJudgmentIntake({
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
    bridgeSettled,
    panelView,
    onKeyChatPresence,
    enabled,
    uploadInProgress,
    trackedAnalysisJobStatus,
  ]);
}

export {
  hasKeyReturnJudgmentDedupe,
  keyReturnJudgmentDedupeKey,
  markKeyReturnJudgmentDedupe,
  shouldAttemptReturnJudgmentEmit,
  threadHasKeyBridgeMessage,
  threadHasReturnJudgmentMessage,
  writeReturnJudgmentEmitterTrace,
} from "../lib/keyReturnJudgmentSessionTransition.js";
