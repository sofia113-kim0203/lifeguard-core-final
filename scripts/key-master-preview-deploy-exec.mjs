/**
 * KEY Master — Preview deploy ONLY (preflight + env + vercel deploy).
 *
 * Usage:
 *   node scripts/key-master-preview-deploy-exec.mjs
 *   node scripts/key-master-preview-deploy-exec.mjs --preflight-only
 *   node scripts/key-master-preview-deploy-exec.mjs --skip-env
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import { resolveKeyMasterPreviewEnv } from "../server/keyCore/oneKeyCoreFlags.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const FIX = join(ROOT, "fixtures/key-judgment-validation-v1");
const OUT = join(FIX, "key-master-preview-deploy-evidence.json");

const TEAM = "70sofia113-1918s-projects";
const KNOWN_QA_CUSTOMER_ID = "a247a66f-a597-4ccf-9530-761b82518002";

const KEY_MASTER_REQUIRED_FILES = [
  "server/keyBrain/keySpeak.js",
  "server/keyCore/keyCustomerMonopoly.js",
  "server/keyCore/keyCustomerTextSeal.js",
  "server/keyCore/oneKeyCoreTurn.js",
  "server/homeBrainFactCore.js",
];

const KEY_MASTER_INTAKE_API_FILES = [
  "api/key-document-intake.js",
  "api/key-analysis-complete-intake.js",
  "api/key-bridge-intake.js",
  "api/key-return-judgment-intake.js",
];

const INTAKE_FORBIDDEN_SPEAK_PATTERNS = [
  { id: "finalizeSalesDirectorResponse", re: /finalizeSalesDirectorResponse/ },
  { id: "generateHumanSalesDirectorResponse", re: /generateHumanSalesDirectorResponse/ },
  { id: "buildKeyStructuredResponse", re: /buildKeyStructuredResponse/ },
  { id: "finalizeBridgeSentence", re: /finalizeBridgeSentence/ },
  { id: "finalizeReturnJudgmentSentence", re: /finalizeReturnJudgmentSentence/ },
  { id: "resolveAnalysisCompleteInitiativeSentence", re: /resolveAnalysisCompleteInitiativeSentence/ },
];

const INTAKE_LEGACY_FALLBACK_PATTERNS = [
  { id: "isOneKeyCore flag gate", re: /isOneKeyCore(?:Document|AnalysisComplete|Bridge|ReturnJudgment)Enabled/ },
  { id: "SALES_DIRECTOR_KEY_LEGACY_FALLBACK", re: /SALES_DIRECTOR_KEY_LEGACY_FALLBACK/ },
  { id: "finalizeDocumentIntakeFirstSentence", re: /finalizeDocumentIntakeFirstSentence/ },
  {
    id: "analysisCompleteFirstSpeak speak import",
    re: /from\s+["'][^"']*analysisCompleteFirstSpeak(?:FirstSpeak)?\.js["']/,
  },
  { id: "bridgeFirstSpeak speak import", re: /from\s+["'][^"']*bridgeFirstSpeak\.js["']/ },
  { id: "legacy fallback branch", re: /legacy[_\s-]?fallback|legacy\s+branch|flag\s+OFF\s+legacy/i },
  { id: "fake persona outlet", re: /persona_outlet:\s*["']finalizeSalesDirectorResponse/ },
];

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

function gitStatusPorcelain() {
  return spawnSync("git", ["status", "--porcelain"], { cwd: ROOT, encoding: "utf8" }).stdout?.trim() ?? "";
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

function assertKeyMasterIntakeApis() {
  const intakeResults = [];

  for (const rel of KEY_MASTER_INTAKE_API_FILES) {
    const abs = join(ROOT, rel);
    if (!existsSync(abs)) {
      throw new Error(`KEY Master preflight failed — missing intake API: ${rel}`);
    }

    const source = readFileSync(abs, "utf8");
    const checks = {
      runOneKeyCoreTurn: /runOneKeyCoreTurn/.test(source),
      keySpeak_path:
        /keySpeak\(key_master\)/.test(source) || /key_speak_master:\s*true/.test(source),
    };

    if (!checks.runOneKeyCoreTurn) {
      throw new Error(`KEY Master preflight failed — ${rel} must call runOneKeyCoreTurn`);
    }
    if (!checks.keySpeak_path) {
      throw new Error(`KEY Master preflight failed — ${rel} must expose keySpeak(key_master) path`);
    }

    for (const { id, re } of INTAKE_FORBIDDEN_SPEAK_PATTERNS) {
      if (re.test(source)) {
        throw new Error(`KEY Master preflight failed — ${rel} forbids ${id}`);
      }
      checks[`forbid_${id}`] = false;
    }

    for (const { id, re } of INTAKE_LEGACY_FALLBACK_PATTERNS) {
      if (re.test(source)) {
        throw new Error(`KEY Master preflight failed — ${rel} forbids legacy fallback: ${id}`);
      }
      checks[`legacy_${id}`] = false;
    }

    intakeResults.push({ file: rel, checks });
  }

  return intakeResults;
}

function assertKeyMasterPreflight() {
  const missing = KEY_MASTER_REQUIRED_FILES.filter((rel) => !existsSync(join(ROOT, rel)));
  if (missing.length) {
    throw new Error(`KEY Master preflight failed — missing files: ${missing.join(", ")}`);
  }

  const turnSource = readFileSync(join(ROOT, "server/keyCore/oneKeyCoreTurn.js"), "utf8");
  if (!/keySpeak\(/.test(turnSource)) {
    throw new Error("KEY Master preflight failed — oneKeyCoreTurn.js does not call keySpeak");
  }
  if (/generateHumanSalesDirectorResponse/.test(turnSource)) {
    throw new Error("KEY Master preflight failed — HUL still referenced in oneKeyCoreTurn.js");
  }

  const homeSource = readFileSync(join(ROOT, "server/homeBrainFactCore.js"), "utf8");
  const handler = homeSource.slice(homeSource.indexOf("export async function handleHomeBrainFactRequest"));
  if (/finalizeSalesDirectorResponse|runSalesDirectorLoopTurn|finalizeHomeAgentResponse/.test(handler)) {
    throw new Error("KEY Master preflight failed — fake KEY paths remain in homeBrainFactCore handler");
  }

  const intakeApis = assertKeyMasterIntakeApis();
  return { intakeApis };
}

async function resolveQaCustomerId() {
  loadEnvFile(join(ROOT, ".env.local"));
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
  const preflightOnly = process.argv.includes("--preflight-only");
  mkdirSync(FIX, { recursive: true });

  const preflightResult = assertKeyMasterPreflight();

  if (preflightOnly) {
    const evidence = {
      schema_version: "key-master-preview-deploy-evidence-v1",
      slice: "KEY_MASTER",
      mode: "preflight-only · no deploy",
      pass_declaration: "none",
      observed_at: new Date().toISOString(),
      git_short_sha: gitShortSha(),
      git_status_porcelain: gitStatusPorcelain(),
      key_master_required_files: KEY_MASTER_REQUIRED_FILES,
      key_master_intake_api_files: KEY_MASTER_INTAKE_API_FILES,
      intake_preflight: preflightResult.intakeApis,
      preflight: "passed",
    };
    writeFileSync(OUT, `${JSON.stringify(evidence, null, 2)}\n`);
    console.log("KEY Master preflight passed (intake APIs included).");
    console.log(`Wrote ${OUT}`);
    return;
  }

  const qaCustomerId = await resolveQaCustomerId();
  const envOps = [];
  const previewEnvKeys = resolveKeyMasterPreviewEnv({});

  if (!skipEnv) {
    const allowBefore = readPreviewEnvVar("SALES_DIRECTOR_KEY_CUSTOMER_ALLOWLIST");
    const allowNext = mergeAllowlist(allowBefore.value, qaCustomerId);
    const targets = {
      ...previewEnvKeys,
      SALES_DIRECTOR_KEY_CUSTOMER_ALLOWLIST: allowNext,
    };
    for (const [key, value] of Object.entries(targets)) {
      if (key === "SALES_DIRECTOR_KEY_CUSTOMER_ALLOWLIST" || String(value).length <= 200) {
        envOps.push({ key, ...upsertPreviewEnvVar(key, String(value)) });
      }
    }
  }

  const deploy = deployPreview();

  const evidence = {
    schema_version: "key-master-preview-deploy-evidence-v1",
    slice: "KEY_MASTER",
    mode: "Preview deploy only · KEY Master preflight · no production",
    pass_declaration: "none",
    observed_at: new Date().toISOString(),
    git_short_sha: gitShortSha(),
    git_status_porcelain: gitStatusPorcelain(),
    key_master_required_files: KEY_MASTER_REQUIRED_FILES,
    key_master_intake_api_files: KEY_MASTER_INTAKE_API_FILES,
    intake_preflight: preflightResult.intakeApis,
    preflight: "passed",
    qa_customer_profile_id: qaCustomerId,
    preview_env_keys: previewEnvKeys,
    env_ops: envOps,
    deploy,
    production_alias_unchanged: true,
    next_step: "node scripts/key-master-survival-preview-probe.mjs <preview-url>",
  };

  writeFileSync(OUT, `${JSON.stringify(evidence, null, 2)}\n`);

  if (!deploy.ok || !deploy.preview_url) {
    console.error("KEY Master preview deploy failed", deploy);
    process.exit(1);
  }

  console.log("KEY Master preview deployed:", deploy.preview_url);
  console.log(`Wrote ${OUT}`);
  console.log(`Next: node scripts/key-master-survival-preview-probe.mjs ${deploy.preview_url}`);
}

await main();
