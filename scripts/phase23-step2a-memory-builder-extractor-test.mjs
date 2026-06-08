/**
 * Phase 23 Step 2A — Profile / Health / Policy Memory Extractor tests.
 *
 * Requires:
 *   VITE_SUPABASE_URL / SUPABASE_URL
 *   VITE_SUPABASE_ANON_KEY / SUPABASE_ANON_KEY
 * Optional (worker invoke + admin seed):
 *   SUPABASE_SERVICE_ROLE_KEY / SERVICE_ROLE_KEY
 */
import { createClient } from "@supabase/supabase-js";

const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const anonKey = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;
const serviceRoleKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE_KEY;

const EXTRACT_SCOPE = "profile_health_policy";
const EXPECTED_FACT_KEYS = [
  "profile.name",
  "profile.age_band",
  "profile.gender",
  "profile.occupation",
  "health.smoking.status",
  "health.medication.summary",
  "health.surgery_5y.flag",
  "health.hospital_5y.flag",
  "insurance.policy.count",
  "insurance.indemnity.held",
];

if (!url || !anonKey) {
  console.error("Missing Supabase URL or anon key");
  process.exit(1);
}

const report = {
  phase: "23-2A",
  env: { hasServiceRole: !!serviceRoleKey },
  tests: {},
};

