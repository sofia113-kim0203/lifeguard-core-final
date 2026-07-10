/**
 * S7-a Borrowed Senses — Preview observe probe ONLY (no deploy · no env file read).
 *
 * Usage (default S7Q1–S7Q12 · writes evidence):
 *   node scripts/key-borrowed-senses-preview-observe-probe.mjs <preview-url> <worktree-path>
 *
 * Same-session S7-A continuous observe (console only · no new evidence file):
 *   node scripts/key-borrowed-senses-preview-observe-probe.mjs <preview-url> <worktree-path> --same-session-s7a
 *
 * History-accumulation self-check (no Preview · no env):
 *   node scripts/key-borrowed-senses-preview-observe-probe.mjs --same-session-s7a-selftest
 *
 * Preferred (allowlist-only env load):
 *   node scripts/key-borrowed-senses-preview-observe-run.mjs <preview-url> <worktree-path> [--env-dir <dir>]
 *
 * Or requires pre-exported process.env:
 *   VERCEL_AUTOMATION_BYPASS_SECRET, VITE_SUPABASE_URL|SUPABASE_URL,
 *   VITE_SUPABASE_ANON_KEY|SUPABASE_ANON_KEY, QA_EMAIL|QA_TEST_EMAIL, QA_PASSWORD|QA_TEST_PASSWORD
 *
 * Default mode writes (worktree): fixtures/key-judgment-validation-v1/s7-borrowed-senses-preview-observe-evidence.json
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
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

/** Explicit same-session S7-A turns — live answers only; never fixture static history. */
export const SAME_SESSION_S7A_TURNS = Object.freeze([
  { id: "T1", question: "분당 맛집 추천해줘" },
  { id: "T2", question: "부모님 모시고 가는데 아버지가 최근 수술하셨어" },
  { id: "T3", question: "수술비도 많이 들었고 보험금 받을 수 있을지 걱정이야" },
]);

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
  return { keyVoiceTrace, shadow, speakPayload: speak, oneKeyCoreTrace: trace };
}

/**
 * Append one completed turn's real customer answer into live history.
 * Does not rewrite or sanitize answerText.
 */
export function appendSameSessionHistory(history = [], question = "", answerText = "") {
  const q = String(question ?? "");
  const a = String(answerText ?? "");
  return [
    ...(Array.isArray(history) ? history : []),
    { role: "user", text: q },
    { role: "assistant", text: a },
  ];
}

/** Pure plan of history turn-counts for T1→T3 (mock-friendly). */
export function planSameSessionHistoryCounts(turnCount = SAME_SESSION_S7A_TURNS.length) {
  const counts = [];
  let historyLen = 0;
  for (let i = 0; i < turnCount; i += 1) {
    counts.push(historyLen);
    historyLen += 2; // user + assistant
  }
  return counts;
}

function isKeyMasterTurn({ responseSource = null, speakPayload = null } = {}) {
  const source = String(responseSource ?? "");
  const compose = String(speakPayload?.compose_mode ?? "");
  return (
    speakPayload?.key_speak_master === true ||
    /^key_master/.test(compose) ||
    /^key_master/.test(source) ||
    source === "one_key_core" ||
    /key_s[67]|borrowed_senses|key_voice/.test(compose)
  );
}

function collectCallCounts(keyVoiceTrace = null, shadow = null) {
  const borrowedCalls = Number(
    keyVoiceTrace?.borrowed_senses_calls ?? shadow?.borrowed_senses_calls ?? 0,
  );
  const s6Calls = Number(keyVoiceTrace?.s6_speak_calls ?? shadow?.s6_speak_calls ?? 0);
  const usedRegen = keyVoiceTrace?.used_constrained_regen === true;
  return {
    borrowed_senses_calls: Number.isFinite(borrowedCalls) ? borrowedCalls : 0,
    s6_speak_calls: Number.isFinite(s6Calls) ? s6Calls : 0,
    regeneration_calls: usedRegen ? 1 : 0,
    used_constrained_regen: usedRegen,
  };
}

