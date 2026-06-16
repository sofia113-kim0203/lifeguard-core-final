/**
 * Analysis jobs autopilot — Vercel Cron runner.
 *
 * Claims stale analysis_jobs (browser not progressing) and runs them to completion
 * via existing runAnalysisJobToCompletion. Does not touch worker_jobs / memory_builder.
 *
 * Auth: Bearer CRON_SECRET (mirrors api/worker-jobs-runner.js).
 */
import { createClient } from "@supabase/supabase-js";
import { runAnalysisJobToCompletion } from "../server/backgroundAnalysisJobRunner.js";
import { postResultMessageIfNeededForTest as postResultMessageIfNeeded } from "../server/conversationalBackgroundAnalysisCore.js";
import {
  DEFAULT_MAX_ATTEMPTS,
  isWithinTimeBudget,
  shouldMarkFailed,
} from "../server/analysisJobsAutopilot.js";

const BATCH_SIZE = 2;
const MAX_DURATION_MS = 300_000;

function createServiceRoleSupabaseClient(env = process.env) {
  const url = String(env.SUPABASE_URL ?? env.VITE_SUPABASE_URL ?? "").trim();
  const serviceRoleKey = String(env.SERVICE_ROLE_KEY ?? env.SUPABASE_SERVICE_ROLE_KEY ?? "").trim();
  if (!url || !serviceRoleKey) return null;
  return createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function isAuthorized(req, env = process.env) {
  const secret = String(env.CRON_SECRET ?? "").trim();
  if (!secret) return false;
  const header = String(req.headers?.authorization ?? "");
  return header === `Bearer ${secret}`;
}

async function releaseAnalysisJobLock(supabase, jobId) {
  const { error } = await supabase
    .from("analysis_jobs")
    .update({ locked_at: null, updated_at: new Date().toISOString() })
    .eq("id", jobId);
  if (error) {
    throw new Error(`release_lock_failed: ${error.message}`);
  }
}

async function recordAutopilotFailure(supabase, job, errorMessage) {
  const nextAttempts = Number(job.attempts ?? 0) + 1;
  const patch = {
    locked_at: null,
    attempts: nextAttempts,
    updated_at: new Date().toISOString(),
  };

  if (shouldMarkFailed(nextAttempts, DEFAULT_MAX_ATTEMPTS)) {
    patch.status = "failed";
    patch.error_message = String(errorMessage ?? "autopilot_failed").slice(0, 2000);
  }

  const { error } = await supabase.from("analysis_jobs").update(patch).eq("id", job.id);
  if (error) {
    throw new Error(`record_failure_failed: ${error.message}`);
  }

  return { attempts: nextAttempts, markedFailed: patch.status === "failed" };
}

export default async function handler(req, res) {
  res.setHeader("Content-Type", "application/json");

  if (req.method !== "GET" && req.method !== "POST") {
    res.statusCode = 405;
    res.end(JSON.stringify({ error: "method_not_allowed" }));
    return;
  }

  if (!isAuthorized(req)) {
    res.statusCode = 401;
    res.end(JSON.stringify({ error: "unauthorized" }));
    return;
  }

  const adminSupabase = createServiceRoleSupabaseClient();
  if (!adminSupabase) {
    res.statusCode = 500;
    res.end(JSON.stringify({ error: "service_role_unavailable" }));
    return;
  }

  const tickStartedAt = Date.now();
  const summary = {
    claimed: 0,
    completed: 0,
    failed: 0,
    retry_scheduled: 0,
    skipped_time_budget: 0,
    record_failures: 0,
  };

  try {
    const { data: claimed, error: claimError } = await adminSupabase.rpc(
      "lifeguard_claim_analysis_jobs",
      { p_limit: BATCH_SIZE },
    );

    if (claimError) {
      console.error("[analysis-jobs-autopilot] claim_failed", claimError.message);
      res.statusCode = 500;
      res.end(JSON.stringify({ error: "claim_failed", detail: claimError.message }));
      return;
    }

    const jobs = Array.isArray(claimed) ? claimed : [];
    summary.claimed = jobs.length;

    for (const job of jobs) {
      if (!isWithinTimeBudget(tickStartedAt, Date.now(), MAX_DURATION_MS)) {
        summary.skipped_time_budget += 1;
        await releaseAnalysisJobLock(adminSupabase, job.id).catch((err) => {
          console.error("[analysis-jobs-autopilot] release_on_budget", {
            jobId: job.id,
            error: err instanceof Error ? err.message : String(err),
          });
        });
        continue;
      }

      try {
        const processResult = await runAnalysisJobToCompletion({
          supabase: adminSupabase,
          jobId: job.id,
        });

        const finalJob = processResult?.job ?? null;
        if (finalJob?.status === "completed") {
          await releaseAnalysisJobLock(adminSupabase, job.id);
          await postResultMessageIfNeeded(adminSupabase, finalJob.customer_id, finalJob);
          summary.completed += 1;
          continue;
        }

        const reason =
          processResult?.error_message ??
          processResult?.reason ??
          `autopilot_incomplete:${finalJob?.status ?? "unknown"}`;

        const outcome = await recordAutopilotFailure(adminSupabase, job, reason);
        if (outcome.markedFailed) {
          summary.failed += 1;
        } else {
          summary.retry_scheduled += 1;
        }
      } catch (jobError) {
        const message = jobError instanceof Error ? jobError.message : String(jobError);
        try {
          const outcome = await recordAutopilotFailure(adminSupabase, job, message);
          if (outcome.markedFailed) {
            summary.failed += 1;
          } else {
            summary.retry_scheduled += 1;
          }
        } catch (recordError) {
          summary.record_failures += 1;
          console.error("[analysis-jobs-autopilot] record_fail_failed", {
            jobId: job.id,
            error: recordError instanceof Error ? recordError.message : String(recordError),
          });
        }
      }
    }

    res.statusCode = 200;
    res.end(JSON.stringify({ ok: true, summary }));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[analysis-jobs-autopilot] runner_unexpected_error", message);
    res.statusCode = 500;
    res.end(JSON.stringify({ error: "runner_unexpected_error", detail: message }));
  }
}
