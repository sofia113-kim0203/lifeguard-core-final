/**
 * A1 — GET /api/worker-jobs-runner
 * Vercel Cron worker_jobs runtime loop: claim → execute → complete/fail (RPC-owned lifecycle).
 */

import { createClient } from "@supabase/supabase-js";
import {
  rebuildCustomerMemoryFoundation,
  resolveServiceRoleKey,
  resolveSupabaseUrl,
} from "../server/customerMemoryFoundation.js";
import {
  formatMemoryBuilderFailure,
  MemoryBuilderRebuildError,
} from "../server/memoryObservability.js";

const DEFAULT_BATCH_LIMIT = 5;
const RETRY_BACKOFF_SECONDS = [30, 120, 600, 3600, 3600];

function resolveRuntimeConfig() {
  const supabaseUrl = resolveSupabaseUrl();
  const serviceRoleKey = resolveServiceRoleKey();
  const cronSecret = String(process.env.CRON_SECRET ?? "").trim();
  const parsedLimit = Number(process.env.WORKER_JOBS_BATCH_LIMIT ?? DEFAULT_BATCH_LIMIT);
  const batchLimit = Number.isFinite(parsedLimit) && parsedLimit > 0 ? Math.min(parsedLimit, 50) : DEFAULT_BATCH_LIMIT;

  return { supabaseUrl, serviceRoleKey, cronSecret, batchLimit };
}

function isAuthorizedCronRequest(req, cronSecret) {
  if (!cronSecret) return false;
  const authHeader = String(req.headers?.authorization ?? req.headers?.Authorization ?? "").trim();
  return authHeader === `Bearer ${cronSecret}`;
}

function resolveBackoffSeconds(retryCount) {
  const index = Math.max(0, Math.min(Number(retryCount ?? 0), RETRY_BACKOFF_SECONDS.length - 1));
  return RETRY_BACKOFF_SECONDS[index];
}

function resolveMemoryBuilderErrorMessage(error) {
  if (error instanceof MemoryBuilderRebuildError) {
    const failures = formatMemoryBuilderFailure(
      error.profile_health_policy,
      error.customer_conversation,
    );
    if (failures.length > 0) {
      return failures.map((f) => `${f.scope}:${f.error}`).join("; ").slice(0, 500);
    }
    return String(error.code ?? "memory_builder_rebuild_failed").slice(0, 500);
  }
  return (error instanceof Error ? error.message : "memory_builder_failed").slice(0, 500);
}

async function completeWorkerJob(admin, jobId) {
  const { error } = await admin.rpc("lifeguard_complete_worker_job", {
    p_job_id: jobId,
  });
  if (error) {
    throw new Error(`lifeguard_complete_worker_job_failed: ${error.message}`);
  }
}

async function failWorkerJob(admin, job, errorMessage) {
  const { error } = await admin.rpc("lifeguard_fail_worker_job", {
    p_job_id: job.id,
    p_error: errorMessage,
    p_backoff_seconds: resolveBackoffSeconds(job.retry_count),
  });
  if (error) {
    throw new Error(`lifeguard_fail_worker_job_failed: ${error.message}`);
  }
}

async function processMemoryBuilderJob({ admin, supabaseUrl, serviceRoleKey, job }) {
  const payload = job?.payload_json && typeof job.payload_json === "object" ? job.payload_json : {};
  const includeConversation = payload.include_conversation !== false;

  await rebuildCustomerMemoryFoundation({
    supabase: admin,
    supabaseUrl,
    serviceRoleKey,
    customerId: job.customer_id,
    includeConversation,
  });
  await completeWorkerJob(admin, job.id);
}

/** @param {import('http').IncomingMessage} req @param {import('http').ServerResponse} res */
export default async function handler(req, res) {
  if (req.method === "OPTIONS") {
    res.statusCode = 200;
    res.end();
    return;
  }

  if (req.method !== "GET") {
    res.statusCode = 405;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ ok: false, reason: "METHOD_NOT_ALLOWED" }));
    return;
  }

  const { supabaseUrl, serviceRoleKey, cronSecret, batchLimit } = resolveRuntimeConfig();

  if (!isAuthorizedCronRequest(req, cronSecret)) {
    res.statusCode = 401;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ ok: false, reason: "UNAUTHORIZED" }));
    return;
  }

  if (!supabaseUrl || !serviceRoleKey) {
    res.statusCode = 500;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ ok: false, reason: "SUPABASE_NOT_CONFIGURED" }));
    return;
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  try {
    const { data: claimedJobs, error: claimError } = await admin.rpc("lifeguard_claim_worker_jobs", {
      p_limit: batchLimit,
    });

    if (claimError) {
      res.statusCode = 500;
      res.setHeader("Content-Type", "application/json");
      res.end(
        JSON.stringify({
          ok: false,
          reason: "CLAIM_FAILED",
          error_message: claimError.message,
        }),
      );
      return;
    }

    const jobs = Array.isArray(claimedJobs) ? claimedJobs : [];
    const results = [];

    for (const job of jobs) {
      const jobType = String(job?.job_type ?? "").trim();

      try {
        if (jobType === "memory_builder") {
          await processMemoryBuilderJob({ admin, supabaseUrl, serviceRoleKey, job });
          results.push({
            job_id: job.id,
            job_type: jobType,
            ok: true,
          });
          continue;
        }

        const unsupportedMessage = `unsupported_job_type:${jobType || "unknown"}`;
        await failWorkerJob(admin, job, unsupportedMessage);
        results.push({
          job_id: job.id,
          job_type: jobType,
          ok: false,
          error_message: unsupportedMessage,
        });
      } catch (error) {
        const errorMessage = resolveMemoryBuilderErrorMessage(error).slice(0, 500);
        try {
          await failWorkerJob(admin, job, errorMessage);
        } catch (failError) {
          console.error("[A1] worker job fail RPC error", {
            job_id: job?.id ?? null,
            error: failError instanceof Error ? failError.message : String(failError),
          });
        }
        results.push({
          job_id: job?.id ?? null,
          job_type: jobType,
          ok: false,
          error_message: errorMessage,
        });
      }
    }

    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        ok: true,
        claimed: jobs.length,
        processed: results.length,
        results,
      }),
    );
  } catch (error) {
    console.error("[A1] worker jobs runner error", {
      error: error instanceof Error ? error.message : String(error),
    });
    res.statusCode = 500;
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        ok: false,
        reason: "SERVER_ERROR",
        error_message: error instanceof Error ? error.message : "worker_jobs_runner_failed",
      }),
    );
  }
}
