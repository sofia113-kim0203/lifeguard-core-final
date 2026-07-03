/**
 * Slice 1 — JC-PREMIUM-BURDEN-v1 Production verification (Tom GO · no PASS).
 * Auth: Production PRODUCTION_PROBE_* + Management API anon (lv5 path).
 */
import { spawnSync, execSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import { parseSse } from "./p10-5-preview-curl-helper.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const FIX = join(ROOT, "fixtures/key-judgment-validation-v1");
const OUT = join(FIX, "jc-premium-burden-v1-slice-production-evidence.json");
const LV5_30Q = join(FIX, "lifeguard-launch-validation-lv5-production-30q-regression-evidence.json");
const DEPLOY_EVIDENCE = join(FIX, "jc-premium-burden-v1-slice-production-deploy-evidence.json");

const PRODUCTION_BASE =
  process.argv.find((a) => a.startsWith("https://"))?.replace(/\/$/, "") ??
  "https://lifeguard-core-final.vercel.app";
const PRODUCTION_REF = "fhvlxcguvjvtftttfrix";
const PRODUCTION_URL = `https://${PRODUCTION_REF}.supabase.co`;
const CLUSTER_ID = "JC-PREMIUM-BURDEN-v1";

const PARAPHRASE = ["보험료가 부담돼.", "보험을 줄이고 싶어.", "월 보험료를 낮추고 싶어."];
const NEGATIVE = ["월 보험료 얼마야?", "내 보험료 총액 얼마야?", "보험료 몇 원이야?"];

function loadEnvFile(path, overwrite = false) {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq <= 0) continue;
    const k = t.slice(0, eq).trim();
    const v = t.slice(eq + 1).trim().replace(/^['"]|['"]$/g, "");
    if (overwrite || !process.env[k]) process.env[k] = v;
  }
}

function gitShortSha() {
  return spawnSync("git", ["rev-parse", "--short", "HEAD"], { cwd: ROOT, encoding: "utf8" }).stdout?.trim() ?? null;
}

async function resolveProductionJwt() {
  loadEnvFile(join(ROOT, ".env.local"));
  let email = process.env.PRODUCTION_PROBE_EMAIL?.trim() ?? "";
  let password = process.env.PRODUCTION_PROBE_PASSWORD?.trim() ?? "";
  if (!password) {
    const tempEnv = join(ROOT, ".tmp-jc-prod-verify-creds");
    try {
      execSync(`npx vercel env pull "${tempEnv}" --environment=production --yes`, {
        cwd: ROOT,
        encoding: "utf8",
        timeout: 180000,
        shell: true,
      });
      loadEnvFile(tempEnv, true);
      email = process.env.PRODUCTION_PROBE_EMAIL ?? email;
      password = process.env.PRODUCTION_PROBE_PASSWORD ?? "";
    } finally {
      if (existsSync(tempEnv)) unlinkSync(tempEnv);
    }
  }
  const mgmtToken = process.env.SUPABASE_ACCESS_TOKEN?.trim();
  if (!email || !password || !mgmtToken) throw new Error("production_probe_or_token_missing");

  const keysRes = await fetch(`https://api.supabase.com/v1/projects/${PRODUCTION_REF}/api-keys`, {
    headers: { Authorization: `Bearer ${mgmtToken}` },
  });
  const keysBody = await keysRes.json().catch(() => ({}));
  const rows = Array.isArray(keysBody) ? keysBody : keysBody?.data ?? [];
  const anon = rows.find((k) => k.name === "anon")?.api_key;
  if (!anon) throw new Error("anon_key_missing");

  const client = createClient(PRODUCTION_URL, anon, { auth: { persistSession: false } });
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error || !data.session?.access_token) throw new Error(`jwt:${error?.message ?? "no_token"}`);
  return data.session.access_token;
}

function extractTrace(done = {}) {
  const trace = done.sales_director_trace ?? done.salesDirectorTrace ?? {};
  const keyPath = trace.p10_4_key_path_trace ?? {};
  const keyOrch = trace.key_orchestrator ?? {};
  const plan = keyOrch.plan ?? {};
  const absorbed = trace.tool_brain_absorbed ?? {};
  const factBundle = done.factBundle ?? trace.agent_turn?.factBundle ?? {};
  return {
    probe_ok: true,
    answer_preview: String(done.answerText ?? "").slice(0, 240),
    classification_intent: keyPath.classificationIntent ?? factBundle.classification_intent ?? null,
    matched_rule: keyPath.matched_rule ?? null,
    companion_cluster: keyPath.companion_cluster ?? factBundle.companion_cluster ?? plan.companion_cluster ?? null,
    lookup_sub_intent: keyPath.lookup_sub_intent ?? factBundle.lookup_sub_intent ?? null,
    key_tools_called: keyPath.key_loop?.key_tools_called ?? keyOrch.tools_called ?? factBundle.key_tools_called ?? null,
    coverage_gap_suppressed:
      absorbed.coverage_gap_suppressed === true || plan.coverage_gap_suppressed === true || factBundle.coverage_gap_suppressed === true,
    response_source: done.response_source ?? null,
  };
}

