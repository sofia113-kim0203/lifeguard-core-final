/**
 * A1 — Worker jobs runner.
 *
 * Triggered by Vercel Cron (every 2 min). Each invocation:
 *   1. claims up to BATCH_SIZE due jobs    → lifeguard_claim_worker_jobs
 *   2. executes each job directly          → (A1) job_type 'memory_builder'
 *   3. records the outcome via RPC         → complete | fail (retry / dead_letter)
 *
 * The runner OWNS the job lifecycle: it does not pass a job id to the memory
 * worker. It calls rebuildCustomerMemoryFoundation directly (which throws on
 * failure) and translates success/throw into the complete / fail RPCs. This
 * keeps the retry/DLQ policy in exactly one place (the fail RPC).
 *
 * Auth: Vercel Cron sends `Authorization: Bearer <CRON_SECRET>`. Without a
 * matching CRON_SECRET the runner refuses to run (fail-closed). The same bearer
 * lets the job loop be triggered manually for verification.
 *
 * Scope (A1): only 'memory_builder' is wired. Any other claimed job_type is
 * failed with `unsupported_job_type:<type>` so it flows through the same
 * retry/DLQ path rather than sitting in 'running' forever.
 */
import { createClient } from "@supabase/supabase-js";
import { rebuildCustomerMemoryFoundation } from "../server/customerMemoryFoundation.js";
const BATCH_SIZE = 1;
const BACKOFF_SECONDS = [60, 300, 1800];
const FALLBACK_BACKOFF_SECONDS = 1800;
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
async function executeJob(adminSupabase, job) {
  if (job.job_type === "memory_builder") {
    await rebuildCustomerMemoryFoundation({
      supabase: adminSupabase,
      customerId: job.customer_id,
      includeConversation: true,
    });
    return;
  }
  throw new Error(`unsupported_job_type:${job.job_type}`);
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
  const summary = {
    claimed: 0,
    completed: 0,
    retrying: 0,
    dead_letter: 0,
    record_failures: 0,
  };
  try {
    const { data: claimed, error: claimError } = await adminSupabase.rpc(
      "lifeguard_claim_worker_jobs",
      { p_limit: BATCH_SIZE },
    );
    if (claimError) {
      console.error("[A1] claim_failed", claimError.message);
      res.statusCode = 500;
      res.end(JSON.stringify({ error: "claim_failed", detail: claimError.message }));
      return;
    }
    const jobs = Array.isArray(claimed) ? claimed : [];
    summary.claimed = jobs.length;
    for (const job of jobs) {
      try {
        await executeJob(adminSupabase, job);
        const { error: completeError } = await adminSupabase.rpc(
          "lifeguard_complete_worker_job",
          { p_job_id: job.id },
        );
        if (completeError) throw new Error(`complete_rpc_failed: ${completeError.message}`);
        summary.completed += 1;
      } catch (jobError) {
        const message = jobError instanceof Error ? jobError.message : String(jobError);
        const retryCount = Number.isInteger(job.retry_count) ? job.retry_count : 0;
        const backoff = BACKOFF_SECONDS[retryCount] ?? FALLBACK_BACKOFF_SECONDS;
        const { data: outcome, error: failError } = await adminSupabase.rpc(
          "lifeguard_fail_worker_job",
          { p_job_id: job.id, p_error: message, p_backoff_seconds: backoff },
        );
        if (failError) {
          summary.record_failures += 1;
          console.error("[A1] fail_rpc_failed", { jobId: job.id, error: failError.message });
          continue;
        }
        if (outcome === "dead_letter") {
          summary.dead_letter += 1;
          console.error("[A1] job_dead_lettered", {
            jobId: job.id,
            jobType: job.job_type,
            error: message,
          });
        } else {
          summary.retrying += 1;
          console.warn("[A1] job_retry_scheduled", {
            jobId: job.id,
            backoffSeconds: backoff,
            error: message,
          });
        }
      }
    }
    res.statusCode = 200;
    res.end(JSON.stringify({ ok: true, summary }));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[A1] runner_unexpected_error", message);
    res.statusCode = 500;
    res.end(JSON.stringify({ error: "runner_unexpected_error", detail: message }));
  }
}
