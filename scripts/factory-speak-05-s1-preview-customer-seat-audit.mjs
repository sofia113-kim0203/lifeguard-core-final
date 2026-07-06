/**
 * FACTORY-SPEAK-05-S1 — Preview customer-seat audit (observation only).
 * Tom 4 checks: Rebalancing factory lost its voice.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { resolveBypassSecret } from "./p10-5-preview-curl-helper.mjs";
import {
  buildRebalancingPanelBudgetLine,
  buildRebalancingPanelCaveat,
  buildRebalancingPanelCautionLines,
  buildRebalancingPanelLead,
  buildRebalancingPanelNextSteps,
  buildRebalancingPanelKeepLine,
  buildRebalancingPanelStrengthenLine,
} from "../src/lib/rebalancingPanelKeyVoice.js";

const ROOT = join(import.meta.dirname, "..");
const FIX = join(ROOT, "fixtures", "key-judgment-validation-v1");
const OUT = join(FIX, "factory-speak-05-s1-preview-customer-seat-evidence.json");

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

const FORBIDDEN_JSON_FIELDS = [
  "next_actions",
  "keep_insurances",
  "strengthen_coverages",
  "cautions_before_reduction",
];
const FORBIDDEN_PANEL_PHRASES = [
  "보장 보강 검토",
  "보장을 줄이는 것이 좋습니다",
  "예산을 늘리세요",
  "전환/재검토",
  "리밸런싱 Claude 설명",
];
const REQUIRED_VISIBLE_FIELDS = [
  "rebalancing_action_codes",
  "budget_delta_band_code",
  "caution_warning_codes",
  "keep_coverage_labels",
  "strengthen_coverage_labels",
];

function gitShortSha() {
  return spawnSync("git", ["rev-parse", "--short", "HEAD"], { cwd: ROOT, encoding: "utf8" }).stdout?.trim() ?? null;
}

function auditJsonStructuredOnly(visible = {}, rebalancingResult = {}) {
  const violations = [];

  for (const field of REQUIRED_VISIBLE_FIELDS) {
    if (!(field in visible)) {
      violations.push({ missing_visible_field: field });
    }
  }

  for (const field of FORBIDDEN_JSON_FIELDS) {
    if (Object.hasOwn(visible, field) && visible[field] != null) {
      const val = visible[field];
      const nonEmpty =
        (Array.isArray(val) && val.length > 0) ||
        (typeof val === "string" && val.trim() !== "");
      if (nonEmpty) {
        violations.push({ forbidden_visible_field: field, value_preview: JSON.stringify(val).slice(0, 80) });
      }
    }
  }

  if (Object.hasOwn(rebalancingResult.estimated_budget_impact ?? {}, "label")) {
    violations.push({
      forbidden_budget_label: rebalancingResult.estimated_budget_impact.label?.slice?.(0, 80) ?? "present",
    });
  }

  const serialized = JSON.stringify({ visible, rebalancingResult });
  const factoryPatterns = [
    /"next_actions"\s*:/,
    /"cautions_before_reduction"\s*:/,
    /"keep_insurances"\s*:/,
    /"strengthen_coverages"\s*:/,
    /보장 보강 검토/,
    /보장을 줄이는 것이 좋습니다/,
    /예산을 늘리세요/,
    /"label"\s*:\s*"월 약/,
  ].filter((pattern) => pattern.test(serialized));

  if (factoryPatterns.length) {
    violations.push({ factory_patterns_in_json: factoryPatterns.map(String) });
  }

  return {
    rebalancing_action_codes: visible.rebalancing_action_codes ?? [],
    budget_delta_band_code: visible.budget_delta_band_code ?? null,
    caution_warning_codes: visible.caution_warning_codes ?? [],
    keep_coverage_labels: visible.keep_coverage_labels ?? [],
    strengthen_coverage_labels: visible.strengthen_coverage_labels ?? [],
    violations,
    pass:
      violations.length === 0 &&
      (visible.rebalancing_action_codes?.length ?? 0) > 0 &&
      Boolean(visible.budget_delta_band_code),
  };
}

function auditPanelVoice(visible = {}) {
  const lead = buildRebalancingPanelLead(visible);
  const keep = buildRebalancingPanelKeepLine(visible);
  const strengthen = buildRebalancingPanelStrengthenLine(visible);
  const budget = buildRebalancingPanelBudgetLine(visible);
  const caveat = buildRebalancingPanelCaveat();
  const cautions = buildRebalancingPanelCautionLines(visible);
  const nextSteps = buildRebalancingPanelNextSteps(visible);
  const combined = [lead, keep, strengthen, budget, caveat, ...cautions, ...nextSteps].join("\n");

  const forbiddenHits = FORBIDDEN_PANEL_PHRASES.filter((phrase) => combined.includes(phrase));
  const factoryPatterns = [
    /보장 보강 검토/,
    /보장을 줄이는 것이 좋습니다/,
    /예산을 늘리세요/,
    /전환\/재검토$/,
    /월 약 \d+원 수준 증가 가능성이 있습니다/,
  ];
  const factoryHits = factoryPatterns.filter((pattern) => pattern.test(combined)).map(String);

  const keyVoicePresent =
    /현재 확인된 자료/.test(combined) &&
    /같이|함께/.test(combined) &&
    (/단정하지 않/.test(combined) || /함께/.test(combined));

  return {
    lead,
    keep,
    strengthen,
    budget,
    caveat,
    cautions,
    next_steps: nextSteps,
    forbidden_phrase_hits: forbiddenHits,
    factory_korean_hits: factoryHits,
    key_voice_present: keyVoicePresent,
    check_1_no_factory_panel_phrases: forbiddenHits.length === 0 && factoryHits.length === 0,
    check_3_key_voice_present: keyVoicePresent,
    pass: forbiddenHits.length === 0 && factoryHits.length === 0 && keyVoicePresent,
  };
}

async function fetchRebalancing({ previewBase, token, bypassSecret }) {
  const url = `${previewBase.replace(/\/$/, "")}/api/customer-rebalancing`;
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
  const [rebalancingApi, aiPage] = await Promise.all([
    fetchRebalancing({ previewBase, token, bypassSecret: bypass }),
    fetchAiPageHtml({ previewBase, bypassSecret: bypass }),
  ]);

  const visible = rebalancingApi.payload?.customer_visible_rebalancing ?? {};
  const rebalancingResult = rebalancingApi.payload?.rebalancing_result ?? {};
  const jsonAudit = auditJsonStructuredOnly(visible, rebalancingResult);
  const panelAudit = auditPanelVoice(visible);

  const claudeExplanation =
    rebalancingApi.payload?.claude_explanation ?? rebalancingApi.payload?.claudeExplanation ?? null;
  const claudeMeta = rebalancingApi.payload?.claude_meta ?? rebalancingApi.payload?.claudeMeta ?? null;
  const html = aiPage.html ?? "";

  const tomChecks = {
    check_1_no_factory_speak_anywhere: {
      question:
        "공장 문장 0건 — '보장 보강 검토' / '보장을 줄이는…' / '예산을 늘리세요' 등 API·Panel·JSON 어디에도 없는가?",
      pass:
        jsonAudit.pass &&
        panelAudit.check_1_no_factory_panel_phrases &&
        !JSON.stringify(rebalancingApi.payload ?? {}).includes("보장 보강 검토"),
      evidence: {
        json_violations: jsonAudit.violations,
        panel_forbidden_hits: panelAudit.forbidden_phrase_hits,
        panel_factory_hits: panelAudit.factory_korean_hits,
        api_payload_has_factory_phrase: JSON.stringify(rebalancingApi.payload ?? {}).includes("보장 보강 검토"),
      },
    },
    check_2_no_claude_explanation_block: {
      question: "Claude 설명 — '리밸런싱 Claude 설명' / claude_explanation 없어졌는가?",
      pass:
        (claudeExplanation == null || String(claudeExplanation).trim() === "") &&
        (claudeMeta?.reason === "FACTORY_SPEAK_05_S1" || claudeMeta?.explanation_mode === "blocked") &&
        !html.includes("리밸런싱 Claude 설명"),
      evidence: {
        claude_explanation: claudeExplanation,
        claude_meta: claudeMeta,
        ai_page_html_has_rebalancing_claude_block: html.includes("리밸런싱 Claude 설명"),
        note: "SPA shell may not include panel text in initial HTML — API + panel voice layer primary",
      },
    },
    check_3_key_voice_present: {
      question: "KEY voice — '현재 확인된 자료 기준으로…' + hedged caveat 형태인가?",
      pass: panelAudit.check_3_key_voice_present,
      evidence: {
        lead: panelAudit.lead,
        keep: panelAudit.keep,
        strengthen: panelAudit.strengthen,
        budget: panelAudit.budget,
        caveat: panelAudit.caveat,
        next_steps: panelAudit.next_steps,
      },
    },
    check_4_json_structured_only: {
      question:
        "Rebalancing JSON — rebalancing_action_codes / budget_delta_band_code / caution_warning_codes only, no next_actions / cautions_before_reduction / budget label?",
      pass: jsonAudit.pass && (claudeExplanation == null || String(claudeExplanation).trim() === ""),
      evidence: {
        ...jsonAudit,
        api_claude_explanation: claudeExplanation,
        api_claude_meta: claudeMeta,
        rebalancing_api_ok: rebalancingApi.ok,
        rebalancing_api_status: rebalancingApi.status,
      },
    },
  };

  const allPass = Object.values(tomChecks).every((check) => check.pass === true);

  const evidence = {
    schema_version: "factory-speak-05-s1-preview-customer-seat-v1",
    audit: "factory_speak_05_s1_preview_customer_seat",
    note: "Observation only — Tom declares Commit/Push GO. Jerry does not declare PASS.",
    tom_one_liner:
      "Rebalancing 공장도 말하지 않는다. codes만 계산하고, 유지관리 판단은 ONE KEY가 고객에게 말한다.",
    preview_base: previewBase,
    git_commit: gitShortSha(),
    observed_at: new Date().toISOString(),
    rebalancing_api: {
      ok: rebalancingApi.ok,
      status: rebalancingApi.status,
      action_code_count: visible.rebalancing_action_codes?.length ?? 0,
      budget_delta_band_code: visible.budget_delta_band_code ?? null,
      design_reference: rebalancingResult.insurance_design_reference?.design_id ?? null,
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