/** Observation-only content notes — never rewrite customer text. */
export function observeSameSessionContentNotes(id = "", answerText = "") {
  const t = String(answerText ?? "");
  if (id === "T1") {
    return {
      answers_current_request: /맛집|한식|일식|분위기|분당|서현|야탑|추천|식당|음식/.test(t),
      no_insurance_force:
        !/보험료|가입하|해지하|22\s*건|보장\s*(부족|충분)|보험\s*쪽으로/.test(t),
    };
  }
  if (id === "T2") {
    return {
      meal_first: /부모|식사|모시|한식|조용|이동|분위기|식당|맛집/.test(t),
      surgery_as_hypothesis_only:
        !/보험금\s*(?:받|지급).{0,12}(?:됩니다|가능합니다)/.test(t) &&
        !/가입하세요|해지해도\s*됩니다/.test(t),
      no_insurance_force_switch: !/보험료|22\s*건|보장\s*(부족|충분)|보험\s*쪽으로/.test(t),
    };
  }
  if (id === "T3") {
    return {
      no_payout_certainty:
        !/지급됩니다|받을\s*수\s*있습니다|청구\s*가능합니다|가능한\s*경우가\s*많/.test(t),
      no_inventory_dump: !/22\s*건/.test(t),
      docs_or_coverage_next: /진단서|영수증|담보|진료비|서류|확인/.test(t),
    };
  }
  return {};
}

function buildSameSessionTurnRow({
  id,
  question,
  historySent,
  events,
  done,
  answerText,
  keyVoiceTrace,
  shadow,
  speakPayload,
  probeOk,
  probeError = null,
}) {
  const replaces = events.filter((e) => e.type === "replace").map((e) => String(e.data?.text ?? ""));
  const responseSource = done.response_source ?? null;
  const keySpeakOriginal = String(done.key_speak_original ?? "").trim();
  const keyTextEqualApi = done.key_text_equal === true;
  const keyTextEqualObserved =
    !keySpeakOriginal || keySpeakOriginal === String(answerText ?? "").trim();
  const calls = collectCallCounts(keyVoiceTrace, shadow);
  const finalAnswerSource =
    shadow?.final_answer_source ??
    keyVoiceTrace?.borrowed_senses_shadow?.final_answer_source ??
    null;

  return redactObject({
    id,
    question,
    final_customer_answer: answerText,
    history_sent_turn_count: Array.isArray(historySent) ? historySent.length : 0,
    history_sent_preview: (historySent ?? []).map((h) => ({
      role: h.role,
      text_len: String(h.text ?? h.content ?? "").length,
    })),
    response_source: responseSource,
    key_master: isKeyMasterTurn({ responseSource, speakPayload }),
    key_text_equality: {
      api: keyTextEqualApi,
      observed: keyTextEqualObserved,
    },
    replace_count: replaces.length,
    customer_output_count: answerText ? 1 : 0,
    borrowed_senses_calls: calls.borrowed_senses_calls,
    regeneration_calls: calls.regeneration_calls,
    used_constrained_regen: calls.used_constrained_regen,
    s6_speak_calls: calls.s6_speak_calls,
    final_answer_source: finalAnswerSource,
    fast_path_ok: keyVoiceTrace?.fast_path?.ok ?? null,
    mid_field_warnings: keyVoiceTrace?.fast_path?.mid_field_warnings ?? [],
    trace_paths: {
      one_key_core_trace: Boolean(done.one_key_core_trace),
      key_voice_trace: Boolean(keyVoiceTrace),
      borrowed_senses_shadow: Boolean(shadow),
      answer_regeneration: keyVoiceTrace?.answer_regeneration ?? null,
    },
    content_notes: observeSameSessionContentNotes(id, answerText),
    probe_ok: probeOk,
    probe_error: probeError,
  });
}

async function runSameSessionS7aObserve({ previewBase, token, bypass }) {
  /** Live cumulative history — starts empty; fixture static history never used. */
  let history = [];
  const turns = [];

  for (const item of SAME_SESSION_S7A_TURNS) {
    const historySent = history.map((h) => ({ ...h }));
    const probe = await fetchBypassSse({
      previewBase,
      token,
      question: item.question,
      history: historySent,
      bypassSecret: bypass,
    });

    if (!probe.ok) {
      turns.push(
        buildSameSessionTurnRow({
          id: item.id,
          question: item.question,
          historySent,
          events: [],
          done: {},
          answerText: "",
          keyVoiceTrace: null,
          shadow: null,
          speakPayload: null,
          probeOk: false,
          probeError: redactString(probe.stderr_preview ?? probe.probe_error ?? "probe_failed"),
        }),
      );
      break;
    }

    const events = parseSse(probe.stdout);
    const done = events.find((e) => e.type === "done")?.data ?? {};
    // Single customer output: done.answerText only (no rewrite / no concat of deltas).
    const answerText = String(done.answerText ?? "").replace(/\s+/g, " ").trim();
    const { keyVoiceTrace, shadow, speakPayload } = extractTrace(done);

    turns.push(
      buildSameSessionTurnRow({
        id: item.id,
        question: item.question,
        historySent,
        events,
        done,
        answerText,
        keyVoiceTrace,
        shadow,
        speakPayload,
        probeOk: true,
      }),
    );

    // Accumulate real final answer for the next turn (unmodified).
    history = appendSameSessionHistory(history, item.question, answerText);
  }

  return {
    mode: "same-session-s7a",
    schema_version: "s7-borrowed-senses-same-session-observe-v0",
    observed_at: new Date().toISOString(),
    preview_url: previewBase,
    production_touched: false,
    evidence_file_written: false,
    same_token: true,
    same_customer: true,
    history_source: "live_accumulated_answers",
    turns,
    summary: {
      turn_count: turns.length,
      probe_ok_count: turns.filter((t) => t.probe_ok).length,
      history_counts_sent: turns.map((t) => t.history_sent_turn_count),
      expected_history_counts: planSameSessionHistoryCounts(),
      single_customer_output_per_turn: turns.every((t) => !t.probe_ok || t.customer_output_count === 1),
    },
  };
}

