/**
 * FACTORY-SPEAK-03-S1 — Preview customer-seat audit (observation only).
 * Tom 4 checks: Underwriting factory lost its voice.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { resolveBypassSecret } from "./p10-5-preview-curl-helper.mjs";
import {
  auditUnderwritingPanelKeyVoice,
  buildUnderwritingPanelItemCaveat,
  buildUnderwritingPanelItemWhy,
} from "../src/lib/underwritingPanelKeyVoice.js";

const ROOT = join(import.meta.dirname, "..");
const FIX = join(ROOT, "fixtures", "key-judgment-validation-v1");
const OUT = join(FIX, "factory-speak-03-s1-preview-customer-seat-evidence.json");

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

const FORBIDDEN_JSON_FIELDS = ["reason", "recommended_next_step"];
const FORBIDDEN_PANEL_PHRASES = [
  "가입 가능성이 높습니다",
  "가입 거절 위험이 높습니다",
  "할증됩니다",
  "표준체 가능성이 높습니다",
  "가입 가능합니다",
  "가입이 거절됩니다",
  "거절됩니다",
];
const REQUIRED_ITEM_FIELDS = [
  "coverage_label",
  "coverage_category",
  "underwriting_status",
  "risk_level",
  "uw_reason_codes",
  "review_step_code",
  "evidence_codes",
  "required_document_codes",
];
const REQUIRED_RESULT_FIELDS = ["risk_score", "overall_underwriting_risk"];

function gitShortSha() {
  return spawnSync("git", ["rev-parse", "--short", "HEAD"], { cwd: ROOT, encoding: "utf8" }).stdout?.trim() ?? null;
}

function collectUnderwritingItems(payload = {}) {
  const uw = payload.underwriting_result ?? payload.underwritingResult ?? {};
  const lists = [
    uw.items,
    uw.likely_standard,
    uw.likely_surcharge,
    uw.likely_exclusion,
    uw.likely_additional_review,
    uw.likely_decline,
  ];
  const items = [];
  for (const list of lists) {
    if (Array.isArray(list)) items.push(...list);
  }
  const deduped = [];
  const seen = new Set();
  for (const item of items) {
    const key = `${item.coverage_category}::${item.underwriting_status}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(item);
  }
  return { uw, items: deduped };
}

function auditJsonStructuredOnly(uw = {}, items = []) {
  const violations = [];

  for (const field of REQUIRED_RESULT_FIELDS) {
    if (!(field in uw) && uw[field] == null) {
      violations.push({ missing_result_field: field });
    }
  }

  if (Object.hasOwn(uw, "reason") && uw.reason != null) {
    violations.push({ forbidden_result_field: "reason" });
  }
  if (Object.hasOwn(uw, "recommended_next_step") && uw.recommended_next_step != null) {
    violations.push({ forbidden_result_field: "recommended_next_step" });
  }

  const samples = [];
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
      underwriting_status: item.underwriting_status,
      risk_level: item.risk_level,
      uw_reason_codes: item.uw_reason_codes ?? null,
      review_step_code: item.review_step_code ?? null,
      evidence_codes: item.evidence_codes ?? null,
      required_document_codes: item.required_document_codes ?? null,
      has_forbidden_reason: Object.hasOwn(item, "reason"),
      has_forbidden_recommended_next_step: Object.hasOwn(item, "recommended_next_step"),
    });
  }

  const serialized = JSON.stringify(uw);
  const factoryKoreanInJson = [
    /가입 가능성이 높습니다/,
    /가입 거절 위험이 높습니다/,
    /할증 가능성이 있습니다/,
    /표준체 가능성이 높습니다/,
    /recommended_next_step/,
    /"reason"\s*:/,
  ].filter((pattern) => pattern.test(serialized));

  if (factoryKoreanInJson.length) {
    violations.push({ factory_korean_in_json: factoryKoreanInJson.map(String) });
  }

  return {
    risk_score: uw.risk_score ?? null,
    overall_underwriting_risk: uw.overall_underwriting_risk ?? null,
    item_count: items.length,
    violations,
    pass: violations.length === 0 && items.length > 0 && uw.risk_score != null,
    samples: samples.slice(0, 8),
  };
}

function auditPanelVoice(sampleItems = []) {
  const whyLines = sampleItems.map((item) => buildUnderwritingPanelItemWhy(item)).filter(Boolean);
  const caveatLines = sampleItems.map((item) => buildUnderwritingPanelItemCaveat(item)).filter(Boolean);
  const combined = [...whyLines, ...caveatLines].join("\n");

  const forbiddenHits = FORBIDDEN_PANEL_PHRASES.filter((phrase) => combined.includes(phrase));
  const factoryPatterns = [
    /가입 가능성이 높습니다/,
    /가입 거절 위험이 높습니다/,
    /할증됩니다/,
    /표준체 가능성이 높습니다/,
  ];
  const factoryHits = factoryPatterns.filter((pattern) => pattern.test(combined)).map(String);

  const voiceAudit = auditUnderwritingPanelKeyVoice(combined);
  const keyVoicePresent =
    whyLines.length > 0 &&
    (caveatLines.some((line) => /단정하지 않겠습니다/.test(line)) ||
      whyLines.some((line) => /단정하지 않겠습니다/.test(line))) &&
    whyLines.some((line) =>
      /현재 확인되는|추가.*확인|함께.*확인|조금 더 확인|함께 보면서/.test(line),
    );

  return {
    why_lines: whyLines,
    caveat_lines: caveatLines,
    forbidden_phrase_hits: forbiddenHits,
    factory_korean_hits: factoryHits,
    forbidden_uw_voice_hits: voiceAudit.forbidden_hits,
    key_voice_present: keyVoicePresent,
    check_1_no_factory_panel_phrases:
      forbiddenHits.length === 0 && factoryHits.length === 0 && voiceAudit.pass,
    check_3_key_voice_present: keyVoicePresent,
    pass:
      forbiddenHits.length === 0 &&
      factoryHits.length === 0 &&
      voiceAudit.pass &&
      keyVoicePresent,
  };
}

async function fetchUnderwritingRisk({ previewBase, token, bypassSecret }) {
  const url = `${previewBase.replace(/\/$/, "")}/api/customer-underwriting-risk`;
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
  const [uwApi, aiPage] = await Promise.all([
    fetchUnderwritingRisk({ previewBase, token, bypassSecret: bypass }),
    fetchAiPageHtml({ previewBase, bypassSecret: bypass }),
  ]);

  const { uw, items } = collectUnderwritingItems(uwApi.payload);
  const sampleItems = (uw.likely_surcharge ?? uw.items ?? items).slice(0, 4);
  const jsonAudit = auditJsonStructuredOnly(uw, items);
  const panelAudit = auditPanelVoice(sampleItems.length ? sampleItems : items.slice(0, 4));

  const claudeExplanation = uwApi.payload?.claude_explanation ?? uwApi.payload?.claudeExplanation ?? null;
  const claudeMeta = uwApi.payload?.claude_meta ?? uwApi.payload?.claudeMeta ?? null;
  const html = aiPage.html ?? "";

  const tomChecks = {
    check_1_panel_no_factory_uw_phrases: {
      question: "Underwriting 패널 — 공장 단정문(가입 가능/거절/할증/표준체) 없어졌는가?",
      pass: panelAudit.check_1_no_factory_panel_phrases,
      evidence: {
        forbidden_phrase_hits: panelAudit.forbidden_phrase_hits,
        factory_korean_hits: panelAudit.factory_korean_hits,
        forbidden_uw_voice_hits: panelAudit.forbidden_uw_voice_hits,
        why_lines: panelAudit.why_lines,
      },
    },
    check_2_no_claude_explanation_block: {
      question: "Claude 설명 — '인수 위험 Claude 설명' / claude_explanation 없어졌는가?",
      pass:
        (claudeExplanation == null || String(claudeExplanation).trim() === "") &&
        (claudeMeta?.reason === "FACTORY_SPEAK_03_S1" || claudeMeta?.explanation_mode === "blocked") &&
        !html.includes("인수 위험 Claude 설명"),
      evidence: {
        claude_explanation: claudeExplanation,
        claude_meta: claudeMeta,
        ai_page_html_has_uw_claude_block: html.includes("인수 위험 Claude 설명"),
        note: "SPA shell may not include panel text in initial HTML — API + panel voice layer primary",
      },
    },
    check_3_key_voice_present: {
      question: "KEY voice — 보류형 문장('현재 확인되는…' + '단정하지 않겠습니다') 형태 남았는가?",
      pass: panelAudit.check_3_key_voice_present,
      evidence: {
        why_lines: panelAudit.why_lines,
        caveat_lines: panelAudit.caveat_lines,
      },
    },
    check_4_json_structured_only: {
      question: "Underwriting JSON — uw_reason_codes/review_step_code only, no reason/recommended_next_step/claude_explanation?",
      pass: jsonAudit.pass && (claudeExplanation == null || String(claudeExplanation).trim() === ""),
      evidence: {
        ...jsonAudit,
        api_claude_explanation: claudeExplanation,
        api_claude_meta: claudeMeta,
      },
    },
  };

  const allPass = Object.values(tomChecks).every((check) => check.pass === true);

  const evidence = {
    schema_version: "factory-speak-03-s1-preview-customer-seat-v1",
    audit: "factory_speak_03_s1_preview_customer_seat",
    note: "Observation only — Tom declares Commit/Push GO. Jerry does not declare PASS.",
    tom_one_liner:
      "Underwriting 공장은 가입 가능성을 말하지 않는다. 위험 신호만 계산하고, 고객에게는 ONE KEY가 신중하게 말한다.",
    preview_base: previewBase,
    git_commit: gitShortSha(),
    observed_at: new Date().toISOString(),
    underwriting_api: {
      ok: uwApi.ok,
      status: uwApi.status,
      item_count: items.length,
      risk_score: uw.risk_score ?? null,
      overall_underwriting_risk: uw.overall_underwriting_risk ?? null,
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
