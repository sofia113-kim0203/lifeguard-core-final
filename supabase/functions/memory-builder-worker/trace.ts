import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { WORKER_NAME, WORKER_PHASE } from "./config.ts";

export type WorkerRunRecord = {
  id: string;
  attempt_number: number;
};

export async function startWorkerRun(
  admin: SupabaseClient,
  params: {
    workerJobId: string;
    attemptNumber: number;
  },
): Promise<WorkerRunRecord> {
  const { data, error } = await admin
    .from("worker_runs")
    .insert({
      worker_job_id: params.workerJobId,
      attempt_number: params.attemptNumber,
      status: "running",
    })
    .select("id, attempt_number")
    .single();

  if (error || !data) {
    throw new Error(`worker_run_start_failed: ${error?.message ?? "unknown"}`);
  }

  return { id: data.id, attempt_number: data.attempt_number };
}

export async function completeWorkerRun(
  admin: SupabaseClient,
  runId: string,
  steps: Record<string, unknown>,
): Promise<void> {
  const { error } = await admin
    .from("worker_runs")
    .update({
      status: "completed",
      finished_at: new Date().toISOString(),
      error_message: null,
    })
    .eq("id", runId);

  if (error) {
    throw new Error(`worker_run_complete_failed: ${error.message}`);
  }

  void steps;
}

export async function failWorkerRun(
  admin: SupabaseClient,
  runId: string | null,
  params: { errorMessage: string; steps: Record<string, unknown> },
): Promise<void> {
  if (!runId) return;

  await admin
    .from("worker_runs")
    .update({
      status: "failed",
      finished_at: new Date().toISOString(),
      error_message: params.errorMessage.slice(0, 500),
    })
    .eq("id", runId);

  void params.steps;
}

export function baseRunSteps(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    phase: WORKER_PHASE,
    worker: WORKER_NAME,
    ...extra,
  };
}
