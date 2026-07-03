/**
 * Slice 1 — JC-PREMIUM-BURDEN-v1 Preview deploy ONLY (no verification).
 *
 * Flow: deploy → print Preview URL → optional deploy evidence
 * Verification is a separate script. Production alias NOT moved.
 *
 * Usage:
 *   node scripts/jc-premium-burden-v1-preview-deploy-exec.mjs
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const FIX = join(ROOT, "fixtures/key-judgment-validation-v1");
const OUT = join(FIX, "jc-premium-burden-v1-slice-preview-deploy-evidence.json");

function gitShortSha() {
  return spawnSync("git", ["rev-parse", "--short", "HEAD"], { cwd: ROOT, encoding: "utf8" }).stdout?.trim() ?? null;
}

function deployPreview() {
  const proc = spawnSync("npx vercel deploy --yes", {
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
    log_tail: text.slice(-1200),
  };
}

function main() {
  if (process.argv.includes("--verify") || process.argv.some((a) => a.startsWith("https://"))) {
    console.error("HOLD — verification is not part of Preview deploy.");
    console.error("Use: node scripts/jc-premium-burden-v1-preview-verify-exec.mjs <preview-url>");
    process.exit(2);
  }

  mkdirSync(FIX, { recursive: true });
  const deploy = deployPreview();

  const evidence = {
    document: "jc_premium_burden_v1_slice_preview_deploy_evidence",
    slice: "SLICE-1-JC-PREMIUM-BURDEN-v1",
    mode: "Preview deploy only · no verification in this script",
    pass_declaration: "none",
    observed_at: new Date().toISOString(),
    git_short_sha: gitShortSha(),
    deploy,
    production_alias_unchanged: true,
    next_step: "node scripts/jc-premium-burden-v1-preview-verify-exec.mjs <preview-url>",
    tom_note: "Deploy and verify are separate buttons",
  };

  writeFileSync(OUT, JSON.stringify(evidence, null, 2));

  if (!deploy.ok || !deploy.preview_url) {
    console.error("Preview deploy failed", deploy);
    process.exit(1);
  }

  console.log("Preview deployed:", deploy.preview_url);
  console.log(`Wrote ${OUT}`);
  console.log(`Next: npm run verify:jc-premium-burden-v1-preview -- ${deploy.preview_url}`);
}

main();