async function probeQuestion(jwt, question) {
  try {
    const res = await fetch(`${PRODUCTION_BASE}/api/customer-home-brain-fact`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "text/event-stream",
        Authorization: `Bearer ${jwt}`,
      },
      body: JSON.stringify({ question, history: [], stream: true }),
    });
    const text = await res.text();
    if (res.status !== 200 || !text.includes("event:")) {
      return {
        probe_ok: false,
        probe_error: `http_${res.status}`,
        http_status: res.status,
        raw_snippet: text.slice(0, 200),
      };
    }
    const done = parseSse(text).find((e) => e.type === "done")?.data ?? {};
    return { http_status: 200, ...extractTrace(done) };
  } catch (err) {
    return {
      probe_ok: false,
      probe_error: err instanceof Error ? err.message : String(err),
    };
  }
}

function assessParaphraseRow(row) {
  const checks = {
    cluster: row.companion_cluster === CLUSTER_ID,
    intent: row.classification_intent === "general_consultation",
    tools: Array.isArray(row.key_tools_called) && row.key_tools_called.includes("premium_stats"),
    gap_suppressed: row.coverage_gap_suppressed === true,
    probe: row.probe_ok === true,
  };
  return { checks, aligned: Object.values(checks).every(Boolean) };
}

function assessNegativeRow(row) {
  const checks = {
    no_cluster: !row.companion_cluster,
    premium_lookup: row.classification_intent === "factual_lookup" && row.lookup_sub_intent === "premium_lookup",
    probe: row.probe_ok === true,
  };
  return { checks, preserved: Object.values(checks).every(Boolean) };
}

function load30qSummary() {
  if (!existsSync(LV5_30Q)) return null;
  try {
    const data = JSON.parse(readFileSync(LV5_30Q, "utf8"));
    return {
      summary: data.summary ?? null,
      pass_count: data.pass_count ?? null,
      total: data.total ?? null,
      path: "fixtures/key-judgment-validation-v1/lifeguard-launch-validation-lv5-production-30q-regression-evidence.json",
    };
  } catch {
    return null;
  }
}

async function main() {
  loadEnvFile(join(ROOT, ".env.local"));
  mkdirSync(FIX, { recursive: true });

  const jwt = await resolveProductionJwt();
  const paraphrase = [];
  for (const q of PARAPHRASE) {
    const row = await probeQuestion(jwt, q);
    paraphrase.push({ question: q, ...row, assessment: assessParaphraseRow(row) });
    console.log(q, row.companion_cluster, row.key_tools_called);
  }

  const negative_control = [];
  for (const q of NEGATIVE) {
    const row = await probeQuestion(jwt, q);
    negative_control.push({ question: q, ...row, assessment: assessNegativeRow(row) });
    console.log(q, row.classification_intent, row.lookup_sub_intent, row.companion_cluster);
  }

  const regression_30q = load30qSummary();
  const deploy = existsSync(DEPLOY_EVIDENCE)
    ? JSON.parse(readFileSync(DEPLOY_EVIDENCE, "utf8")).deploy ?? null
    : null;

  const evidence = {
    document: "jc_premium_burden_v1_slice_production_evidence",
    slice: "SLICE-1-JC-PREMIUM-BURDEN-v1",
    mode: "Production verification · Tom Production GO",
    pass_declaration: "none — await Tom audit",
    observed_at: new Date().toISOString(),
    git_short_sha: gitShortSha(),
    production_url: PRODUCTION_BASE,
    auth_path: "production_probe + management_api_anon (lv5)",
    deploy,
    paraphrase,
    negative_control,
    paraphrase_all_aligned: paraphrase.every((r) => r.assessment.aligned),
    negative_control_preserved: negative_control.every((r) => r.assessment.preserved),
    regression_30q_production: regression_30q,
    tom_note: "Slice 1 Production close evidence · Jerry observes only",
  };

  writeFileSync(OUT, JSON.stringify(evidence, null, 2));
  console.log(`Wrote ${OUT}`);
  console.log(
    `aligned=${evidence.paraphrase_all_aligned} negative=${evidence.negative_control_preserved} 30q=${regression_30q?.summary ?? "n/a"}`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
