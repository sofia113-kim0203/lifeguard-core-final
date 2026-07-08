/**
 * S7-a Borrowed Senses — Preview deploy ONLY (no env file read · no Vercel env upsert).
 *
 * Usage:
 *   node scripts/key-borrowed-senses-preview-deploy.mjs <worktree-path> [--expect-commit <full-sha>]
 *
 * Success stdout (JSON): { ok, preview_url, deployment_id, git_commit }
 * Failure stdout (JSON): { ok: false, step, exit_code }
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";

const TEAM = "70sofia113-1918s-projects";

function git(cwd, args) {
  const proc = spawnSync("git", args, { cwd, encoding: "utf8", shell: true });
  return {
    ok: proc.status === 0,
    out: String(proc.stdout ?? "").trim(),
    exit_code: proc.status ?? 1,
  };
}

function parseArgs(argv) {
  const positional = [];
  let expectCommit = null;
  for (let i = 2; i < argv.length; i += 1) {
    if (argv[i] === "--expect-commit") {
      expectCommit = argv[i + 1] ?? null;
      i += 1;
      continue;
    }
    positional.push(argv[i]);
  }
  return { worktree: positional[0] ?? "", expectCommit };
}

function deployPreview(cwd) {
  const proc = spawnSync("npx", ["vercel", "deploy", "--yes", "--scope", TEAM], {
    cwd,
    encoding: "utf8",
    shell: true,
    maxBuffer: 16 * 1024 * 1024,
    timeout: 600000,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const text = `${proc.stdout ?? ""}\n${proc.stderr ?? ""}`;
  const urls = text.match(/https:\/\/lifeguard-core-final[^\s]+/g) ?? [];
  return {
    ok: proc.status === 0,
    exit_code: proc.status ?? 1,
    preview_url: urls[urls.length - 1] ?? null,
    deployment_id: text.match(/dpl_[A-Za-z0-9]+/)?.[0] ?? null,
  };
}

function fail(step, exitCode = 1) {
  console.log(JSON.stringify({ ok: false, step, exit_code: exitCode }));
  process.exit(exitCode);
}

function main() {
  const { worktree, expectCommit } = parseArgs(process.argv);

  if (!worktree || !existsSync(worktree)) {
    fail("worktree_missing");
  }

  const head = git(worktree, ["rev-parse", "HEAD"]);
  if (!head.ok || !head.out) {
    fail("git_rev_parse_failed", head.exit_code);
  }

  if (expectCommit && head.out !== expectCommit) {
    fail("head_mismatch");
  }

  const status = git(worktree, ["status", "--short"]);
  if (status.out) {
    fail("worktree_not_clean");
  }

  const deploy = deployPreview(worktree);
  if (!deploy.ok || !deploy.preview_url) {
    fail("deploy_failed", deploy.exit_code);
  }

  console.log(
    JSON.stringify({
      ok: true,
      preview_url: deploy.preview_url,
      deployment_id: deploy.deployment_id,
      git_commit: head.out,
    }),
  );
}

main();
