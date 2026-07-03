/**
 * Phase C Slice 2 — Preview customer-seat audit (observation only).
 * Tom v1.1 gate: Phase B Premium Judge + Care Plan Contract on "보험료 부담돼."
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
import { CARE_PLAN_TRANSITION } from "../server/keyBrain/phaseCSlice1CoverageCarePlan.js";
import { PREMIUM_CARE_PLAN_FORBIDDEN_RE } from "../server/keyBrain/phaseCSlice2PremiumCarePlan.js";

const ROOT = join(import.meta.dirname, "..");
const FIX = join(ROOT, "fixtures", "key-judgment-validation-v1");
const OUT = join(FIX, "phase-c-slice-2-preview-customer-seat-evidence.json");

const SLICE2_Q = "보험료 부담돼.";
const PREMIUM_CLUSTER = "JC-PREMIUM-BURDEN-v1";
const EMPATHY_OPENER_RE = /느껴지시는|마음은\s*이해|걱정되시는/;
const COMPANION_RE = /함께|같이/;

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
    companionCluster: keyPath.companion_cluster ?? null,
    matchedRule: keyPath.matched_rule ?? null,
    responseSource: done.response_source ?? null,
  };
}

function auditTomPreviewSeat(text = "") {
  const answer = String(text);
  const transitionIdx = answer.indexOf(CARE_PLAN_TRANSITION);
  const judgmentEnd = answer.search(/단정하지\s*않|어렵습니다|말씀드리기\s*어렵|판단하기\s*어렵/);
  const carePlanPart = transitionIdx >= 0 ? answer.slice(transitionIdx) : answer;

  const phase_b_seat = {
    judgment_first: /^지금|^현재/.test(answer),
    customer_understandable_reason: /등록|보장|납입|가치|자료/.test(answer),
    honest_boundary: /단정하지\s*않|확인되지\s*않|어렵/.test(answer),
    plan_not_conclusion: !/줄이(?:세요|시|라)|해지(?:하(?:세요|시|라))/.test(carePlanPart),
  };

  const care_plan_contract = {
    judge_to_plan_transition:
      answer.includes(CARE_PLAN_TRANSITION) && transitionIdx > 0 && judgmentEnd > 0 && transitionIdx > judgmentEnd,
    what_present: /①/.test(answer) && COMPANION_RE.test(carePlanPart),
    when_present: /이번\s*달|다음|그다음|갱신\s*시기|저장\s*후/.test(answer),
    why_present: /\(.*때문입니다|\).*위해서입니다\)/.test(answer),
    plan_reassurance: /앞으로는\s*이렇게|이번\s*달/.test(answer),
    companion_voice: COMPANION_RE.test(carePlanPart),
    not_product_pitch: !PREMIUM_CARE_PLAN_FORBIDDEN_RE.test(carePlanPart) && !EMPATHY_OPENER_RE.test(answer),
  };

  const slice2_contract_pass = [
    care_plan_contract.judge_to_plan_transition,
    care_plan_contract.what_present,
    care_plan_contract.when_present,
    care_plan_contract.why_present,
    care_plan_contract.companion_voice,
    care_plan_contract.plan_reassurance,
    care_plan_contract.not_product_pitch,
    phase_b_seat.plan_not_conclusion,
  ].every(Boolean);

  return {
    phase_b_seat,
    care_plan_contract,
    slice2_contract_pass,
    guardrails: {
      no_first_action_overlap: !/이번에는.*같이\s*확인/.test(answer),
      no_empathy_opener: !EMPATHY_OPENER_RE.test(answer),
    },
  };
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
    question: SLICE2_Q,
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
    schema_version: "phase-c-slice-2-preview-customer-seat-evidence-v1",
    audit_purpose: "Phase B Premium Judge + Phase C Care Plan Contract v1.1 on Preview",
    slice: "Phase C Slice 2 — Premium Care Plan",
    question: SLICE2_Q,
    recorded_at: new Date().toISOString(),
    git_short_sha: gitShortSha(),
    preview_base: resolved.previewBase,
    auth_fingerprint: previewAuthPathFingerprint(resolved),
    probe_ok: probeOk,
    probe_error: probeError,
    answer_text: extracted.answerText || null,
    companion_cluster: extracted.companionCluster,
    expected_companion_cluster: PREMIUM_CLUSTER,
    phase_b_seat_audit: seatAudit.phase_b_seat,
    care_plan_contract: seatAudit.care_plan_contract,
    slice2_contract_pass: seatAudit.slice2_contract_pass,
    guardrails: seatAudit.guardrails,
    jerry_pass_declaration: "none",
    tom_seat_audit_status: "pending",
  };
  writeFileSync(OUT, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
  console.log("[Phase C Slice 2 Preview Customer Seat]");
  console.log(`question: ${SLICE2_Q}`);
  console.log(`answer: ${extracted.answerText ? extracted.answerText.slice(0, 220) : "(missing)"}`);
  console.log("Phase B seat:");
  for (const [key, value] of Object.entries(seatAudit.phase_b_seat)) {
    console.log(`  ${key}: ${value ? "yes" : "no"}`);
  }
  console.log("Care Plan contract v1.1:");
  for (const [key, value] of Object.entries(seatAudit.care_plan_contract)) {
    console.log(`  ${key}: ${value ? "yes" : "no"}`);
  }
  console.log(`slice2_contract_pass (observation): ${seatAudit.slice2_contract_pass}`);
  console.log("Tom/진woo seat signoff: pending");
  if (!probeOk) process.exit(1);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
