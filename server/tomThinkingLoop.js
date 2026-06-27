/**
 * Tom 2-A — Thinking loop owns intent/evidence/judgment; LLM translates only.
 */
import { generateTomRegulatedChatResponse } from "./casualChatResponseCore.js";
import { ONE_BRAIN_SURFACES } from "./oneBrainResponseLayer.js";
import {
  buildGapEvidenceAudit,
  formatTomRegulatedEvidenceBlock,
  EVIDENCE_STATUS,
} from "./tomEvidenceLens.js";

export const TOM_THINKING_STEPS = [
  "intent",
  "required_information",
  "audit_known_unknown",
  "hold_or_answer",
  "request_missing_material",
  "continue_conversation",
];

function normalizeQuestion(question = "") {
  return String(question ?? "").replace(/\s+/g, " ").trim();
}

export function runTomThinkingPlan({ question = "", intent = "", factBundle = {} } = {}) {
  const normalizedQuestion = normalizeQuestion(question);
  const audit = buildGapEvidenceAudit(
    { ...factBundle, question: normalizedQuestion },
    normalizedQuestion,
  );

  const stepIntent =
    intent === "coverage_gap_check"
      ? `coverage_adequacy_question:${audit.topic ?? "gap"}`
      : "general_insurance_question";

  const requiredEvidence = audit.fields
    .filter((field) => /diagnosis_benefit|similar_benefit|surgery_benefit|_contract/.test(field.id))
    .map((field) => field.id);

  const holdJudgment = !audit.judgment_ready;

  return {
    steps: TOM_THINKING_STEPS,
    intent: stepIntent,
    required_evidence: requiredEvidence,
    audit,
    hold_judgment: holdJudgment,
    next_action: holdJudgment ? "request_more_document" : "explain_known_evidence",
  };
}

export function composeTomThinkingDecision(plan) {
  const audit = plan.audit;
  const label = audit.topicLabel ?? "해당 보장";
  const knownLabels = audit.fields
    .filter((field) => field.status === EVIDENCE_STATUS.KNOWN)
    .map((field) => field.label);
  const unknownLabels = audit.missing_labels ?? [];

  if (plan.hold_judgment) {
    return [
      "[Tom decision — translate ONLY; do not add facts, numbers, or judgments]",
      `question: ${audit.question}`,
      `topic: ${label}`,
      `step1_intent: ${plan.intent}`,
      `step2_required_before_answer: ${audit.missing_summary}`,
      `step3_audit_known: ${knownLabels.length > 0 ? knownLabels.join(", ") : "none"}`,
      `step3_audit_unknown: ${unknownLabels.join(", ")}`,
      `step4_judgment: HOLD — sufficient/insufficient must NOT be stated`,
      `step5_next_material: 보장내역서 추가 페이지`,
      `step6_continue: invite customer to send the document and continue the conversation`,
      `voice_order: (1) open warmly as Tom with a brief "잠깐 볼게요" style opener, (2) direct answer to the question with hold allowed, (3) say what is not visible yet from audit unknown fields — never 상담사 phrases like "말씀드리기 어렵습니다", (4) ask for the next document page in friendly Tom tone`,
    ].join("\n");
  }

  return [
    "[Tom decision — translate ONLY; do not add facts, numbers, or judgments]",
    `question: ${audit.question}`,
    `topic: ${label}`,
    `step4_judgment: ANSWER using known fields only`,
    `step3_audit_known: ${knownLabels.join(", ")}`,
    `step6_continue: keep conversation open for follow-up`,
  ].join("\n");
}

export function composeTomGapHoldFallback(plan) {
  const audit = plan.audit;
  const label = audit.topicLabel ?? "해당 보장";
  return `잠깐 볼게요. 지금 자료에선 ${label} 진단비 금액이 안 보여요. 그래서 부족한지는 아직 판단 못 하겠어요. 보장내역서 다음 장 주시면 같이 볼게요.`;
}

export const INVENTORY_DUMP_PATTERNS = [
  /현재\s*\d+\s*건의\s*보험/,
  /월\s*보험료/,
  /318,683|31만8천/,
  /등록된\s*서류\s*\d+\s*건/,
  /등록된\s*고객\s*정보\s*\d+\s*건/,
  /문서\s*\d+\s*건/,
  /AI\s*상담실/,
];

export function violatesHomeInventoryDump(text = "") {
  const normalized = String(text ?? "").trim();
  if (!normalized) return false;
  for (const pattern of INVENTORY_DUMP_PATTERNS) {
    if (pattern.test(normalized)) return true;
  }
  return false;
}

export function violatesTomGapVoiceChecks(text, audit) {
  const normalized = String(text ?? "").trim();
  if (!normalized) return "empty";

  for (const pattern of INVENTORY_DUMP_PATTERNS) {
    if (pattern.test(normalized)) return "inventory_or_redirect";
  }

  if (/부족합니다|충분합니다|없습니다|반드시\s*부족|확실히\s*부족/.test(normalized)) {
    return "judgment_assertion";
  }

  const unknownAmountFields = (audit?.fields ?? []).filter(
    (field) =>
      /diagnosis_benefit|similar_benefit|surgery_benefit/.test(field.id) &&
      field.status !== EVIDENCE_STATUS.KNOWN,
  );
  if (unknownAmountFields.length > 0 && /[\d,]+원/.test(normalized)) {
    return "fabricated_amount";
  }

  return null;
}

