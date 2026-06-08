import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { JOB_TYPE } from "./config.ts";
import type { WorkerJobRecord } from "./types.ts";

const ACTIVE_JOB_STATUSES = ["pending", "queued", "running", "retrying"] as const;

export async function loadMemoryBuilderJob(
  admin: SupabaseClient,
  jobId: string,
): Promise<WorkerJobRecord | null> {
  const { data, error } = await admin
    .from("worker_jobs")
    .select("id, job_type, status, customer_id, source_ref, payload_json, retry_count")
    .eq("id", jobId)
    .eq("job_type", JOB_TYPE)
    .maybeSingle();

  if (error) {
    throw new Error(`worker_job_load_failed: ${error.message}`);
  }

  return (data as WorkerJobRecord | null) ?? null;
}

export function isRunnableJobStatus(status: string): boolean {
  return (ACTIVE_JOB_STATUSES as readonly string[]).includes(status);
}

export async function markJobRunning(
  admin: SupabaseClient,
  jobId: string,
): Promise<void> {
  const now = new Date().toISOString();
  const { error } = await admin
    .from("worker_jobs")
    .update({
      status: "running",
      started_at: now,
      error_message: null,
      updated_at: now,
    })
    .eq("id", jobId)
    .in("status", ["pending", "queued", "retrying"]);

  if (error) {
    throw new Error(`worker_job_running_failed: ${error.message}`);
  }
}

export async function markJobCompleted(
  admin: SupabaseClient,
  jobId: string,
): Promise<void> {
  const now = new Date().toISOString();
  const { error } = await admin
    .from("worker_jobs")
    .update({
      status: "completed",
      finished_at: now,
      error_message: null,
      updated_at: now,
    })
    .eq("id", jobId);

  if (error) {
    throw new Error(`worker_job_complete_failed: ${error.message}`);
  }
}

export async function markJobFailed(
  admin: SupabaseClient,
  jobId: string | null,
  errorMessage: string,
): Promise<void> {
  if (!jobId) return;

  const now = new Date().toISOString();
  await admin
    .from("worker_jobs")
    .update({
      status: "failed",
      finished_at: now,
      error_message: errorMessage.slice(0, 500),
      updated_at: now,
    })
    .eq("id", jobId);
}
