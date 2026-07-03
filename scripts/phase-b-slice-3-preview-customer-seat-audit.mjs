/**
 * Phase B Slice 3 — Preview customer-seat audit (observation only).
 * Tom gate: "알아서 봐줘." — judgment takeover, no decision deflection.
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
import {
  DELEGATION_FORBIDDEN_RE,
  DELEGATION_OPENER,
} from "../server/keyBrain/phaseBSlice3DelegationJudgment.js";

const ROOT = join(import.meta.dirname, "..");
const FIX = join(ROOT, "fixtures", "key-judgment-validation-v1");
const OUT = join(FIX, "phase-b-slice-3-preview-customer-seat-evidence.json");

const SLICE3_Q = "알아서 봐줘.";
const LEGACY_RELATIONAL_RE = /여쭤볼|확인이\s*목적.{0,12}결정/;

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
    judgmentComposeMode: trace.finalize_trace?.key_compose_trace?.compose_mode ?? null,
    responseSource: done.response_source ?? null,
  };
}

function auditTomPreviewSeat(text = "") {
  const answer = String(text);
  const tom_seat_audit = {
    judgment_first: answer.startsWith(DELEGATION_OPENER),
    no_decision_deflection:
      !DELEGATION_FORBIDDEN_RE.test(answer) &&
      !LEGACY_RELATIONAL_RE.test(answer) &&
      !answer.includes("제일 걸리는 축"),
    customer_understandable_reason: /등록|보장|분석|이전|자료|유지|구조/.test(answer),
    honest_boundary: /단정하지\s*않|어렵|확인되지\s*않/.test(answer),
    natural_first_action: /이번에는.*같이|같이\s*확인|저장해\s*주시면/.test(answer),
  };
  const guardrails = {
    no_legacy_companion_opener: !answer.includes("제일 걸리는 축"),
    no_legacy_relational_probe: !LEGACY_RELATIONAL_RE.test(answer),
    no_forbidden_questions: !DELEGATION_FORBIDDEN_RE.test(answer),
  };
  return { tom_seat_audit, guardrails, tom_five_pass: Object.values(tom_seat_audit).every(Boolean) };
}

async function main() {
  loadPreviewProbeEnvFile(join(ROOT, ".env.local"));
  loadPreviewProbeEnvFile(join(ROOT, ".env.preview.pulled"));
  const previewBaseArg = process.argv[2]?.startsWith("http") ? process.argv[2].trim() : "";
  const bypass = resolveBypassSecret();
  const resolved = resolvePreviewProbeEnv({ previewBase: previewBaseArg });
  if (!resolved.previewBase || !bypass) {
    console.error("BLOCKED — preview URL and bypass required");
    process.exit(1);
  }
  const token = await mintPreviewProbeJwt(resolved);
  const probe = await fetchBypassSse({
    previewBase: resolved.previewBase,
    token,
    question: SLICE3_Q,
    history: [],
    bypassSecret: bypass,
  });
  let extracted = { answerText: "" };
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
    schema_version: "phase-b-slice-3-preview-customer-seat-evidence-v1",
    audit_purpose: "로컬 Delegation Intent 경험이 Preview에서 재현되는가",
    slice: "Phase B Slice 3 — Delegation (알아서 봐줘.)",
    question: SLICE3_Q,
    recorded_at: new Date().toISOString(),
    git_short_sha: gitShortSha(),
    preview_base: resolved.previewBase,
    auth_fingerprint: previewAuthPathFingerprint(resolved),
    probe_ok: probeOk,
    probe_error: probeError,
    answer_text: extracted.answerText || null,
    judgment_compose_mode: extracted.judgmentComposeMode,
    expected_compose_mode: "phase_b_slice3_delegation",
    tom_seat_audit: seatAudit.tom_seat_audit,
    tom_five_pass: seatAudit.tom_five_pass,
    guardrails: seatAudit.guardrails,
    jerry_pass_declaration: "none",
    tom_seat_audit_status: "pending",
  };
  writeFileSync(OUT, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
  console.log("[Phase B Slice 3 Preview Customer Seat]");
  console.log(`question: ${SLICE3_Q}`);
  console.log(`answer: ${extracted.answerText ? extracted.answerText.slice(0, 200) : "(missing)"}`);
  for (const [key, value] of Object.entries(seatAudit.tom_seat_audit)) {
    console.log(`  ${key}: ${value ? "yes" : "no"}`);
  }
  console.log(`tom_five_pass (observation): ${seatAudit.tom_five_pass}`);
  console.log("Tom/진woo seat signoff: pending");
  if (!probeOk) process.exit(1);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
