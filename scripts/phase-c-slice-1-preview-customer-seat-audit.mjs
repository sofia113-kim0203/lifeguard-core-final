/**
 * Phase C Slice 1 — Preview customer-seat audit (observation only).
 * Tom gate: Phase B Judge + Care Plan Contract on "내 보험 괜찮아?"
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
  CARE_PLAN_FORBIDDEN_RE,
  CARE_PLAN_TRANSITION,
} from "../server/keyBrain/phaseCSlice1CoverageCarePlan.js";

const ROOT = join(import.meta.dirname, "..");
const FIX = join(ROOT, "fixtures", "key-judgment-validation-v1");
const OUT = join(FIX, "phase-c-slice-1-preview-customer-seat-evidence.json");

const SLICE1_Q = "내 보험 괜찮아?";
const COVERAGE_CLUSTER = "JC-COVERAGE-ANXIETY-v1";
const EMPATHY_OPENER_RE = /걱정되시는|마음은\s*이해|뭔가\s*빠진\s*것\s*같/;

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
  const judgmentEnd = answer.search(/단정하지\s*않|어렵습니다|말씀드리기\s*어렵/);

  const phase_b_seat = {
    judgment_first: /^지금 확인|지금은\s*등록/.test(answer),
    customer_understandable_reason: /현재\s*자료|등록된\s*보험|확인되는\s*범위/.test(answer),
    honest_boundary: /단정하지\s*않|확인되지\s*않|어렵/.test(answer),
  };

  const care_plan_contract = {
    judge_to_plan_transition:
      answer.includes(CARE_PLAN_TRANSITION) && transitionIdx > 0 && judgmentEnd > 0 && transitionIdx > judgmentEnd,
    what_present: /①/.test(answer) && /확인|점검|저장|정리/.test(answer),
    when_present: /이번\s*달|올해\s*안|갱신\s*시기|저장\s*후|그다음/.test(answer),
    why_present: /때문|위해서|급하지|확정하기/.test(answer),
    plan_reassurance: /이번\s*달|올해\s*안|앞으로는\s*이렇게/.test(answer),
    not_product_pitch: !CARE_PLAN_FORBIDDEN_RE.test(answer) && !EMPATHY_OPENER_RE.test(answer),
  };

  const slice1_contract_pass = [
    care_plan_contract.judge_to_plan_transition,
    care_plan_contract.what_present,
    care_plan_contract.when_present,
    care_plan_contract.plan_reassurance,
    care_plan_contract.not_product_pitch,
  ].every(Boolean);

  return {
    phase_b_seat,
    care_plan_contract,
    why_deferred_slice1: !care_plan_contract.why_present,
    slice1_contract_pass,
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
    question: SLICE1_Q,
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
    schema_version: "phase-c-slice-1-preview-customer-seat-evidence-v1",
    audit_purpose: "Phase B Judge + Phase C Care Plan Contract on Preview",
    slice: "Phase C Slice 1 — Care Plan Next Step",
    question: SLICE1_Q,
    recorded_at: new Date().toISOString(),
    git_short_sha: gitShortSha(),
    preview_base: resolved.previewBase,
    auth_fingerprint: previewAuthPathFingerprint(resolved),
    probe_ok: probeOk,
    probe_error: probeError,
    answer_text: extracted.answerText || null,
    companion_cluster: extracted.companionCluster,
    expected_companion_cluster: COVERAGE_CLUSTER,
    phase_b_seat_audit: seatAudit.phase_b_seat,
    care_plan_contract: seatAudit.care_plan_contract,
    why_deferred_slice1: seatAudit.why_deferred_slice1,
    slice1_contract_pass: seatAudit.slice1_contract_pass,
    guardrails: seatAudit.guardrails,
    jerry_pass_declaration: "none",
    tom_seat_audit_status: "pending",
  };
  writeFileSync(OUT, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
  console.log("[Phase C Slice 1 Preview Customer Seat]");
  console.log(`question: ${SLICE1_Q}`);
  console.log(`answer: ${extracted.answerText ? extracted.answerText.slice(0, 220) : "(missing)"}`);
  console.log("Phase B seat:");
  for (const [key, value] of Object.entries(seatAudit.phase_b_seat)) {
    console.log(`  ${key}: ${value ? "yes" : "no"}`);
  }
  console.log("Care Plan contract:");
  for (const [key, value] of Object.entries(seatAudit.care_plan_contract)) {
    const note = key === "why_present" && seatAudit.why_deferred_slice1 ? " (deferred Slice 2+)" : "";
    console.log(`  ${key}: ${value ? "yes" : "no"}${note}`);
  }
  console.log(`slice1_contract_pass (observation): ${seatAudit.slice1_contract_pass}`);
  console.log("Tom/진woo seat signoff: pending");
  if (!probeOk) process.exit(1);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
