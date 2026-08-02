/**
 * E-2-1 — staging Supabase provisioning (split phases)
 *
 * Phase A (--phase=a): create/reuse staging project + ref separation check only
 * Phase B (--phase=b): apply migrations 001–033 (separate approval required)
 *
 * Flags:
 *   --dry-run     Print planned actions only; no API writes / no SQL execution
 *   --phase=a|b   Default: a
 *   --resume      Allow Phase B to continue after last_success_migration (inventory)
 *
 * Does NOT: buckets, auth users, Vercel env, .env.local changes
 * Never stores secrets in inventory/report files (db_pass, keys, tokens)
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const PROD_REF = "fhvlxcguvjvtftttfrix";
const PROD_HOST = `${PROD_REF}.supabase.co`;
const STAGING_NAME = "lifeguard-core-staging";
const INVENTORY_PATH = path.join(ROOT, ".e2-1-inventory.json");
const REPORT_PATH = path.join(ROOT, ".e2-1-intermediate-report.json");

const MIGRATION_FILES = [
  "001_initial_schema.sql",
  "002_rls_service_policies.sql",
  "003_seed_rule_packs.sql",
  "004_customer_consents.sql",
  "005_document_ingest_extend.sql",
  "006_case_knowledge.sql",
  "007_customer_state_snapshots.sql",
  "008_monitoring_signals.sql",
  "009_notification_service.sql",
  "010_worker_jobs.sql",
  "011_outbox_processing.sql",
  "012_notification_delivery.sql",
  "013_signup_auth_bootstrap.sql",
  "014_signup_provision_always.sql",
  "015_fix_signup_health_rowcount.sql",
  "016_customer_conversations.sql",
  "017_document_ingest_mvp.sql",
  "018_lockdown_customer_document_match_rpc.sql",
  "019_customer_memory_schema_foundation.sql",
  "020_customer_memory_write_lockdown.sql",
  "020a_policy_knowledge_foundation.sql",
  "021_policy_knowledge_vector_search.sql",
  "022_customer_memory_foundation.sql",
  "023_conversational_background_analysis.sql",
  "024_claude_performance_optimization.sql",
  "025_conversation_result_per_job_unique.sql",
  "026_signup_basic_profile.sql",
  "027_document_delete_source_policy_retire.sql",
  "028_retire_orphaned_source_deleted_policies.sql",
  "029_active_policy_view_single_source.sql",
  "030_worker_jobs_runtime_rpcs.sql",
  "031_analysis_jobs_autopilot.sql",
  "032_profile_insurance_policies_extended_columns.sql",
  "033_refresh_active_policy_view_after_extended_columns.sql",
  "034_key_document_memory_commits.sql",
];

const CORE_TABLES = [
  "users",
  "customer_profiles",
  "customer_consents",
  "rule_packs",
  "customer_documents",
  "worker_jobs",
  "analysis_jobs",
];

const argv = new Set(process.argv.slice(2));
const DRY_RUN = argv.has("--dry-run");
const RESUME = argv.has("--resume");
const PHASE = argv.has("--phase=b") ? "b" : "a";

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
    throw new Error("production_guard:SUPABASE_ENV=production|prod is forbidden for E-2-1");
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

function saveInventory(inventory) {
  const safe = { ...inventory };
  delete safe.db_pass;
  delete safe.db_password;
  delete safe.SERVICE_ROLE_KEY;
  delete safe.VITE_SUPABASE_ANON_KEY;
  delete safe.SUPABASE_ACCESS_TOKEN;
  safe.updated_at = new Date().toISOString();
  fs.writeFileSync(INVENTORY_PATH, `${JSON.stringify(safe, null, 2)}\n`, "utf8");
  return safe;
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

async function waitForProjectActive(token, ref, timeoutMs = 600_000) {
  if (DRY_RUN) {
    console.log(`[DRY_RUN] would poll project status until ACTIVE: ref=${ref}`);
    return { status: "ACTIVE_HEALTHY", dry_run: true };
  }
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const res = await mgmtApi(token, `/projects/${ref}`);
    if (!res.ok) throw new Error(`project_status_failed:${res.status}`);
    const status = String(res.body?.status ?? "").toUpperCase();
    if (status === "ACTIVE_HEALTHY" || status === "ACTIVE") return res.body;
    if (status.includes("FAILED") || status.includes("ERROR")) {
      throw new Error(`project_provision_failed:${status}`);
    }
    await new Promise((r) => setTimeout(r, 10_000));
  }
  throw new Error("project_provision_timeout");
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

function planLine(message) {
  console.log(`[PLAN] ${message}`);
}

async function inspectDbState(token, ref) {
  const tableArray = CORE_TABLES.map((t) => `'${t}'`).join(", ");
  const sql = `
SELECT
  (SELECT COUNT(*)::int FROM information_schema.tables
     WHERE table_schema = 'public' AND table_type = 'BASE TABLE') AS public_table_count,
  (SELECT COUNT(*)::int FROM pg_class c
     JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relkind = 'r'
       AND c.relname = ANY (ARRAY[${tableArray}])) AS core_table_hits,
  (SELECT COUNT(*)::int FROM pg_class c
     JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relname = 'rule_packs') AS rule_pack_rel_exists,
  (SELECT COUNT(*)::int FROM pg_extension e WHERE e.extname IN ('pgcrypto','vector')) AS required_extension_count;
`;
  const row = (await runSql(token, ref, sql, { label: "db_state_inspection" }))?.[0] ?? {};
  const publicTableCount = Number(row.public_table_count ?? 0);
  const coreHits = Number(row.core_table_hits ?? 0);
  const rulePackRelExists = Number(row.rule_pack_rel_exists ?? 0) > 0;
  const extCount = Number(row.required_extension_count ?? 0);

  let state = "empty";
  if (publicTableCount === 0 && coreHits === 0) state = "empty";
  else if (coreHits >= CORE_TABLES.length && rulePackRelExists) state = "likely_complete";
  else if (coreHits > 0 || publicTableCount > 0) state = "partial";

  return {
    public_table_count: publicTableCount,
    core_table_hits: coreHits,
    rule_pack_rel_exists: rulePackRelExists,
    required_extension_count: extCount,
    state,
    recommendation:
      state === "partial"
        ? "STOP: partial schema detected — delete/recreate staging project before Phase B (or use --resume only with explicit approval)"
        : state === "likely_complete"
          ? "STOP: schema appears complete — skip Phase B or delete/recreate for clean apply"
          : "OK: staging DB appears clean for initial migration apply",
  };
}

async function runPhaseA(token, report) {
  planLine(`Phase A: staging project create/reuse + ref verification (dry_run=${DRY_RUN})`);

  const orgs = await mgmtApi(token, "/organizations");
  if (!DRY_RUN && !orgs.ok) throw new Error(`organizations_failed:${orgs.status}`);
  const org = DRY_RUN ? { id: "<org-id>", name: "<org-name>" } : orgs.body?.[0];
  if (!org?.id) throw new Error("no_organization");
  planLine(`organization=${org.name ?? org.id}`);

  const prodMeta = await mgmtApi(token, `/projects/${PROD_REF}`);
  if (!DRY_RUN && !prodMeta.ok) throw new Error(`production_metadata_failed:${prodMeta.status}`);
  const region = DRY_RUN ? "ap-southeast-2 (from production metadata)" : (prodMeta.body?.region ?? "ap-southeast-2");
  planLine(`production_ref=${PROD_REF} production_region=${region}`);

  let inventory = loadInventory();
  let stagingRef = inventory?.staging_ref ?? null;
  let createdNew = false;
  let operatorDbPassNotice = null;

  if (!stagingRef) {
    const projects = await mgmtApi(token, "/projects");
    if (!DRY_RUN && !projects.ok) throw new Error(`projects_list_failed:${projects.status}`);
    const existing = DRY_RUN ? null : (projects.body ?? []).find((p) => p.name === STAGING_NAME);
    if (existing?.id) {
      stagingRef = existing.id;
      report.steps.push({ step: "create_project", result: "reused_existing", ref: stagingRef });
      planLine(`reuse existing staging project name=${STAGING_NAME} ref=${stagingRef}`);
    } else {
      const dbPass = crypto.randomBytes(24).toString("base64url");
      planLine(`create staging project name=${STAGING_NAME} region=${region}`);
      if (DRY_RUN) {
        stagingRef = "<new-staging-ref>";
        report.steps.push({ step: "create_project", result: "dry_run_would_create", name: STAGING_NAME, region });
      } else {
        const created = await mgmtApi(token, "/projects", {
          method: "POST",
          body: JSON.stringify({
            organization_id: org.id,
            name: STAGING_NAME,
            region,
            db_pass: dbPass,
          }),
        });
        if (!created.ok) {
          throw new Error(`create_project_failed:${created.status}:${JSON.stringify(created.body).slice(0, 300)}`);
        }
        stagingRef = created.body?.id ?? created.body?.ref;
        if (!stagingRef) throw new Error("create_project_missing_ref");
        createdNew = true;
        operatorDbPassNotice = dbPass;
        report.steps.push({ step: "create_project", result: "created", ref: stagingRef, region });
      }
    }
  } else {
    report.steps.push({ step: "create_project", result: "resumed_from_inventory", ref: stagingRef });
    planLine(`reuse inventory staging_ref=${stagingRef}`);
  }

  const stagingHost = `https://${stagingRef}.supabase.co`;
  assertProductionGuard({ stagingRef, stagingHost });

  report.ref_check = {
    production_ref: PROD_REF,
    production_host: `https://${PROD_HOST}`,
    staging_ref: stagingRef,
    staging_host: stagingHost,
    refs_different: stagingRef !== PROD_REF,
    hosts_different: hostFromUrl(stagingHost) !== PROD_HOST,
    supabase_env: resolveSupabaseEnvLabel() || "(unset)",
  };
  planLine(`ref_check staging_ref=${stagingRef} refs_different=${stagingRef !== PROD_REF}`);

  await waitForProjectActive(token, stagingRef);
  report.steps.push({ step: "wait_active", result: DRY_RUN ? "dry_run" : "ok", ref: stagingRef });

  if (!DRY_RUN) {
    inventory = saveInventory({
      ...(inventory ?? {}),
      staging_ref: stagingRef,
      staging_name: STAGING_NAME,
      staging_host: stagingHost,
      production_ref: PROD_REF,
      region,
      phase_a_completed_at: new Date().toISOString(),
      created_at: inventory?.created_at ?? new Date().toISOString(),
    });
    if (createdNew && operatorDbPassNotice) {
      console.log("OPERATOR_NOTICE: staging database password was generated for this run.");
      console.log("OPERATOR_NOTICE: copy it now from secure channel output — it is NOT stored in inventory/report.");
      console.log(`OPERATOR_DB_PASSWORD=${operatorDbPassNotice}`);
    }
  } else {
    planLine("would write .e2-1-inventory.json without secrets");
  }

  report.status = "phase_a_ok";
  return { stagingRef, stagingHost };
}

async function runPhaseB(token, report) {
  planLine(`Phase B: migration apply 001–031 (dry_run=${DRY_RUN}, resume=${RESUME})`);

  const inventory = loadInventory();
  const stagingRef = inventory?.staging_ref;
  const stagingHost = inventory?.staging_host ?? (stagingRef ? `https://${stagingRef}.supabase.co` : null);
  if (!stagingRef) {
    if (DRY_RUN) {
      planLine("Phase B blocked: .e2-1-inventory.json missing — run Phase A first");
      report.status = "phase_b_dry_run_blocked_no_inventory";
      report.failure_policy = {
        immediate_stop: true,
        recommendation: "Complete Phase A (live, approved) before Phase B",
      };
      return;
    }
    throw new Error("phase_b_requires_inventory: run Phase A first and ensure .e2-1-inventory.json exists");
  }
  assertProductionGuard({ stagingRef, stagingHost });

  const dbState = await inspectDbState(token, stagingRef);
  report.db_preflight = dbState;
  planLine(
    `db_preflight state=${dbState.state} public_tables=${dbState.public_table_count} core_hits=${dbState.core_table_hits}`,
  );

  if (dbState.state === "partial") {
    throw new Error(
      "phase_b_blocked:partial_schema — delete/recreate staging project before retry; do not continue on broken chain",
    );
  }
  if (dbState.state === "likely_complete" && !RESUME) {
    throw new Error(
      "phase_b_blocked:schema_already_present — migrations appear applied; use --resume only with explicit approval or recreate project",
    );
  }
  if (dbState.state !== "empty" && !RESUME) {
    throw new Error("phase_b_blocked:staging_not_clean — expected empty DB for initial apply");
  }

  const migrationResults = [];
  let filesToRun = [...MIGRATION_FILES];

  if (RESUME && inventory.last_success_migration) {
    const idx = MIGRATION_FILES.indexOf(inventory.last_success_migration);
    if (idx < 0) throw new Error(`resume_failed:unknown_last_success_migration:${inventory.last_success_migration}`);
    filesToRun = MIGRATION_FILES.slice(idx + 1);
    planLine(`resume from after ${inventory.last_success_migration} (${filesToRun.length} files remaining)`);
  } else if (RESUME) {
    planLine("resume requested but no last_success_migration — running full chain");
  } else {
    planLine(`clean apply full chain (${filesToRun.length} files)`);
  }

  for (const file of filesToRun) {
    const sqlPath = path.join(ROOT, "supabase", "migrations", file);
    if (!fs.existsSync(sqlPath)) throw new Error(`migration_missing:${file}`);
    const sql = fs.readFileSync(sqlPath, "utf8");
    planLine(`migration ${file}`);
    try {
      await runSql(token, stagingRef, sql, { label: file });
      migrationResults.push({ file, result: DRY_RUN ? "dry_run" : "ok" });
      if (!DRY_RUN) {
        saveInventory({
          ...inventory,
          last_success_migration: file,
          phase_b_last_ok_at: new Date().toISOString(),
        });
      }
    } catch (error) {
      migrationResults.push({
        file,
        result: "failed",
        error: error instanceof Error ? error.message : String(error),
      });
      report.migrations = migrationResults;
      report.status = "phase_b_failed";
      report.failure_policy = {
        immediate_stop: true,
        partial_schema: true,
        recommendation: "Delete and recreate the staging Supabase project, then rerun Phase A and Phase B from clean state",
        auto_resume: false,
        resume_requires_flag: "--resume",
      };
      report.finished_at = new Date().toISOString();
      writeReport(report);
      console.log(`E2-1_STATUS=failed PHASE=b AT=${file}`);
      console.log("FAILURE_POLICY=stop; recommend staging project delete/recreate; no auto-resume");
      process.exit(1);
    }
  }

  const extCheck = await runSql(
    token,
    stagingRef,
    "SELECT extname FROM pg_extension WHERE extname IN ('pgcrypto','vector') ORDER BY extname;",
    { label: "post_check_extensions" },
  );
  const rulePackCheck = await runSql(
    token,
    stagingRef,
    "SELECT COUNT(*)::int AS rule_pack_count FROM public.rule_packs;",
    { label: "post_check_rule_packs" },
  );

  report.migrations = migrationResults;
  report.post_checks = {
    extensions: DRY_RUN ? { dry_run: true } : extCheck,
    rule_pack_count: DRY_RUN ? null : (rulePackCheck?.[0]?.rule_pack_count ?? null),
  };
  report.status = DRY_RUN ? "phase_b_dry_run" : "phase_b_ok";
}

async function main() {
  const report = {
    phase: "E-2-1",
    mode: DRY_RUN ? "dry_run" : "live",
    run_phase: PHASE,
    resume: RESUME,
    started_at: new Date().toISOString(),
    production_ref: PROD_REF,
    staging_name: STAGING_NAME,
    steps: [],
  };

  assertSupabaseEnvNotProduction();

  const token = loadAccessToken();

  if (PHASE === "a") {
    await runPhaseA(token, report);
  } else {
    await runPhaseB(token, report);
  }

  report.finished_at = new Date().toISOString();
  writeReport(report);

  console.log(`E2-1_STATUS=${report.status}`);
  console.log(`E2-1_MODE=${DRY_RUN ? "dry_run" : "live"}`);
  console.log(`E2-1_PHASE=${PHASE}`);
}

main().catch((error) => {
  console.error("E2-1_FATAL", error instanceof Error ? error.message : String(error));
  process.exit(1);
});
