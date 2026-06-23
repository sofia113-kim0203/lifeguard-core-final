/**
 * E-2-1 follow-up — apply migration 033 only on existing staging (no 001–032 replay).
 *
 * Target: .e2-1-inventory.json staging_ref (must differ from production ref)
 * Migration: 033_refresh_active_policy_view_after_extended_columns.sql
 * Prerequisite: last_success_migration = 032_profile_insurance_policies_extended_columns.sql
 *
 * Flags:
 *   --dry-run   Print planned actions only; no SQL execution
 *
 * Does NOT: delete/recreate staging, rerun 001–032, backfill, filter/security_invoker changes
 * Never stores secrets in report files
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const PROD_REF = "fhvlxcguvjvtftttfrix";
const PROD_HOST = `${PROD_REF}.supabase.co`;
const INVENTORY_PATH = path.join(ROOT, ".e2-1-inventory.json");
const REPORT_PATH = path.join(ROOT, ".e2-1-staging-apply-033-report.json");
const MIGRATION_FILE = "033_refresh_active_policy_view_after_extended_columns.sql";
const MIGRATION_PATH = path.join(ROOT, "supabase", "migrations", MIGRATION_FILE);
const PREREQ_MIGRATION = "032_profile_insurance_policies_extended_columns.sql";
const VIEW_NAME = "active_profile_insurance_policies";
const EXPECTED_COLUMNS = ["premium_amount", "policy_status", "contract_date"];

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

function loadInventory() {
  if (!fs.existsSync(INVENTORY_PATH)) return null;
  return JSON.parse(fs.readFileSync(INVENTORY_PATH, "utf8"));
}

function assertProductionGuard({ stagingRef, stagingHost }) {
  const supabaseEnv = String(
    process.env.SUPABASE_ENV ?? parseEnvFile(path.join(ROOT, ".env.local")).SUPABASE_ENV ?? "",
  )
    .trim()
    .toLowerCase();
  if (supabaseEnv === "production" || supabaseEnv === "prod") {
    throw new Error("production_guard:SUPABASE_ENV=production|prod forbidden");
  }
  if (!stagingRef) throw new Error("production_guard:staging_ref missing");
  if (stagingRef === PROD_REF) throw new Error("production_guard:staging_ref matches production ref");
  const host = String(stagingHost ?? "")
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/\/$/, "");
  if (host && (host === PROD_HOST || host.endsWith(`.${PROD_HOST}`))) {
    throw new Error("production_guard:staging host matches production host");
  }
}

async function mgmtApi(token, apiPath, options = {}) {
  if (DRY_RUN) {
    return { ok: true, status: 200, body: { dry_run: true, path: apiPath } };
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

async function verifyViewColumns(token, ref) {
  const colList = EXPECTED_COLUMNS.map((c) => `'${c}'`).join(", ");
  const sql = `
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = '${VIEW_NAME}'
  AND column_name = ANY (ARRAY[${colList}])
ORDER BY column_name;`;
  return runSql(token, ref, sql, { label: "verify_view_columns" });
}

async function main() {
  const inventory = loadInventory();
  const stagingRef = inventory?.staging_ref ?? null;
  const stagingHost = inventory?.staging_host ?? (stagingRef ? `https://${stagingRef}.supabase.co` : null);
  assertProductionGuard({ stagingRef, stagingHost });

  if (!fs.existsSync(MIGRATION_PATH)) {
    throw new Error(`migration_missing:${MIGRATION_FILE}`);
  }

  const sql = fs.readFileSync(MIGRATION_PATH, "utf8");
  const report = {
    phase: "E-2-1-apply-033",
    mode: DRY_RUN ? "dry_run" : "live",
    staging_ref: stagingRef,
    migration_file: MIGRATION_FILE,
    view_name: VIEW_NAME,
    last_success_migration_before: inventory?.last_success_migration ?? null,
    expected_view_columns: EXPECTED_COLUMNS,
    started_at: new Date().toISOString(),
  };

  console.log(`E2-1-APPLY-033_MODE=${DRY_RUN ? "dry_run" : "live"}`);
  console.log(`E2-1-APPLY-033_STAGING_REF=${stagingRef}`);
  console.log(`E2-1-APPLY-033_MIGRATION=${MIGRATION_FILE}`);
  console.log(`E2-1-APPLY-033_LAST_SUCCESS=${inventory?.last_success_migration ?? "null"}`);

  if (inventory?.last_success_migration !== PREREQ_MIGRATION) {
    console.log(`E2-1-APPLY-033_WARN last_success_migration is not ${PREREQ_MIGRATION} — manual review recommended`);
  }

  if (DRY_RUN) {
    console.log(`E2-1-APPLY-033_WOULD_APPLY migration=${MIGRATION_FILE} ref=${stagingRef}`);
    console.log(`E2-1-APPLY-033_WOULD_VERIFY view=${VIEW_NAME} columns=${EXPECTED_COLUMNS.join(",")}`);
    console.log("E2-1-APPLY-033_SKIP rerun 001-032=true");
    report.status = "dry_run_ok";
    report.finished_at = new Date().toISOString();
    fs.writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    console.log("E2-1-APPLY-033_STATUS=dry_run_ok");
    return;
  }

  const token = parseEnvFile(path.join(ROOT, ".env.local")).SUPABASE_ACCESS_TOKEN?.trim();
  if (!token) throw new Error("SUPABASE_ACCESS_TOKEN missing in .env.local (read-only)");

  await runSql(token, stagingRef, sql, { label: MIGRATION_FILE });
  const viewColumns = await verifyViewColumns(token, stagingRef);
  report.view_column_verify = viewColumns;
  report.last_success_migration_after = MIGRATION_FILE;
  report.status = "ok";
  report.finished_at = new Date().toISOString();
  fs.writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  if (!inventory) throw new Error("inventory_missing");
  inventory.last_success_migration = MIGRATION_FILE;
  inventory.updated_at = new Date().toISOString();
  fs.writeFileSync(INVENTORY_PATH, `${JSON.stringify(inventory, null, 2)}\n`, "utf8");

  console.log("E2-1-APPLY-033_STATUS=ok");
}

main().catch((error) => {
  console.error("E2-1-APPLY-033_FATAL", error instanceof Error ? error.message : String(error));
  process.exit(1);
});
