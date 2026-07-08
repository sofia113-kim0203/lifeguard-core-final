/**
 * B0Q2/B0Q3 단독 reprobe — 7-B-2a stabilize.
 */
import fs from "node:fs";
import { join } from "node:path";
import { classifyConsultationIntent } from "../server/intentGateLayer.js";
import { buildKeyFirstJudgment } from "../server/keyBrain/documentFirstJudgment.js";
import { buildRuntimeS5TurnBundle } from "../server/keyCore/keyRuntimeS5.js";
import { buildKeyVoiceComposeResult } from "../server/keyCore/keyVoiceCompose.js";
import { gateBorrowedSensesOutput } from "../server/keyCore/keyBorrowedSensesGate.js";
import { resolveAnthropicApiKey } from "../server/claudeGroundedExecutionCore.js";

const ROOT = join(import.meta.dirname, "..");
const TARGETS = process.argv.slice(2).length ? process.argv.slice(2) : ["B0Q2", "B0Q3"];

function loadEnvFile(relativePath) {
  const full = join(ROOT, relativePath);
  if (!fs.existsSync(full)) return;
  for (const line of fs.readFileSync(full, "utf8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i <= 0) continue;
    const k = t.slice(0, i).trim();
    const v = t.slice(i + 1).trim().replace(/^['"]|['"]$/g, "");
    if (!process.env[k]) process.env[k] = v;
  }
}

loadEnvFile(".env.local");
loadEnvFile(".env");
if (!resolveAnthropicApiKey(process.env)) {
  for (const name of fs.readdirSync(ROOT).filter((n) => n.startsWith(".env.local.backup")).sort().reverse()) {
    loadEnvFile(name);
    if (resolveAnthropicApiKey(process.env)) break;
  }
}

process.env.KEY_RUNTIME_S5 = "active";
process.env.KEY_CUSTOMER_UNDERSTANDING = "off";
process.env.KEY_VOICE = "on";
process.env.KEY_BORROWED_SENSES = "shadow";
process.env.KEY_BORROWED_SENSES_TIMEOUT_MS = "45000";

function mockPolicies22() {
  return Array.from({ length: 22 }, (_, i) => ({
    insurer_name: i === 0 ? "삼성생명" : "메리츠화재",
    product_name: "실손의료비보험",
    monthly_premium: i === 0 ? 45000 : 85000,
    status: "active",
    source: "profile",
  }));
}

function ctx22() {
  const policies = mockPolicies22();
  return {
    contextSnapshot: { bundle: { policies, memoryFacts: [], recentConversation: { hasHistory: false, latestUserMessages: [], latestUserMessageExcerpt: null } }, flags: { has_policies: true } },
    loadedContext: { profile: "present", policies: "present", documents: "empty", memory: "empty", conversations: { status: "empty", source: [], phase_filter_applied: false }, consents: "empty", flags: {} },
  };
}

const spec = JSON.parse(fs.readFileSync(join(ROOT, "fixtures/key-judgment-validation-v1/s7b-leadership-schema-v0.json"), "utf8"));

for (const id of TARGETS) {
  const item = spec.golden_shapes.find((g) => g.id === id);
  const question = item.question;
  const { contextSnapshot, loadedContext } = ctx22();
  const consultationIntent = classifyConsultationIntent(question);
  const history = item.history ?? [];
  const bundle = buildRuntimeS5TurnBundle({ question, contextSnapshot, loadedContext, consultationIntent, history });
  const keyFirstJudgment = buildKeyFirstJudgment({ question, contextSnapshot, loadedContext, consultationIntent });
  const voice = await buildKeyVoiceComposeResult(
    { ...bundle, ...keyFirstJudgment },
    { question, history, env: process.env },
  );
  const trace = voice?.key_voice_trace ?? {};
  const s7 = trace.borrowed_senses_shadow ?? {};
  const borrowed = s7.borrowed ?? {};
  const gate = s7.gate ?? gateBorrowedSensesOutput({ borrowed, directive: trace.directive, history, question });
  console.log(JSON.stringify({ id, question, s6: voice?.text?.slice(0, 80), gate, next_decision_point: borrowed.next_decision_point, visual_observation: borrowed.visual_observation }, null, 2));
}