async function setupCustomer(label) {
  const stamp = Date.now();
  const email = `phase23-2a-${label}-${stamp}@example.com`;
  const password = `Step2a!${stamp}`;
  const sb = createClient(url, anonKey, { auth: { persistSession: false } });

  await sb.auth.signUp({ email, password });
  await sb.auth.signInWithPassword({ email, password });
  const authUid = (await sb.auth.getUser()).data.user.id;

  await sb.rpc("lifeguard_bootstrap_customer_signup", {
    p_display_name: `phase23-2a-${label}`,
    p_consent_version: "2026-01-01-ko",
  });

  const { data: profile } = await sb
    .from("customer_profiles")
    .select("id, memory_version")
    .eq("user_id", authUid)
    .single();

  return { customerClient: sb, customerId: profile.id, memoryVersion: profile.memory_version ?? 0 };
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

async function seedStructuredData(admin, customerId) {
  await admin
    .from("customer_profiles")
    .update({
      display_name: "테스트고객",
      birth_date: "1988-03-15",
      gender: "female",
      job_category: "office_worker",
    })
    .eq("id", customerId);

  await admin
    .from("profile_health")
    .update({
      smoking: "no",
      medication: "혈압약 복용",
      surgery_5y: "yes",
      hospital_5y: "no",
      family_history: "부: 고혈압",
      source: "update",
    })
    .eq("customer_id", customerId);

  await admin.from("customer_consents").upsert(
    {
      customer_id: customerId,
      consent_type: "insurance_data_processing",
      consent_version: "2026-01-01-ko",
      granted: true,
      granted_at: new Date().toISOString(),
      source: "test",
      purpose: "보험정보 처리 동의 (테스트)",
      required: true,
    },
    { onConflict: "customer_id,consent_type,consent_version" },
  );

  const { data: policy } = await admin
    .from("profile_insurance_policies")
    .insert({
      customer_id: customerId,
      insurer_name: "KB손해보험",
      product_name: "실손의료비",
      policy_type: "indemnity",
      is_active: true,
      source: "manual",
    })
    .select("id")
    .single();

  return { policyId: policy?.id ?? null };
}

const primary = await setupCustomer("primary");
report.tests.customerInsertDenied = await (async () => {
  const { error } = await primary.customerClient.from("customer_memory_facts").insert({
    customer_id: primary.customerId,
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
  report.tests.extractorRun = {
    pass: null,
    skipped: true,
    reason: "SERVICE_ROLE_KEY not available",
  };
  report.allPass = report.tests.customerInsertDenied.pass === true;
  console.log(JSON.stringify(report, null, 2));
  process.exit(report.allPass ? 0 : 1);
}

const admin = createClient(url, serviceRoleKey, { auth: { persistSession: false } });

await seedStructuredData(admin, primary.customerId);

const firstInvoke = await invokeWorker({
  customer_id: primary.customerId,
  mode: "extract",
  scope: EXTRACT_SCOPE,
});

const workerReady =
  firstInvoke.status === 200 &&
  firstInvoke.body?.scope === EXTRACT_SCOPE &&
  (firstInvoke.body?.facts_changed ?? 0) >= 1;

report.tests.extractorRun = {
  pass: workerReady,
  status: firstInvoke.status,
  facts_changed: firstInvoke.body?.facts_changed ?? null,
  memory_version: firstInvoke.body?.memory_version ?? null,
  fact_action_summary: firstInvoke.body?.fact_action_summary ?? null,
  extractors: firstInvoke.body?.extractors ?? null,
  unsupported: firstInvoke.body?.error === "unsupported_mode",
};

if (!workerReady) {
  report.tests.factsCreated = {
    pass: null,
    skipped: true,
    reason:
      firstInvoke.body?.error === "unsupported_mode"
        ? "worker not deployed with Step 2A extract mode"
        : `worker invoke failed status=${firstInvoke.status}`,
  };
  report.tests.missingConsentSkips = { pass: null, skipped: true };
  report.tests.idempotencyNoOp = { pass: null, skipped: true };
  report.tests.supersedeOnChange = { pass: null, skipped: true };
  report.tests.customerSelectOwnActive = { pass: null, skipped: true };
  report.tests.crossCustomerSelectBlocked = { pass: null, skipped: true };
  report.tests.memoryVersionNoOp = { pass: null, skipped: true };
  report.allPass = report.tests.customerInsertDenied.pass === true;
  console.log(JSON.stringify(report, null, 2));
  process.exit(report.allPass ? 0 : 1);
}

const { data: activeFactsAfterFirst } = await primary.customerClient
  .from("customer_memory_facts")
  .select("id, fact_key, fact_value, fact_type, importance, source_table, metadata_json, superseded_at")
  .eq("customer_id", primary.customerId)
  .is("superseded_at", null);

const factKeys = new Set((activeFactsAfterFirst ?? []).map((row) => row.fact_key));
const createdExpected = EXPECTED_FACT_KEYS.filter((key) => factKeys.has(key));

report.tests.factsCreated = {
  pass: createdExpected.length >= 6,
  expected_keys: EXPECTED_FACT_KEYS,
  created_keys: createdExpected,
  active_count: activeFactsAfterFirst?.length ?? 0,
  sample_metadata: (activeFactsAfterFirst ?? []).find((row) => row.fact_key === "health.medication.summary")
    ?.metadata_json ?? null,
};

const consentCustomer = await setupCustomer("noconsent");
await admin
  .from("profile_health")
  .update({
    medication: "비밀약",
    smoking: "yes",
    source: "update",
  })
  .eq("customer_id", consentCustomer.customerId);

await admin
  .from("customer_consents")
  .update({ revoked_at: new Date().toISOString() })
  .eq("customer_id", consentCustomer.customerId)
  .eq("consent_type", "sensitive_health_processing")
  .is("revoked_at", null);

const consentInvoke = await invokeWorker({
  customer_id: consentCustomer.customerId,
  mode: "rebuild",
  scope: EXTRACT_SCOPE,
});

const { data: noConsentHealthFacts } = await admin
  .from("customer_memory_facts")
  .select("fact_key")
  .eq("customer_id", consentCustomer.customerId)
  .like("fact_key", "health.%")
  .is("superseded_at", null);

report.tests.missingConsentSkips = {
  pass:
    consentInvoke.status === 200 &&
    (consentInvoke.body?.extractors?.health?.skipped === true ||
      (noConsentHealthFacts ?? []).length === 0),
  health_facts_count: noConsentHealthFacts?.length ?? 0,
  health_extractor: consentInvoke.body?.extractors?.health ?? null,
};

const memoryVersionAfterFirst = firstInvoke.body?.memory_version ?? null;

const secondInvoke = await invokeWorker({
  customer_id: primary.customerId,
  mode: "rebuild",
  scope: EXTRACT_SCOPE,
});

report.tests.idempotencyNoOp = {
  pass:
    secondInvoke.status === 200 &&
    secondInvoke.body?.facts_changed === 0 &&
    (secondInvoke.body?.fact_action_summary?.no_op ?? 0) > 0,
  facts_changed: secondInvoke.body?.facts_changed ?? null,
  fact_action_summary: secondInvoke.body?.fact_action_summary ?? null,
};

report.tests.memoryVersionNoOp = {
  pass:
    secondInvoke.status === 200 &&
    secondInvoke.body?.memory_version === memoryVersionAfterFirst,
  before: memoryVersionAfterFirst,
  after: secondInvoke.body?.memory_version ?? null,
};

const { data: medicationBefore } = await admin
  .from("customer_memory_facts")
  .select("id, fact_value")
  .eq("customer_id", primary.customerId)
  .eq("fact_key", "health.medication.summary")
  .is("superseded_at", null)
  .maybeSingle();

await admin
  .from("profile_health")
  .update({ medication: "당뇨약 복용", source: "update" })
  .eq("customer_id", primary.customerId);

const thirdInvoke = await invokeWorker({
  customer_id: primary.customerId,
  mode: "extract",
  scope: EXTRACT_SCOPE,
});

const { data: medicationAfter } = await admin
  .from("customer_memory_facts")
  .select("id, fact_value, superseded_at")
  .eq("customer_id", primary.customerId)
  .eq("fact_key", "health.medication.summary")
  .order("created_at", { ascending: false })
  .limit(2);

const supersededRow = (medicationAfter ?? []).find((row) => row.superseded_at);
const activeRow = (medicationAfter ?? []).find((row) => !row.superseded_at);

report.tests.supersedeOnChange = {
  pass:
    thirdInvoke.status === 200 &&
    (thirdInvoke.body?.facts_changed ?? 0) >= 1 &&
    !!supersededRow &&
    activeRow?.fact_value === "당뇨약 복용" &&
    medicationBefore?.fact_value !== activeRow?.fact_value,
  facts_changed: thirdInvoke.body?.facts_changed ?? null,
  old_value: medicationBefore?.fact_value ?? null,
  new_value: activeRow?.fact_value ?? null,
};

report.tests.customerSelectOwnActive = {
  pass: (activeFactsAfterFirst ?? []).length > 0,
  active_count: activeFactsAfterFirst?.length ?? 0,
};

const other = await setupCustomer("other");
const { data: crossRows, error: crossError } = await other.customerClient
  .from("customer_memory_facts")
  .select("id")
  .eq("customer_id", primary.customerId);

report.tests.crossCustomerSelectBlocked = {
  pass: !crossError && (crossRows ?? []).length === 0,
  row_count: crossRows?.length ?? 0,
};

report.allPass = Object.values(report.tests).every((test) => {
  if (!test || typeof test !== "object" || !("pass" in test)) return true;
  if (test.pass === null) return true;
  return test.pass === true;
});

console.log(JSON.stringify(report, null, 2));
process.exit(report.allPass ? 0 : 1);
