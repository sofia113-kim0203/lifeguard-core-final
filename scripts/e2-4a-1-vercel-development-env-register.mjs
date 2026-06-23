/**
 * E-2-4A-1 — Register 6 Vercel Development env keys (reduced scope).
 *
 * Supabase 4 keys: staging ref inwswsruvvzaeioqkelq via Management API api-keys.
 * CRON_SECRET: dev-only generated. COVERAGE_SHEET_LIVE_GATE: literal "0".
 *
 * Flags:
 *   --dry-run   Plan + guard checks only; no vercel env add, no secret output
 *
 * Deferred (not registered): ANTHROPIC_API_KEY, OPENAI_API_KEY
 * Forbidden: preview env run, preview/production secret copy, .env.local writes
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const STAGING_REF = "inwswsruvvzaeioqkelq";
const PROD_REF = "fhvlxcguvjvtftttfrix";
const STAGING_HOST = `https://${STAGING_REF}.supabase.co`;
const COVERAGE_GATE_VALUE = "0";
const DEFERRED_KEYS = ["ANTHROPIC_API_KEY", "OPENAI_API_KEY"];
const REGISTER_KEYS = [
  "VITE_SUPABASE_URL",
  "VITE_SUPABASE_ANON_KEY",
  "SERVICE_ROLE_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "CRON_SECRET",
  "COVERAGE_SHEET_LIVE_GATE",
];

const argv = new Set(process.argv.slice(2));
const DRY_RUN = argv.has("--dry-run");

const KEY_SOURCES = {
  VITE_SUPABASE_URL: "staging_host",
  VITE_SUPABASE_ANON_KEY: "staging_api_keys_anon",
  SERVICE_ROLE_KEY: "staging_api_keys_service_role",
  SUPABASE_SERVICE_ROLE_KEY: "staging_api_keys_service_role_alias",
  CRON_SECRET: "dev_generated",
  COVERAGE_SHEET_LIVE_GATE: "literal_0",
};

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

function assertNoProductionRef(label, value) {
  if (String(value ?? "").includes(PROD_REF)) {
    throw new Error(`production_ref_leak:${label}`);
  }
}

async function fetchStagingSupabaseKeys(accessToken) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${STAGING_REF}/api-keys`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`staging_api_keys_failed:${res.status}`);
  const keys = await res.json();
  const anon = keys.find((k) => k.name === "anon")?.api_key;
  const service = keys.find((k) => k.name === "service_role")?.api_key;
  if (!anon || !service) throw new Error("staging_api_keys_missing:anon_or_service_role");
  return { anon_key: anon, service_role_key: service };
}

function buildValues(stagingKeys, cronSecret) {
  return {
    VITE_SUPABASE_URL: STAGING_HOST,
    VITE_SUPABASE_ANON_KEY: stagingKeys.anon_key,
    SERVICE_ROLE_KEY: stagingKeys.service_role_key,
    SUPABASE_SERVICE_ROLE_KEY: stagingKeys.service_role_key,
    CRON_SECRET: cronSecret,
    COVERAGE_SHEET_LIVE_GATE: COVERAGE_GATE_VALUE,
  };
}

function addDevelopmentEnv(key, value) {
  execSync(`npx vercel env add ${key} development`, {
    cwd: ROOT,
    input: String(value),
    stdio: ["pipe", "pipe", "pipe"],
    encoding: "utf8",
  });
}

function listDevelopmentKeyNames() {
  const out = execSync("npx vercel env ls development", {
    cwd: ROOT,
    stdio: ["ignore", "pipe", "pipe"],
    encoding: "utf8",
  });
  const names = [];
  for (const line of out.split(/\r?\n/)) {
    const match = line.match(/^\s+([A-Z0-9_]+)\s+/);
    if (match) names.push(match[1]);
  }
  return names;
}

async function main() {
  console.log(`E2-4A-1_MODE=${DRY_RUN ? "dry_run" : "live"}`);
  console.log(`E2-4A-1_STAGING_REF=${STAGING_REF}`);
  console.log(`E2-4A-1_STAGING_HOST=${STAGING_HOST}`);

  for (const key of DEFERRED_KEYS) {
    console.log(`E2-4A-1_DEFERRED key=${key}`);
  }

  const accessToken = parseEnvFile(path.join(ROOT, ".env.local")).SUPABASE_ACCESS_TOKEN?.trim();
  if (!accessToken && !DRY_RUN) {
    throw new Error("SUPABASE_ACCESS_TOKEN missing in .env.local (read-only)");
  }

  let stagingKeys = { anon_key: "[dry-run]", service_role_key: "[dry-run]" };
  if (DRY_RUN) {
    console.log("E2-4A-1_WOULD_FETCH staging_api_keys ref=inwswsruvvzaeioqkelq");
    assertNoProductionRef("STAGING_HOST", STAGING_HOST);
    console.log("E2-4A-1_GUARD production_ref_absent=pass");
  } else {
    stagingKeys = await fetchStagingSupabaseKeys(accessToken);
  }

  const cronSecret = DRY_RUN ? "[dry-run-generated]" : crypto.randomBytes(32).toString("base64url");
  const values = buildValues(stagingKeys, cronSecret);

  for (const key of REGISTER_KEYS) {
    assertNoProductionRef(key, key === "VITE_SUPABASE_URL" ? values[key] : values[key]);
  }
  if (!DRY_RUN) {
    for (const key of ["VITE_SUPABASE_ANON_KEY", "SERVICE_ROLE_KEY", "SUPABASE_SERVICE_ROLE_KEY", "CRON_SECRET"]) {
      assertNoProductionRef(key, values[key]);
    }
  }

  for (const key of REGISTER_KEYS) {
    console.log(`E2-4A-1_${DRY_RUN ? "WOULD_ADD" : "ADD"} key=${key} source=${KEY_SOURCES[key]}`);
    if (!DRY_RUN) addDevelopmentEnv(key, values[key]);
  }

  if (DRY_RUN) {
    console.log("E2-4A-1_SECRET_POLICY no_values_logged=true");
    console.log("E2-4A-1_STATUS=dry_run_ok");
    return;
  }

  const names = listDevelopmentKeyNames();
  console.log("E2-4A-1_DEVELOPMENT_KEYS_BEGIN");
  for (const name of names.sort()) console.log(`E2-4A-1_DEV_KEY name=${name}`);
  console.log("E2-4A-1_DEVELOPMENT_KEYS_END");
  console.log("E2-4A-1_SECRET_POLICY no_values_logged=true");
  console.log("E2-4A-1_STATUS=ok");
}

main().catch((error) => {
  console.error("E2-4A-1_FATAL", error instanceof Error ? error.message : String(error));
  process.exit(1);
});
