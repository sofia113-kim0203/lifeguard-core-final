/**
 * ONE KEY Core S02-5 — Preview deploy ONLY (no push · no production).
 *
 * Adds ONE_KEY_CORE_BRIDGE=1 to Preview env (existing Preview env preserved).
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const FIX = join(ROOT, "fixtures/key-judgment-validation-v1");
const OUT = join(FIX, "one-key-core-s02-5-preview-deploy-evidence.json");

const TEAM = "70sofia113-1918s-projects";
const PREVIEW_ENV_ADD = {
  ONE_KEY_CORE_BRIDGE: "1",
};

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
  return { action: hasVar ? "update" : "add", value };
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

  const envOps = [];
  if (!skipEnv) {
    for (const [key, value] of Object.entries(PREVIEW_ENV_ADD)) {
      envOps.push({ key, ...upsertPreviewEnvVar(key, value) });
    }
  }

  const deploy = deployPreview();

  const evidence = {
    schema_version: "one-key-core-s02-5-preview-deploy-evidence-v1",
    slice: "ONE-KEY-CORE-S02-5-bridge",
    mode: "Preview deploy only · no push · no production",
    pass_declaration: "none",
    observed_at: new Date().toISOString(),
    git_short_sha: gitShortSha(),
    preview_env_add: PREVIEW_ENV_ADD,
    preview_env_preserved: [
      "ONE_KEY_CORE_RETURN_JUDGMENT",
      "ONE_KEY_CORE_ANALYSIS_COMPLETE",
      "ONE_KEY_CORE_DOCUMENT",
      "ONE_KEY_CORE_S1",
      "KEY_UPLOAD_ENTRY",
      "SALES_DIRECTOR_KEY_ORCHESTRATOR",
      "SALES_DIRECTOR_KEY_LEGACY_FALLBACK",
      "SALES_DIRECTOR_KEY_CUSTOMER_ALLOWLIST",
    ],
    env_ops: envOps,
    deploy,
    production_alias_unchanged: true,
    next_step: "node scripts/one-key-core-s02-5-upload-5beat-preview-probe.mjs <preview-url>",
  };

  writeFileSync(OUT, `${JSON.stringify(evidence, null, 2)}\n`);

  if (!deploy.ok || !deploy.preview_url) {
    console.error("Preview deploy failed", deploy);
    process.exit(1);
  }

  console.log("Preview deployed:", deploy.preview_url);
  console.log(`Wrote ${OUT}`);
  console.log(`Next: node scripts/one-key-core-s02-5-upload-5beat-preview-probe.mjs ${deploy.preview_url}`);
}

await main();
