import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { CONVERSATION_SCOPE, CUSTOMER_CONVERSATION_SCOPE, EXTRACT_SCOPE, JOB_TYPE, WORKER_NAME, WORKER_PHASE } from "./config.ts";
import {
  isRunnableJobStatus,
  loadMemoryBuilderJob,
  markJobCompleted,
  markJobFailed,
  markJobRunning,
} from "./jobs.ts";
import { runConversationMemoryExtract, runCustomerConversationMemoryExtract, runProfileHealthPolicyExtract } from "./rebuild.ts";
import { isServiceRoleBearer, resolveServiceRoleKey } from "./service-role.ts";
import { upsertSmokeFact } from "./smoke.ts";
import {
  baseRunSteps,
  completeWorkerRun,
  failWorkerRun,
  startWorkerRun,
} from "./trace.ts";
import type { MemoryBuilderMode, MemoryBuilderRequestBody, MemoryBuilderScope } from "./types.ts";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function jsonResponse(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

function safeErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message.slice(0, 500);
  return "memory_builder_failed";
}

function parseRequestBody(raw: unknown): MemoryBuilderRequestBody {
  const body = (raw ?? {}) as Record<string, unknown>;
  return {
    job_id: body.job_id ? String(body.job_id).trim() : undefined,
    customer_id: body.customer_id ? String(body.customer_id).trim() : undefined,
    scope: (body.scope ? String(body.scope).trim() : "smoke") as MemoryBuilderScope,
    mode: (body.mode ? String(body.mode).trim() : "smoke") as MemoryBuilderMode,
  };
}

function isExtractMode(mode: MemoryBuilderMode, scope: MemoryBuilderScope): boolean {
  return (mode === "extract" || mode === "rebuild") &&
    (scope === EXTRACT_SCOPE || scope === CONVERSATION_SCOPE || scope === CUSTOMER_CONVERSATION_SCOPE);
}

async function assertCustomerExists(
  admin: ReturnType<typeof createClient>,
  customerId: string,
): Promise<void> {
  const { data, error } = await admin
    .from("customer_profiles")
    .select("id")
    .eq("id", customerId)
    .is("deleted_at", null)
    .maybeSingle();

  if (error) {
    throw new Error(`customer_lookup_failed: ${error.message}`);
  }

  if (!data?.id) {
    throw new Error("customer_not_found");
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS });
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "method_not_allowed" }, 405);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = resolveServiceRoleKey();

  if (!supabaseUrl || !serviceRoleKey) {
    return jsonResponse({ error: "worker_not_configured" }, 500);
  }

  const authHeader = req.headers.get("Authorization");
  if (!isServiceRoleBearer(authHeader, serviceRoleKey)) {
    return jsonResponse({ error: "service_role_required" }, 403);
  }

  let body: MemoryBuilderRequestBody;
  try {
    body = parseRequestBody(await req.json());
  } catch {
    return jsonResponse({ error: "invalid_json_body" }, 422);
  }

  const mode = body.mode ?? "smoke";
  const scope = body.scope ?? "smoke";
  const isSmoke = mode === "smoke" && scope === "smoke";
  const isExtract = isExtractMode(mode, scope);

  if (!isSmoke && !isExtract) {
    return jsonResponse(
      {
        error: "unsupported_mode",
        message:
          "Supported: mode=smoke scope=smoke, or mode=extract|rebuild scope=profile_health_policy|conversation|customer_conversation.",
      },
      422,
    );
  }

  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  let jobId: string | null = body.job_id ?? null;
  let customerId = body.customer_id ?? null;
  let runId: string | null = null;

  try {
    if (jobId) {
      const job = await loadMemoryBuilderJob(adminClient, jobId);
      if (!job) {
        return jsonResponse({ error: "worker_job_not_found", job_type: JOB_TYPE }, 404);
      }

      if (!isRunnableJobStatus(job.status) && job.status !== "running") {
        return jsonResponse(
          {
            error: "worker_job_not_runnable",
            status: job.status,
          },
          409,
        );
      }

      customerId = job.customer_id;

      if (body.customer_id && body.customer_id !== customerId) {
        return jsonResponse({ error: "customer_id_job_mismatch" }, 422);
      }

      if (job.status !== "running") {
        await markJobRunning(adminClient, jobId);
      }

      const run = await startWorkerRun(adminClient, {
        workerJobId: jobId,
        attemptNumber: (job.retry_count ?? 0) + 1,
      });
      runId = run.id;
    }

    if (!customerId) {
      return jsonResponse({ error: "customer_id_required" }, 422);
    }

    await assertCustomerExists(adminClient, customerId);

    if (isSmoke) {
      const smokeResult = await upsertSmokeFact(adminClient, {
        customerId,
        jobId,
        scope: "smoke",
      });

      if (jobId) {
        await markJobCompleted(adminClient, jobId);
        if (runId) {
          await completeWorkerRun(
            adminClient,
            runId,
            baseRunSteps({
              mode: "smoke",
              fact_key: smokeResult.fact_key,
              fact_action: smokeResult.action,
            }),
          );
        }
      }

      return jsonResponse({
        worker: WORKER_NAME,
        phase: WORKER_PHASE,
        mode: "smoke",
        scope: "smoke",
        customer_id: customerId,
        job_id: jobId,
        worker_run_id: runId,
        fact_key: smokeResult.fact_key,
        fact_id: smokeResult.fact_id,
        fact_action: smokeResult.action,
        no_customer_data_extracted: true,
      });
    }

    const extractResult = scope === CUSTOMER_CONVERSATION_SCOPE
      ? await runCustomerConversationMemoryExtract(adminClient, customerId)
      : scope === CONVERSATION_SCOPE
        ? await runConversationMemoryExtract(adminClient, customerId)
        : await runProfileHealthPolicyExtract(adminClient, customerId);

    if (jobId) {
      await markJobCompleted(adminClient, jobId);
      if (runId) {
        await completeWorkerRun(
          adminClient,
          runId,
          baseRunSteps({
            mode,
            scope,
            facts_changed: extractResult.facts_changed,
            memory_version: extractResult.memory_version,
            fact_action_summary: extractResult.fact_action_summary,
          }),
        );
      }
    }

    return jsonResponse({
      worker: WORKER_NAME,
      phase: WORKER_PHASE,
      mode,
      scope,
      customer_id: customerId,
      job_id: jobId,
      worker_run_id: runId,
      consent_snapshot: extractResult.consent_snapshot,
      extractors: extractResult.extractors,
      fact_results: extractResult.fact_results,
      fact_action_summary: extractResult.fact_action_summary,
      facts_changed: extractResult.facts_changed,
      memory_version: extractResult.memory_version,
      fact_keys: extractResult.fact_keys,
      no_llm_generated: true,
    });
  } catch (error) {
    const message = safeErrorMessage(error);

    if (jobId) {
      await markJobFailed(adminClient, jobId, message);
    }

    await failWorkerRun(adminClient, runId, {
      errorMessage: message,
      steps: baseRunSteps({ mode, scope, error: message }),
    });

    return jsonResponse(
      {
        error: "memory_builder_failed",
        message,
        worker: WORKER_NAME,
        phase: WORKER_PHASE,
        job_id: jobId,
        customer_id: customerId,
      },
      500,
    );
  }
});
