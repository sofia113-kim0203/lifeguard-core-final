/**
 * KEY-GI-1 QA — 20문항 품질 감사 (live LLM · Tom human read).
 *
 * Usage:
 *   node scripts/key-gi-1-qa-quality-audit-exec.mjs
 *   node scripts/key-gi-1-qa-quality-audit-exec.mjs --preview
 *   node scripts/key-gi-1-qa-quality-audit-exec.mjs --direct-gi1
 *
 * Modes:
 *   default (local) — full homeBrainFactRequest + GK delegation (needs ANTHROPIC_API_KEY)
 *   --direct-gi1    — L1 prompt path only via generateLifeguardChatResponse (needs ANTHROPIC_API_KEY)
 *   --preview       — deployed Preview SSE probe (needs QA env + GI-1 deployed)
 * Mechanical hints only — Tom fills human checklist · no PASS auto-declaration.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

import { handleHomeBrainFactRequest } from "../server/homeBrainFactCore.js";
import { detectForbiddenOutputPatterns } from "../server/humanUnderstandingLoop.js";
import { resolveAnthropicApiKey } from "../server/claudeGroundedExecutionCore.js";
import { generateLifeguardChatResponse } from "../server/lifeguardChatCore.js";
import {
  loadPreviewProbeEnvFile,
  mintPreviewProbeJwt,
  probePreviewSse,
  resolveJudgmentComposeMode,
  resolvePreviewProbeEnv,
} from "./preview-auth-probe-path.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const FIX = join(ROOT, "fixtures/key-judgment-validation-v1");
const BANK_PATH = join(FIX, "gi-1-qa-bank-v1.json");
const OUT_JSON = join(FIX, "key-gi-1-qa-quality-audit-v1-evidence.json");
const OUT_MD = join(FIX, "key-gi-1-qa-quality-audit-v1-evidence.md");

const DRY_RUN = process.argv.includes("--dry-run");
const PREVIEW_ARG =
  process.argv.find((a) => a.startsWith("https://"))?.replace(/\/$/, "") ?? null;
const USE_PREVIEW = process.argv.includes("--preview") || Boolean(PREVIEW_ARG);
const DIRECT_GI1 = process.argv.includes("--direct-gi1");
const CUSTOMER_ID = "cust-gi1-qa-audit";

const INSURANCE_PUSH_RE =
  /(?:필요하시면\s*보험|보험\s*상담도|보험\s*이야기\s*해볼|가입\s*내역\s*한번\s*볼|실손(?:이|을)?|담보\s*구조|보험료\s*부담|보장(?:이|을)?\s*확인)/i;
const ENGINE_EXPOSURE_RE =
  /(?:Gap|Coverage\s*Gap|orchestrator|Tom\s*Thinking|추천엔진|보장분석|파이프라인|memory_fact)/i;
const KEY_VOICE_BAD_RE =
  /(?:LIFEGUARD:|😀|😊|!!+|ㅋㅋ|ㅎㅎ)/;

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

function buildMockSupabase() {
  return {
    from(table) {
      const chain = {
        select() {
          return chain;
        },
        eq() {
          return chain;
        },
        is() {
          return chain;
        },
        order() {
          return chain;
        },
        limit() {
          return chain;
        },
        maybeSingle: async () => ({
          data: { id: CUSTOMER_ID, display_name: "GI1 QA", memory_version: 1 },
          error: null,
        }),
        then(onFulfilled, onRejected) {
          let payload = { data: [], error: null, count: 0 };
          if (table === "active_profile_insurance_policies") {
            payload = {
              data: [{ product_name: "실손", policy_type: "health", monthly_premium: 45000 }],
              error: null,
            };
          }
          if (table === "customer_memory_facts") {
            payload = {
              data: [{ fact_key: "worry", fact_value: "보험료 부담" }],
              error: null,
              count: 1,
            };
          }
          if (table === "customer_context_snapshots") {
            payload = {
              data: [
                {
                  id: "snap-gi1-qa",
                  context_snapshot_id: "snap-gi1-qa",
                  customer_id: CUSTOMER_ID,
                  payload: {},
                },
              ],
              error: null,
            };
          }
          return Promise.resolve(payload).then(onFulfilled, onRejected);
        },
      };
      return chain;
    },
  };
}

function extractTrace(result) {
  const sdt = result.sales_director_trace ?? {};
  const finalize = sdt.finalize_trace ?? {};
  const kct = finalize.key_compose_trace ?? {};
  return {
    compose_mode: kct.compose_mode ?? finalize.generation_mode ?? null,
    chat_profile: kct.chat_profile ?? null,
    gi1_max_chars: kct.gi1_max_chars ?? null,
    generation_mode: finalize.generation_mode ?? null,
    response_source: result.responseSource ?? finalize.response_source ?? null,
    forbidden_scan: kct.forbidden_pattern_scan ?? finalize.forbidden_pattern_scan ?? null,
  };
}

function mechanicalHints(answerText = "") {
  const text = String(answerText ?? "").trim();
  const forbidden = detectForbiddenOutputPatterns(text);
  return {
    answer_chars: text.length,
    within_gi1_cap: text.length <= 900,
    insurance_push_heuristic: INSURANCE_PUSH_RE.test(text),
    engine_exposure_heuristic: ENGINE_EXPOSURE_RE.test(text),
    key_voice_bad_heuristic: KEY_VOICE_BAD_RE.test(text),
    forbidden_pattern_scan: forbidden,
    note: "heuristic only — Tom human read decides quality",
  };
}

async function probeQuestionPreview(row, previewBase, token, env) {
  const startedAt = Date.now();
  const probe = await probePreviewSse({
    previewBase,
    question: row.q,
    history: [],
    token,
    env,
  });

  if (!probe.probe_ok) {
    return {
      ...row,
      answer_text: "",
      trace: { compose_mode: null, probe_error: probe.probe_error },
      routing_ok: false,
      latency_ms: Date.now() - startedAt,
      mechanical_hints: mechanicalHints(""),
      probe_ok: false,
      probe_error: probe.probe_error,
      tom_human_checklist: {
        natural: null,
        factual_ok: null,
        no_insurance_push: null,
        gpt_level: null,
        key_voice: null,
        notes: `probe failed: ${probe.probe_error}`,
      },
    };
  }

  const done = probe.done ?? {};
  const answerText = String(done.answerText ?? done.answer_text ?? done.text ?? "").trim();
  const composeMode = resolveJudgmentComposeMode(done);
  const hints = mechanicalHints(answerText);

  return {
    ...row,
    answer_text: answerText,
    trace: {
      compose_mode: composeMode,
      chat_profile: done.sales_director_trace?.finalize_trace?.key_compose_trace?.chat_profile ?? null,
      generation_mode: done.sales_director_trace?.finalize_trace?.generation_mode ?? null,
      response_source: done.responseSource ?? done.response_source ?? null,
    },
    routing_ok: composeMode === "general_knowledge_delegation",
    latency_ms: Date.now() - startedAt,
    mechanical_hints: hints,
    probe_ok: true,
    tom_human_checklist: {
      natural: null,
      factual_ok: null,
      no_insurance_push: null,
      gpt_level: null,
      key_voice: null,
      notes: "",
    },
  };
}

async function probeQuestionDirectGi1(row, env) {
  const startedAt = Date.now();
  const llm = await generateLifeguardChatResponse({
    question: row.q,
    history: [],
    fetchImpl: fetch,
    env,
    gi1Profile: true,
  });
  const answerText = String(llm.text ?? "").trim();
  const hints = mechanicalHints(answerText);
  return {
    ...row,
    answer_text: answerText,
    trace: {
      compose_mode: "general_knowledge_delegation",
      chat_profile: llm.chat_profile ?? "gi1",
      gi1_max_chars: llm.max_chars_applied ?? 900,
      response_source: llm.response_source ?? null,
      probe_path: "direct_gi1_prompt",
    },
    routing_ok: llm.ok === true && llm.response_source === "lifeguard_claude",
    latency_ms: Date.now() - startedAt,
    mechanical_hints: hints,
    probe_ok: llm.ok === true,
    probe_error: llm.ok ? null : llm.reason,
    tom_human_checklist: {
      natural: null,
      factual_ok: null,
      no_insurance_push: null,
      gpt_level: null,
      key_voice: null,
      notes: "",
    },
  };
}

async function probeQuestion(row, env) {
  const startedAt = Date.now();
  const result = await handleHomeBrainFactRequest({
    question: row.q,
    history: [],
    userSupabase: buildMockSupabase(),
    customerId: CUSTOMER_ID,
    env: {
      ...env,
      SALES_DIRECTOR_KEY_ORCHESTRATOR: "1",
      SALES_DIRECTOR_KEY_CUSTOMER_ALLOWLIST: CUSTOMER_ID,
    },
    fetchImpl: fetch,
    requestStartedAt: startedAt,
    streamHandlers: { _emitted: false, onDelta() {}, onReplace() {} },
  });

  const answerText = String(result.answerText ?? "").trim();
  const trace = extractTrace(result);
  const hints = mechanicalHints(answerText);

  return {
    ...row,
    answer_text: answerText,
    trace,
    routing_ok: trace.compose_mode === "general_knowledge_delegation",
    latency_ms: Date.now() - startedAt,
    mechanical_hints: hints,
    tom_human_checklist: {
      natural: null,
      factual_ok: null,
      no_insurance_push: null,
      gpt_level: null,
      key_voice: null,
      notes: "",
    },
  };
}

function buildMarkdown(evidence) {
  const lines = [
    "# KEY-GI-1 QA Quality Audit (20문항)",
    "",
    `observed_at: ${evidence.observed_at}`,
    `implementation_sha: ${evidence.implementation_sha ?? "unknown"}`,
    `mode: ${evidence.mode}`,
    `pass_declaration: ${evidence.pass_declaration}`,
    "",
    "> Regression 전 Tom human read gate. Mechanical hints ≠ quality PASS.",
    "",
    "## Tom checklist (each item)",
    "",
    ...(evidence.tom_checklist ?? []).map((item) => `- ${item}`),
    "",
    "---",
    "",
  ];

  let currentDomain = null;
  for (const row of evidence.probes) {
    if (row.domain !== currentDomain) {
      currentDomain = row.domain;
      lines.push(`## ${currentDomain}`, "");
    }
    lines.push(`### ${row.id} — ${row.q}`, "");
    lines.push("**답변**", "");
    lines.push("```");
    lines.push(row.answer_text || "(empty)");
    lines.push("```");
    lines.push("");
    lines.push("| routing | compose_mode | chars | insurance_heuristic | forbidden |");
    lines.push("|---------|--------------|-------|---------------------|-----------|");
    lines.push(
      `| ${row.routing_ok ? "GK delegation OK" : "⚠ not GK"} | ${row.trace.compose_mode ?? "—"} | ${row.mechanical_hints.answer_chars} | ${row.mechanical_hints.insurance_push_heuristic ? "⚠ flag" : "—"} | ${row.mechanical_hints.forbidden_pattern_scan.pass ? "pass" : row.mechanical_hints.forbidden_pattern_scan.hits.join(",")} |`,
    );
    lines.push("");
    lines.push("**Tom human read (fill in evidence JSON)**");
    lines.push("- [ ] 자연스러운가?");
    lines.push("- [ ] 사실 오류 없는가?");
    lines.push("- [ ] 보험 억지 연결 없는가?");
    lines.push("- [ ] GPT 수준인가?");
    lines.push("- [ ] KEY 말투 유지되는가?");
    lines.push("");
    lines.push("---");
    lines.push("");
  }

  lines.push("## Summary (Tom fills after read)");
  lines.push("");
  lines.push("- GPT 수준에 가까워졌는가?: _pending_");
  lines.push("- Regression GO?: _pending_");
  lines.push("");
  return `${lines.join("\n")}\n`;
}

async function main() {
  loadEnvFile(join(ROOT, ".env.local"));
  loadEnvFile(join(ROOT, ".env.preview.pulled"));

  const bank = JSON.parse(readFileSync(BANK_PATH, "utf8"));
  const apiKey = resolveAnthropicApiKey(process.env);
  const previewBase = PREVIEW_ARG ?? process.env.PREVIEW_BASE?.replace(/\/$/, "") ?? "";

  if (!DRY_RUN && !USE_PREVIEW && !DIRECT_GI1 && !apiKey) {
    console.error(
      JSON.stringify({
        ok: false,
        error: "ANTHROPIC_API_KEY_MISSING",
        hint: "Add ANTHROPIC_API_KEY to .env.local · then: npm run exec:key-gi-1-qa-quality-audit · or --direct-gi1 for L1 prompt-only QA",
      }),
    );
    process.exit(1);
  }

  if (!DRY_RUN && DIRECT_GI1 && !apiKey) {
    console.error(
      JSON.stringify({
        ok: false,
        error: "ANTHROPIC_API_KEY_MISSING",
        hint: "--direct-gi1 requires ANTHROPIC_API_KEY in .env.local for live Tom read answers",
      }),
    );
    process.exit(1);
  }

  mkdirSync(FIX, { recursive: true });

  const probes = [];
  let probeMode = "dry-run";
  let previewMeta = null;

  if (DRY_RUN) {
    probeMode = "dry-run";
    for (const row of bank.questions) {
      probes.push({
        ...row,
        answer_text: "",
        trace: { compose_mode: null },
        routing_ok: null,
        latency_ms: 0,
        mechanical_hints: mechanicalHints(""),
        tom_human_checklist: {
          natural: null,
          factual_ok: null,
          no_insurance_push: null,
          gpt_level: null,
          key_voice: null,
          notes: "dry-run — no live answer",
        },
        dry_run: true,
      });
    }
  } else if (DIRECT_GI1) {
    probeMode = "direct-gi1";
    for (const row of bank.questions) {
      process.stdout.write(`direct-gi1 probing ${row.id}...\n`);
      probes.push(await probeQuestionDirectGi1(row, process.env));
      await new Promise((r) => setTimeout(r, 400));
    }
  } else if (USE_PREVIEW) {
    probeMode = "preview";
    const resolved = resolvePreviewProbeEnv({ previewBase, env: process.env });
    const token = await mintPreviewProbeJwt(resolved);
    previewMeta = { preview_base: resolved.previewBase };
    for (const row of bank.questions) {
      process.stdout.write(`preview probing ${row.id}...\n`);
      probes.push(await probeQuestionPreview(row, resolved.previewBase, token, process.env));
      await new Promise((r) => setTimeout(r, 500));
    }
  } else {
    probeMode = "local-live";
    for (const row of bank.questions) {
      process.stdout.write(`local probing ${row.id}...\n`);
      probes.push(await probeQuestion(row, process.env));
      await new Promise((r) => setTimeout(r, 400));
    }
  }

  const routingOk = probes.filter((p) => p.routing_ok === true).length;
  const insuranceFlags = probes.filter((p) => p.mechanical_hints.insurance_push_heuristic).length;
  const forbiddenFails = probes.filter((p) => !p.mechanical_hints.forbidden_pattern_scan.pass).length;

  const evidence = {
    document: "key_gi_1_qa_quality_audit_v1_evidence",
    slice: "KEY-GI-1",
    phase: "GI1-QA",
    mode: DRY_RUN
      ? "dry-run · bank only"
      : `${probeMode} · Tom human read · no PASS`,
    probe_mode: probeMode,
    preview_meta: previewMeta,
    status: "submitted — Tom human read pending",
    version: "1.0.0",
    observed_at: new Date().toISOString(),
    pass_declaration: "none",
    implementation_sha: gitShortSha(),
    qa_bank_ref: "fixtures/key-judgment-validation-v1/gi-1-qa-bank-v1.json",
    l1_ref: "fixtures/key-judgment-validation-v1/key-gi-1-l1-prompt-profile-v1-evidence.json",
    tom_checklist:
      bank.tom_checklist ??
      (bank.tom_scoring?.dimensions ?? []).map((d) => `${d}: Tom 1~5 score`),
    tom_question: "GI-1이 정말 GPT 수준에 가까워졌는가? — human read before regression",
    exec_order_note: "GI1-QA before ~110 regression · QA=quality · Regression=not broken",
    probes,
    mechanical_summary: {
      total: probes.length,
      routing_gk_delegation: routingOk,
      insurance_push_heuristic_flags: insuranceFlags,
      forbidden_pattern_fails: forbiddenFails,
      note: "Mechanical summary only — Tom decides GPT-level quality",
    },
    tom_verdict: {
      gpt_level_close: null,
      regression_go: null,
      notes: "",
    },
    jerry: "GI1-QA only · regression held · no PASS",
  };

  writeFileSync(OUT_JSON, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
  writeFileSync(OUT_MD, buildMarkdown(evidence), "utf8");

  console.log(
    JSON.stringify({
      ok: true,
      dry_run: DRY_RUN,
      out_json: OUT_JSON,
      out_md: OUT_MD,
      routingOk,
      insuranceFlags,
      forbiddenFails,
    }),
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
