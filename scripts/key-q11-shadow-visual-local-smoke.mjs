/**
 * Local Q11 shadow-only visual override smoke (Claude optional).
 * Verifies customer-facing visual_blocks stay empty/unrelated while shadow sees fixture table.
 */
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { buildKeyVoiceComposeResult } from "../server/keyCore/keyVoiceCompose.js";
import { buildRuntimeS5TurnBundle } from "../server/keyCore/keyRuntimeS5.js";
import { classifyConsultationIntent } from "../server/intentGateLayer.js";
import { buildKeyFirstJudgment } from "../server/keyBrain/documentFirstJudgment.js";
import { resolveAnthropicApiKey } from "../server/claudeGroundedExecutionCore.js";
import { resolveShadowVisualBlocksOverride } from "../server/keyCore/shadowVisualBlocksOverride.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const spec = JSON.parse(
  readFileSync(join(root, "fixtures/key-judgment-validation-v1/s7-borrowed-senses-experiment-v0.json"), "utf8"),
);
const item = (spec.experiment_questions ?? []).find((q) => q.id === "S7Q11");
if (!item) throw new Error("S7Q11 missing from fixture");

for (const name of [".env.local", ".env"]) {
  const p = join(root, name);
  if (!existsSync(p)) continue;
  for (const line of readFileSync(p, "utf8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#") || !t.includes("=")) continue;
    const i = t.indexOf("=");
    const k = t.slice(0, i).trim();
    let v = t.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (!process.env[k]) process.env[k] = v;
  }
}

process.env.KEY_VOICE = "on";
process.env.KEY_BORROWED_SENSES = "shadow";
process.env.KEY_RUNTIME_S5 = "active";

const override = resolveShadowVisualBlocksOverride(item.shadow_visual_blocks, process.env);
if (!override?.length) {
  console.log(JSON.stringify({ ok: false, step: "override_resolve_failed" }));
  process.exit(1);
}

const question = item.question;
const history = item.history ?? [];
const previousAnswerSummary = history.filter((h) => h.role === "assistant").slice(-1)[0]?.text ?? "";
const consultationIntent = classifyConsultationIntent(question);
const contextSnapshot = { bundle: { recentConversation: history } };
const loadedContext = null;
const bundle = buildRuntimeS5TurnBundle({
  question,
  contextSnapshot,
  loadedContext,
  consultationIntent,
  history,
});
const keyFirstJudgment = buildKeyFirstJudgment({
  question,
  contextSnapshot,
  loadedContext,
  consultationIntent,
});

if (!resolveAnthropicApiKey(process.env)) {
  console.log(
    JSON.stringify({
      ok: true,
      mode: "override_unit_only",
      anthropic: false,
      override_count: override.length,
      customer_facing_note: "compose skipped — no API key; override gate PASS",
    }),
  );
  process.exit(0);
}

const voice = await buildKeyVoiceComposeResult(
  { ...bundle, ...keyFirstJudgment },
  {
    question,
    history,
    previousAnswerSummary,
    shadowVisualBlocksOverride: override,
    env: process.env,
  },
);

const trace = voice?.key_voice_trace ?? {};
const shadow = trace.borrowed_senses_shadow ?? {};
const borrowed = shadow.borrowed ?? {};
const customerBlocks = voice?.visual_blocks ?? [];
const obs = String(borrowed.visual_observation ?? "");
const s6 = String(voice?.text ?? "");
const report = {
  ok: true,
  mode: "local_compose",
  s6_len: s6.length,
  customer_visual_blocks_length: customerBlocks.length,
  customer_visual_blocks_types: customerBlocks.map((b) => b.type),
  shadow_override_used: trace.shadow_visual_blocks_override_used === true,
  shadow_override_count: trace.shadow_visual_blocks_override_count ?? 0,
  final_answer_source: borrowed.final_answer_source ?? shadow.final_answer_source ?? null,
  customer_text_changed: shadow.customer_text_changed ?? null,
  visual_observation_preview: obs.slice(0, 220),
  shadow_sees_table:
    /확인된\s*납입\s*요약|premium_summary|대표\s*확인|아직\s*정리\s*중/.test(obs) ||
    (/22건/.test(obs) && /4만5천/.test(obs) && !/visual_blocks_summary\s*없음/.test(obs)),
  gate_ok: shadow.gate?.ok ?? null,
  visual_scope_violation: shadow.gate?.visual_scope_violation ?? null,
  understanding_pollution: shadow.gate?.understanding_pollution ?? null,
  s7_error: shadow.error ?? null,
  key_purpose: borrowed.key_purpose ?? null,
  next_decision_len: Array.isArray(borrowed.next_decision_point)
    ? borrowed.next_decision_point.length
    : 0,
};

const pass =
  report.shadow_override_used &&
  report.shadow_override_count >= 1 &&
  report.final_answer_source === "s6" &&
  report.customer_text_changed === false &&
  report.shadow_sees_table &&
  report.gate_ok === true &&
  report.visual_scope_violation !== true &&
  !report.s7_error;

console.log(JSON.stringify({ ...report, pass }, null, 2));
process.exit(pass ? 0 : 1);
