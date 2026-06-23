/**
 * E-2-3 — staging QA auth users + synthetic seed + RLS verify plan
 *
 * Target: .e2-1-inventory.json staging_ref (must differ from production ref)
 * Creates fixed QA accounts + minimal synthetic rows for cross-tenant RLS.
 *
 * Flags:
 *   --dry-run   Print planned actions only; no auth/DB writes
 *
 * Does NOT: production emails/UUIDs, Kim Jinwoo persona, Vercel env, .env.local edits
 * Never stores passwords/tokens/keys in inventory/report files
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const PROD_REF = "fhvlxcguvjvtftttfrix";
const PROD_HOST = `${PROD_REF}.supabase.co`;
const E21_INVENTORY_PATH = path.join(ROOT, ".e2-1-inventory.json");
const QA_INVENTORY_PATH = path.join(ROOT, ".e2-3-qa-inventory.json");
const REPORT_PATH = path.join(ROOT, ".e2-3-intermediate-report.json");

const SIGNUP_CONSENT_VERSION = "2026-01-01-ko";
const DOCUMENT_STORAGE_VERSION = "2026-06-07-ko-doc";
const DOCUMENT_ANALYSIS_VERSION = "2026-06-07-ko-doc-analysis";
const INSURANCE_DATA_VERSION = "2026-01-01-ko";
const SEED_SOURCE = "e2_3_qa_seed";
const POLICY_SOURCE = "manual";

const QA_USERS = [
  {
    key: "customer_a",
    email: "e2-3-qa-customer-a@staging-qa.example.com",
    role: "customer",
    display_name: "QA Customer A",
    grant_extended_consents: true,
    seed_profile: true,
  },
  {
    key: "customer_b",
    email: "e2-3-qa-customer-b@staging-qa.example.com",
    role: "customer",
    display_name: "QA Customer B",
    grant_extended_consents: false,
    seed_profile: true,
  },
  {
    key: "admin",
    email: "e2-3-qa-admin@staging-qa.example.com",
    role: "admin",
    display_name: "QA Admin",
    grant_extended_consents: false,
    seed_profile: false,
  },
  {
    key: "agent",
    email: "e2-3-qa-agent@staging-qa.example.com",
    role: "agent",
    display_name: "QA Agent",
    grant_extended_consents: false,
    seed_profile: false,
  },
];

const SIGNUP_CONSENTS = [
  { consent_type: "privacy_collection", consent_version: SIGNUP_CONSENT_VERSION },
  { consent_type: "sensitive_health_processing", consent_version: SIGNUP_CONSENT_VERSION },
  { consent_type: "ai_consultation", consent_version: SIGNUP_CONSENT_VERSION },
];

const EXTENDED_CONSENTS = [
  { consent_type: "document_storage", consent_version: DOCUMENT_STORAGE_VERSION },
  { consent_type: "document_analysis", consent_version: DOCUMENT_ANALYSIS_VERSION },
  { consent_type: "memory_retention", consent_version: SIGNUP_CONSENT_VERSION },
  { consent_type: "insurance_data_processing", consent_version: INSURANCE_DATA_VERSION },
];

const RLS_VERIFY_TABLES = [
  "customer_profiles",
  "active_profile_insurance_policies",
  "customer_documents",
  "customer_memory_facts",
  "customer_consents",
  "customer_conversations",
];

/** Min rows on customer_b (service_role) to prove tenant has data; 0 = jwt_rows===0 is sufficient. */
const RLS_TARGET_B_MIN_ROWS = {
  customer_profiles: 1,
  active_profile_insurance_policies: 1,
  customer_documents: 0,
  customer_memory_facts: 0,
  customer_consents: 1,
  customer_conversations: 0,
};

const argv = new Set(process.argv.slice(2));
const DRY_RUN = argv.has("--dry-run");

function parseEnvFile(envPath) {
  const out = {};
  if (!fs.existsSync(envPath)) return out;
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const idx = trimmed.indexOf("=");
    if (idx <= 0) continue;
    out[trimmed.slice(0, idx).trim()] = trimmed.slice(idx + 1).trim();
  }
  return out;
}

