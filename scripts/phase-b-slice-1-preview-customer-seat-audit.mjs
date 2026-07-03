/**
 * Phase B Slice 1 — Preview customer-seat audit evidence (observation only).
 * Tom gate: "내 보험 괜찮아?" must match local expert-judgment experience on Preview.
 * Jerry does NOT declare Slice 1 complete. Tom/진woo seat signoff required.
 *
 * Usage:
 *   node scripts/phase-b-slice-1-preview-customer-seat-audit.mjs [preview-url]
 */
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  loadPreviewProbeEnvFile,
  mintPreviewProbeJwt,
  previewAuthPathFingerprint,
  resolvePreviewProbeEnv,
} from "./preview-auth-probe-path.mjs";
import { fetchBypassSse, parseSse, resolveBypassSecret } from "./p10-5-preview-curl-helper.mjs";

const ROOT = join(import.meta.dirname, "..");
const FIX = join(ROOT, "fixtures", "key-judgment-validation-v1");
const OUT = join(FIX, "phase-b-slice-1-preview-customer-seat-evidence.json");

const SLICE1_Q = "내 보험 괜찮아?";
const COVERAGE_CLUSTER = "JC-COVERAGE-ANXIETY-v1";

const DEFLECT_RE = /제일\s*불편|뭐가\s*불편|오늘은\s*확인이\s*목적/;
const INVENTORY_DUMP_RE = /확인\s*가능한\s*내용|field_count|OCR/i;
const EMPATHY_OPENER_RE = /걱정되시는|마음은\s*이해|뭔가\s*빠진\s*것\s*같/;
const INTERNAL_REASON_RE = /저장된\s*분석\s*기준|가입\s*\d+\s*건과\s*저장/;

function gitShortSha() {
  return spawnSync("git", ["rev-parse", "--short", "HEAD"], { cwd: ROOT, encoding: "utf8" }).stdout?.trim() ?? null;
}

function extractAnswer(events) {
  const done = events.find((e) => e.type === "done")?.data ?? {};
  const trace = done.sales_director_trace ?? done.salesDirectorTrace ?? {};
  const keyPath = trace.p10_4_key_path_trace ?? {};
  const replaces = events.filter((e) => e.type === "replace").map((e) => e.data?.text ?? "");
  const deltas = events.filter((e) => e.type === "delta").map((e) => e.data?.text ?? "");
  const answerText = String(done.answerText ?? replaces.at(-1) ?? deltas.join("") ?? "").trim();
  return {
    answerText,
    classificationIntent: keyPath.classificationIntent ?? done.consultation_intent ?? null,
    companionCluster: keyPath.companion_cluster ?? done.factBundle?.companion_cluster ?? null,
    matchedRule: keyPath.matched_rule ?? null,
    judgmentComposeMode:
      trace.finalize_trace?.key_compose_trace?.compose_mode ??
      done.sales_director_judgment_audit?.compose_mode ??
      null,
    responseSource: done.response_source ?? null,
  };
}

function auditTomPreviewSeat(text = "") {
  const answer = String(text);
  const tom_seat_audit = {
    judgment_first: /^지금 확인|지금은\s*등록|지금\s*확인된/.test(answer),
    customer_understandable_reason: /현재\s*자료|등록된\s*보험|확인되는\s*범위|그\s*축/.test(answer),
    honest_boundary: /단정하지\s*않|확인되지\s*않|어렵습니다|말씀드리기\s*어렵/.test(answer),
    natural_next_action: /이번에는.*같이|같이\s*확인|같이\s*맞춰|같이\s*보|저장해\s*주시면/.test(answer),
  };
  const guardrails = {
    no_empathy_opener: !EMPATHY_OPENER_RE.test(answer),
    no_deflection: !DEFLECT_RE.test(answer),
    no_inventory_dump: !INVENTORY_DUMP_RE.test(answer),
    no_internal_reason: !INTERNAL_REASON_RE.test(answer),
  };
  const tom_four_pass = Object.values(tom_seat_audit).every(Boolean);
  return { tom_seat_audit, guardrails, tom_four_pass };
}

async function main() {
  loadPreviewProbeEnvFile(join(ROOT, ".env.local"));
  loadPreviewProbeEnvFile(join(ROOT, ".env.preview.pulled"));

  const previewBaseArg = process.argv[2]?.startsWith("http") ? process.argv[2].trim() : "";
  const bypass = resolveBypassSecret();
  const resolved = resolvePreviewProbeEnv({ previewBase: previewBaseArg });

  if (!resolved.previewBase || !bypass) {
    console.error("BLOCKED — preview URL and VERCEL_AUTOMATION_BYPASS_SECRET required");
    process.exit(1);
  }

  const token = await mintPreviewProbeJwt(resolved);
  const probe = await fetchBypassSse({
    previewBase: resolved.previewBase,
    token,
    question: SLICE1_Q,
    history: [],
    bypassSecret: bypass,
  });

  let extracted = {
    answerText: "",
    classificationIntent: null,
    companionCluster: null,
    matchedRule: null,
    judgmentComposeMode: null,
    responseSource: null,
  };
  let probeOk = false;
  let probeError = null;

  if (probe.ok) {
    extracted = extractAnswer(parseSse(probe.stdout));
    probeOk = extracted.answerText.length > 0;
    if (!probeOk) probeError = "empty_answer";
  } else {
    probeError = probe.unauthorized ? "UNAUTHORIZED" : `http_${probe.http_status ?? "unknown"}`;
  }

  const seatAudit = auditTomPreviewSeat(extracted.answerText);

  const evidence = {
    schema_version: "phase-b-slice-1-preview-customer-seat-evidence-v1",
    audit_purpose: "로컬 전문가 경험이 Preview에서 동일하게 재현되는가 (Evidence는 판정 증거)",
    slice: "Phase B Slice 1 — Coverage adequacy",
    question: SLICE1_Q,
    recorded_at: new Date().toISOString(),
    git_short_sha: gitShortSha(),
    preview_base: resolved.previewBase,
    auth_fingerprint: previewAuthPathFingerprint(resolved),
    probe_ok: probeOk,
    probe_error: probeError,
    http_status: probe.http_status ?? null,
    answer_text: extracted.answerText || null,
    answer_preview: extracted.answerText ? extracted.answerText.slice(0, 320) : null,
    classification_intent: extracted.classificationIntent,
    matched_rule: extracted.matchedRule,
    companion_cluster: extracted.companionCluster,
    expected_companion_cluster: COVERAGE_CLUSTER,
    judgment_compose_mode: extracted.judgmentComposeMode,
    response_source: extracted.responseSource,
    tom_seat_audit: seatAudit.tom_seat_audit,
    tom_four_pass: seatAudit.tom_four_pass,
    guardrails: seatAudit.guardrails,
    jerry_pass_declaration: "none",
    tom_seat_audit_status: "pending",
    slice_1_completion_status: "awaiting_preview_customer_seat_audit",
  };

  writeFileSync(OUT, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");

  console.log("[Phase B Slice 1 Preview Customer Seat]");
  console.log(`question: ${SLICE1_Q}`);
  console.log(`answer: ${extracted.answerText ? extracted.answerText.slice(0, 200) : "(missing)"}`);
  console.log("Tom 4-item seat audit:");
  for (const [key, value] of Object.entries(seatAudit.tom_seat_audit)) {
    console.log(`  ${key}: ${value ? "yes" : "no"}`);
  }
  console.log(`tom_four_pass (observation): ${seatAudit.tom_four_pass}`);
  console.log("Tom/진woo seat signoff: pending — Jerry does not declare Slice 1 complete");

  if (!probeOk) process.exit(1);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
