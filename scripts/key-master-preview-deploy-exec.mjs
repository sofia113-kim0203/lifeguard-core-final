/**
 * KEY Master — Preview deploy ONLY (preflight + env + vercel deploy).
 *
 * Usage:
 *   node scripts/key-master-preview-deploy-exec.mjs
 *   node scripts/key-master-preview-deploy-exec.mjs --preflight-only
 *   node scripts/key-master-preview-deploy-exec.mjs --skip-env
 *   node scripts/key-master-preview-deploy-exec.mjs --claude-full-active
 *
 * --claude-full-active: Preview env upsert only — sets KEY_BORROWED_SENSES=active.
 *   Forbidden with Production intent or --skip-env. Default remains shadow.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createClient } from "@supabase/supabase-js";
import { resolveKeyMasterPreviewEnv } from "../server/keyCore/oneKeyCoreFlags.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const FIX = join(ROOT, "fixtures/key-judgment-validation-v1");
const OUT = join(FIX, "key-master-preview-deploy-evidence.json");

const TEAM = "70sofia113-1918s-projects";
const KNOWN_QA_CUSTOMER_ID = "a247a66f-a597-4ccf-9530-761b82518002";

/** True when argv/env indicates Production target or Production-related command. */
export function detectProductionIntent(argv = process.argv, env = process.env) {
  const args = argv.slice(2).map((a) => String(a ?? "").trim().toLowerCase());
  if (args.includes("--prod") || args.includes("--production") || args.includes("production")) {
    return true;
  }
  if (args.some((a) => a === "--target=production" || a.startsWith("--target=prod"))) {
    return true;
  }
  const vercelEnv = String(env.VERCEL_ENV ?? "").trim().toLowerCase();
  if (vercelEnv === "production") return true;
  const targetEnv = String(env.VERCEL_TARGET_ENV ?? env.VERCEL_TARGET ?? "")
    .trim()
    .toLowerCase();
  if (targetEnv === "production" || targetEnv === "prod") return true;
  return false;
}

export function parseKeyMasterDeployArgv(argv = process.argv) {
  return {
    skipEnv: argv.includes("--skip-env"),
    preflightOnly: argv.includes("--preflight-only"),
    claudeFullActive: argv.includes("--claude-full-active"),
    productionIntent: detectProductionIntent(argv),
  };
}

/**
 * Preview env keys for upsert. Default KEY_BORROWED_SENSES=shadow.
 * --claude-full-active overrides to active only (no new hidden env flags).
 */
export function buildKeyMasterPreviewEnvKeys({ claudeFullActive = false } = {}) {
  return {
    ...resolveKeyMasterPreviewEnv({}),
    ...(claudeFullActive ? { KEY_BORROWED_SENSES: "active" } : {}),
  };
}

/**
 * Safety for explicit Claude-Full Preview activation.
 * @returns {{ ok: true } | { ok: false, reason: string }}
 */
export function assertClaudeFullActiveSafety({
  claudeFullActive = false,
  skipEnv = false,
  productionIntent = false,
} = {}) {
  if (!claudeFullActive) return { ok: true };
  if (productionIntent) {
    return { ok: false, reason: "claude_full_active_forbidden_on_production" };
  }
  if (skipEnv) {
    return {
      ok: false,
      reason: "claude_full_active_requires_env_upsert_skip_env_forbidden",
    };
  }
  return { ok: true };
}

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

