/**
 * P10-5 — Preview SSE helpers (fetch+bypass primary; vercel curl fallback).
 */
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

export function resolveBypassSecret(env = process.env) {
  return String(env.VERCEL_AUTOMATION_BYPASS_SECRET ?? "").trim() || null;
}

export function redactProbeText(text = "") {
  return String(text)
    .replace(/Bearer\s+\S+/gi, "Bearer [REDACTED]")
    .replace(/x-vercel-protection-bypass:\s*\S+/gi, "x-vercel-protection-bypass:[REDACTED]")
    .replace(/VERCEL_AUTOMATION_BYPASS_SECRET[=:\s]\S+/gi, "VERCEL_AUTOMATION_BYPASS_SECRET=[REDACTED]")
    .replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, "[JWT_REDACTED]");
}

/** Primary P10-5 path — Node fetch + bypass header + QA JWT (Windows-safe JSON body). */
export async function fetchBypassSse({
  previewBase,
  token,
  question,
  history = [],
  threadPublicCitations = null,
  threadVerifiedFactRefs = null,
  threadHandoffMemo = null,
  sessionId = null,
  presence = false,
  bypassSecret = null,
  env = process.env,
}) {
  const bypass = bypassSecret ?? resolveBypassSecret(env);
  if (!bypass) {
    return {
      ok: false,
      exit_code: 2,
      stdout: "",
      stderr_preview: "VERCEL_AUTOMATION_BYPASS_SECRET missing",
      spawn_error: null,
      method: "fetch + x-vercel-protection-bypass + JWT",
      http_status: null,
    };
  }

  const baseUrl = `${String(previewBase).replace(/\/$/, "")}/api/customer-home-brain-fact`;
  const url = baseUrl;
  const body = JSON.stringify({
    question,
    history,
    stream: true,
    ...(Array.isArray(threadPublicCitations) && threadPublicCitations.length
      ? { thread_public_citations: threadPublicCitations }
      : {}),
    ...(Array.isArray(threadVerifiedFactRefs) && threadVerifiedFactRefs.length
      ? { thread_verified_fact_refs: threadVerifiedFactRefs }
      : {}),
    ...(threadHandoffMemo && typeof threadHandoffMemo === "object"
      ? { thread_handoff_memo: threadHandoffMemo }
      : {}),
    ...(sessionId ? { session_id: sessionId } : {}),
    ...(presence === true ? { presence: true, question: "" } : {}),
  });

  let httpStatus = null;
  let stdout = "";
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "text/event-stream",
        Authorization: `Bearer ${token}`,
        "x-vercel-protection-bypass": bypass,
      },
      body,
    });
    httpStatus = res.status;
    stdout = await res.text();
  } catch (err) {
    return {
      ok: false,
      exit_code: 1,
      stdout: "",
      stderr_preview: err instanceof Error ? err.message : String(err),
      spawn_error: null,
      method: "fetch + x-vercel-protection-bypass + JWT",
      http_status: null,
    };
  }

  const unauthorized = /UNAUTHORIZED/.test(stdout) || httpStatus === 401;
  const invalidJson = /Invalid JSON|Expected property name/.test(stdout);
  const hasEvent = stdout.includes("event:");
  const ok = httpStatus === 200 && hasEvent && !unauthorized && !invalidJson;

  return {
    ok,
    exit_code: ok ? 0 : 1,
    stdout,
    stderr_preview: "",
    spawn_error: null,
    method: "fetch + x-vercel-protection-bypass + JWT",
    http_status: httpStatus,
    unauthorized,
    invalid_json: invalidJson,
  };
}

