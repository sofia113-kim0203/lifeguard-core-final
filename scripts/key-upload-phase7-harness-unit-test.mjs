/**
 * Phase 7 harness gate — header≡plan≡predicate≡summary + P-H1-SPEECH real-chat re-pass.
 * LIVE = 0 · product mod = 0
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  evaluatePh1Speech,
  normalizeChatTimeline,
  P_H1_SPEECH_ID,
} from "./key-upload-h1-speech-chat-predicate.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const PLAN_PATH = join(
  ROOT,
  "fixtures/key-judgment-validation-v1/key-remaining-root-close-live-plan-v1.json",
);

let passed = 0;
async function test(name, fn) {
  await fn();
  passed += 1;
  console.log(`PASS ${name}`);
}

function arraysEqual(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

await test("ALIGN-1 header ≡ pass_predicate ≡ summary", () => {
  const plan = JSON.parse(readFileSync(PLAN_PATH, "utf8"));
  assert.equal(plan.harness_law, "header ≡ plan ≡ pass_predicate ≡ summary");
  assert.ok(arraysEqual(plan.header, plan.pass_predicate), "header≠pass_predicate");
  assert.ok(arraysEqual(plan.header, plan.summary), "header≠summary");
  assert.ok(plan.header.includes(P_H1_SPEECH_ID), "P-H1-SPEECH missing from header");
  assert.ok(
    Array.isArray(plan.forbidden_checks) &&
      plan.forbidden_checks.some((x) => /notifySystemMessage|enableSystemMessage/.test(x)),
    "plan must forbid symbol-name speech fails",
  );
  assert.match(plan.predicates[P_H1_SPEECH_ID], /symbol-name residue scan FORBIDDEN/i);
  assert.match(plan.predicates[P_H1_SPEECH_ID], /Customer chat KEY-outside system sentences = 0/i);
  assert.equal(plan.live, 0);
});

await test("ALIGN-2 H1 step pass_predicate includes P-H1-SPEECH real-chat expect", () => {
  const plan = JSON.parse(readFileSync(PLAN_PATH, "utf8"));
  const h1 = plan.live_steps.H1;
  assert.ok(h1.pass_predicate.includes(P_H1_SPEECH_ID));
  assert.ok(
    h1.expect.some((line) => /KEY-outside system sentences/.test(line) && /symbol names/i.test(line)),
  );
  assert.ok(!h1.expect.some((line) => /enableSystemMessage|notifySystemMessage/.test(line)));
});

await test("SPEECH-1 clean DocumentsPanel upload timeline PASSes P-H1-SPEECH", () => {
  // Simulates observed customer chat after Panel upload with S-SPEECH assembly:
  // local banner only + later KEY assistant — no system role insert.
  const messages = normalizeChatTimeline([
    {
      role: "ui_local",
      content: "업로드되었습니다",
      metadata: { channel: "documents_panel_banner", ui_local: true },
    },
    {
      role: "assistant",
      content: "서류를 확인했습니다.",
      metadata: { key_sealed: true },
    },
  ]);
  const result = evaluatePh1Speech(messages, { surface: "DocumentsPanel" });
  assert.equal(result.ok, true);
  assert.equal(result.key_outside_system_count, 0);
  assert.equal(result.check_mode, "customer_chat_timeline");
  assert.equal(result.forbidden_check, "symbol_name_residue_scan");
});

await test("SPEECH-2 KEY-outside system sentence FAILs P-H1-SPEECH", () => {
  const messages = normalizeChatTimeline([
    {
      role: "system",
      content: "문서 분석이 완료되었습니다.",
      metadata: { event: "system_message", source: "document_upload_system_chat" },
    },
    {
      role: "assistant",
      content: "서류를 확인했습니다.",
      metadata: { key_sealed: true },
    },
  ]);
  const result = evaluatePh1Speech(messages, { surface: "DocumentsPanel" });
  assert.equal(result.ok, false);
  assert.equal(result.key_outside_system_count, 1);
  assert.equal(result.offenders[0].role, "system");
});

await test("SPEECH-3 symbol-scan rows are ignored (cannot false-FAIL)", () => {
  const messages = normalizeChatTimeline([
    {
      kind: "bundle_string_scan",
      enableSystemMessage_present: true,
      notifySystemMessage_present: true,
    },
    {
      role: "assistant",
      content: "KEY sealed",
      metadata: { key_sealed: true },
    },
  ]);
  const result = evaluatePh1Speech(messages);
  assert.equal(result.ok, true, "symbol residue must not drive Speech fail");
  assert.equal(result.key_outside_system_count, 0);
});

await test("SPEECH-4 re-pass: current product Panel upload chat shape", () => {
  // Re-pass contract for assembled S-SPEECH: upload hook writes local success only;
  // customer_conversations gains no role=system from that path.
  const observedAfterPanelUpload = normalizeChatTimeline([
    {
      role: "ui_local",
      content: "업로드 성공 배너",
      metadata: { ui_local: true, channel: "documents_panel_banner" },
    },
  ]);
  const result = evaluatePh1Speech(observedAfterPanelUpload, { surface: "DocumentsPanel" });
  assert.equal(result.ok, true);
  assert.equal(result.id, P_H1_SPEECH_ID);
});

console.log(`${passed} phase7 harness tests passed (LIVE=0)`);
