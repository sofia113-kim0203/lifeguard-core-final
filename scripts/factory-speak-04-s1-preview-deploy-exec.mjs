/**
 * FACTORY-SPEAK-04-S1 — Preview deploy ONLY (no push · no production · no env change).
 *
 * Usage:
 *   node scripts/factory-speak-04-s1-preview-deploy-exec.mjs
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const FIX = join(ROOT, "fixtures/key-judgment-validation-v1");
const OUT = join(FIX, "factory-speak-04-s1-preview-deploy-evidence.json");

const TEAM = "70sofia113-1918s-projects";

function gitShortSha() {
  return spawnSync("git", ["rev-parse", "--short", "HEAD"], { cwd: ROOT, encoding: "utf8" }).stdout?.trim() ?? null;
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
  mkdirSync(FIX, { recursive: true });
  const deploy = deployPreview();

  const evidence = {
    schema_version: "factory-speak-04-s1-preview-deploy-evidence-v1",
    slice: "FACTORY-SPEAK-04-S1-design",
    mode: "Preview deploy only · no push · no production · no env change",
    pass_declaration: "none",
    observed_at: new Date().toISOString(),
    git_short_sha: gitShortSha(),
    preview_env_changed: false,
    deploy,
    production_alias_unchanged: true,
    next_step: "node scripts/factory-speak-04-s1-preview-customer-seat-audit.mjs <preview-url>",
  };

  writeFileSync(OUT, `${JSON.stringify(evidence, null, 2)}\n`);

  if (!deploy.ok || !deploy.preview_url) {
    console.error("Preview deploy failed", deploy);
    process.exit(1);
  }

  console.log("Preview deployed:", deploy.preview_url);
  console.log(`Wrote ${OUT}`);
  console.log(`Next: node scripts/factory-speak-04-s1-preview-customer-seat-audit.mjs ${deploy.preview_url}`);
}

await main();
