/**
 * FACTORY-SPEAK-02-S1 — Preview customer-seat audit (observation only).
 * Tom 4 checks: Coverage Gap factory lost its voice.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { resolveBypassSecret } from "./p10-5-preview-curl-helper.mjs";
import {
  buildGapPanelItemCaveat,
  buildGapPanelItemWhy,
} from "../src/lib/gapPanelKeyVoice.js";

const ROOT = join(import.meta.dirname, "..");
const FIX = join(ROOT, "fixtures", "key-judgment-validation-v1");
const OUT = join(FIX, "factory-speak-02-s1-preview-customer-seat-evidence.json");

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

const FORBIDDEN_JSON_FIELDS = ["reason", "recommended_action"];
const FORBIDDEN_PANEL_PHRASES = [
  "암 보장 보강을 우선 검토하세요",
  "암 보장이 없거나 부족하다는 memory가 있습니다",
  "보장 보강을 우선 검토",
  "memory가 있습니다",
];
const REQUIRED_ITEM_FIELDS = [
  "coverage_label",
  "coverage_category",
  "current_status",
  "gap_level",
  "priority",
  "gap_reason_codes",
  "action_code",
  "evidence_codes",
  "confidence",
  "requires_agent_review",
];
const REQUIRED_RESULT_FIELDS = ["gap_score"];

function gitShortSha() {
  return spawnSync("git", ["rev-parse", "--short", "HEAD"], { cwd: ROOT, encoding: "utf8" }).stdout?.trim() ?? null;
}

function collectGapItems(payload = {}) {
  const gap = payload.coverage_gap_result ?? payload.coverageGapResult ?? {};
  const lists = [gap.items, gap.top_gaps, gap.priority_actions];
  const items = [];
  for (const list of lists) {
    if (Array.isArray(list)) items.push(...list);
  }
  return { gap, items };
}

function auditJsonStructuredOnly(gap = {}, items = []) {
  const violations = [];
  const samples = [];

  for (const field of REQUIRED_RESULT_FIELDS) {
    if (!(field in gap) && gap[field] == null) {
      violations.push({ missing_result_field: field });
    }
  }

  for (const item of items) {
    for (const field of FORBIDDEN_JSON_FIELDS) {
      if (Object.hasOwn(item, field) && item[field] != null && String(item[field]).trim()) {
        violations.push({
          field,
          coverage_label: item.coverage_label,
          value_preview: String(item[field]).slice(0, 80),
        });
      }
    }
    const missing = REQUIRED_ITEM_FIELDS.filter((field) => !(field in item));
    if (missing.length) {
      violations.push({ missing_structured: missing, coverage_label: item.coverage_label });
    }
    samples.push({
      coverage_label: item.coverage_label,
      gap_level: item.gap_level,
      current_status: item.current_status,
      action_code: item.action_code ?? null,
      gap_reason_codes: item.gap_reason_codes ?? null,
      evidence_codes: item.evidence_codes ?? null,
      has_forbidden_reason: Object.hasOwn(item, "reason"),
      has_forbidden_recommended_action: Object.hasOwn(item, "recommended_action"),
    });
  }

  const serialized = JSON.stringify(gap);
  const factoryKoreanInJson = [
    /보장 보강을 우선 검토/,
    /없거나 부족하다는 memory/,
    /recommended_action/,
  ].filter((pattern) => pattern.test(serialized));

  if (factoryKoreanInJson.length) {
    violations.push({ factory_korean_in_json: factoryKoreanInJson.map(String) });
  }

  return {
    gap_score: gap.gap_score ?? null,
    item_count: items.length,
    violations,
    pass: violations.length === 0 && items.length > 0 && gap.gap_score != null,
    samples: samples.slice(0, 8),
  };
}

function auditPanelVoice(topGaps = []) {
  const whyLines = topGaps.map((item) => buildGapPanelItemWhy(item)).filter(Boolean);
  const caveatLines = topGaps.map((item) => buildGapPanelItemCaveat(item)).filter(Boolean);
  const combined = [...whyLines, ...caveatLines].join("\n");

  const forbiddenHits = FORBIDDEN_PANEL_PHRASES.filter((phrase) => combined.includes(phrase));
  const factoryPatterns = [/보장 보강을 우선 검토/, /없거나 부족하다는 memory/, /검토하세요/];
  const factoryHits = factoryPatterns.filter((pattern) => pattern.test(combined)).map(String);

  const keyVoicePresent =
    whyLines.some((line) => /같이 확인|함께 점검|같이 보면|같이 보면서/.test(line)) &&
    (caveatLines.some((line) => /단정하기 어렵/.test(line)) ||
      whyLines.some((line) => /같이 확인/.test(line)));

  return {
    why_lines: whyLines,
    caveat_lines: caveatLines,
    forbidden_phrase_hits: forbiddenHits,
    factory_korean_hits: factoryHits,
    key_voice_present: keyVoicePresent,
    check_1_no_factory_panel_phrases: forbiddenHits.length === 0 && factoryHits.length === 0,
    check_3_key_voice_present: keyVoicePresent,
    pass: forbiddenHits.length === 0 && factoryHits.length === 0 && keyVoicePresent,
  };
}

async function fetchCoverageGap({ previewBase, token, bypassSecret }) {
  const url = `${previewBase.replace(/\/$/, "")}/api/customer-coverage-gap`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      "x-vercel-protection-bypass": bypassSecret,
    },
    body: JSON.stringify({ skip_claude: false }),
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
  const [gapApi, aiPage] = await Promise.all([
    fetchCoverageGap({ previewBase, token, bypassSecret: bypass }),
    fetchAiPageHtml({ previewBase, bypassSecret: bypass }),
  ]);

  const { gap, items } = collectGapItems(gapApi.payload);
  const topGaps = (gap.top_gaps ?? []).slice(0, 3);
  const jsonAudit = auditJsonStructuredOnly(gap, items);
  const panelAudit = auditPanelVoice(topGaps);

  const claudeExplanation = gapApi.payload?.claude_explanation ?? gapApi.payload?.claudeExplanation ?? null;
  const claudeMeta = gapApi.payload?.claude_meta ?? gapApi.payload?.claudeMeta ?? null;
  const html = aiPage.html ?? "";

  const tomChecks = {
    check_1_panel_no_factory_gap_phrases: {
      question: "Gap 패널 — 공장 한국어 문장(보강 검토/memory 설명) 없어졌는가?",
      pass: panelAudit.check_1_no_factory_panel_phrases,
      evidence: {
        forbidden_phrase_hits: panelAudit.forbidden_phrase_hits,
        factory_korean_hits: panelAudit.factory_korean_hits,
        why_lines: panelAudit.why_lines,
      },
    },
    check_2_no_claude_explanation_block: {
      question: "Claude 설명 — '보장 공백 Claude 설명' / claude_explanation 없어졌는가?",
      pass:
        (claudeExplanation == null || String(claudeExplanation).trim() === "") &&
        (claudeMeta?.reason === "FACTORY_SPEAK_02_S1" || claudeMeta?.explanation_mode === "blocked") &&
        !html.includes("보장 공백 Claude 설명"),
      evidence: {
        claude_explanation: claudeExplanation,
        claude_meta: claudeMeta,
        ai_page_html_has_gap_claude_block: html.includes("보장 공백 Claude 설명"),
        note: "SPA shell may not include panel text in initial HTML — API + panel voice layer primary",
      },
    },
    check_3_key_voice_present: {
      question: "KEY voice — '같이 확인' + '단정하기 어렵' 형태 남았는가?",
      pass: panelAudit.check_3_key_voice_present,
      evidence: {
        why_lines: panelAudit.why_lines,
        caveat_lines: panelAudit.caveat_lines,
      },
    },
    check_4_json_structured_only: {
      question: "Coverage Gap JSON — action_code/gap_reason_codes only, no reason/recommended_action?",
      pass: jsonAudit.pass,
      evidence: jsonAudit,
    },
  };

  const allPass = Object.values(tomChecks).every((check) => check.pass === true);

  const evidence = {
    schema_version: "factory-speak-02-s1-preview-customer-seat-v1",
    audit: "factory_speak_02_s1_preview_customer_seat",
    note: "Observation only — Tom declares Commit/Push GO. Jerry does not declare PASS.",
    tom_one_liner:
      "Coverage Gap 공장은 \"부족\"을 계산한다. \"부족합니다\"라고 고객에게 말하는 것은 ONE KEY만 한다.",
    preview_base: previewBase,
    git_commit: gitShortSha(),
    observed_at: new Date().toISOString(),
    coverage_gap_api: {
      ok: gapApi.ok,
      status: gapApi.status,
      top_gaps_count: topGaps.length,
      gap_score: gap.gap_score ?? null,
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
