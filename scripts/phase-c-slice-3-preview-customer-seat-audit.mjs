/**
 * Phase C Slice 3 — Preview customer-seat audit (observation only).
 * Tom v1.2: Care Leadership + Lead/Decision boundary on "알아서 봐줘."
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
import { DELEGATION_OPENER, DELEGATION_FORBIDDEN_RE } from "../server/keyBrain/phaseBSlice3DelegationJudgment.js";
import {
  DELEGATION_CARE_PLAN_FORBIDDEN_RE,
  DELEGATION_CARE_PLAN_TRANSITION,
} from "../server/keyBrain/phaseCSlice3DelegationCarePlan.js";

const ROOT = join(import.meta.dirname, "..");
const FIX = join(ROOT, "fixtures", "key-judgment-validation-v1");
const OUT = join(FIX, "phase-c-slice-3-preview-customer-seat-evidence.json");

const SLICE3_Q = "알아서 봐줘.";
const LEADERSHIP_RE = /제가\s*먼저/;

function gitShortSha() {
  return spawnSync("git", ["rev-parse", "--short", "HEAD"], { cwd: ROOT, encoding: "utf8" }).stdout?.trim() ?? null;
}

function extractAnswer(events) {
  const done = events.find((e) => e.type === "done")?.data ?? {};
  const trace = done.sales_director_trace ?? done.salesDirectorTrace ?? {};
  const composeMode = trace.finalize_trace?.key_compose_trace?.compose_mode ?? null;
  const replaces = events.filter((e) => e.type === "replace").map((e) => e.data?.text ?? "");
  const deltas = events.filter((e) => e.type === "delta").map((e) => e.data?.text ?? "");
  const answerText = String(done.answerText ?? replaces.at(-1) ?? deltas.join("") ?? "").trim();
  return {
    answerText,
    composeMode,
    classificationIntent: trace.p10_4_key_path_trace?.classificationIntent ?? done.consultation_intent ?? null,
    responseSource: done.response_source ?? null,
  };
}

function auditTomPreviewSeat(text = "") {
  const answer = String(text);
  const transitionIdx = answer.indexOf(DELEGATION_CARE_PLAN_TRANSITION);
  const judgmentEnd = answer.search(/단정하지\s*않|어렵습니다|말씀드리기\s*어렵|판단하기\s*어렵/);
  const carePlanPart = transitionIdx >= 0 ? answer.slice(transitionIdx) : answer;

  const phase_b_seat = {
    judgment_first: answer.startsWith(DELEGATION_OPENER),
    no_decision_deflection: !DELEGATION_FORBIDDEN_RE.test(answer),
    customer_understandable_reason: /등록|보장|분석|유지|구조/.test(answer),
    honest_boundary: /단정하지\s*않|확인되지\s*않|어렵/.test(answer),
    lead_not_decide_for_customer: !/(?:가입|해지|청구)\s*(?:하(?:세요|시|라)|확정)/.test(carePlanPart),
  };

  const care_plan_contract = {
    judge_to_plan_transition:
      answer.includes(DELEGATION_CARE_PLAN_TRANSITION) && transitionIdx > 0 && judgmentEnd > 0 && transitionIdx > judgmentEnd,
    what_present: /①/.test(answer) && LEADERSHIP_RE.test(carePlanPart),
    when_present: /이번\s*달|다음|그다음|정리\s*후/.test(answer),
    why_present: /\(.*때문입니다|\).*하려는\s*것입니다\)/.test(answer),
    plan_reassurance: /같이\s*진행|함께\s*결정|같이/.test(answer),
    care_leadership: LEADERSHIP_RE.test(carePlanPart),
    not_product_pitch: !DELEGATION_CARE_PLAN_FORBIDDEN_RE.test(carePlanPart),
  };

  const delegation_care_plan_tom = {
    key_leads_first: LEADERSHIP_RE.test(carePlanPart),
    no_decision_dump_to_customer: !DELEGATION_FORBIDDEN_RE.test(answer) && !/제일\s*걸리는\s*축/.test(answer),
    final_decision_together: /함께\s*결정|같이\s*정하|같이\s*보|같이\s*잡/.test(carePlanPart),
    no_over_delegation_promise: !/다\s*맡겨|맡겨\s*주|전부\s*제가/.test(carePlanPart),
    primary_care_physician_feel: answer.startsWith(DELEGATION_OPENER) && LEADERSHIP_RE.test(carePlanPart),
  };

  const slice3_contract_pass = [
    care_plan_contract.judge_to_plan_transition,
    care_plan_contract.what_present,
    care_plan_contract.when_present,
    care_plan_contract.why_present,
    care_plan_contract.care_leadership,
    care_plan_contract.not_product_pitch,
    phase_b_seat.lead_not_decide_for_customer,
    ...Object.values(delegation_care_plan_tom),
  ].every(Boolean);

  return {
    phase_b_seat,
    care_plan_contract,
    delegation_care_plan_tom,
    slice3_contract_pass,
    guardrails: {
      no_first_action_overlap: !/이번에는.*같이\s*확인/.test(answer),
      compose_mode_expected: "phase_b_slice3_delegation",
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
    question: SLICE3_Q,
    history: [],
    bypassSecret: bypass,
  });
  let extracted = { answerText: "", composeMode: null };
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
    schema_version: "phase-c-slice-3-preview-customer-seat-evidence-v1",
    audit_purpose: "Phase B Delegation Judge + Phase C Care Leadership Contract v1.2 on Preview",
    slice: "Phase C Slice 3 — Delegation Care Plan",
    question: SLICE3_Q,
    recorded_at: new Date().toISOString(),
    git_short_sha: gitShortSha(),
    preview_base: resolved.previewBase,
    auth_fingerprint: previewAuthPathFingerprint(resolved),
    probe_ok: probeOk,
    probe_error: probeError,
    answer_text: extracted.answerText || null,
    compose_mode: extracted.composeMode,
    expected_compose_mode: "phase_b_slice3_delegation",
    phase_b_seat_audit: seatAudit.phase_b_seat,
    care_plan_contract: seatAudit.care_plan_contract,
    delegation_care_plan_tom: seatAudit.delegation_care_plan_tom,
    slice3_contract_pass: seatAudit.slice3_contract_pass,
    guardrails: seatAudit.guardrails,
    jerry_pass_declaration: "none",
    tom_seat_audit_status: "pending",
  };
  writeFileSync(OUT, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
  console.log("[Phase C Slice 3 Preview Customer Seat]");
  console.log(`question: ${SLICE3_Q}`);
  console.log(`compose_mode: ${extracted.composeMode ?? "(missing)"}`);
  console.log(`answer: ${extracted.answerText ? extracted.answerText.slice(0, 220) : "(missing)"}`);
  console.log("Delegation Care Plan (Tom):");
  for (const [key, value] of Object.entries(seatAudit.delegation_care_plan_tom)) {
    console.log(`  ${key}: ${value ? "yes" : "no"}`);
  }
  console.log("Care Plan contract v1.2:");
  for (const [key, value] of Object.entries(seatAudit.care_plan_contract)) {
    console.log(`  ${key}: ${value ? "yes" : "no"}`);
  }
  console.log(`slice3_contract_pass (observation): ${seatAudit.slice3_contract_pass}`);
  console.log("Tom/진woo seat signoff: pending");
  if (!probeOk) process.exit(1);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