function loadAccessToken() {
  if (DRY_RUN) return "dry-run-token";
  const token = parseEnvFile(path.join(ROOT, ".env.local")).SUPABASE_ACCESS_TOKEN?.trim();
  if (!token) throw new Error("SUPABASE_ACCESS_TOKEN missing in .env.local");
  return token;
}

function resolveSupabaseEnvLabel() {
  const fromProcess = String(process.env.SUPABASE_ENV ?? "").trim().toLowerCase();
  if (fromProcess) return fromProcess;
  return String(parseEnvFile(path.join(ROOT, ".env.local")).SUPABASE_ENV ?? "").trim().toLowerCase();
}

function hostFromUrl(url) {
  try {
    return new URL(url).host.toLowerCase();
  } catch {
    return "";
  }
}

function assertSupabaseEnvNotProduction() {
  const supabaseEnv = resolveSupabaseEnvLabel();
  if (supabaseEnv === "production" || supabaseEnv === "prod") {
    throw new Error("production_guard:SUPABASE_ENV=production|prod is forbidden for E-2-3");
  }
}

function assertProductionGuard({ stagingRef, stagingHost }) {
  assertSupabaseEnvNotProduction();
  if (!stagingRef) throw new Error("production_guard:staging_ref missing");
  if (stagingRef === PROD_REF) {
    throw new Error("production_guard:staging_ref matches production ref");
  }
  const host = String(stagingHost ?? "")
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/\/$/, "");
  if (host && (host === PROD_HOST || host.endsWith(`.${PROD_HOST}`))) {
    throw new Error("production_guard:staging host matches production host");
  }
}

function sanitizeReport(report) {
  return JSON.parse(
    JSON.stringify(report, (_key, value) => {
      if (typeof value === "string" && /eyJ[a-zA-Z0-9_-]+\./.test(value)) return "[REDACTED_JWT]";
      return value;
    }),
  );
}

function writeReport(report) {
  fs.writeFileSync(REPORT_PATH, `${JSON.stringify(sanitizeReport(report), null, 2)}\n`, "utf8");
}

function saveQaInventory(inventory) {
  const safe = { ...inventory };
  delete safe.passwords;
  delete safe.service_role_key;
  delete safe.anon_key;
  delete safe.access_token;
  safe.updated_at = new Date().toISOString();
  fs.writeFileSync(QA_INVENTORY_PATH, `${JSON.stringify(safe, null, 2)}\n`, "utf8");
  return safe;
}

function loadE21Inventory() {
  if (!fs.existsSync(E21_INVENTORY_PATH)) return null;
  return JSON.parse(fs.readFileSync(E21_INVENTORY_PATH, "utf8"));
}

function planLine(message) {
  console.log(`[PLAN] ${message}`);
}

function buildPlannedUsers() {
  return QA_USERS.map((user) => ({
    key: user.key,
    email: user.email,
    role: user.role,
    display_name: user.display_name,
    auth_action: "auth.admin.createUser (email_confirm=true) or reuse if exists",
    db_followup:
      user.role === "customer"
        ? "trigger 014 → users/customer_profiles/profile_health/signup consents"
        : "trigger 014 → customer bootstrap; then UPDATE public.users.role",
  }));
}

function buildPlannedConsents() {
  const out = [];
  for (const user of QA_USERS) {
    const rows = [...SIGNUP_CONSENTS.map((c) => ({ ...c, customer_key: user.key, origin: "signup_trigger" }))];
    if (user.grant_extended_consents) {
      for (const c of EXTENDED_CONSENTS) {
        rows.push({ ...c, customer_key: user.key, origin: "e2_3_seed_insert" });
      }
    }
    out.push({ customer_key: user.key, consents: rows });
  }
  return out;
}

