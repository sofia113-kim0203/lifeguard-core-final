/**
 * FACTORY-SPEAK-04-S1 — Preview customer-seat audit (observation only).
 * Tom 4 checks: Design factory lost its voice.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { resolveBypassSecret } from "./p10-5-preview-curl-helper.mjs";
import {
  buildDesignPanelBudgetLine,
  buildDesignPanelCaveat,
  buildDesignPanelLead,
  buildDesignPanelNextSteps,
  buildDesignPanelSummary,
} from "../src/lib/designPanelKeyVoice.js";

const ROOT = join(import.meta.dirname, "..");
const FIX = join(ROOT, "fixtures", "key-judgment-validation-v1");
const OUT = join(FIX, "factory-speak-04-s1-preview-customer-seat-evidence.json");

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

const FORBIDDEN_JSON_FIELDS = ["design_summary", "next_actions", "design_title"];
const FORBIDDEN_PANEL_PHRASES = [
  "고객님은",
  "고객 · 기존",
  "보강 검토 ·",
  "최종 가입 여부를 결정",
  "인수심사 결과와 보험료를 확인한 뒤",
];
const REQUIRED_VISIBLE_FIELDS = [
  "design_reason_codes",
  "plan_step_codes",
  "budget_band_code",
  "priority_coverages",
];
const REQUIRED_DESIGN_FIELDS = ["design_id", "design_priority", "plan_step_codes", "design_reason_codes"];

function gitShortSha() {
  return spawnSync("git", ["rev-parse", "--short", "HEAD"], { cwd: ROOT, encoding: "utf8" }).stdout?.trim() ?? null;
}

function auditJsonStructuredOnly(visible = {}, insuranceDesign = {}) {
  const violations = [];

  for (const field of REQUIRED_VISIBLE_FIELDS) {
    if (!(field in visible)) {
      violations.push({ missing_visible_field: field });
    }
  }

  for (const field of FORBIDDEN_JSON_FIELDS) {
    if (Object.hasOwn(visible, field) && visible[field] != null && String(visible[field]).trim() !== "") {
      violations.push({ forbidden_visible_field: field, value_preview: String(visible[field]).slice(0, 80) });
    }
    if (
      Object.hasOwn(insuranceDesign, field) &&
      insuranceDesign[field] != null &&
      String(insuranceDesign[field]).trim() !== ""
    ) {
      violations.push({
        forbidden_design_field: field,
        value_preview: String(insuranceDesign[field]).slice(0, 80),
      });
    }
  }

  for (const field of REQUIRED_DESIGN_FIELDS) {
    if (!(field in insuranceDesign) && insuranceDesign[field] == null) {
      violations.push({ missing_design_field: field });
    }
  }

  const serialized = JSON.stringify({ visible, insuranceDesign });
  const factoryKoreanInJson = [
    /design_summary/,
    /"next_actions"\s*:/,
    /design_title/,
    /고객 · 기존/,
    /보강 검토/,
  ].filter((pattern) => pattern.test(serialized));

  if (factoryKoreanInJson.length) {
    violations.push({ factory_patterns_in_json: factoryKoreanInJson.map(String) });
  }

  return {
    design_id: insuranceDesign.design_id ?? null,
    design_priority: visible.design_priority ?? insuranceDesign.design_priority ?? null,
    plan_step_codes: visible.plan_step_codes ?? [],
    design_reason_codes: visible.design_reason_codes ?? [],
    budget_band_code: visible.budget_band_code ?? null,
    priority_coverages: visible.priority_coverages ?? [],
    violations,
    pass:
      violations.length === 0 &&
      (visible.plan_step_codes?.length ?? 0) > 0 &&
      (visible.design_reason_codes?.length ?? 0) > 0 &&
      Boolean(insuranceDesign.design_id),
  };
}

function auditPanelVoice(visible = {}) {
  const lead = buildDesignPanelLead(visible);
  const summary = buildDesignPanelSummary(visible);
  const budget = buildDesignPanelBudgetLine(visible);
  const caveat = buildDesignPanelCaveat();
  const nextSteps = buildDesignPanelNextSteps(visible);
  const combined = [lead, summary, budget, caveat, ...nextSteps].join("\n");

  const forbiddenHits = FORBIDDEN_PANEL_PHRASES.filter((phrase) => combined.includes(phrase));
  const factoryPatterns = [
    /고객 · 기존/,
    /보강 검토 · 월/,
    /보장 검토$/,
    /설계사·보험사 심사 상담/,
  ];
  const factoryHits = factoryPatterns.filter((pattern) => pattern.test(combined)).map(String);

  const keyVoicePresent =
    /현재 확인된 자료/.test(combined) &&
    /같이/.test(combined) &&
    (/단정하지 않/.test(combined) || /함께/.test(combined));

  return {
    lead,
    summary,
    budget,
    caveat,
    next_steps: nextSteps,
    forbidden_phrase_hits: forbiddenHits,
    factory_korean_hits: factoryHits,
    key_voice_present: keyVoicePresent,
    check_1_no_factory_panel_phrases: forbiddenHits.length === 0 && factoryHits.length === 0,
    check_3_key_voice_present: keyVoicePresent,
    pass: forbiddenHits.length === 0 && factoryHits.length === 0 && keyVoicePresent,
  };
}

async function fetchInsuranceDesign({ previewBase, token, bypassSecret }) {
  const url = `${previewBase.replace(/\/$/, "")}/api/customer-insurance-design`;
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
  const [designApi, aiPage] = await Promise.all([
    fetchInsuranceDesign({ previewBase, token, bypassSecret: bypass }),
    fetchAiPageHtml({ previewBase, bypassSecret: bypass }),
  ]);

  const visible = designApi.payload?.customer_visible_design ?? {};
  const insuranceDesign = designApi.payload?.insurance_design ?? {};
  const jsonAudit = auditJsonStructuredOnly(visible, insuranceDesign);
  const panelAudit = auditPanelVoice(visible);

  const claudeExplanation =
    designApi.payload?.claude_explanation ?? designApi.payload?.claudeExplanation ?? null;
  const claudeMeta = designApi.payload?.claude_meta ?? designApi.payload?.claudeMeta ?? null;
  const html = aiPage.html ?? "";

  const tomChecks = {
    check_1_panel_no_factory_design_phrases: {
      question: "Design 패널 — 공장 summary 문장(고객님은/기존/보강 검토 composite) 없어졌는가?",
      pass: panelAudit.check_1_no_factory_panel_phrases,
      evidence: {
        forbidden_phrase_hits: panelAudit.forbidden_phrase_hits,
        factory_korean_hits: panelAudit.factory_korean_hits,
        lead: panelAudit.lead,
        summary: panelAudit.summary,
      },
    },
    check_2_no_claude_explanation_block: {
      question: "Claude 설명 — '설계안 Claude 설명' / claude_explanation 없어졌는가?",
      pass:
        (claudeExplanation == null || String(claudeExplanation).trim() === "") &&
        (claudeMeta?.reason === "FACTORY_SPEAK_04_S1" || claudeMeta?.explanation_mode === "blocked") &&
        !html.includes("설계안 Claude 설명"),
      evidence: {
        claude_explanation: claudeExplanation,
        claude_meta: claudeMeta,
        ai_page_html_has_design_claude_block: html.includes("설계안 Claude 설명"),
        note: "SPA shell may not include panel text in initial HTML — API + panel voice layer primary",
      },
    },
    check_3_key_voice_present: {
      question: "KEY voice — '현재 확인된 자료 기준으로…' + hedged caveat 형태인가?",
      pass: panelAudit.check_3_key_voice_present,
      evidence: {
        lead: panelAudit.lead,
        summary: panelAudit.summary,
        budget: panelAudit.budget,
        caveat: panelAudit.caveat,
        next_steps: panelAudit.next_steps,
      },
    },
    check_4_json_structured_only: {
      question:
        "Design JSON — plan_step_codes/design_reason_codes/budget_band_code only, no design_summary/next_actions/claude_explanation?",
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
    schema_version: "factory-speak-04-s1-preview-customer-seat-v1",
    audit: "factory_speak_04_s1_preview_customer_seat",
    note: "Observation only — Tom declares Commit/Push GO. Jerry does not declare PASS.",
    tom_one_liner:
      "Design 공장은 설계 summary를 말하지 않는다. codes만 계산하고, 고객에게는 ONE KEY가 신중하게 말한다.",
    preview_base: previewBase,
    git_commit: gitShortSha(),
    observed_at: new Date().toISOString(),
    design_api: {
      ok: designApi.ok,
      status: designApi.status,
      design_id: insuranceDesign.design_id ?? null,
      priority_count: visible.priority_coverages?.length ?? 0,
      plan_step_count: visible.plan_step_codes?.length ?? 0,
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