export async function runTomThinkingTurn({
  question = "",
  intent = "",
  factBundle = {},
  history = [],
  fetchImpl = fetch,
  env = process.env,
} = {}) {
  const normalizedQuestion = normalizeQuestion(question);
  const plan = runTomThinkingPlan({ question: normalizedQuestion, intent, factBundle });
  const regulatedEvidence = formatTomRegulatedEvidenceBlock(plan.audit);
  const thinkingDecision = composeTomThinkingDecision(plan);

  const llm = await generateTomRegulatedChatResponse({
    question: normalizedQuestion,
    regulatedEvidence,
    thinkingDecision,
    holdJudgment: plan.hold_judgment,
    topicLabel: plan.audit.topicLabel,
    history,
    fetchImpl,
    env,
  });

  let text = llm.ok ? llm.text : composeTomGapHoldFallback(plan);
  const violation = violatesTomGapVoiceChecks(text, plan.audit);
  if (violation) {
    text = composeTomGapHoldFallback(plan);
  }

  return {
    ok: true,
    text,
    thinking: plan,
    thinking_decision: thinkingDecision,
    response_source: violation ? "tom_fallback" : llm.ok ? llm.response_source : "tom_fallback",
    llm_ok: llm.ok === true,
    violation,
  };
}

export function passesSteinTomGapVoiceChecks(text, audit, { question = "" } = {}) {
  const normalized = String(text ?? "").trim();
  if (!normalized) return { ok: false, check: "empty" };

  const violation = violatesTomGapVoiceChecks(normalized, audit);
  if (violation) return { ok: false, check: violation };

  const q = normalizeQuestion(question);
  const firstSentence = normalized.split(/[.!?]/)[0] ?? normalized;
  if (q.includes("부족") && !/부족|판단|확인|보이|보여|알|모르|어렵|아직|필요|보류|잠깐|못/.test(firstSentence)) {
    return { ok: false, check: "direct_answer" };
  }

  for (const pattern of INVENTORY_DUMP_PATTERNS) {
    if (pattern.test(normalized)) return { ok: false, check: "relevant_facts_only" };
  }

  if (!audit?.judgment_ready && !/보이|보여|확인|자료|내역|페이지|주시|알려|모르|어렵|필요|보류|잠깐|같이/.test(normalized)) {
    return { ok: false, check: "unknown_honesty" };
  }

  return { ok: true, check: null };
}

const TOM_GAP_ALLOWED_SURFACES = new Set([
  ONE_BRAIN_SURFACES.CONSULTATION,
  ONE_BRAIN_SURFACES.HOME,
]);

export function isTom2AGapVoiceEnabled(env = process.env) {
  const flag = String(env?.TOM_2A_GAP_VOICE ?? "true").trim().toLowerCase();
  return flag !== "false" && flag !== "0";
}

export function resolveTom2AGapVoiceFlag(env = process.env) {
  const raw = env?.TOM_2A_GAP_VOICE;
  return {
    raw: raw == null ? null : String(raw),
    enabled: isTom2AGapVoiceEnabled(env),
  };
}

export function buildTomVoiceExecutionTrace({
  question = "",
  intentClassification = null,
  surface = ONE_BRAIN_SURFACES.CONSULTATION,
  env = process.env,
  handler = "",
  tomRan = false,
  responseSource = null,
  violation = null,
} = {}) {
  const intent =
    typeof intentClassification === "string" ? intentClassification : intentClassification?.intent ?? null;
  const flag = resolveTom2AGapVoiceFlag(env);
  const shouldRun = shouldRunTom2AGapVoice(intentClassification, question, surface, env);
  return {
    handler,
    question: normalizeQuestion(question),
    intent,
    surface,
    TOM_2A_GAP_VOICE_raw: flag.raw,
    TOM_2A_GAP_VOICE_enabled: flag.enabled,
    should_run_tom: shouldRun,
    tom_ran: tomRan,
    response_source: responseSource,
    violation,
    finalize_fn: tomRan
      ? "finalizeOneBrainResponse(tomGapVoiceHandled=true)"
      : shouldRun
        ? "finalizeOneBrainResponse(guidance_or_passthrough)"
        : "finalizeOneBrainResponse(no_tom_gate)",
  };
}

export function shouldRunTom2AGapVoice(
  intentClassification,
  question = "",
  surface = ONE_BRAIN_SURFACES.CONSULTATION,
  env = process.env,
) {
  if (!isTom2AGapVoiceEnabled(env)) return false;
  if (!TOM_GAP_ALLOWED_SURFACES.has(surface)) return false;
  const intent =
    typeof intentClassification === "string" ? intentClassification : intentClassification?.intent ?? null;
  return intent === "coverage_gap_check";
}

export async function applyTom2AGapVoiceIfEligible({
  question = "",
  intentClassification = null,
  surface = ONE_BRAIN_SURFACES.CONSULTATION,
  factBundle = {},
  history = [],
  fetchImpl = fetch,
  env = process.env,
  handler = "",
} = {}) {
  const shouldRun = shouldRunTom2AGapVoice(intentClassification, question, surface, env);
  if (!shouldRun) {
    return {
      ran: false,
      text: null,
      trace: buildTomVoiceExecutionTrace({
        question,
        intentClassification,
        surface,
        env,
        handler,
        tomRan: false,
      }),
    };
  }

  const intent =
    typeof intentClassification === "string" ? intentClassification : intentClassification?.intent ?? "";
  const tom = await runTomThinkingTurn({
    question,
    intent,
    factBundle,
    history,
    fetchImpl,
    env,
  });

  return {
    ran: true,
    text: tom.text,
    tom,
    trace: buildTomVoiceExecutionTrace({
      question,
      intentClassification,
      surface,
      env,
      handler,
      tomRan: true,
      responseSource: tom.response_source,
      violation: tom.violation,
    }),
  };
}

