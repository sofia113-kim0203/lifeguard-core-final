import { useEffect, useRef } from "react";
import {
  fetchAnalysisJobStatus,
  fetchLatestAnalysisJob,
} from "../lib/customerConversationalAnalysis.js";
import { requestKeyAnalysisCompleteIntake } from "../lib/keyAnalysisCompleteIntake.js";
import {
  detectTrackedJobCompleteTransition,
  hasAnalysisCompleteIntakeDedupe,
  isAnalysisJobInFlight,
  KEY_ANALYSIS_COMPLETE_POLL_INTERVAL_MS,
  KEY_ANALYSIS_COMPLETE_POLL_MAX_MS,
  markAnalysisCompleteIntakeDedupe,
  writeEmitterTrace,
} from "../lib/keyAnalysisCompleteSessionTransition.js";

async function emitAnalysisCompleteIntake(job, onKeyChatPresence, { trackedJobId, latestJobId } = {}) {
  if (!job?.id || typeof onKeyChatPresence !== "function") return false;

  writeEmitterTrace({
    tracked_job_id: trackedJobId ?? job.id,
    latest_job_id: latestJobId ?? null,
    tracked_differs_from_latest: Boolean(
      trackedJobId && latestJobId && trackedJobId !== latestJobId,
    ),
    tracked_job_status: job.status,
    p4_intake_call_started_at: new Date().toISOString(),
  });

  if (hasAnalysisCompleteIntakeDedupe(job.id)) {
    writeEmitterTrace({ p4_intake_skipped: "dedupe", p4_intake_called: false });
    return false;
  }

  const result = await requestKeyAnalysisCompleteIntake(job.id, {
    transitionObservedAt: new Date().toISOString(),
  });

  const sentence = String(result?.customer_initiative_sentence ?? "").trim();
  writeEmitterTrace({
    p4_intake_called: Boolean(result?.ok && sentence),
    p4_intake_ok: Boolean(result?.ok),
    p4_intake_sentence_preview: sentence ? sentence.slice(0, 120) : null,
  });

  if (!result?.ok || !sentence) return false;

  markAnalysisCompleteIntakeDedupe(job.id);
  onKeyChatPresence({ keyInitiativeSentence: sentence });
  writeEmitterTrace({ p4_bubble_appended: true });
  return true;
}

/**
 * P4 Session emitter — tracks upload-linked jobId (not fetchLatestAnalysisJob alone).
 */
export function useKeyAnalysisCompleteSessionTransition({
  trackedAnalysisJobId = null,
  setActiveAnalysisJob = null,
  onKeyChatPresence = null,
  onTrackedJobComplete = null,
  enabled = true,
} = {}) {
  const trackedPriorStatusRef = useRef(null);
  const handlingRef = useRef(false);

  const handleTrackedComplete = async (job, latestJobId) => {
    if (!job?.id || handlingRef.current) return;
    handlingRef.current = true;
    try {
      const appended = await emitAnalysisCompleteIntake(job, onKeyChatPresence, {
        trackedJobId: trackedAnalysisJobId,
        latestJobId,
      });
      if (appended && typeof onTrackedJobComplete === "function") {
        onTrackedJobComplete(job.id);
      }
    } finally {
      handlingRef.current = false;
    }
  };

  useEffect(() => {
    if (!enabled || !trackedAnalysisJobId) return undefined;

    trackedPriorStatusRef.current = null;

    writeEmitterTrace({
      tracked_job_id: trackedAnalysisJobId,
      emitter_mode: "tracked_job_id",
    });

    let cancelled = false;
    const pollStartedAt = Date.now();

    const pollTrackedJob = async () => {
      if (cancelled) return;

      let latestJobId = null;
      try {
        const latest = await fetchLatestAnalysisJob();
        latestJobId = latest?.id ?? null;
        writeEmitterTrace({
          latest_job_id: latestJobId,
          tracked_differs_from_latest: Boolean(
            trackedAnalysisJobId && latestJobId && trackedAnalysisJobId !== latestJobId,
          ),
        });
      } catch {
        // latest comparison optional
      }

      try {
        const { analysisJob } = await fetchAnalysisJobStatus({
          jobId: trackedAnalysisJobId,
          action: "status",
        });

        if (!analysisJob?.id || cancelled) return;

        writeEmitterTrace({
          tracked_job_id: trackedAnalysisJobId,
          tracked_job_status: analysisJob.status,
          latest_job_id: latestJobId,
        });

        if (typeof setActiveAnalysisJob === "function") {
          setActiveAnalysisJob(analysisJob);
        }

        const transitioned = detectTrackedJobCompleteTransition(
          trackedAnalysisJobId,
          trackedPriorStatusRef.current,
          analysisJob,
        );
        trackedPriorStatusRef.current = analysisJob.status ?? null;

        if (transitioned) {
          await handleTrackedComplete(transitioned, latestJobId);
          return "done";
        }

        if (analysisJob.status === "failed") {
          writeEmitterTrace({ tracked_job_failed: true });
          return "failed";
        }

        if (!isAnalysisJobInFlight(analysisJob.status)) {
          return "terminal";
        }
      } catch {
        // retry on next tick
      }

      if (Date.now() - pollStartedAt > KEY_ANALYSIS_COMPLETE_POLL_MAX_MS) {
        writeEmitterTrace({ tracked_job_poll_timeout: true });
        return "timeout";
      }

      return "continue";
    };

    const timer = setInterval(async () => {
      const outcome = await pollTrackedJob();
      if (outcome && outcome !== "continue") {
        clearInterval(timer);
      }
    }, KEY_ANALYSIS_COMPLETE_POLL_INTERVAL_MS);

    void pollTrackedJob();

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [
    trackedAnalysisJobId,
    enabled,
    onKeyChatPresence,
    onTrackedJobComplete,
    setActiveAnalysisJob,
  ]);
}

export {
  analysisCompleteIntakeDedupeKey,
  detectAnalysisCompleteTransition,
  detectTrackedJobCompleteTransition,
  hasAnalysisCompleteIntakeDedupe,
  isAnalysisJobInFlight,
  markAnalysisCompleteIntakeDedupe,
  readEmitterTrace,
  writeEmitterTrace,
} from "../lib/keyAnalysisCompleteSessionTransition.js";
