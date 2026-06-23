/**
 * E-2-4C root-cause isolation (readonly + NOTIFY only).
 * Outputs ref match and view column checks only — no secrets.
 */
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const STAGING_REF = "inwswsruvvzaeioqkelq";
const PROD_REF = "fhvlxcguvjvtftttfrix";
const EXPECTED_COLUMNS = ["premium_amount", "policy_status", "contract_date"];
const TEMP_ENV = path.join(ROOT, ".e2-4c-dev-env-check.tmp");

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

function extractRef(url) {
  const match = String(url ?? "").match(/https:\/\/([^.]+)\.supabase\.co/i);
  return match?.[1] ?? null;
}

function pullDevelopmentEnv() {
  try {
    if (fs.existsSync(TEMP_ENV)) fs.unlinkSync(TEMP_ENV);
  } catch {
    // ignore
  }
  execSync(`npx vercel env pull "${TEMP_ENV}" --environment=development --yes`, {
    cwd: ROOT,
    stdio: ["ignore", "pipe", "pipe"],
    encoding: "utf8",
  });
  const env = parseEnvFile(TEMP_ENV);
  try {
    fs.unlinkSync(TEMP_ENV);
  } catch {
    // ignore
  }
  return env;
}

async function mgmtQuery(token, ref, sql, label) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query: sql }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message =
      body?.message ?? body?.error ?? (typeof body?.raw === "string" ? body.raw : JSON.stringify(body));
    throw new Error(`${label}_failed:${res.status}:${String(message).slice(0, 300)}`);
  }
  return body;
}

async function main() {
  const devEnv = pullDevelopmentEnv();
  const devRef = extractRef(devEnv.VITE_SUPABASE_URL);
  const devMatch = devRef === STAGING_REF;
  console.log(`E2-4C-DEV_ENV_REF=${devRef ?? "missing"}`);
  console.log(`E2-4C-DEV_ENV_REF_MATCH=${devMatch}`);
  console.log(`E2-4C-EXPECTED_REF=${STAGING_REF}`);

  const token = parseEnvFile(path.join(ROOT, ".env.local")).SUPABASE_ACCESS_TOKEN?.trim();
  if (!token) throw new Error("SUPABASE_ACCESS_TOKEN missing");

  const colList = EXPECTED_COLUMNS.map((c) => `'${c}'`).join(", ");
  const viewSql = `
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'active_profile_insurance_policies'
  AND column_name = ANY (ARRAY[${colList}])
ORDER BY column_name;`;

  const viewCols = await mgmtQuery(token, STAGING_REF, viewSql, "view_columns");
  console.log(`E2-4C-VIEW_COLUMN_QUERY table=active_profile_insurance_policies`);
  for (const col of EXPECTED_COLUMNS) {
    const found = Array.isArray(viewCols) && viewCols.some((r) => r.column_name === col);
    console.log(`E2-4C-VIEW_COLUMN_${col}=${found ? "present" : "absent"}`);
  }

  const reloadOnly = new Set(process.argv.slice(2)).has("--reload");
  if (reloadOnly) {
    await mgmtQuery(token, STAGING_REF, "NOTIFY pgrst, 'reload schema';", "pgrst_reload");
    console.log("E2-4C-PGRST_RELOAD=executed");
  } else {
    console.log("E2-4C-PGRST_RELOAD=skipped_pass_--reload_to_execute");
  }

  if (devRef === PROD_REF) {
    throw new Error("production_guard:dev_env_ref_is_production");
  }
}

main().catch((error) => {
  console.error("E2-4C-ISOLATE_FATAL", error instanceof Error ? error.message : String(error));
  process.exit(1);
});
