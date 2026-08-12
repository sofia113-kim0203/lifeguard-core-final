import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { runNative } from "./native.mjs";
import {
  EXPECTED_PROJECT,
  PRODUCTION_ALIAS,
  resolveAuth,
  resolveBypass,
} from "./env.mjs";

function fail(layer, firstBreak, extra = {}) {
  return {
    PREFLIGHT: "FAIL",
    LAYER: layer,
    FIRST_BREAK: firstBreak,
    FAIL_DOMAIN: "HARNESS",
    PRODUCT_TEST: "NOT_STARTED",
    ...extra,
  };
}

function hold(layer, firstBreak, extra = {}) {
  return {
    PREFLIGHT: "HOLD",
    LAYER: layer,
    FIRST_BREAK: firstBreak,
    FAIL_DOMAIN: "HARNESS",
    PRODUCT_TEST: "NOT_STARTED",
    ...extra,
  };
}

export function runPreflight({
  repoRoot,
  target,
  sourceSha,
  url,
  deploymentId,
  resumeFrom,
  requireDeployMeta = false,
}) {
  const checks = [];

  // BROWSER — playwright resolvable
  const require = createRequire(import.meta.url);
  let browserOk = false;
  try {
    require.resolve("playwright", { paths: [repoRoot, process.cwd()] });
    browserOk = true;
  } catch {
    browserOk = false;
  }
  checks.push({ name: "BROWSER", ok: browserOk });
  if (!browserOk) {
    return fail("BROWSER", "PLAYWRIGHT_MISSING", { checks });
  }

  // PROJECT lock (documentation; deploy path re-checks .vercel/project.json)
  checks.push({ name: "PROJECT", ok: true, expected: EXPECTED_PROJECT });

  const t = String(target || "").toLowerCase();
  if (t !== "preview" && t !== "production") {
    return fail("TARGET", "TARGET_INVALID", { checks, target: t });
  }
  checks.push({ name: "TARGET", ok: true, value: t });

  const sha = String(sourceSha || "").trim();
  if (!/^[0-9a-f]{7,40}$/i.test(sha)) {
    return fail("SOURCE_SHA", "SOURCE_SHA_MISSING", { checks });
  }
  checks.push({ name: "SOURCE_SHA", ok: true, value: sha });

  // WORKTREE — for seat-only we only require repo path exists
  if (!existsSync(join(repoRoot, "package.json"))) {
    return fail("WORKTREE", "REPO_ROOT_INVALID", { checks });
  }
  checks.push({ name: "WORKTREE", ok: true });

  const auth = resolveAuth(t);
  const credPresent = Boolean(auth.email && auth.password);
  checks.push({
    name: "AUTH_CREDENTIAL_PRESENT",
    ok: credPresent,
    emailKey: auth.emailKey,
    passwordKey: auth.passwordKey,
  });
  if (!credPresent) {
    // Tom lock: fixed Production QA is prerequisite — HOLD not product FAIL
    return hold("AUTH", "FIXED_QA_ABSENT", {
      checks,
      required: `${auth.emailKey}+${auth.passwordKey}`,
      note:
        t === "production"
          ? "PROD_QA_* fixed seat required; signup-on-the-fly forbidden"
          : "QA_* required for Preview; no Production credential fallback",
    });
  }

  const bypass = resolveBypass();
  checks.push({ name: "BYPASS", ok: Boolean(bypass) });
  if (!bypass) {
    return hold("AUTH", "BYPASS_ABSENT", { checks });
  }

  let seatUrl = String(url || "").trim().replace(/\/$/, "");
  if (!seatUrl) {
    return fail("TARGET", "URL_MISSING", { checks });
  }
  if (t === "production") {
    if (seatUrl !== PRODUCTION_ALIAS && !seatUrl.includes("preview.lifeguardkey.ai")) {
      return fail("TARGET", "PRODUCTION_URL_MISMATCH", {
        checks,
        url: seatUrl,
        expected: PRODUCTION_ALIAS,
      });
    }
  } else {
    if (seatUrl.includes("preview.lifeguardkey.ai")) {
      return fail("TARGET", "PREVIEW_MUST_NOT_USE_PRODUCTION_ALIAS", {
        checks,
        url: seatUrl,
      });
    }
  }
  checks.push({ name: "URL", ok: true, value: seatUrl });

  if (requireDeployMeta || resumeFrom === "seat") {
    const dpl = String(deploymentId || "").trim();
    if (!dpl.startsWith("dpl_")) {
      return hold("DEPLOY", "DEPLOYMENT_ID_MISSING", {
        checks,
        note: "Seat resume requires known deployment id; redeploy or pass --deployment-id",
      });
    }
    checks.push({ name: "DEPLOYMENT_ID", ok: true, value: dpl });
  }

  // LOGIN/COMPOSER are verified live in seat-engine before first question.
  return {
    PREFLIGHT: "PASS",
    FAIL_DOMAIN: null,
    PRODUCT_TEST: "READY",
    auth,
    bypass,
    url: seatUrl,
    checks,
  };
}

export function ensurePlaywright(repoRoot) {
  const require = createRequire(import.meta.url);
  try {
    return {
      ok: true,
      path: require.resolve("playwright", { paths: [repoRoot, process.cwd()] }),
    };
  } catch {
    const r = runNative(
      "npm",
      ["install", "--no-save", "--no-package-lock", "playwright@1.54.2"],
      { cwd: repoRoot },
    );
    if (!r.ok) {
      return { ok: false, error: "PLAYWRIGHT_INSTALL_FAILED", detail: r.stderr };
    }
    try {
      return {
        ok: true,
        path: require.resolve("playwright", { paths: [repoRoot] }),
      };
    } catch (e) {
      return { ok: false, error: "PLAYWRIGHT_RESOLVE_FAILED", detail: String(e) };
    }
  }
}
