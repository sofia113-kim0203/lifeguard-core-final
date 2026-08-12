import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export const PRODUCTION_ALIAS = "https://preview.lifeguardkey.ai";
export const EXPECTED_PROJECT = "lifeguard-core-final";
export const VERCEL_SCOPE = "70sofia113-1918s-projects";
export const VERCEL_PROJECT_JSON = {
  projectId: "prj_1TzEFOqbjFt3S6asgf0f7ChAjx4y",
  orgId: "team_LICcIVWRaJx3UzyA9X6uLdQg",
};

export function loadEnvLocal(repoRoot) {
  const path = join(repoRoot, ".env.local");
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i <= 0) continue;
    const k = t.slice(0, i).trim();
    const v = t.slice(i + 1).trim().replace(/^['"]|['"]$/g, "");
    if (!process.env[k]) process.env[k] = v;
  }
}

/** Import User-scope env on Windows into process.env if missing. */
export function importUserEnv(names) {
  // Node cannot read Windows User env registry portably; PowerShell wrapper sets them.
  // Keep API for clarity; values already in process.env win.
  for (const name of names) {
    if (process.env[name]) continue;
  }
}

export function resolveBypass() {
  return (
    process.env.VERCEL_AUTOMATION_BYPASS_SECRET ||
    process.env.VERCEL_PROTECTION_BYPASS ||
    process.env.A2_TRIAL3_HG_BYPASS_SECRET ||
    ""
  ).trim();
}

/**
 * Auth routing lock:
 * Preview → QA_* only
 * Production → PROD_QA_* only (fixed seat; no signup, no staging fallback)
 */
export function resolveAuth(target) {
  const t = String(target || "").toLowerCase();
  if (t === "production") {
    return {
      target: "production",
      emailKey: "PROD_QA_EMAIL",
      passwordKey: "PROD_QA_PASSWORD",
      email: String(process.env.PROD_QA_EMAIL || "").trim(),
      password: String(process.env.PROD_QA_PASSWORD || ""),
      allowSignup: false,
      forbidFallbackKeys: ["QA_EMAIL", "QA_PASSWORD", "QA_TEST_EMAIL", "QA_TEST_PASSWORD"],
    };
  }
  return {
    target: "preview",
    emailKey: "QA_EMAIL",
    passwordKey: "QA_PASSWORD",
    email: String(process.env.QA_EMAIL || "").trim(),
    password: String(process.env.QA_PASSWORD || ""),
    allowSignup: false,
    forbidFallbackKeys: ["PROD_QA_EMAIL", "PROD_QA_PASSWORD"],
  };
}

export function bypassEntryUrl(base, secret) {
  const u = new URL(base);
  u.searchParams.set("x-vercel-protection-bypass", secret);
  u.searchParams.set("x-vercel-set-bypass-cookie", "true");
  return u.toString();
}

export function defaultUrlForTarget(target) {
  if (String(target).toLowerCase() === "production") return PRODUCTION_ALIAS;
  return String(process.env.OKF_PREVIEW_URL || process.env.PREVIEW_URL || "").trim();
}
