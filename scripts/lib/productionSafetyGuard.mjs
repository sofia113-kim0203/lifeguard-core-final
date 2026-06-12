/**
 * Blocks verification scripts from mutating production auth.users or creating ghost test accounts.
 */
import { readFileSync, existsSync } from "node:fs";

export const PRODUCTION_SUPABASE_HOSTS = new Set([
  "fhvlxcguvjvtftttfrix.supabase.co",
]);

export const ALLOWED_TEST_SUPABASE_ENVS = new Set(["local", "test"]);

const BLOCK_PREFIX = "PRODUCTION_SAFETY_GUARD";

export function loadEnvLocal(path = ".env.local") {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const idx = trimmed.indexOf("=");
    if (idx <= 0) continue;
    const key = trimmed.slice(0, idx).trim();
    if (!process.env[key]) process.env[key] = trimmed.slice(idx + 1).trim();
  }
}

export function resolveSupabaseUrl() {
  return process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL ?? "";
}

export function resolveSupabaseHost(url = resolveSupabaseUrl()) {
  try {
    return new URL(url).host.toLowerCase();
  } catch {
    return "";
  }
}

export function resolveSupabaseEnv() {
  return String(process.env.SUPABASE_ENV ?? "").trim().toLowerCase();
}

export function isExampleTestEmail(email) {
  return /@example\.com$/i.test(String(email ?? "").trim());
}

export function isProductionSupabaseUrl(url = resolveSupabaseUrl()) {
  const host = resolveSupabaseHost(url);
  if (PRODUCTION_SUPABASE_HOSTS.has(host)) return true;
  const env = resolveSupabaseEnv();
  return env === "production" || env === "prod";
}

function exitBlocked(scriptName, reason) {
  console.error(`${BLOCK_PREFIX} [${scriptName}] BLOCKED: ${reason}`);
  process.exit(1);
}

/**
 * Call at script startup (after loadEnvLocal).
 * @param {object} options
 * @param {string} options.scriptName
 * @param {boolean} [options.createsTestAccount=false]
 * @param {string|null} [options.plannedTestEmail=null]
 * @param {boolean} [options.usesServiceRoleAuthAdmin=false]
 */
export function assertSafeTestScriptExecution({
  scriptName,
  createsTestAccount = false,
  plannedTestEmail = null,
  usesServiceRoleAuthAdmin = false,
} = {}) {
  if (!scriptName) {
    exitBlocked("unknown", "scriptName is required");
  }

  const url = resolveSupabaseUrl();
  const host = resolveSupabaseHost(url);
  const supabaseEnv = resolveSupabaseEnv();

  if (!url) {
    exitBlocked(scriptName, "Supabase URL is missing (VITE_SUPABASE_URL / SUPABASE_URL).");
  }

  if (isProductionSupabaseUrl(url)) {
    exitBlocked(
      scriptName,
      `Production Supabase is not allowed for verification scripts (host=${host}). Use a local/test project via .env.test.local and SUPABASE_ENV=local.`,
    );
  }

  if (usesServiceRoleAuthAdmin && isProductionSupabaseUrl(url)) {
    exitBlocked(
      scriptName,
      "SERVICE_ROLE auth.users mutation is forbidden on production Supabase.",
    );
  }

  if (createsTestAccount) {
    if (!ALLOWED_TEST_SUPABASE_ENVS.has(supabaseEnv)) {
      exitBlocked(
        scriptName,
        `Test account creation requires SUPABASE_ENV=local|test (current: "${supabaseEnv || "(unset)"}").`,
      );
    }
  }

  if (plannedTestEmail && isExampleTestEmail(plannedTestEmail) && isProductionSupabaseUrl(url)) {
    exitBlocked(scriptName, "@example.com test accounts are forbidden on production.");
  }
}

/** Call immediately before auth.signUp / auth.admin.createUser. */
export function assertBeforeTestSignUp(email, scriptName) {
  assertSafeTestScriptExecution({
    scriptName,
    createsTestAccount: true,
    plannedTestEmail: email,
  });

  if (isExampleTestEmail(email) && isProductionSupabaseUrl()) {
    exitBlocked(scriptName, "@example.com test accounts are forbidden on production.");
  }
}

/** Call before auth.admin.createUser / deleteUser with service role. */
export function assertNoProductionServiceRoleAuthMutation(scriptName) {
  if (isProductionSupabaseUrl()) {
    exitBlocked(
      scriptName,
      "SERVICE_ROLE auth.users mutation is forbidden on production Supabase.",
    );
  }
}
