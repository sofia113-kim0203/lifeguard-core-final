/**
 * Phase 23 Step 1C — Memory Builder worker skeleton smoke test.
 *
 * Requires:
 *   VITE_SUPABASE_URL / SUPABASE_URL
 *   VITE_SUPABASE_ANON_KEY / SUPABASE_ANON_KEY
 * Optional (worker invoke + job enqueue):
 *   SUPABASE_SERVICE_ROLE_KEY / SERVICE_ROLE_KEY
 */
import { createClient } from "@supabase/supabase-js";

const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const anonKey = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;
const serviceRoleKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE_KEY;

const SMOKE_FACT_KEY = "system.memory_builder.smoke_test";
const JOB_TYPE = "memory_builder";

if (!url || !anonKey) {
  console.error("Missing Supabase URL or anon key");
  process.exit(1);
}

const report = {
  phase: "23-1C",
  env: { hasServiceRole: !!serviceRoleKey },
  tests: {},
};

async function setupCustomer() {
  const stamp = Date.now();
  const email = `phase23-1c-${stamp}@example.com`;
  const password = `Step1c!${stamp}`;
  const sb = createClient(url, anonKey, { auth: { persistSession: false } });

  await sb.auth.signUp({ email, password });
  await sb.auth.signInWithPassword({ email, password });
  const authUid = (await sb.auth.getUser()).data.user.id;

  await sb.rpc("lifeguard_bootstrap_customer_signup", {
    p_display_name: "phase23-1c",
    p_consent_version: "2026-01-01-ko",
  });

  const { data: profile } = await sb
    .from("customer_profiles")
    .select("id")
    .eq("user_id", authUid)
    .single();

  return { customerClient: sb, customerId: profile.id };
}

async function invokeWorker(params) {
  const workerUrl = `${url}/functions/v1/memory-builder-worker`;
  const response = await fetch(workerUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${serviceRoleKey}`,
      "Content-Type": "application/json",
      apikey: serviceRoleKey,
    },
    body: JSON.stringify(params),
  });

  const body = await response.json().catch(() => ({}));
  return { status: response.status, body };
}

const { customerClient, customerId } = await setupCustomer();

report.tests.customerInsertDenied = await (async () => {
  const { error } = await customerClient.from("customer_memory_facts").insert({
    customer_id: customerId,
    fact_key: "customer.should.fail",
    fact_value: "blocked",
    provenance_type: "system",
  });
  return {
    pass: !!error,
    code: error?.code ?? null,
    message: error?.message ?? null,
  };
})();

if (!serviceRoleKey) {
  report.tests.workerInvoke = {
    pass: null,
    skipped: true,
    reason: "SERVICE_ROLE_KEY not available",
  };
  report.tests.idempotency = {
    pass: null,
    skipped: true,
    reason: "SERVICE_ROLE_KEY not available",
  };
  report.tests.customerSelectOwnActive = {
    pass: null,
    skipped: true,
    reason: "requires worker or service_role seed",
  };
  report.allPass = report.tests.customerInsertDenied.pass === true;
  console.log(JSON.stringify(report, null, 2));
  process.exit(report.allPass ? 0 : 1);
}

const admin = createClient(url, serviceRoleKey, { auth: { persistSession: false } });
const sourceRef = `phase23-1c-smoke-${Date.now()}`;

const { data: job, error: jobError } = await admin
  .from("worker_jobs")
  .insert({
    job_type: JOB_TYPE,
    status: "queued",
    customer_id: customerId,
    source_ref: sourceRef,
    payload_json: { mode: "smoke", scope: "smoke", phase: "23-1C" },
  })
  .select("id")
  .single();

report.tests.workerJobEnqueue = jobError
  ? { pass: false, code: jobError.code, message: jobError.message }
  : { pass: true, job_id: job.id };

const firstInvoke = await invokeWorker({
  job_id: job?.id,
  customer_id: customerId,
  mode: "smoke",
  scope: "smoke",
});

report.tests.workerInvoke = {
  pass: firstInvoke.status === 200 && firstInvoke.body?.fact_key === SMOKE_FACT_KEY,
  status: firstInvoke.status,
  body: firstInvoke.body,
};

const secondInvoke = await invokeWorker({
  customer_id: customerId,
  mode: "smoke",
  scope: "smoke",
});

report.tests.idempotency = {
  pass:
    secondInvoke.status === 200 &&
    secondInvoke.body?.fact_action === "no_op",
  status: secondInvoke.status,
  fact_action: secondInvoke.body?.fact_action ?? null,
};

const { data: activeFacts, error: selectError } = await customerClient
  .from("customer_memory_facts")
  .select("id, fact_key, fact_type, importance, source_table, metadata_json, superseded_at")
  .eq("customer_id", customerId)
  .is("superseded_at", null);

const smokeFact = (activeFacts ?? []).find((row) => row.fact_key === SMOKE_FACT_KEY);

report.tests.customerSelectOwnActive = {
  pass: !selectError && !!smokeFact,
  error: selectError?.message ?? null,
  activeCount: activeFacts?.length ?? 0,
  smokeFact: smokeFact
    ? {
        fact_type: smokeFact.fact_type,
        importance: smokeFact.importance,
        source_table: smokeFact.source_table,
        metadata_json: smokeFact.metadata_json,
      }
    : null,
};

const { count: duplicateCount, error: dupError } = await admin
  .from("customer_memory_facts")
  .select("id", { count: "exact", head: true })
  .eq("customer_id", customerId)
  .eq("fact_key", SMOKE_FACT_KEY)
  .is("superseded_at", null);

report.tests.singleActiveSmokeFact = {
  pass: !dupError && duplicateCount === 1,
  activeCount: duplicateCount ?? null,
};

report.allPass = Object.values(report.tests).every((test) => {
  if (!test || typeof test !== "object" || !("pass" in test)) return true;
  if (test.pass === null) return true;
  return test.pass === true;
});

console.log(JSON.stringify(report, null, 2));
process.exit(report.allPass ? 0 : 1);
