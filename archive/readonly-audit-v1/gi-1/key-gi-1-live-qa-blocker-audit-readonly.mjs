/**
 * KEY-GI-1 — Live QA blocker audit (readonly · no secrets in output).
 *
 * Tom sequence gate:
 *   ① Preview includes GI-1 code (SHA + runtime GK probe)
 *   ② API Key
 *   ③ Live QA → Tom score → Regression → Close
 */
import { readFileSync, existsSync, writeFileSync } from "node:fs";
import { execSync, spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { resolveAnthropicApiKey } from "../server/claudeGroundedExecutionCore.js";
import {
  mintPreviewProbeJwt,
  previewAuthPathFingerprint,
  probePreviewSse,
  resolveJudgmentComposeMode,
  resolvePreviewProbeEnv,
} from "./preview-auth-probe-path.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const FIX = join(ROOT, "fixtures/key-judgment-validation-v1");
const OUT = join(FIX, "key-gi-1-live-qa-blocker-v1-evidence.json");
const START_GATE = join(FIX, "key-gi-1-start-gate-v1-evidence.json");

const GI1_MARKERS = [
  "delegateGeneralKnowledgeChatTurn",
  "general_knowledge_delegation",
  "isGeneralKnowledgeEligible",
  "LIFEGUARD_GI1_SYSTEM_PROMPT",
  "gi1Profile",
];

const GI1_FILES = [
  "server/generalKnowledgeEligibility.js",
  "server/homeAgentTom.js",
  "server/homeBrainFactCore.js",
  "server/lifeguardChatCore.js",
  "server/humanUnderstandingLoop.js",
];

const GK_PROBE_QUESTION = "양자컴퓨터가 뭐야 쉽게";

function loadEnvFile(path, overwrite = false) {
  if (!existsSync(path)) return false;
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq <= 0) continue;
    const k = t.slice(0, eq).trim();
    const v = t.slice(eq + 1).trim().replace(/^['"]|['"]$/g, "");
    if (overwrite || !process.env[k]) process.env[k] = v;
  }
  return true;
}

function gitShortSha(ref = "HEAD") {
  return spawnSync("git", ["rev-parse", "--short", ref], { cwd: ROOT, encoding: "utf8" }).stdout?.trim() ?? null;
}

function gitFullSha(ref = "HEAD") {
  return spawnSync("git", ["rev-parse", ref], { cwd: ROOT, encoding: "utf8" }).stdout?.trim() ?? null;
}

function gitFileMarkers(sha, file) {
  const proc = spawnSync("git", ["show", `${sha}:${file}`], { cwd: ROOT, encoding: "utf8" });
  if (proc.status !== 0) {
    return { file, readable: false, markers: null };
  }
  const src = proc.stdout ?? "";
  const markers = Object.fromEntries(GI1_MARKERS.map((m) => [m, src.includes(m)]));
  return {
    file,
    readable: true,
    markers,
    marker_count: GI1_MARKERS.filter((m) => markers[m]).length,
  };
}

function gi1GitTreeAudit(sha, label) {
  const files = GI1_FILES.map((f) => gitFileMarkers(sha, f));
  const aggregate = Object.fromEntries(
    GI1_MARKERS.map((m) => [m, files.some((f) => f.markers?.[m])]),
  );
  return {
    sha,
    label,
    full_sha: gitFullSha(sha),
    short_sha: gitShortSha(sha),
    files,
    aggregate_markers: aggregate,
    gi1_tree_ready:
      aggregate.delegateGeneralKnowledgeChatTurn &&
      aggregate.isGeneralKnowledgeEligible &&
      aggregate.LIFEGUARD_GI1_SYSTEM_PROMPT,
  };
}

function resolveGi1ImplementationSha() {
  if (existsSync(START_GATE)) {
    try {
      const doc = JSON.parse(readFileSync(START_GATE, "utf8"));
      const short = doc.start_gate_steps?.environment?.head_short ?? null;
      const full = doc.start_gate_steps?.environment?.head_sha ?? null;
      if (short || full) {
        return {
          source: "key-gi-1-start-gate-v1-evidence.json",
          short_sha: short ?? gitShortSha(full),
          full_sha: full ?? gitFullSha(short),
        };
      }
    } catch {
      /* fall through */
    }
  }
  return {
    source: "local HEAD at audit",
    short_sha: gitShortSha("HEAD"),
    full_sha: gitFullSha("HEAD"),
  };
}

function vercelInspectJson(target) {
  try {
    const raw = execSync(`npx vercel inspect ${target} --json`, {
      cwd: ROOT,
      encoding: "utf8",
      timeout: 120000,
      maxBuffer: 16 * 1024 * 1024,
      shell: true,
    });
    const jsonStart = raw.indexOf("{");
    const data = JSON.parse(jsonStart >= 0 ? raw.slice(jsonStart) : raw);
    return { ok: true, target, data };
  } catch (err) {
    return {
      ok: false,
      target,
      error: err instanceof Error ? err.message.slice(0, 300) : String(err),
    };
  }
}

function extractDeploymentMeta(inspectData) {
  const meta = inspectData?.meta ?? {};
  const gitSource = inspectData?.gitSource ?? meta?.githubCommitSha ?? null;
  return {
    deployment_id: inspectData?.id ?? null,
    deployment_url: inspectData?.url ?? inspectData?.target ?? null,
    ready_state: inspectData?.readyState ?? inspectData?.state ?? null,
    github_commit_sha:
      meta?.githubCommitSha ??
      inspectData?.gitSource?.sha ??
      inspectData?.githubCommitSha ??
      null,
    github_commit_ref: meta?.githubCommitRef ?? inspectData?.gitSource?.ref ?? null,
    created_at: inspectData?.createdAt ?? inspectData?.created ?? null,
  };
}

function extractBrainLambda(inspectData) {
  const outputs = inspectData?.builds?.flatMap((b) => b.output ?? []) ?? [];
  const entry = outputs.find((o) => String(o.path ?? "").includes("customer-home-brain-fact"));
  if (!entry) return null;
  return {
    path: entry.path,
    digest: entry.digest ?? null,
    size: entry.size ?? null,
  };
}

function workingTreeVsHeadGi1() {
  const rows = GI1_FILES.map((file) => {
    let disk = "";
    try {
      disk = readFileSync(join(ROOT, file), "utf8");
    } catch {
      return { file, disk_readable: false };
    }
    const proc = spawnSync("git", ["show", `HEAD:${file}`], { cwd: ROOT, encoding: "utf8" });
    const committed = proc.status === 0 ? proc.stdout : "";
    const statusProc = spawnSync("git", ["status", "--porcelain", file], { cwd: ROOT, encoding: "utf8" });
    return {
      file,
      git_status: statusProc.stdout?.trim() || "committed",
      disk_gi1_markers: GI1_MARKERS.filter((m) => disk.includes(m)),
      committed_gi1_markers: committed ? GI1_MARKERS.filter((m) => committed.includes(m)) : [],
      gi1_on_disk_not_on_head:
        GI1_MARKERS.some((m) => disk.includes(m)) &&
        !GI1_MARKERS.some((m) => committed.includes(m)),
    };
  });
  const anyUncommittedGi1 = rows.some((r) => r.gi1_on_disk_not_on_head);
  return {
    head_short: gitShortSha("HEAD"),
    any_uncommitted_gi1_on_disk: anyUncommittedGi1,
    files: rows,
    implication: anyUncommittedGi1
      ? "GI-1 exists in working tree but not in HEAD — Preview deploy cannot include GI-1 until commit+push+deploy"
      : "GI-1 markers aligned between disk and HEAD",
  };
}

function shaAligned(a, b) {
  if (!a || !b) return null;
  const na = String(a).toLowerCase();
  const nb = String(b).toLowerCase();
  if (na === nb) return true;
  if (na.startsWith(nb) || nb.startsWith(na)) return true;
  return false;
}

const PREVIEW_OVERRIDE =
  process.argv.find((a) => a.startsWith("https://"))?.replace(/\/$/, "") ?? null;

loadEnvFile(join(ROOT, ".env.local"));
loadEnvFile(join(ROOT, ".env.preview.pulled"));
if (PREVIEW_OVERRIDE) process.env.PREVIEW_BASE = PREVIEW_OVERRIDE;

const headShort = gitShortSha("HEAD");
const headFull = gitFullSha("HEAD");
const gi1Impl = resolveGi1ImplementationSha();
const headGi1Tree = gi1GitTreeAudit("HEAD", "local_head");
const gi1ImplTree = gi1Impl.short_sha ? gi1GitTreeAudit(gi1Impl.short_sha, "gi1_implementation_ref") : null;

const anthropicKey = resolveAnthropicApiKey(process.env);
const preview = resolvePreviewProbeEnv({ env: process.env });

const blockers = [];
const resolvedBlockers = [];

const workingTreeGi1 = workingTreeVsHeadGi1();

const checks = {
  anthropic_api_key: {
    set: Boolean(anthropicKey),
    source: anthropicKey
      ? process.env.ANTHROPIC_API_KEY
        ? "ANTHROPIC_API_KEY"
        : "CLAUDE_API_KEY"
      : null,
  },
  preview_base: {
    set: Boolean(preview.previewBase),
    host: preview.previewBase ? new URL(preview.previewBase).host : null,
  },
  bypass_secret: { set: Boolean(preview.bypass) },
  supabase: { url_set: Boolean(preview.supabaseUrl), anon_set: Boolean(preview.supabaseAnon) },
  qa_creds: {
    email_set: Boolean(preview.email),
    password_set: Boolean(preview.password),
    email_domain: preview.email?.includes("@") ? preview.email.split("@")[1] : null,
  },
  sha_triangulation: {
    head_sha: { short: headShort, full: headFull },
    gi1_implementation_sha: gi1Impl,
    preview_deployment_sha: null,
    head_matches_gi1_ref: shaAligned(headShort, gi1Impl.short_sha),
    preview_matches_head: null,
    preview_matches_gi1_ref: null,
    vercel_inspect_git_sha_limitation:
      "Vercel CLI inspect may omit githubCommitSha — runtime GK probe + lambda digest are co-gates",
  },
  gi1_git_tree: {
    head: headGi1Tree,
    gi1_implementation_ref: gi1ImplTree,
  },
  gi1_working_tree_vs_head: workingTreeGi1,
};

if (!anthropicKey) {
  blockers.push({
    id: "API_KEY",
    label: "ANTHROPIC_API_KEY missing in local env",
    owner: "ops/Tom",
    resolution: "Bind ANTHROPIC_API_KEY · then npm run exec:key-gi-1-qa-quality-audit-direct (or preview after GI-1 deploy confirmed)",
  });
}

if (!preview.previewBase) {
  blockers.push({ id: "EXEC_ENV", label: "PREVIEW_BASE missing" });
}
if (!preview.bypass) {
  blockers.push({ id: "EXEC_ENV", label: "VERCEL_AUTOMATION_BYPASS_SECRET missing" });
}

let previewInspect = null;
if (preview.previewBase) {
  previewInspect = vercelInspectJson(preview.previewBase);
  if (previewInspect.ok) {
    const meta = extractDeploymentMeta(previewInspect.data);
    const brain = extractBrainLambda(previewInspect.data);
    checks.preview_deployment = { ...meta, brain_lambda: brain };
    checks.sha_triangulation.preview_deployment_sha = {
      github_commit_sha: meta.github_commit_sha,
      github_commit_ref: meta.github_commit_ref,
      deployment_id: meta.deployment_id,
      brain_lambda_digest: brain?.digest ?? null,
    };
    if (meta.github_commit_sha) {
      checks.sha_triangulation.preview_matches_head = shaAligned(meta.github_commit_sha, headFull);
      checks.sha_triangulation.preview_matches_gi1_ref = shaAligned(
        meta.github_commit_sha,
        gi1Impl.full_sha,
      );
      const previewGi1Tree = gi1GitTreeAudit(meta.github_commit_sha, "preview_deployment_git");
      checks.gi1_git_tree.preview_deployment = previewGi1Tree;
    }
  } else {
    checks.preview_deployment = { inspect_ok: false, error: previewInspect.error };
  }
}

let qaJwt = null;
try {
  qaJwt = await mintPreviewProbeJwt(preview);
  checks.qa_jwt = { ok: true };
  if (!blockers.some((b) => b.id === "AUTH")) {
    resolvedBlockers.push({
      id: "AUTH",
      label: "Preview auth path OK (QA JWT + bypass)",
      resolved_at: new Date().toISOString(),
    });
  }
} catch (err) {
  checks.qa_jwt = { ok: false, error: err.message };
  blockers.push({ id: "AUTH", label: `QA JWT mint failed: ${err.message}` });
}

if (qaJwt && preview.previewBase) {
  const sseProbe = await probePreviewSse({
    previewBase: preview.previewBase,
    question: "파리는 어느 나라 수도야?",
    token: qaJwt,
    bypassSecret: preview.bypass,
  });
  checks.preview_sse_auth = {
    probe_ok: sseProbe.probe_ok,
    http_status: sseProbe.http_status ?? null,
    unauthorized: sseProbe.unauthorized === true,
  };
  if (!sseProbe.probe_ok) {
    if (sseProbe.unauthorized) {
      blockers.push({ id: "AUTH", label: "Preview SSE UNAUTHORIZED" });
    } else {
      blockers.push({
        id: "EXEC_ENV",
        label: `Preview SSE failed: ${sseProbe.probe_error ?? sseProbe.http_status ?? "unknown"}`,
      });
    }
  }

  const gkProbe = await probePreviewSse({
    previewBase: preview.previewBase,
    question: GK_PROBE_QUESTION,
    token: qaJwt,
    bypassSecret: preview.bypass,
  });
  const composeMode = gkProbe.probe_ok ? resolveJudgmentComposeMode(gkProbe.done ?? {}) : null;
  checks.gi1_runtime_probe = {
    question: GK_PROBE_QUESTION,
    probe_ok: gkProbe.probe_ok,
    compose_mode: composeMode,
    general_knowledge_delegation: composeMode === "general_knowledge_delegation",
    response_source: gkProbe.done?.responseSource ?? gkProbe.done?.response_source ?? null,
    answer_preview: gkProbe.probe_ok
      ? String(gkProbe.done?.answerText ?? gkProbe.done?.answer_text ?? "").slice(0, 120)
      : gkProbe.probe_error ?? null,
  };

  const gi1OnPreview =
    checks.gi1_runtime_probe.general_knowledge_delegation === true ||
    checks.sha_triangulation.preview_matches_gi1_ref === true ||
    checks.gi1_git_tree.preview_deployment?.gi1_tree_ready === true;

  checks.gi1_preview_includes_code = {
    confirmed: gi1OnPreview === true,
    method: [
      "runtime compose_mode === general_knowledge_delegation",
      "vercel inspect githubCommitSha vs GI-1 ref",
      "git tree GI-1 markers at preview deployment sha",
    ],
    verdict: gi1OnPreview
      ? "Preview appears to include GI-1"
      : "Preview does NOT include GI-1 (or SHA unverified + runtime routing wrong)",
  };

  if (!gi1OnPreview) {
    const uncommitted = workingTreeGi1.any_uncommitted_gi1_on_disk;
    blockers.push({
      id: "GI-1_PREVIEW",
      label: uncommitted
        ? "GI-1 on disk but not in HEAD commit — Preview cannot include GI-1 until commit+push+deploy"
        : "Live QA Preview does not include GI-1 code (SHA mismatch or GK delegation 0/1)",
      owner: "ops/Jerry",
      resolution: uncommitted
        ? "Commit+push GI-1 files · deploy Preview · re-run audit:key-gi-1-live-qa-blocker until runtime compose_mode=general_knowledge_delegation"
        : "Deploy Preview from HEAD with GI-1 · verify SHA triangulation · re-run npm run audit:key-gi-1-live-qa-blocker",
      evidence: {
        runtime_compose_mode: composeMode,
        preview_github_sha: checks.sha_triangulation.preview_deployment_sha?.github_commit_sha ?? null,
        head_short: headShort,
        gi1_ref_short: gi1Impl.short_sha,
        gi1_uncommitted_on_disk: uncommitted,
      },
    });
  } else {
    resolvedBlockers.push({
      id: "GI-1_PREVIEW",
      label: "Preview includes GI-1 (runtime and/or SHA gate)",
      resolved_at: new Date().toISOString(),
    });
  }
}

const blockerChecklist = {
  AUTH: blockers.some((b) => b.id === "AUTH"),
  API_KEY: blockers.some((b) => b.id === "API_KEY"),
  GI1_PREVIEW: blockers.some((b) => b.id === "GI-1_PREVIEW"),
  EXEC_ENV: blockers.some((b) => b.id === "EXEC_ENV"),
};

const uniqueBlockerIds = [...new Set(blockers.map((b) => b.id))];
const evidence = {
  document: "key_gi_1_live_qa_blocker_v1_evidence",
  slice: "KEY-GI-1",
  phase: "GI1-QA-BLOCKER",
  mode: "Blocker audit — not GO wait",
  status: blockers.length ? "blocked" : "ready_for_live_qa",
  version: "1.2.0",
  observed_at: new Date().toISOString(),
  pass_declaration: "none",
  tom_correction: "Blockers = API_KEY + GI-1_PREVIEW (not API_KEY alone until SHA/runtime confirmed)",
  management: {
    principle: "대기가 아니라 Blocker 제거",
    blocker_checklist: blockerChecklist,
    when_cleared_sequence: [
      "1. Preview에 GI-1 코드(SHA) 포함 확인",
      "2. ANTHROPIC_API_KEY 확인",
      "3. Live QA 20문항",
      "4. Tom 채점 (avg >= 4.5)",
      "5. Regression ~110",
      "6. GI-1 Close",
    ],
    current_state: {
      AUTH: !blockerChecklist.AUTH,
      PREVIEW_URL: Boolean(checks.preview_base.set),
      API_KEY: !blockerChecklist.API_KEY,
      GI1_PREVIEW: !blockerChecklist.GI1_PREVIEW,
    },
  },
  blockers,
  resolved_blockers: resolvedBlockers,
  blocker_ids: uniqueBlockerIds,
  checks,
  preview_auth_fingerprint: previewAuthPathFingerprint(preview),
  exec_commands: {
    blocker_audit: "npm run audit:key-gi-1-live-qa-blocker",
    blocker_audit_fresh_preview: "npm run audit:key-gi-1-live-qa-blocker -- <preview-url>",
    local_direct: "npm run exec:key-gi-1-qa-quality-audit-direct",
    preview_live_qa: "npm run exec:key-gi-1-qa-quality-audit-preview -- <gi-1-preview-url>",
  },
  jerry: uniqueBlockerIds.length
    ? `Blocked: ${uniqueBlockerIds.join(" + ")} — resolve before Live QA`
    : "All blockers clear — run Live QA immediately",
};

writeFileSync(OUT, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
console.log(
  JSON.stringify(
    {
      status: evidence.status,
      blocker_ids: uniqueBlockerIds,
      gi1_preview_confirmed: checks.gi1_preview_includes_code?.confirmed ?? null,
      out: OUT,
    },
    null,
    2,
  ),
);
