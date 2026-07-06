/**
 * FACTORY-SPEAK-01-S1 — Preview customer-seat audit (observation only).
 * Tom 4 checks: factory lost its voice on Recommendation.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { resolveBypassSecret } from "./p10-5-preview-curl-helper.mjs";
import {
  buildRecommendationPanelItemCaveat,
  buildRecommendationPanelItemWhy,
  buildRecommendationPanelContinuation,
} from "../src/lib/recommendationPanelKeyVoice.js";

const ROOT = join(import.meta.dirname, "..");
const FIX = join(ROOT, "fixtures", "key-judgment-validation-v1");
const OUT = join(FIX, "factory-speak-01-s1-preview-customer-seat-evidence.json");

function loadEnvFile(envPath) {
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim().replace(/^['"]|['"]$/g, "");
    if (!process.env[key]) process.env[key] = value;
  }
}

const FORBIDDEN_JSON_FIELDS = ["reason", "budget_consideration", "underwriting_consideration"];
const FORBIDDEN_PANEL_PHRASES = ["왜냐하면", "KEY가 덧붙이는 설명"];
const REQUIRED_STRUCTURED_FIELDS = [
  "reason_codes",
  "budget_band",
  "recommendation_score",
  "recommendation_type",
  "coverage_label",
];

function gitShortSha() {
  return spawnSync("git", ["rev-parse", "--short", "HEAD"], { cwd: ROOT, encoding: "utf8" }).stdout?.trim() ?? null;
}

function collectRecommendationItems(payload = {}) {
  const lists = [
    payload.customer_visible_top2,
    payload.customerVisibleTop2,
    payload.recommendations,
    payload.keep_existing_recommendations,
  ];
  const items = [];
  for (const list of lists) {
    if (Array.isArray(list)) items.push(...list);
  }
  return items;
}

function auditJsonStructuredOnly(items = []) {
  const violations = [];
  const samples = [];

  for (const item of items) {
    for (const field of FORBIDDEN_JSON_FIELDS) {
      if (Object.hasOwn(item, field) && item[field] != null && String(item[field]).trim()) {
        violations.push({ field, coverage_label: item.coverage_label, value_preview: String(item[field]).slice(0, 80) });
      }
    }
    const missing = REQUIRED_STRUCTURED_FIELDS.filter((field) => !(field in item));
    if (missing.length) {
      violations.push({ missing_structured: missing, coverage_label: item.coverage_label });
    }
    samples.push({
      coverage_label: item.coverage_label,
      recommendation_type: item.recommendation_type,
      recommendation_score: item.recommendation_score,
      reason_codes: item.reason_codes ?? null,
      budget_band: item.budget_band ?? null,
      has_forbidden_reason: Object.hasOwn(item, "reason"),
    });
  }

  return {
    item_count: items.length,
    violations,
    pass: violations.length === 0 && items.length > 0,
    samples,
  };
}

function auditPanelVoice(items = []) {
  const whyLines = items.map((item) => buildRecommendationPanelItemWhy(item)).filter(Boolean);
  const caveatLines = items.map((item) => buildRecommendationPanelItemCaveat(item)).filter(Boolean);
  const continuation = buildRecommendationPanelContinuation(items.slice(0, 2));
  const combined = [continuation, ...whyLines, ...caveatLines].join("\n");

  const forbiddenHits = FORBIDDEN_PANEL_PHRASES.filter((phrase) => combined.includes(phrase));
  const factoryKoreanPatterns = [/보장 보강이 필요하며/, /월 보험 예산이 Memory에/, /인수 위험 분석 결과가 없습니다/];
  const factoryHits = factoryKoreanPatterns.filter((pattern) => pattern.test(combined)).map(String);

  const keyVoicePresent =
    whyLines.some((line) => /같이 확인|함께 점검|같이 보|같이 짚/.test(line)) ||
    caveatLines.some((line) => /단정하기보다|같이 보/.test(line));

  return {
    why_lines: whyLines,
    caveat_lines: caveatLines,
    continuation,
    forbidden_phrase_hits: forbiddenHits,
    factory_korean_hits: factoryHits,
    key_voice_present: keyVoicePresent,
    check_1_no_wae_nya_ha_myeon: !combined.includes("왜냐하면"),
    check_3_key_voice_only:
      forbiddenHits.length === 0 && factoryHits.length === 0 && keyVoicePresent,
    pass:
      !combined.includes("왜냐하면") &&
      forbiddenHits.length === 0 &&
      factoryHits.length === 0 &&
      keyVoicePresent,
  };
}

async function fetchRecommendations({ previewBase, token, bypassSecret }) {
  const url = `${previewBase.replace(/\/$/, "")}/api/customer-recommendations`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      "x-vercel-protection-bypass": bypassSecret,
    },
    body: JSON.stringify({}),
  });
  const payload = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, payload };
}

async function fetchAiPageHtml({ previewBase, bypassSecret }) {
  const url = `${previewBase.replace(/\/$/, "")}/ai`;
  const res = await fetch(url, {
    headers: { "x-vercel-protection-bypass": bypassSecret },
  });
  const html = await res.text().catch(() => "");
  return { ok: res.ok, status: res.status, html };
}

async function mintPreviewProbeJwt() {
  const supabaseUrl = String(process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL ?? "").trim();
  const supabaseAnon = String(process.env.VITE_SUPABASE_ANON_KEY ?? process.env.SUPABASE_ANON_KEY ?? "").trim();
  const email = String(process.env.QA_EMAIL ?? process.env.QA_TEST_EMAIL ?? "").trim();
  const password = String(process.env.QA_PASSWORD ?? process.env.QA_TEST_PASSWORD ?? "").trim();
  if (!supabaseUrl || !supabaseAnon || !email || !password) {
    throw new Error("BLOCKED — missing preview probe env (Supabase URL/anon + QA_EMAIL/QA_PASSWORD)");
  }
  const { data: auth, error } = await createClient(supabaseUrl, supabaseAnon, {
    auth: { persistSession: false },
  }).auth.signInWithPassword({ email, password });
  if (error || !auth.session?.access_token) {
    throw new Error(`BLOCKED — auth failed: ${error?.message ?? "no token"}`);
  }
  return auth.session.access_token;
}

async function main() {
  loadEnvFile(join(ROOT, ".env.local"));
  loadEnvFile(join(ROOT, ".env.preview.pulled"));
  const previewBaseArg = process.argv[2]?.startsWith("http") ? process.argv[2].trim() : "";
  const previewBase = String(previewBaseArg || process.env.PREVIEW_BASE || "").replace(/\/$/, "");
  const bypass = resolveBypassSecret();
  if (!previewBase || !bypass) {
    console.error("BLOCKED — preview URL and VERCEL_AUTOMATION_BYPASS_SECRET required");
    process.exit(1);
  }

  const token = await mintPreviewProbeJwt();
  const [recApi, aiPage] = await Promise.all([
    fetchRecommendations({ previewBase, token, bypassSecret: bypass }),
    fetchAiPageHtml({ previewBase, bypassSecret: bypass }),
  ]);

  const items = collectRecommendationItems(recApi.payload);
  const top2 = (recApi.payload?.customer_visible_top2 ?? recApi.payload?.customerVisibleTop2 ?? []).slice(0, 2);
  const jsonAudit = auditJsonStructuredOnly(items);
  const panelAudit = auditPanelVoice(top2);

  const claudeExplanation = recApi.payload?.claude_explanation ?? recApi.payload?.claudeExplanation ?? null;
  const claudeMeta = recApi.payload?.claude_meta ?? recApi.payload?.claudeMeta ?? null;

  const html = aiPage.html ?? "";
  const check2_html_no_claude_block =
    !html.includes("KEY가 덧붙이는 설명") && !html.includes("왜냐하면");

  const tomChecks = {
    check_1_panel_no_wae_nya_ha_myeon: {
      question: "Recommendation Panel — '왜냐하면...' 없어졌는가?",
      pass: panelAudit.check_1_no_wae_nya_ha_myeon,
      evidence: { forbidden_phrase_hits: panelAudit.forbidden_phrase_hits, why_lines: panelAudit.why_lines },
    },
    check_2_no_claude_explanation_block: {
      question: "Claude 설명 — 'KEY가 덧붙이는 설명' 영역 없어졌는가?",
      pass:
        (claudeExplanation == null || String(claudeExplanation).trim() === "") &&
        (claudeMeta?.reason === "FACTORY_SPEAK_01_S1" || claudeMeta?.explanation_mode === "blocked"),
      evidence: {
        claude_explanation: claudeExplanation,
        claude_meta: claudeMeta,
        ai_page_html_has_claude_block: html.includes("KEY가 덧붙이는 설명"),
        ai_page_html_has_wae_nya: html.includes("왜냐하면"),
        note: "SPA shell may not include panel text in initial HTML — API + panel voice layer primary",
      },
    },
    check_3_key_voice_only: {
      question: "KEY 설명만 남았는가?",
      pass: panelAudit.check_3_key_voice_only,
      evidence: {
        why_lines: panelAudit.why_lines,
        caveat_lines: panelAudit.caveat_lines,
        continuation: panelAudit.continuation,
        factory_korean_hits: panelAudit.factory_korean_hits,
      },
    },
    check_4_json_structured_only: {
      question: "Recommendation JSON — reason_codes/budget_band only, no Korean reason?",
      pass: jsonAudit.pass,
      evidence: jsonAudit,
    },
  };

  const allPass = Object.values(tomChecks).every((check) => check.pass === true);

  const evidence = {
    schema_version: "factory-speak-01-s1-preview-customer-seat-v1",
    audit: "factory_speak_01_s1_preview_customer_seat",
    note: "Observation only — Tom declares Commit/Push GO. Jerry does not declare PASS.",
    tom_one_liner:
      "이번 Slice는 기능 추가가 아니다. 추천하는 공장을 계산하는 공장으로 되돌리는 첫 번째 수술이다.",
    preview_base: previewBase,
    git_commit: gitShortSha(),
    observed_at: new Date().toISOString(),
    recommendation_api: {
      ok: recApi.ok,
      status: recApi.status,
      top2_count: top2.length,
    },
    tom_checks: tomChecks,
    all_four_pass: allPass,
    status: allPass ? "awaiting_tom_commit_push_go" : "blocked_factory_speak_still_present",
    jerry_pass_declaration: "none",
  };

  writeFileSync(OUT, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({ out: OUT, all_four_pass: allPass, tom_checks: tomChecks }, null, 2));
  if (!allPass) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