function buildPlannedSeedRows() {
  return [
    {
      table: "profile_insurance_policies",
      customer_key: "customer_a",
      row: {
        insurer_name: "QA테스트손보",
        product_name: "QA종합보장A",
        policy_type: "health",
        source: POLICY_SOURCE,
        seed_tag: SEED_SOURCE,
        is_active: true,
      },
    },
    {
      table: "profile_insurance_policies",
      customer_key: "customer_b",
      row: {
        insurer_name: "QA테스트생명",
        product_name: "QA종합보장B",
        policy_type: "life",
        source: POLICY_SOURCE,
        seed_tag: SEED_SOURCE,
        is_active: true,
      },
    },
    {
      table: "customer_memory_facts",
      customer_key: "customer_a",
      row: {
        fact_key: "qa.preference.premium.burden_stated",
        fact_value: "QA synthetic memory fact for staging only",
        provenance_type: "profile",
        source_table: "e2_3_qa_seed",
        metadata_json: {
          consent_type: "memory_retention",
          consent_version: SIGNUP_CONSENT_VERSION,
          source: SEED_SOURCE,
          no_mock: false,
          synthetic: true,
        },
      },
    },
    {
      table: "customer_documents",
      customer_key: "customer_a",
      row: {
        original_filename: "qa-staging-metadata-only.txt",
        mime_type: "text/plain",
        doc_class: "other",
        ingest_status: "uploaded",
        storage_path: "<customer_id>/<document_id>/qa-staging-metadata-only.txt",
        metadata_json: { source: SEED_SOURCE, synthetic: true, note: "metadata_only_no_blob_required_for_rls" },
      },
    },
    {
      table: "agent_assignments",
      customer_key: "customer_a",
      agent_key: "agent",
      row: {
        status: "active",
        assigned_at: "NOW()",
        notes: "e2_3_qa_seed synthetic assignment",
      },
    },
  ];
}

function buildRlsVerifyPlan() {
  return {
    cross_tenant: {
      actor: "customer_a JWT",
      target: "customer_b customer_id",
      tables: RLS_VERIFY_TABLES,
      expected: "0 rows returned on jwt queries; service_role min rows per table (see rls_target_b_min_rows)",
    },
    role_matrix: [
      { actor: "customer_a", resource: "own customer_documents", expected: "allowed under own prefix" },
      { actor: "customer_b", resource: "customer_a documents", expected: "0 rows" },
      { actor: "agent", resource: "customer_documents/profile_health", expected: "0 rows (002)" },
      { actor: "admin", resource: "worker_jobs", expected: "audit SELECT only" },
    ],
    script_step: "signIn customer_a → JWT queries B ids → compare counts via service_role",
    rls_target_b_min_rows: RLS_TARGET_B_MIN_ROWS,
  };
}

function buildLiveApiPlan(stagingRef) {
  const stagingHost = `https://${stagingRef}.supabase.co`;
  return [
    { method: "GET", path: `/v1/projects/${stagingRef}/api-keys`, purpose: "resolve staging anon + service_role (not stored in report)" },
    { method: "POST", path: `${stagingHost}/auth/v1/admin/users`, purpose: "create/reuse QA user ×4 (service_role auth header)" },
    { method: "POST", path: `/v1/projects/${stagingRef}/database/query`, purpose: "UPDATE public.users.role for admin/agent" },
    { method: "POST", path: `/v1/projects/${stagingRef}/database/query`, purpose: "INSERT customer_consents extended grants (customer_a)" },
    { method: "POST", path: `/v1/projects/${stagingRef}/database/query`, purpose: "INSERT synthetic seed rows (policies, memory, document metadata, agent_assignments)" },
    { method: "POST", path: `${stagingHost}/auth/v1/token?grant_type=password`, purpose: "signIn customer_a for RLS verify" },
    { method: "POST", path: `/v1/projects/${stagingRef}/database/query`, purpose: "RLS evidence counts (service_role)" },
    { method: "GET", path: `${stagingHost}/rest/v1/...`, purpose: "JWT cross-tenant SELECT via Supabase client (6 tables)" },
  ];
}