function runSameSessionS7aSelftest() {
  const expected = planSameSessionHistoryCounts(3);
  let history = [];
  const sentCounts = [];
  const mockAnswers = ["A1-restaurant", "A2-meal-first", "A3-docs"];
  SAME_SESSION_S7A_TURNS.forEach((item, i) => {
    sentCounts.push(history.length);
    history = appendSameSessionHistory(history, item.question, mockAnswers[i]);
  });
  const ok =
    JSON.stringify(sentCounts) === JSON.stringify(expected) &&
    expected[0] === 0 &&
    expected[1] === 2 &&
    expected[2] === 4 &&
    history.length === 6 &&
    history[0].role === "user" &&
    history[0].text === SAME_SESSION_S7A_TURNS[0].question &&
    history[1].text === mockAnswers[0] &&
    history[5].text === mockAnswers[2] &&
    observeSameSessionContentNotes("T1", "분당 한식 분위기부터 볼까요?").no_insurance_force === true &&
    observeSameSessionContentNotes("T3", "확인 전 지급 단정 불가. 진단서·담보부터.").no_payout_certainty ===
      true;

  console.log(
    JSON.stringify({
      ok,
      mode: "same-session-s7a-selftest",
      expected_history_counts: expected,
      sent_counts: sentCounts,
      final_history_len: history.length,
    }),
  );
  return ok;
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
  if (id === "S7Q3") {
    checks.proposal_direction_present = Boolean(String(borrowed.proposal_direction ?? "").trim());
    checks.missing_proposal_direction_gate_ok = gate.missing_proposal_direction !== true;
    const nd = borrowed.next_decision_point ?? [];
    checks.next_decision_count_ok = Array.isArray(nd) && nd.filter((c) => String(c).trim()).length >= 2;
  }
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
  const argv = process.argv.slice(2);
  const sameSession = argv.includes("--same-session-s7a");
  const selftest = argv.includes("--same-session-s7a-selftest");
  const positional = argv.filter((a) => !String(a).startsWith("--"));

  if (selftest) {
    const ok = runSameSessionS7aSelftest();
    process.exit(ok ? 0 : 2);
  }

  const previewUrl = String(positional[0] ?? "").replace(/\/$/, "");
  const worktree = String(positional[1] ?? "");

  if (!previewUrl || !worktree || !existsSync(worktree)) {
    console.log(JSON.stringify({ ok: false, step: "missing_args" }));
    process.exit(1);
  }

  if (!requiredLocalEnvOk()) {
    console.log(JSON.stringify({ ok: false, step: "local_env_missing" }));
    process.exit(1);
  }

  const bypass = resolveBypassSecret();
  const token = await mintToken();

  // --- Explicit same-session S7-A mode (console only · no evidence write) ---
  if (sameSession) {
    const result = await runSameSessionS7aObserve({
      previewBase: previewUrl,
      token,
      bypass,
    });
    console.log(JSON.stringify(redactObject(result), null, 2));
    const ok =
      result.summary.probe_ok_count === SAME_SESSION_S7A_TURNS.length &&
      result.summary.single_customer_output_per_turn === true;
    process.exit(ok ? 0 : 2);
  }

  // --- Default mode: S7Q1–S7Q12 (unchanged contract) ---
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

const isDirectRun =
  Boolean(process.argv[1]) && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isDirectRun) {
  await main();
}
