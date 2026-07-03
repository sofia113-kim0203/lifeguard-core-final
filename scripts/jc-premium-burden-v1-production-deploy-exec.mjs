/**
 * Slice 1 — JC-PREMIUM-BURDEN-v1 Production deploy ONLY (Tom GO gated).
 *
 * Flow (after Tom audit): --tom-go → deploy prod → deploy evidence
 * Production verification is a separate command (30Q regression).
 *
 * Usage:
 *   node scripts/jc-premium-burden-v1-production-deploy-exec.mjs --tom-go
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const FIX = join(ROOT, "fixtures/key-judgment-validation-v1");
const OUT = join(FIX, "jc-premium-burden-v1-slice-production-deploy-evidence.json");

const TOM_GO = process.argv.includes("--tom-go");

function gitShortSha() {
  return spawnSync("git", ["rev-parse", "--short", "HEAD"], { cwd: ROOT, encoding: "utf8" }).stdout?.trim() ?? null;
}

function deployProduction() {
  const proc = spawnSync("npx vercel deploy --prod --yes", {
    cwd: ROOT,
    encoding: "utf8",
    shell: true,
    maxBuffer: 16 * 1024 * 1024,
    timeout: 600000,
  });
  const text = `${proc.stdout ?? ""}\n${proc.stderr ?? ""}`;
  const urls = text.match(/https:\/\/[^\s]+/g) ?? [];
  return {
    ok: proc.status === 0,
    exit_code: proc.status,
    production_url: urls.find((u) => u.includes("lifeguard-core-final")) ?? urls[urls.length - 1] ?? null,
    log_tail: text.slice(-1200),
  };
}

function main() {
  if (!TOM_GO) {
    console.error("HOLD — Production deploy requires Tom GO.");
    console.error("After Preview evidence passes Tom audit, run:");
    console.error("  node scripts/jc-premium-burden-v1-production-deploy-exec.mjs --tom-go");
    console.error("Then verify separately:");
    console.error("  npm run regression:lv5-production-30q");
    process.exit(2);
  }

  mkdirSync(FIX, { recursive: true });
  const deploy = deployProduction();

  const evidence = {
    document: "jc_premium_burden_v1_slice_production_deploy_evidence",
    slice: "SLICE-1-JC-PREMIUM-BURDEN-v1",
    mode: "Production deploy only · Tom GO acknowledged",
    pass_declaration: "none — run Production verification separately",
    observed_at: new Date().toISOString(),
    git_short_sha: gitShortSha(),
    tom_go_flag: true,
    deploy,
    next_step: "npm run regression:lv5-production-30q",
    tom_note: "Deploy and Production verification are separate buttons",
  };

  writeFileSync(OUT, JSON.stringify(evidence, null, 2));

  if (!deploy.ok) {
    console.error("Production deploy failed", deploy);
    process.exit(1);
  }

  console.log("Production deployed:", deploy.production_url ?? "see log");
  console.log(`Wrote ${OUT}`);
  console.log("Next: npm run regression:lv5-production-30q");
}

main();