async function mgmtApi(token, apiPath, options = {}) {
  if (DRY_RUN) {
    return {
      ok: true,
      status: 200,
      body: { dry_run: true, path: apiPath, method: options.method ?? "GET" },
    };
  }
  const res = await fetch(`https://api.supabase.com/v1${apiPath}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(options.headers ?? {}),
    },
  });
  const text = await res.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = { raw: text.slice(0, 500) };
  }
  return { ok: res.ok, status: res.status, body };
}

async function fetchStagingKeys(token, stagingRef) {
  if (DRY_RUN) {
    return { anon_key: "[DRY_RUN]", service_role_key: "[DRY_RUN]" };
  }
  const res = await mgmtApi(token, `/projects/${stagingRef}/api-keys`);
  if (!res.ok) throw new Error(`api_keys_failed:${res.status}`);
  const keys = Array.isArray(res.body) ? res.body : [];
  const anon = keys.find((k) => k.name === "anon")?.api_key;
  const service = keys.find((k) => k.name === "service_role")?.api_key;
  if (!anon || !service) throw new Error("staging_api_keys_missing:anon_or_service_role");
  return { anon_key: anon, service_role_key: service };
}

async function runSql(token, ref, sql, { label = "sql" } = {}) {
  if (DRY_RUN) {
    console.log(`[DRY_RUN] would execute ${label} on ref=${ref} (${sql.length} chars)`);
    return { dry_run: true, label };
  }
  const res = await mgmtApi(token, `/projects/${ref}/database/query`, {
    method: "POST",
    body: JSON.stringify({ query: sql }),
  });
  if (!res.ok) {
    const message =
      res.body?.message ??
      res.body?.error ??
      (typeof res.body?.raw === "string" ? res.body.raw : JSON.stringify(res.body));
    throw new Error(`sql_failed:${res.status}:${String(message).slice(0, 400)}`);
  }
  return res.body;
}

function generatePassword() {
  return `E2-3-QA-${crypto.randomBytes(18).toString("base64url")}!`;
}

async function ensureAuthUser(adminClient, user, password) {
  if (DRY_RUN) {
    return { user_id: `<dry-run-${user.key}>`, created: true, email: user.email };
  }

  const list = await adminClient.auth.admin.listUsers({ page: 1, perPage: 200 });
  if (list.error) throw new Error(`auth_list_failed:${list.error.message}`);
  const existing = (list.data.users ?? []).find(
    (row) => String(row.email ?? "").toLowerCase() === user.email.toLowerCase(),
  );
  if (existing?.id) {
    const updated = await adminClient.auth.admin.updateUserById(existing.id, { password });
    if (updated.error) {
      throw new Error(`auth_reuse_password_failed:${user.key}:${updated.error.message}`);
    }
    return { user_id: existing.id, created: false, email: user.email };
  }

  const created = await adminClient.auth.admin.createUser({
    email: user.email,
    password,
    email_confirm: true,
    user_metadata: {
      display_name: user.display_name,
      signup_consent_version: SIGNUP_CONSENT_VERSION,
      e2_3_qa: true,
    },
  });
  if (created.error || !created.data.user?.id) {
    throw new Error(`auth_create_failed:${user.key}:${created.error?.message ?? "no_user"}`);
  }
  return { user_id: created.data.user.id, created: true, email: user.email };
}

async function resolveCustomerId(adminDb, userId) {
  if (DRY_RUN) return `<dry-run-customer-for-${userId}>`;
  const sql = `
SELECT cp.id AS customer_id
FROM public.customer_profiles cp
WHERE cp.user_id = '${userId}'::uuid
  AND cp.deleted_at IS NULL
LIMIT 1;`;
  const rows = await runSql(adminDb.token, adminDb.ref, sql, { label: "resolve_customer_id" });
  return rows?.[0]?.customer_id ?? null;
}

async function applyRoleUpdates(token, ref, usersByKey) {
  const sql = QA_USERS.filter((u) => u.role !== "customer")
    .map((u) => {
      const userId = usersByKey[u.key]?.user_id;
      return `
UPDATE public.users
SET role = '${u.role}', updated_at = NOW()
WHERE id = '${userId}'::uuid;`;
    })
    .join("\n");
  if (!sql.trim()) return;
  await runSql(token, ref, sql, { label: "update_user_roles" });
}

async function grantExtendedConsents(token, ref, customerId) {
  const values = EXTENDED_CONSENTS.map(
    (c) => `(
      '${customerId}'::uuid,
      '${c.consent_type}',
      '${c.consent_version}',
      TRUE,
      NOW(),
      '${SEED_SOURCE}',
      'E-2-3 QA extended consent',
      TRUE
    )`,
  ).join(",\n");
  const sql = `
INSERT INTO public.customer_consents (
  customer_id, consent_type, consent_version, granted, granted_at, source, purpose, required
)
VALUES ${values}
ON CONFLICT (customer_id, consent_type, consent_version) DO NOTHING;`;
  await runSql(token, ref, sql, { label: "grant_extended_consents" });
}

async function applySyntheticSeed(token, ref, ids) {
  const customerA = ids.customer_a?.customer_id;
  const customerB = ids.customer_b?.customer_id;
  const agentUserId = ids.agent?.user_id;
  if (!customerA || !customerB || !agentUserId) {
    throw new Error("seed_ids_missing:customer_a/customer_b/agent");
  }

  const documentId = crypto.randomUUID();
  const sql = `
INSERT INTO public.profile_insurance_policies (
  customer_id, insurer_name, product_name, policy_type, source, is_active
)
SELECT '${customerA}'::uuid, 'QA테스트손보', 'QA종합보장A', 'health', '${POLICY_SOURCE}', TRUE
WHERE NOT EXISTS (
  SELECT 1 FROM public.profile_insurance_policies p
  WHERE p.customer_id = '${customerA}'::uuid AND p.product_name = 'QA종합보장A' AND p.deleted_at IS NULL
);

INSERT INTO public.profile_insurance_policies (
  customer_id, insurer_name, product_name, policy_type, source, is_active
)
SELECT '${customerB}'::uuid, 'QA테스트생명', 'QA종합보장B', 'life', '${POLICY_SOURCE}', TRUE
WHERE NOT EXISTS (
  SELECT 1 FROM public.profile_insurance_policies p
  WHERE p.customer_id = '${customerB}'::uuid AND p.product_name = 'QA종합보장B' AND p.deleted_at IS NULL
);

INSERT INTO public.customer_memory_facts (
  customer_id, fact_key, fact_value, provenance_type, source_table, metadata_json, confidence
)
SELECT '${customerA}'::uuid,
  'qa.preference.premium.burden_stated',
  'QA synthetic memory fact for staging only',
  'profile',
  '${SEED_SOURCE}',
  '{"consent_type":"memory_retention","consent_version":"${SIGNUP_CONSENT_VERSION}","source":"${SEED_SOURCE}","synthetic":true}'::jsonb,
  0.900
WHERE NOT EXISTS (
  SELECT 1 FROM public.customer_memory_facts f
  WHERE f.customer_id = '${customerA}'::uuid AND f.fact_key = 'qa.preference.premium.burden_stated' AND f.superseded_at IS NULL
);

INSERT INTO public.customer_documents (
  id, customer_id, storage_path, mime_type, original_filename, doc_class, ingest_status, metadata_json
)
SELECT '${documentId}'::uuid,
  '${customerA}'::uuid,
  '${customerA}/${documentId}/qa-staging-metadata-only.txt',
  'text/plain',
  'qa-staging-metadata-only.txt',
  'other',
  'uploaded',
  '{"source":"${SEED_SOURCE}","synthetic":true,"metadata_only_no_blob":true}'::jsonb
WHERE NOT EXISTS (
  SELECT 1 FROM public.customer_documents d
  WHERE d.customer_id = '${customerA}'::uuid AND d.original_filename = 'qa-staging-metadata-only.txt' AND d.deleted_at IS NULL
);

INSERT INTO public.agent_assignments (
  customer_id, agent_user_id, status, assigned_at, notes
)
SELECT '${customerA}'::uuid, '${agentUserId}'::uuid, 'active', NOW(), 'e2_3_qa_seed synthetic assignment'
WHERE NOT EXISTS (
  SELECT 1 FROM public.agent_assignments aa
  WHERE aa.customer_id = '${customerA}'::uuid AND aa.agent_user_id = '${agentUserId}'::uuid AND aa.deleted_at IS NULL
);`;
  await runSql(token, ref, sql, { label: "synthetic_seed" });
}

async function runRlsVerify(stagingHost, anonKey, serviceRoleKey, ids, customerAPassword) {
  if (DRY_RUN) {
    return { ok: true, mode: "dry_run", tables: RLS_VERIFY_TABLES };
  }

  const authClient = createClient(stagingHost, anonKey, { auth: { persistSession: false } });
  const signIn = await authClient.auth.signInWithPassword({
    email: QA_USERS.find((u) => u.key === "customer_a").email,
    password: customerAPassword,
  });
  if (signIn.error || !signIn.data.session?.access_token) {
    throw new Error(`rls_verify_signin_failed:${signIn.error?.message ?? "no_session"}`);
  }

  const userClient = createClient(stagingHost, anonKey, {
    auth: { persistSession: false },
    global: { headers: { Authorization: `Bearer ${signIn.data.session.access_token}` } },
  });
  const adminClient = createClient(stagingHost, serviceRoleKey, { auth: { persistSession: false } });

  const bCustomerId = ids.customer_b.customer_id;
  const results = [];

  for (const table of RLS_VERIFY_TABLES) {
    let jwtQuery;
    if (table === "customer_profiles") {
      jwtQuery = userClient.from(table).select("id").eq("id", bCustomerId);
    } else if (table === "active_profile_insurance_policies") {
      jwtQuery = userClient.from(table).select("id").eq("customer_id", bCustomerId);
    } else {
      jwtQuery = userClient.from(table).select("id").eq("customer_id", bCustomerId);
    }
    const jwtRes = await jwtQuery;
    let adminCountQuery;
    if (table === "customer_profiles") {
      adminCountQuery = adminClient.from(table).select("id", { count: "exact", head: true }).eq("id", bCustomerId);
    } else if (table === "active_profile_insurance_policies") {
      adminCountQuery = adminClient.from(table).select("id", { count: "exact", head: true }).eq("customer_id", bCustomerId);
    } else if (table === "customer_documents") {
      adminCountQuery = adminClient
        .from(table)
        .select("id", { count: "exact", head: true })
        .eq("customer_id", bCustomerId)
        .is("deleted_at", null);
    } else {
      adminCountQuery = adminClient.from(table).select("id", { count: "exact", head: true }).eq("customer_id", bCustomerId);
    }
    const adminRes = await adminCountQuery;
    const jwtRows = Array.isArray(jwtRes.data) ? jwtRes.data.length : 0;
    const adminCount = adminRes.count ?? 0;
    const minBRows = RLS_TARGET_B_MIN_ROWS[table] ?? 0;
    results.push({
      table,
      jwt_rows: jwtRows,
      admin_count: adminCount,
      min_b_rows: minBRows,
      pass: jwtRows === 0 && adminCount >= minBRows,
    });
  }

  const ok = results.every((r) => r.pass);
  return { ok, results };
}

async function main() {
  const report = {
    phase: "E-2-3",
    mode: DRY_RUN ? "dry_run" : "live",
    started_at: new Date().toISOString(),
    production_ref: PROD_REF,
    planned_users: buildPlannedUsers(),
    planned_roles: QA_USERS.map((u) => ({ key: u.key, role: u.role })),
    planned_consents: buildPlannedConsents(),
    planned_seed_rows: buildPlannedSeedRows(),
    rls_verify_plan: buildRlsVerifyPlan(),
    steps: [],
  };

  assertSupabaseEnvNotProduction();

  const e21 = loadE21Inventory();
  const stagingRef = e21?.staging_ref ?? null;
  const stagingHost = e21?.staging_host ?? (stagingRef ? `https://${stagingRef}.supabase.co` : null);
  if (!stagingRef) {
    throw new Error("e2_3_requires_e21_inventory: missing staging_ref in .e2-1-inventory.json");
  }
  assertProductionGuard({ stagingRef, stagingHost });

  report.staging_ref = stagingRef;
  report.staging_host = stagingHost;
  report.ref_check = {
    production_ref: PROD_REF,
    staging_ref: stagingRef,
    refs_different: stagingRef !== PROD_REF,
    hosts_different: hostFromUrl(stagingHost) !== PROD_HOST,
  };
  report.live_api_plan = buildLiveApiPlan(stagingRef);

  planLine(`E-2-3 QA auth/seed target ref=${stagingRef} dry_run=${DRY_RUN}`);

  for (const user of QA_USERS) {
    planLine(`user ${user.key} email=${user.email} role=${user.role}`);
  }

  if (DRY_RUN) {
    for (const step of [
      "fetch_staging_api_keys",
      "auth_admin_createUser x4",
      "resolve_customer_ids",
      "update_roles admin/agent",
      "grant_extended_consents customer_a",
      "synthetic_seed",
      "rls_verify customer_a vs customer_b",
    ]) {
      planLine(`would_run ${step}`);
    }
    report.status = "e2_3_dry_run";
    report.finished_at = new Date().toISOString();
    writeReport(report);
    saveQaInventory({
      staging_ref: stagingRef,
      planned_users: report.planned_users,
      planned_seed_rows: report.planned_seed_rows,
      status: "planned_not_created",
    });
    console.log(`E2-3_STATUS=${report.status}`);
    console.log(`E2-3_MODE=dry_run`);
    console.log(`E2-3_TARGET_REF=${stagingRef}`);
    return;
  }

  const token = loadAccessToken();
  const keys = await fetchStagingKeys(token, stagingRef);
  const adminAuth = createClient(stagingHost, keys.service_role_key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const passwords = {};
  const usersByKey = {};

  for (const user of QA_USERS) {
    const password = generatePassword();
    passwords[user.key] = password;
    planLine(`create auth user ${user.email}`);
    const authResult = await ensureAuthUser(adminAuth, user, password);
    usersByKey[user.key] = {
      ...authResult,
      role: user.role,
      customer_id: null,
    };
    await new Promise((r) => setTimeout(r, 500));
  }

  for (const key of ["customer_a", "customer_b", "admin", "agent"]) {
    usersByKey[key].customer_id = await resolveCustomerId({ token, ref: stagingRef }, usersByKey[key].user_id);
  }

  planLine("update admin/agent roles");
  await applyRoleUpdates(token, stagingRef, usersByKey);

  planLine("grant extended consents for customer_a");
  await grantExtendedConsents(token, stagingRef, usersByKey.customer_a.customer_id);

  planLine("apply synthetic seed");
  await applySyntheticSeed(token, stagingRef, usersByKey);

  planLine("run RLS verify");
  const rls = await runRlsVerify(
    stagingHost,
    keys.anon_key,
    keys.service_role_key,
    usersByKey,
    passwords.customer_a,
  );
  report.rls_verify = rls;

  report.steps.push({ step: "auth_users", result: "ok", users: usersByKey });
  report.status = rls.ok ? "e2_3_ok" : "e2_3_rls_verify_failed";
  report.finished_at = new Date().toISOString();
  writeReport(report);

  saveQaInventory({
    staging_ref: stagingRef,
    users: Object.fromEntries(
      Object.entries(usersByKey).map(([key, val]) => [
        key,
        { email: val.email, user_id: val.user_id, customer_id: val.customer_id, role: val.role },
      ]),
    ),
    status: report.status,
  });

  console.log("OPERATOR_NOTICE: QA passwords generated for this run only.");
  console.log("OPERATOR_NOTICE: copy from secure channel output — NOT stored in inventory/report.");
  for (const user of QA_USERS) {
    console.log(`OPERATOR_QA_PASSWORD_${user.key.toUpperCase()}=[REDACTED_IN_LOG_USE_STDOUT_ONLY]`);
  }
  for (const user of QA_USERS) {
    console.log(`OPERATOR_QA_PASSWORD_${user.key}=${passwords[user.key]}`);
  }

  console.log(`E2-3_STATUS=${report.status}`);
  console.log(`E2-3_MODE=live`);
  console.log(`E2-3_TARGET_REF=${stagingRef}`);

  if (!rls.ok) process.exit(1);
}

main().catch((error) => {
  console.error("E2-3_FATAL", error instanceof Error ? error.message : String(error));
  process.exit(1);
});
