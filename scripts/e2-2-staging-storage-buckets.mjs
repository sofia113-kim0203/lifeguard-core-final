/**
 * E-2-2 — staging Supabase storage buckets + storage.objects policies
 *
 * Target: .e2-1-inventory.json staging_ref (must differ from production ref)
 * Buckets: customer-documents, policy-pdfs (private only)
 *
 * Flags:
 *   --dry-run   Print planned actions only; no API writes / no SQL execution
 *
 * Does NOT: claim-evidence, auth users, seed, Vercel env, .env.local changes
 * Never stores secrets in report files (keys, tokens, db passwords)
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const PROD_REF = "fhvlxcguvjvtftttfrix";
const PROD_HOST = `${PROD_REF}.supabase.co`;
const INVENTORY_PATH = path.join(ROOT, ".e2-1-inventory.json");
const REPORT_PATH = path.join(ROOT, ".e2-2-intermediate-report.json");
const POLICY_SQL_PATH = path.join(ROOT, "scripts", "e2-2-staging-storage-policies.sql");

const TARGET_BUCKETS = [
  { id: "customer-documents", name: "customer-documents", public: false },
  { id: "policy-pdfs", name: "policy-pdfs", public: false },
];

const FORBIDDEN_BUCKETS = ["claim-evidence"];

const EXPECTED_POLICY_NAMES = [
  "lg_storage_customer_documents_select_own",
  "lg_storage_customer_documents_insert_own",
  "lg_storage_customer_documents_update_own",
  "lg_storage_customer_documents_delete_own",
  "lg_storage_customer_documents_admin_select",
  "lg_storage_policy_pdfs_admin_all",
];

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
    throw new Error("production_guard:SUPABASE_ENV=production|prod is forbidden for E-2-2");
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

function loadInventory() {
  if (!fs.existsSync(INVENTORY_PATH)) return null;
  return JSON.parse(fs.readFileSync(INVENTORY_PATH, "utf8"));
}

function planLine(message) {
  console.log(`[PLAN] ${message}`);
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

function buildBucketCreateSql() {
  const inserts = TARGET_BUCKETS.map(
    (bucket) => `
INSERT INTO storage.buckets (id, name, public)
SELECT '${bucket.id}', '${bucket.name}', ${bucket.public ? "true" : "false"}
WHERE NOT EXISTS (
  SELECT 1 FROM storage.buckets WHERE id = '${bucket.id}'
);`,
  ).join("\n");
  return `-- E-2-2 bucket bootstrap (idempotent)\n${inserts}`;
}

function buildTargetBucketsSql() {
  const bucketList = TARGET_BUCKETS.map((b) => `'${b.id}'`).join(", ");
  return `
SELECT id, name, public
FROM storage.buckets
WHERE id IN (${bucketList})
ORDER BY id;
`;
}

function buildForbiddenBucketsSql() {
  const forbiddenList = FORBIDDEN_BUCKETS.map((b) => `'${b}'`).join(", ");
  return `
SELECT id, name, public
FROM storage.buckets
WHERE id IN (${forbiddenList});
`;
}

function buildPoliciesSql() {
  const policyList = EXPECTED_POLICY_NAMES.map((p) => `'${p}'`).join(", ");
  return `
SELECT policyname, cmd, roles
FROM pg_policies
WHERE schemaname = 'storage'
  AND tablename = 'objects'
  AND policyname IN (${policyList})
ORDER BY policyname;
`;
}

function buildForbiddenCountSql() {
  const forbiddenList = FORBIDDEN_BUCKETS.map((b) => `'${b}'`).join(", ");
  return `
SELECT COUNT(*)::int AS forbidden_bucket_count
FROM storage.buckets
WHERE id IN (${forbiddenList});
`;
}

function evaluateVerification(rows) {
  const buckets = Array.isArray(rows?.buckets) ? rows.buckets : [];
  const policies = Array.isArray(rows?.policies) ? rows.policies : [];
  const forbiddenCount = Number(rows?.forbidden_bucket_count ?? 0);

  const bucketById = Object.fromEntries(buckets.map((row) => [row.id, row]));
  const missingBuckets = TARGET_BUCKETS.filter((b) => !bucketById[b.id]).map((b) => b.id);
  const publicBuckets = TARGET_BUCKETS.filter((b) => bucketById[b.id]?.public === true).map((b) => b.id);
  const presentPolicyNames = new Set(policies.map((p) => p.policyname));
  const missingPolicies = EXPECTED_POLICY_NAMES.filter((name) => !presentPolicyNames.has(name));

  return {
    ok:
      missingBuckets.length === 0 &&
      publicBuckets.length === 0 &&
      missingPolicies.length === 0 &&
      forbiddenCount === 0,
    missing_buckets: missingBuckets,
    public_buckets: publicBuckets,
    missing_policies: missingPolicies,
    forbidden_bucket_count: forbiddenCount,
    bucket_rows: buckets,
    policy_rows: policies,
  };
}

async function main() {
  const report = {
    phase: "E-2-2",
    mode: DRY_RUN ? "dry_run" : "live",
    started_at: new Date().toISOString(),
    production_ref: PROD_REF,
    target_buckets: TARGET_BUCKETS.map((b) => b.id),
    forbidden_buckets: FORBIDDEN_BUCKETS,
    steps: [],
  };

  assertSupabaseEnvNotProduction();

  const inventory = loadInventory();
  const stagingRef = inventory?.staging_ref ?? null;
  const stagingHost = inventory?.staging_host ?? (stagingRef ? `https://${stagingRef}.supabase.co` : null);
  if (!stagingRef) {
    throw new Error("e2_2_requires_inventory: run E-2-1 Phase A first (.e2-1-inventory.json missing staging_ref)");
  }

  assertProductionGuard({ stagingRef, stagingHost });

  report.staging_ref = stagingRef;
  report.staging_host = stagingHost;
  report.ref_check = {
    production_ref: PROD_REF,
    production_host: `https://${PROD_HOST}`,
    staging_ref: stagingRef,
    staging_host: stagingHost,
    refs_different: stagingRef !== PROD_REF,
    hosts_different: hostFromUrl(stagingHost) !== PROD_HOST,
    supabase_env: resolveSupabaseEnvLabel() || "(unset)",
  };

  planLine(`E-2-2 storage bootstrap target ref=${stagingRef} dry_run=${DRY_RUN}`);

  if (!fs.existsSync(POLICY_SQL_PATH)) {
    throw new Error(`policy_sql_missing:${POLICY_SQL_PATH}`);
  }
  const policySql = fs.readFileSync(POLICY_SQL_PATH, "utf8");
  const bucketSql = buildBucketCreateSql();

  const token = loadAccessToken();

  planLine("preflight: existing buckets");
  const preflightTarget = await runSql(token, stagingRef, buildTargetBucketsSql(), { label: "preflight_target_buckets" });
  const preflightForbidden = await runSql(token, stagingRef, buildForbiddenBucketsSql(), { label: "preflight_forbidden_buckets" });
  report.steps.push({
    step: "preflight_buckets",
    result: DRY_RUN ? "dry_run" : "ok",
    existing_target_buckets: DRY_RUN ? null : preflightTarget,
    forbidden_buckets_found: DRY_RUN ? null : preflightForbidden,
  });

  planLine("create buckets (idempotent INSERT WHERE NOT EXISTS)");
  await runSql(token, stagingRef, bucketSql, { label: "create_buckets" });
  report.steps.push({ step: "create_buckets", result: DRY_RUN ? "dry_run" : "ok", buckets: TARGET_BUCKETS.map((b) => b.id) });

  planLine("apply storage.objects policies");
  await runSql(token, stagingRef, policySql, { label: "apply_storage_policies" });
  report.steps.push({
    step: "apply_storage_policies",
    result: DRY_RUN ? "dry_run" : "ok",
    policy_count: EXPECTED_POLICY_NAMES.length,
    policy_names: EXPECTED_POLICY_NAMES,
  });

  planLine("verify buckets + policies");
  const verifyBuckets = await runSql(token, stagingRef, buildTargetBucketsSql(), { label: "verify_buckets" });
  const verifyPolicies = await runSql(token, stagingRef, buildPoliciesSql(), { label: "verify_policies" });
  const verifyForbidden = await runSql(token, stagingRef, buildForbiddenCountSql(), { label: "verify_forbidden_buckets" });
  const verifyInput = DRY_RUN
    ? {
        buckets: TARGET_BUCKETS.map((b) => ({ id: b.id, name: b.name, public: false })),
        policies: EXPECTED_POLICY_NAMES.map((policyname) => ({ policyname, cmd: "dry_run", roles: ["authenticated"] })),
        forbidden_bucket_count: 0,
      }
    : {
        buckets: verifyBuckets,
        policies: verifyPolicies,
        forbidden_bucket_count: verifyForbidden?.[0]?.forbidden_bucket_count ?? 0,
      };

  const verification = evaluateVerification(verifyInput);
  report.verification = verification;
  report.status = DRY_RUN ? "e2_2_dry_run" : verification.ok ? "e2_2_ok" : "e2_2_verify_failed";

  report.finished_at = new Date().toISOString();
  writeReport(report);

  console.log(`E2-2_STATUS=${report.status}`);
  console.log(`E2-2_MODE=${DRY_RUN ? "dry_run" : "live"}`);
  console.log(`E2-2_TARGET_REF=${stagingRef}`);

  if (!DRY_RUN && !verification.ok) {
    console.error("E2-2_VERIFY_FAILED", JSON.stringify(verification));
    process.exit(1);
  }
}

main().catch((error) => {
  console.error("E2-2_FATAL", error instanceof Error ? error.message : String(error));
  process.exit(1);
});