function stripJsCommentsForPreflight(source = "") {
  return String(source ?? "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

/**
 * Stein Commit A — oneKeyCoreTurn must use the approved async customer speak path.
 * PASS only when keySpeakAsync is imported from keySpeak.js AND actually called,
 * and finalizeKeyCustomerText remains on the KEY Master outlet.
 * FAIL: missing call, comment-only, import-only, or legacy keySpeak(...) alone.
 */
export function evaluateOneKeyCoreTurnSpeakPath(turnSource = "") {
  const code = stripJsCommentsForPreflight(turnSource);
  const importsAsync = /import\s*\{[^}]*\bkeySpeakAsync\b[^}]*\}\s*from\s*["'][^"']*keySpeak\.js["']/.test(
    code,
  );
  const callsAsync = /(?:^|[^.\w])(?:await\s+)?keySpeakAsync\s*\(/.test(code);
  const callsLegacySync = /(?:^|[^.\w])keySpeak\s*\(/.test(code);
  const callsFinalize = /\bfinalizeKeyCustomerText\s*\(/.test(code);

  if (!callsAsync) {
    if (callsLegacySync) {
      return {
        ok: false,
        reason:
          "oneKeyCoreTurn.js calls legacy keySpeak only — approved path is keySpeakAsync",
      };
    }
    return {
      ok: false,
      reason: "oneKeyCoreTurn.js does not call keySpeakAsync",
    };
  }
  if (!importsAsync) {
    return {
      ok: false,
      reason: "oneKeyCoreTurn.js must import keySpeakAsync from keySpeak.js",
    };
  }
  if (!callsFinalize) {
    return {
      ok: false,
      reason: "oneKeyCoreTurn.js must call finalizeKeyCustomerText on KEY Master outlet",
    };
  }
  return { ok: true, reason: null };
}

function assertKeyMasterPreflight() {
  const missing = KEY_MASTER_REQUIRED_FILES.filter((rel) => !existsSync(join(ROOT, rel)));
  if (missing.length) {
    throw new Error(`KEY Master preflight failed — missing files: ${missing.join(", ")}`);
  }

  const turnSource = readFileSync(join(ROOT, "server/keyCore/oneKeyCoreTurn.js"), "utf8");
  const speakPath = evaluateOneKeyCoreTurnSpeakPath(turnSource);
  if (!speakPath.ok) {
    throw new Error(`KEY Master preflight failed — ${speakPath.reason}`);
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
  return { intakeApis, turn_speak_path: speakPath };
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

function stampDeployIdentity(sha) {
  const stampPath = join(ROOT, "server/keyCore/keyDeployIdentity.js");
  const body = `/**
 * Preview deploy identity stamp — values filled at deploy from \`git rev-parse HEAD\`.
 * Do not hand-edit with a fake sha. Local default stays null until stamped for upload.
 */
export const KEY_DEPLOY_IDENTITY = {
  git_commit_sha: ${JSON.stringify(sha || null)},
  source: ${JSON.stringify(sha ? "git_rev_parse_at_preview_deploy" : null)},
};
`;
  writeFileSync(stampPath, body);
}

function restoreDeployIdentity() {
  stampDeployIdentity(null);
}

function deployPreview() {
  const sha =
    spawnSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).stdout?.trim() || "";
  stampDeployIdentity(sha || null);
  let proc;
  try {
    // shell:false so --env is not mangled on Windows; stamp file is the primary sha path.
    const deployArgs = ["vercel", "deploy", "--yes", "--scope", TEAM];
    if (sha) {
      deployArgs.push("--env", `GIT_COMMIT_SHA=${sha}`);
      deployArgs.push("--build-env", `GIT_COMMIT_SHA=${sha}`);
    }
    // Windows: npx.cmd + shell:false keeps --env intact and avoids empty spawn.
    const npxBin = process.platform === "win32" ? "npx.cmd" : "npx";
    proc = spawnSync(npxBin, deployArgs, {
      cwd: ROOT,
      encoding: "utf8",
      shell: false,
      maxBuffer: 16 * 1024 * 1024,
      timeout: 600000,
    });
  } finally {
    restoreDeployIdentity();
  }
  const text = `${proc?.stdout ?? ""}\n${proc?.stderr ?? ""}`;
  const urls = text.match(/https:\/\/lifeguard-core-final[^\s]+/g) ?? [];
  return {
    ok: proc?.status === 0,
    exit_code: proc?.status ?? 1,
    preview_url: urls[urls.length - 1] ?? null,
    log_tail: text.slice(-2000),
    git_commit_sha: sha || null,
  };
}

async function main() {
  const flags = parseKeyMasterDeployArgv(process.argv);
  const { skipEnv, preflightOnly, claudeFullActive } = flags;
  mkdirSync(FIX, { recursive: true });

  const safety = assertClaudeFullActiveSafety({
    claudeFullActive,
    skipEnv,
    productionIntent: flags.productionIntent,
  });
  if (!safety.ok) {
    console.error(`KEY Master deploy blocked: ${safety.reason}`);
    console.error(
      "KEY_BORROWED_SENSES=active is Preview-only and requires env upsert (no --skip-env, no Production).",
    );
    process.exit(1);
  }

  const preflightResult = assertKeyMasterPreflight();

  if (preflightOnly) {
    const previewEnvKeysPreflight = buildKeyMasterPreviewEnvKeys({ claudeFullActive });
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
      claude_full_active: claudeFullActive === true,
      KEY_BORROWED_SENSES: previewEnvKeysPreflight.KEY_BORROWED_SENSES,
      preview_env_keys: previewEnvKeysPreflight,
    };
    writeFileSync(OUT, `${JSON.stringify(evidence, null, 2)}\n`);
    console.log("KEY Master preflight passed (intake APIs included).");
    console.log(`KEY_BORROWED_SENSES=${previewEnvKeysPreflight.KEY_BORROWED_SENSES}`);
    console.log(`Wrote ${OUT}`);
    return;
  }

  const qaCustomerId = await resolveQaCustomerId();
  const envOps = [];
  const previewEnvKeys = buildKeyMasterPreviewEnvKeys({ claudeFullActive });

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
    mode: claudeFullActive
      ? "Preview deploy · KEY Master · Claude-Full active (KEY_BORROWED_SENSES=active) · no production"
      : "Preview deploy only · KEY Master preflight · no production",
    pass_declaration: "none",
    observed_at: new Date().toISOString(),
    git_short_sha: gitShortSha(),
    git_status_porcelain: gitStatusPorcelain(),
    key_master_required_files: KEY_MASTER_REQUIRED_FILES,
    key_master_intake_api_files: KEY_MASTER_INTAKE_API_FILES,
    intake_preflight: preflightResult.intakeApis,
    preflight: "passed",
    qa_customer_profile_id: qaCustomerId,
    claude_full_active: claudeFullActive === true,
    KEY_BORROWED_SENSES: previewEnvKeys.KEY_BORROWED_SENSES,
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
  console.log(`KEY_BORROWED_SENSES=${previewEnvKeys.KEY_BORROWED_SENSES}`);
  if (claudeFullActive) {
    console.log("claude_full_active=true (Preview env upsert)");
  }
  console.log(`Wrote ${OUT}`);
  console.log(`Next: node scripts/key-master-survival-preview-probe.mjs ${deploy.preview_url}`);
}

const isDirectRun =
  Boolean(process.argv[1]) &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url;
if (isDirectRun) {
  await main();
}