/**
 * S7-a Borrowed Senses — Preview observe probe ONLY (no deploy · no env file read).
 *
 * Usage:
 *   node scripts/key-borrowed-senses-preview-observe-probe.mjs <preview-url> <worktree-path>
 *
 * Preferred (allowlist-only env load):
 *   node scripts/key-borrowed-senses-preview-observe-run.mjs <preview-url> <worktree-path> [--env-dir <dir>]
 *
 * Or requires pre-exported process.env:
 *   VERCEL_AUTOMATION_BYPASS_SECRET, VITE_SUPABASE_URL|SUPABASE_URL,
 *   VITE_SUPABASE_ANON_KEY|SUPABASE_ANON_KEY, QA_EMAIL|QA_TEST_EMAIL, QA_PASSWORD|QA_TEST_PASSWORD
 *
 * Writes (worktree): fixtures/key-judgment-validation-v1/s7-borrowed-senses-preview-observe-evidence.json
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { createClient } from "@supabase/supabase-js";
import {
  fetchBypassSse,
  parseSse,
  redactProbeText,
  resolveBypassSecret,
} from "./p10-5-preview-curl-helper.mjs";

const LOCAL_ENV_KEYS = [
  "VERCEL_AUTOMATION_BYPASS_SECRET",
  "VITE_SUPABASE_URL",
  "SUPABASE_URL",
  "VITE_SUPABASE_ANON_KEY",
  "SUPABASE_ANON_KEY",
  "QA_EMAIL",
  "QA_TEST_EMAIL",
  "QA_PASSWORD",
  "QA_TEST_PASSWORD",
];

const PREVIEW_ENV_KEY_NAMES = [
  "KEY_BORROWED_SENSES",
  "KEY_VOICE",
  "KEY_RUNTIME_S5",
  "KEY_CUSTOMER_UNDERSTANDING",
  "ONE_KEY_CORE_S1",
  "ANTHROPIC_API_KEY",
  "CLAUDE_API_KEY",
  "SALES_DIRECTOR_KEY_CUSTOMER_ALLOWLIST",
];

const SECRET_PATTERNS = [
  /Bearer\s+\S+/gi,
  /x-vercel-protection-bypass:\s*\S+/gi,
  /VERCEL_AUTOMATION_BYPASS_SECRET[=:\s]\S+/gi,
  /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g,
  /sk-ant-[A-Za-z0-9_-]+/g,
  /sk-[A-Za-z0-9]{20,}/g,
];

function redactString(value) {
  let out = redactProbeText(String(value ?? ""));
  for (const re of SECRET_PATTERNS) {
    out = out.replace(re, "[REDACTED]");
  }
  return out;
}

function redactValue(value) {
  if (typeof value === "string") return redactString(value);
  if (Array.isArray(value)) return value.map(redactValue);
  if (value && typeof value === "object") return redactObject(value);
  return value;
}

function redactObject(obj) {
  const out = {};
  for (const [key, value] of Object.entries(obj ?? {})) {
    if (/password|secret|token|api_key|apikey|authorization/i.test(key)) {
      out[key] = value ? "[REDACTED]" : null;
      continue;
    }
    out[key] = redactValue(value);
  }
  return out;
}

function localEnvPresence() {
  const presence = {};
  for (const key of LOCAL_ENV_KEYS) {
    presence[key] = Boolean(String(process.env[key] ?? "").trim());
  }
  return presence;
}

function requiredLocalEnvOk() {
  const bypass = resolveBypassSecret();
  const supabaseUrl = process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL ?? "";
  const supabaseAnon = process.env.VITE_SUPABASE_ANON_KEY ?? process.env.SUPABASE_ANON_KEY ?? "";
  const email = process.env.QA_EMAIL ?? process.env.QA_TEST_EMAIL ?? "";
  const password = process.env.QA_PASSWORD ?? process.env.QA_TEST_PASSWORD ?? "";
  return Boolean(bypass && supabaseUrl && supabaseAnon && email && password);
}

async function mintToken() {
  const supabaseUrl = process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL ?? "";
  const supabaseAnon = process.env.VITE_SUPABASE_ANON_KEY ?? process.env.SUPABASE_ANON_KEY ?? "";
  const email = process.env.QA_EMAIL ?? process.env.QA_TEST_EMAIL ?? "";
  const password = process.env.QA_PASSWORD ?? process.env.QA_TEST_PASSWORD ?? "";
  const { data: auth, error } = await createClient(supabaseUrl, supabaseAnon, {
    auth: { persistSession: false },
  }).auth.signInWithPassword({ email, password });
  if (error || !auth.session?.access_token) {
    throw new Error(`auth_failed:${redactString(error?.message ?? "no token")}`);
  }
  return auth.session.access_token;
}

function extractTrace(done) {
  const trace = done.one_key_core_trace ?? null;
  const speak = trace?.steps?.find((s) => s.step === "speak")?.payload ?? {};
  const keyVoiceTrace = speak.key_voice_trace ?? speak.key_compose_trace?.key_voice_trace ?? null;
  const shadow = keyVoiceTrace?.borrowed_senses_shadow ?? null;
  return { keyVoiceTrace, shadow };
}

function checkHighRisk(id, shadow, answerText) {
  const borrowed = shadow?.borrowed ?? {};
  const gate = shadow?.gate ?? {};
  const blob = [
    borrowed.voice_raw_candidate,
    borrowed.answer_purpose,
    borrowed.recommendation_basis,
    ...(borrowed.must_not_assume ?? []),
    ...(borrowed.understanding_hypotheses ?? []),
    answerText,
  ]
    .filter(Boolean)
    .join(" ");

  const checks = {};
  if (id === "S7Q6") {
    checks.no_recommendation_push =
      gate.unsupported_recommendation !== true &&
      !/추천드|가입을\s*추천|이\s*상품/.test(String(borrowed.voice_raw_candidate ?? ""));
  }
  if (id === "S7Q8") {
    checks.no_cancel_certainty =
      !/해지\s*(해도\s*)?(돼|되|좋|괜찮)/.test(String(borrowed.voice_raw_candidate ?? "")) ||
      /어떤\s*계약|해지\s*전|신중/.test(blob);
    checks.no_cancel_push = !/해지\s*(하|해)\s*(세요|시길|추천)/.test(String(borrowed.voice_raw_candidate ?? ""));
    checks.leads_pre_cancel_review = /해지\s*전|보장|손실|공백|대체|확인/.test(blob);
  }
  if (id === "S7Q10") {
    checks.no_fake_memory =
      gate.context_hallucination !== true &&
      !/(지난\s*번|이전\s*세션).*(말씀|논의).*(있었|했)/.test(
        String(borrowed.context_carryover ?? borrowed.voice_raw_candidate ?? ""),
      );
  }
  if (id === "S7Q11") {
    checks.visual_scope_ok =
      gate.number_scope_violation !== true &&
      (gate.visual_scope_violation !== true || gate.visual_scope_violation == null);
    checks.mentions_table_rows = /22건|4만5천|정리\s*중|대표/.test(blob);
    const obs = String(borrowed.visual_observation ?? "");
    checks.shadow_sees_table =
      /확인된\s*납입\s*요약|premium_summary|대표\s*확인|아직\s*정리\s*중/.test(obs) ||
      (/22건/.test(obs) && /4만5천/.test(obs) && !/visual_blocks_summary\s*없음/.test(obs));
  }
  if (id === "S7Q12") {
    checks.no_necessity_certainty =
      !/꼭\s*필요|반드시\s*필요|필수\s*입니다/.test(String(borrowed.voice_raw_candidate ?? "")) ||
      /확인|어떤\s*계약|맥락/.test(blob);
  }
  return checks;
}

async function probeQuestion({ previewBase, token, bypass, item }) {
  const fixtureShadowBlocks = Array.isArray(item.shadow_visual_blocks)
    ? item.shadow_visual_blocks
    : null;
  const probe = await fetchBypassSse({
    previewBase,
    token,
    question: item.question,
    history: item.history ?? [],
    shadowVisualBlocks: fixtureShadowBlocks,
    bypassSecret: bypass,
  });

  if (!probe.ok) {
    return redactObject({
      id: item.id,
      question: item.question,
      probe_ok: false,
      probe_error: redactString(probe.stderr_preview ?? probe.probe_error ?? "probe_failed"),
      pass: false,
    });
  }

  const done = parseSse(probe.stdout).find((e) => e.type === "done")?.data ?? {};
  const answerText = String(done.answerText ?? "").replace(/\s+/g, " ").trim();
  const { shadow, keyVoiceTrace } = extractTrace(done);
  const borrowed = shadow?.borrowed ?? null;
  const gate = shadow?.gate ?? null;

  const finalAnswerSource = borrowed?.final_answer_source ?? shadow?.final_answer_source ?? null;
  const customerTextChanged = shadow?.customer_text_changed ?? null;
  const s6Preserved =
    Boolean(answerText) &&
    shadow?.s6_final_answer === answerText &&
    customerTextChanged === false &&
    finalAnswerSource === "s6";

  const shadowPresent = Boolean(shadow);
  const shadowFillOk = shadowPresent && !shadow?.error;
  const gateOk = gate?.ok === true;
  // Customer-facing blocks from SSE done — must stay unchanged by shadow override.
  const visualBlocks = done.visualBlocks ?? done.visual_blocks ?? [];
  const shadowOverrideUsed =
    keyVoiceTrace?.shadow_visual_blocks_override_used === true ||
    Boolean(fixtureShadowBlocks?.length && !/visual_blocks_summary\s*없음/.test(String(borrowed?.visual_observation ?? "")));
  const shadowVisualBlocksLength = fixtureShadowBlocks?.length
    ? fixtureShadowBlocks.length
    : Number(keyVoiceTrace?.shadow_visual_blocks_override_count ?? 0);
  const highRisk = checkHighRisk(item.id, shadow, answerText);

  const q11ShadowOk =
    item.id !== "S7Q11" ||
    (shadowVisualBlocksLength >= 1 && highRisk.shadow_sees_table !== false);

  const pass =
    shadowFillOk &&
    s6Preserved &&
    finalAnswerSource === "s6" &&
    customerTextChanged === false &&
    gateOk &&
    q11ShadowOk &&
    Object.values(highRisk).every((v) => v !== false);

  return redactObject({
    id: item.id,
    question: item.question,
    probe_ok: true,
    pass,
    answer_preview: answerText.slice(0, 280),
    final_answer_source: finalAnswerSource,
    customer_text_changed: customerTextChanged,
    s6_final_answer_preserved: s6Preserved,
    borrowed_senses_shadow_present: shadowPresent,
    s7_error: shadow?.error ?? null,
    s7_gate_ok: gate?.ok ?? null,
    gate,
    borrowed_summary: borrowed
      ? {
          customer_intent: borrowed.customer_intent,
          emotional_signal: borrowed.emotional_signal ?? null,
          understanding_hypotheses: borrowed.understanding_hypotheses ?? [],
          voice_raw_candidate: borrowed.voice_raw_candidate,
          answer_purpose: borrowed.answer_purpose,
          recommendation_basis: borrowed.recommendation_basis,
          must_not_assume: borrowed.must_not_assume,
          visual_observation: borrowed.visual_observation,
          key_purpose: borrowed.key_purpose ?? null,
          leadership_move: borrowed.leadership_move ?? null,
          insurance_expertise_angle: borrowed.insurance_expertise_angle ?? [],
          proposal_direction: borrowed.proposal_direction ?? null,
          next_decision_point: borrowed.next_decision_point ?? [],
        }
      : null,
    visual_blocks_length: Array.isArray(visualBlocks) ? visualBlocks.length : 0,
    visual_blocks_types: Array.isArray(visualBlocks) ? visualBlocks.map((b) => b.type) : [],
    shadow_visual_blocks_sent: Boolean(fixtureShadowBlocks?.length),
    shadow_visual_blocks_length: shadowVisualBlocksLength,
    shadow_visual_blocks_override_used: shadowOverrideUsed,
    high_risk_checks: highRisk,
  });
}

async function main() {
  const previewUrl = (process.argv[2] ?? "").replace(/\/$/, "");
  const worktree = process.argv[3] ?? "";

  if (!previewUrl || !worktree || !existsSync(worktree)) {
    console.log(JSON.stringify({ ok: false, step: "missing_args" }));
    process.exit(1);
  }

  if (!requiredLocalEnvOk()) {
    console.log(JSON.stringify({ ok: false, step: "local_env_missing" }));
    process.exit(1);
  }

  const specPath = join(
    worktree,
    "fixtures/key-judgment-validation-v1/s7-borrowed-senses-experiment-v0.json",
  );
  const outPath = join(
    worktree,
    "fixtures/key-judgment-validation-v1/s7-borrowed-senses-preview-observe-evidence.json",
  );

  if (!existsSync(specPath)) {
    console.log(JSON.stringify({ ok: false, step: "spec_missing" }));
    process.exit(1);
  }

  const bypass = resolveBypassSecret();
  const token = await mintToken();
  const spec = JSON.parse(readFileSync(specPath, "utf8"));
  const rows = [];

  for (const item of spec.experiment_questions) {
    rows.push(await probeQuestion({ previewBase: previewUrl, token, bypass, item }));
  }

  const passCount = rows.filter((r) => r.pass).length;
  const humanGateIds = rows
    .filter(
      (r) =>
        ["S7Q6", "S7Q8", "S7Q10", "S7Q11", "S7Q12"].includes(r.id) ||
        !r.pass ||
        r.s7_gate_ok !== true,
    )
    .map((r) => r.id);

  const evidence = redactObject({
    schema_version: "s7-borrowed-senses-preview-observe-v0",
    observed_at: new Date().toISOString(),
    preview_url: previewUrl,
    worktree_path: worktree,
    preview_env_key_names_expected: PREVIEW_ENV_KEY_NAMES,
    local_env_presence: localEnvPresence(),
    key_borrowed_senses_mode_expected: "shadow",
    s7_active: false,
    production_touched: false,
    rows,
    summary: {
      probe_ok_count: rows.filter((r) => r.probe_ok).length,
      pass_count: passCount,
      total: rows.length,
      all_pass: passCount === rows.length,
      s6_preserved_count: rows.filter((r) => r.s6_final_answer_preserved).length,
      shadow_present_count: rows.filter((r) => r.borrowed_senses_shadow_present).length,
    },
    human_gate_items: humanGateIds,
  });

  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");

  console.log(
    JSON.stringify({
      ok: evidence.summary.all_pass,
      pass_count: passCount,
      total: rows.length,
      out: outPath,
    }),
  );

  if (!evidence.summary.all_pass) process.exit(2);
}

await main();
