/**
 * Native CLI runner — exit code only. stderr warnings never mean failure.
 */
import { spawnSync } from "node:child_process";

export function runNative(command, args, { cwd, env, timeoutMs = 0 } = {}) {
  const r = spawnSync(command, args, {
    cwd,
    env: env ? { ...process.env, ...env } : process.env,
    encoding: "utf8",
    shell: true,
    timeout: timeoutMs > 0 ? timeoutMs : undefined,
  });
  const status = typeof r.status === "number" ? r.status : 1;
  return {
    ok: status === 0,
    status,
    stdout: String(r.stdout || ""),
    stderr: String(r.stderr || ""),
    signal: r.signal || null,
    error: r.error ? String(r.error.message || r.error) : null,
  };
}
