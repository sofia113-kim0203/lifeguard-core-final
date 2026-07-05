/**
 * ONE KEY Core S1 — Preview deploy ONLY (no push · no production).
 *
 * Sets Preview env (S1 flags + allowlist merge) then `vercel deploy --yes`.
 *
 * Usage:
 *   node scripts/one-key-core-s1-preview-deploy-exec.mjs
 *   node scripts/one-key-core-s1-preview-deploy-exec.mjs --skip-env
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const FIX = join(ROOT, "fixtures/key-judgment-validation-v1");
const OUT = join(FIX, "one-key-core-s1-preview-deploy-evidence.json");

const TEAM = "70sofia113-1918s-projects";
const KNOWN_QA_CUSTOMER_ID = "a247a66f-a597-4ccf-9530-761b82518002";
const PREVIEW_ENV_KEYS = {
  ONE_KEY_CORE_S1: "1",
  SALES_DIRECTOR_KEY_ORCHESTRATOR: "1",
  SALES_DIRECTOR_KEY_LEGACY_FALLBACK: "0",
};

function loadEnvFile(path) {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim().replace(/^['"]|['"]$/g, "");
    if (!process.env[key]) process.env[key] = value;
  }
}

function gitShortSha() {
  return spawnSync("git", ["rev-parse", "--short", "HEAD"], { cwd: ROOT, encoding: "utf8" }).stdout?.trim() ?? null;
}

function runVercel(args, { timeout = 120000 } = {}) {
  const proc = spawnSync("npx", ["vercel", ...args, "--scope", TEAM], {
    cwd: ROOT,
    encoding: "utf8",
    shell: true,
    maxBuffer: 16 * 1024 * 1024,
    timeout,
    stdio: ["ignore", "pipe", "pipe"],
  });
  return {
    ok: proc.status === 0,
    exit_code: proc.status,
    stdout: proc.stdout ?? "",
    stderr: proc.stderr ?? "",
  };
}

function readPreviewEnvVar(name) {
  const proc = spawnSync(
    "npx",
    ["vercel", "env", "run", "-e", "preview", "--scope", TEAM, "--", "node", "-e", `console.log(process.env.${name}||'')`],
    { cwd: ROOT, encoding: "utf8", shell: true, stdio: ["ignore", "pipe", "pipe"], timeout: 120000 },
  );
  if (proc.status !== 0) return { ok: false, value: "", error: proc.stderr?.slice(0, 300) };
  return { ok: true, value: String(proc.stdout ?? "").trim() };
}

function upsertPreviewEnvVar(name, value) {
  const existing = runVercel(["env", "ls", "preview"]);
  const hasVar = new RegExp(`\\b${name}\\b`).test(`${existing.stdout}\n${existing.stderr}`);
  const args = hasVar
    ? ["env", "update", name, "preview", "--yes", "--value", value]
    : ["env", "add", name, "preview", "--yes", "--value", value];
  const proc = runVercel(args, { timeout: 120000 });
  if (!proc.ok) {
    throw new Error(`env_${hasVar ? "update" : "add"}_${name}_failed:${proc.stderr.slice(0, 400)}`);
  }
  return { action: hasVar ? "update" : "add" };
}

function mergeAllowlist(currentRaw, appendId) {
  const ids = String(currentRaw ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (!ids.includes(appendId)) ids.push(appendId);
  return ids.join(",");
}

async function resolveQaCustomerId() {
  loadEnvFile(join(ROOT, ".env.local"));
  loadEnvFile(join(ROOT, ".env.preview.pulled"));
  const supabaseUrl = process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL ?? "";
  const supabaseAnon = process.env.VITE_SUPABASE_ANON_KEY ?? process.env.SUPABASE_ANON_KEY ?? "";
  const email = process.env.QA_EMAIL ?? process.env.QA_TEST_EMAIL ?? "";
  const password = process.env.QA_PASSWORD ?? process.env.QA_TEST_PASSWORD ?? "";
  if (!supabaseUrl || !supabaseAnon || !email || !password) return KNOWN_QA_CUSTOMER_ID;

  const { data: auth, error } = await createClient(supabaseUrl, supabaseAnon, {
    auth: { persistSession: false },
  }).auth.signInWithPassword({ email, password });
  if (error || !auth.session?.access_token) return KNOWN_QA_CUSTOMER_ID;

  const userSupabase = createClient(supabaseUrl, supabaseAnon, {
    auth: { persistSession: false },
    global: { headers: { Authorization: `Bearer ${auth.session.access_token}` } },
  });
  const { data: authData } = await userSupabase.auth.getUser();
  if (!authData?.user?.id) return KNOWN_QA_CUSTOMER_ID;
  const { data: profile } = await userSupabase
    .from("customer_profiles")
    .select("id")
    .eq("user_id", authData.user.id)
    .maybeSingle();
  return profile?.id ?? KNOWN_QA_CUSTOMER_ID;
}

function deployPreview() {
  const proc = spawnSync("npx", ["vercel", "deploy", "--yes", "--scope", TEAM], {
    cwd: ROOT,
    encoding: "utf8",
    shell: true,
    maxBuffer: 16 * 1024 * 1024,
    timeout: 600000,
  });
  const text = `${proc.stdout ?? ""}\n${proc.stderr ?? ""}`;
  const urls = text.match(/https:\/\/lifeguard-core-final[^\s]+/g) ?? [];
  return {
    ok: proc.status === 0,
    exit_code: proc.status,
    preview_url: urls[urls.length - 1] ?? null,
    log_tail: text.slice(-2000),
  };
}

async function main() {
  const skipEnv = process.argv.includes("--skip-env");
  mkdirSync(FIX, { recursive: true });

  const qaCustomerId = await resolveQaCustomerId();
  const envOps = [];

  if (!skipEnv) {
    const allowBefore = readPreviewEnvVar("SALES_DIRECTOR_KEY_CUSTOMER_ALLOWLIST");
    const allowNext = mergeAllowlist(allowBefore.value, qaCustomerId);
    const targets = {
      ...PREVIEW_ENV_KEYS,
      SALES_DIRECTOR_KEY_CUSTOMER_ALLOWLIST: allowNext,
    };
    for (const [key, value] of Object.entries(targets)) {
      envOps.push({ key, ...upsertPreviewEnvVar(key, value) });
    }
  }

  const deploy = deployPreview();

  const evidence = {
    schema_version: "one-key-core-s1-preview-deploy-evidence-v1",
    slice: "ONE-KEY-CORE-S1",
    mode: "Preview deploy only · no push · no production",
    pass_declaration: "none",
    observed_at: new Date().toISOString(),
    git_short_sha: gitShortSha(),
    qa_customer_profile_id: qaCustomerId,
    preview_env_keys: PREVIEW_ENV_KEYS,
    env_ops: envOps,
    deploy,
    production_alias_unchanged: true,
    next_step: "node scripts/one-key-core-s1-preview-seat-probe.mjs <preview-url>",
  };

  writeFileSync(OUT, `${JSON.stringify(evidence, null, 2)}\n`);

  if (!deploy.ok || !deploy.preview_url) {
    console.error("Preview deploy failed", deploy);
    process.exit(1);
  }

  console.log("Preview deployed:", deploy.preview_url);
  console.log(`Wrote ${OUT}`);
  console.log(`Next: node scripts/one-key-core-s1-preview-seat-probe.mjs ${deploy.preview_url}`);
}

await main();