/** Fallback — vercel curl (Windows JSON quoting may fail). */
export function vercelCurlSse({
  previewBase,
  token,
  question,
  history = [],
  env = process.env,
}) {
  const body = JSON.stringify({ question, history, stream: true });
  const runEnv = { ...env };
  delete runEnv.DEBUG;
  delete runEnv.VERCEL_DEBUG;

  const workDir = mkdtempSync(join(tmpdir(), "p10-5-vcurl-"));
  const bodyPath = join(workDir, "body.json");
  const headersPath = join(workDir, "headers.txt");
  writeFileSync(bodyPath, body, "utf8");
  writeFileSync(
    headersPath,
    [
      "Content-Type: application/json",
      "Accept: text/event-stream",
      `Authorization: Bearer ${token}`,
    ].join("\n"),
    "utf8",
  );

  const args = [
    "vercel",
    "curl",
    "/api/customer-home-brain-fact",
    "--deployment",
    String(previewBase).replace(/\/$/, ""),
    "--yes",
    "--",
    "--request",
    "POST",
    "--header",
    `@${headersPath}`,
    "--data-binary",
    `@${bodyPath}`,
  ];

  const proc = spawnSync("npx", args, {
    encoding: "utf8",
    maxBuffer: 30 * 1024 * 1024,
    shell: true,
    env: runEnv,
  });

  const stdout = proc.stdout ?? "";
  const stderr = String(proc.stderr ?? "");
  const protectionBlocked = /Authentication Required|x-vercel-protection-bypass/i.test(
    `${stdout}${stderr}`,
  );
  const ok = stdout.includes("event:") && !protectionBlocked;

  return {
    ok,
    exit_code: proc.status ?? 1,
    stdout,
    stderr_preview: redactProbeText(stderr).slice(0, 500),
    spawn_error: proc.error?.message ?? null,
    method: "npx vercel curl -d JSON (spawnSync)",
    protection_blocked: protectionBlocked,
  };
}

export function parseSse(raw = "") {
  const events = [];
  for (const block of String(raw).split("\n\n")) {
    if (!block.trim() || !block.includes("data:")) continue;
    let event = "message";
    const dataLines = [];
    for (const line of block.split("\n")) {
      if (line.startsWith("event:")) event = line.slice(6).trim();
      if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
    }
    if (!dataLines.length) continue;
    try {
      events.push({ type: event, data: JSON.parse(dataLines.join("\n")) });
    } catch {
      events.push({ type: event, data: { raw: dataLines.join("\n") } });
    }
  }
  return events;
}

/** Prior P10-2 probes used customer_profiles.id (not auth.users.id). */
export const KNOWN_ALLOWLIST_TARGET = "a247a66f-a597-4ccf-9530-761b82518002";

export function buildAllowlistAudit({
  qaCustomerId = null,
  qaCustomerProfileId = null,
  trace = null,
} = {}) {
  const allowlistActive = trace?.key_eligibility?.allowlist_active === true;
  const customerInAllowlist = trace?.key_eligibility?.customer_in_allowlist ?? null;
  const keyEnvEnabled = trace?.key_eligibility?.key_env_enabled === true;
  const skipReasons = trace?.key_eligibility?.skip_reasons ?? [];

  const keyCustomerId = qaCustomerProfileId ?? qaCustomerId;
  const qaMatchesKnownTarget = keyCustomerId === KNOWN_ALLOWLIST_TARGET;

  const allowlistMismatch =
    (allowlistActive === true && customerInAllowlist === false) ||
    skipReasons.includes("customer_not_in_key_allowlist");

  let classification = "unknown";
  if (!keyCustomerId) {
    classification = "qa_customer_unknown";
  } else if (allowlistMismatch) {
    classification = "config_mismatch_allowlist";
  } else if (trace && !keyEnvEnabled) {
    classification = "config_mismatch_key_env_off";
  } else {
    classification = "allowlist_ok_or_inactive";
  }

  return {
    qa_auth_user_id: qaCustomerId ?? null,
    qa_customer_profile_id: qaCustomerProfileId ?? null,
    key_customer_id_used: keyCustomerId,
    known_allowlist_target: KNOWN_ALLOWLIST_TARGET,
    qa_matches_known_allowlist_target: qaMatchesKnownTarget,
    allowlist_active: allowlistActive,
    customer_in_allowlist: customerInAllowlist,
    key_env_enabled: keyEnvEnabled,
    skip_reasons: skipReasons,
    allowlist_mismatch: allowlistMismatch,
    classification,
    note: allowlistMismatch
      ? "KEY non-entry due to allowlist/config mismatch — not a runtime KEY failure"
      : qaMatchesKnownTarget
        ? "customer_profile_id matches known allowlist target"
        : null,
  };
}

export function classifyKeyRouteOutcome({ probeOk, keyRoute, allowlistAudit, trace = null }) {
  if (!probeOk) return "probe_failed";
  if (keyRoute?.key_route_observed) return "key_route_observed";
  if (allowlistAudit?.classification === "config_mismatch_allowlist") return "config_mismatch_allowlist";
  if (allowlistAudit?.classification === "config_mismatch_key_env_off") return "config_mismatch_key_env_off";
  if (trace?.key_eligibility?.skip_reasons?.includes("customer_not_in_key_allowlist")) {
    return "config_mismatch_allowlist";
  }
  return "legacy_or_non_key_route";
}
