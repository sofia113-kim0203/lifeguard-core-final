/**
 * E-2-4B — Align .env.local to staging Supabase + QA customer_a.
 * Never logs secret values.
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const ENV_PATH = path.join(ROOT, ".env.local");
const AUDIT_SCRIPT = path.join(__dirname, "e2-4b-env-local-audit.mjs");
const STAGING_REF = "inwswsruvvzaeioqkelq";
const PROD_REF = "fhvlxcguvjvtftttfrix";
const STAGING_HOST = `https://${STAGING_REF}.supabase.co`;
const QA_EMAIL = "e2-3-qa-customer-a@staging-qa.example.com";

function parseEnvFile(envPath) {
  const out = {};
  const order = [];
  if (!fs.existsSync(envPath)) return { out, order, lines: [] };
  const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const idx = trimmed.indexOf("=");
    if (idx <= 0) continue;
    const key = trimmed.slice(0, idx).trim();
    let value = trimmed.slice(idx + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
    order.push(key);
  }
  return { out, order, lines };
}

function serializeEnv(entries) {
  const keys = [
    "VITE_SUPABASE_URL",
    "VITE_SUPABASE_ANON_KEY",
    "SUPABASE_URL",
    "SUPABASE_ANON_KEY",
    "SUPABASE_ACCESS_TOKEN",
    "QA_EMAIL",
    "QA_PASSWORD",
  ];
  const lines = ["# E-2-4B aligned to staging ref inwswsruvvzaeioqkelq"];
  for (const key of keys) {
    if (entries[key] !== undefined) lines.push(`${key}=${entries[key]}`);
  }
  return `${lines.join("\n")}\n`;
}

async function fetchStagingKeys(accessToken) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${STAGING_REF}/api-keys`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`staging_api_keys_failed:${res.status}`);
  const keys = await res.json();
  const anon = keys.find((k) => k.name === "anon")?.api_key;
  const service = keys.find((k) => k.name === "service_role")?.api_key;
  if (!anon || !service) throw new Error("staging_api_keys_missing");
  return { anon_key: anon, service_role_key: service };
}

async function resetCustomerAPassword(stagingHost, serviceRoleKey) {
  const admin = createClient(stagingHost, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const password = `E2-4B-QA-${crypto.randomBytes(18).toString("base64url")}!`;
  const list = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
  if (list.error) throw new Error(`auth_list_failed:${list.error.message}`);
  const existing = (list.data.users ?? []).find(
    (u) => String(u.email ?? "").toLowerCase() === QA_EMAIL.toLowerCase(),
  );
  if (!existing?.id) throw new Error("qa_customer_a_missing:run_e2_3_first");
  const updated = await admin.auth.admin.updateUserById(existing.id, { password });
  if (updated.error) throw new Error(`qa_password_reset_failed:${updated.error.message}`);
  return password;
}

async function authSmoke(stagingHost, anonKey, email, password) {
  const client = createClient(stagingHost, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error || !data.session?.access_token) {
    return { ok: false, reason: error?.message ?? "no_session" };
  }
  return { ok: true, reason: "signed_in" };
}

function runAudit() {
  return execSync(`node "${AUDIT_SCRIPT}"`, { encoding: "utf8" });
}

async function main() {
  if (!fs.existsSync(ENV_PATH)) throw new Error("env_local_missing");

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupPath = path.join(ROOT, `.env.local.backup.e2-4b-${stamp}`);
  fs.copyFileSync(ENV_PATH, backupPath);
  console.log(`E2-4B_BACKUP created=${path.basename(backupPath)}`);

  const parsed = parseEnvFile(ENV_PATH);
  const accessToken = parsed.out.SUPABASE_ACCESS_TOKEN?.trim();
  if (!accessToken) throw new Error("SUPABASE_ACCESS_TOKEN_missing");

  const stagingKeys = await fetchStagingKeys(accessToken);
  const qaPassword = await resetCustomerAPassword(STAGING_HOST, stagingKeys.service_role_key);

  const next = {
    VITE_SUPABASE_URL: STAGING_HOST,
    VITE_SUPABASE_ANON_KEY: stagingKeys.anon_key,
    SUPABASE_URL: STAGING_HOST,
    SUPABASE_ANON_KEY: stagingKeys.anon_key,
    SUPABASE_ACCESS_TOKEN: accessToken,
    QA_EMAIL,
    QA_PASSWORD: qaPassword,
  };

  for (const [key, value] of Object.entries(next)) {
    if (String(value).includes(PROD_REF)) throw new Error(`production_ref_leak_before_write:${key}`);
  }

  fs.writeFileSync(ENV_PATH, serializeEnv(next), "utf8");

  const auditRaw = runAudit();
  const audit = JSON.parse(auditRaw);
  const prodHits = audit.entries.filter((e) => e.has_production_ref).map((e) => e.key);
  const urlHosts = audit.entries
    .filter((e) => e.url_host)
    .map((e) => ({ key: e.key, url_host: e.url_host }));
  const hasServiceRole = audit.entries.some((e) => e.key === "SERVICE_ROLE_KEY");
  const hasQaEmail = audit.entries.some((e) => e.key === "QA_EMAIL" && e.is_set);

  const smoke = await authSmoke(STAGING_HOST, stagingKeys.anon_key, QA_EMAIL, qaPassword);

  console.log(`E2-4B_PRODUCTION_REF_HITS count=${prodHits.length}`);
  console.log(`E2-4B_STAGING_URL_HOSTS ${JSON.stringify(urlHosts)}`);
  console.log(`E2-4B_QA_EMAIL present=${hasQaEmail}`);
  console.log(`E2-4B_SERVICE_ROLE_KEY present=${hasServiceRole}`);
  console.log(`E2-4B_AUTH_SMOKE ok=${smoke.ok} reason=${smoke.reason}`);
  console.log("E2-4B_SECRET_POLICY no_values_logged=true");
  console.log(`E2-4B_STATUS=${prodHits.length === 0 && !hasServiceRole && hasQaEmail && smoke.ok ? "ok" : "failed"}`);

  if (prodHits.length || hasServiceRole || !hasQaEmail || !smoke.ok) process.exit(1);
}

main().catch((error) => {
  console.error("E2-4B_FATAL", error instanceof Error ? error.message : String(error));
  process.exit(1);
});
