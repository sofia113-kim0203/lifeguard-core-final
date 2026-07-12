/**
 * Slice 6 — KEY Voice Compose.
 * Probe modes may run Borrowed Senses before Decision (hypotheses material).
 * Customer replacement:
 *   - off / shadow: never (S6 only; shadow may observe candidate)
 *   - active_partial: S6 first, then existing Stage2 promote helper
 *   - active: Stage3+alignment+Gate may use candidate without S6 (honest empty s6 input);
 *             else S6 once, then existing Stage3 promote helper (still requires alignment)
 */
import { buildDecision, validateAndRecordClaudeDecision } from "./keyDecision.js";
import { assertDecisionFactGate } from "./assertFactTextGate.js";
import {
  isKeyVoiceActive,
  isKeyBorrowedSensesProbeEnabled,
  isKeyBorrowedSensesStage2Partial,
  isKeyBorrowedSensesStage3Active,
  isVercelProductionEnv,
  getKeyBorrowedSensesMode,
} from "./oneKeyCoreFlags.js";
import { buildKeyVoiceDirective, summarizeKeyVoiceDirective } from "./keyVoiceDirective.js";
import {
  speakKeyVoice,
  createGhostLedger,
  peekGhostPathsReached,
} from "./keyVoiceSpeak.js";
import { gateKeyVoiceAnswer } from "./keyVoiceGate.js";
import { buildKeyVoiceVisualBlocks } from "./keyVoiceVisualBlocks.js";
import { gateKeyVoiceVisualBlocks } from "./keyVoiceBlockGate.js";
import {
  runBorrowedSensesShadowProbe,
  buildEarlyBorrowedFactBoundary,
  buildVerifiedCustomerChart,
} from "./keyBorrowedSensesSpeak.js";
import { gateBorrowedSensesOutput } from "./keyBorrowedSensesGate.js";
import {
  evaluateBorrowedFastPathCandidate,
  applyStage2PromotionToCompose,
  canSoftApproveBorrowedVoice,
  collectAnswerFacingSafetyFail,
  isSoftPromotionFailReason,
} from "./keyBorrowedSensesStage2.js";
import { applyStage3PromotionToCompose } from "./keyBorrowedSensesStage3.js";
import { KEY_MONOPOLY_FAILURE_CUSTOMER_TEXT } from "./keyCustomerMonopoly.js";
import { DOCUMENT_DIRECT_REQUEST_TOO_LARGE_CUSTOMER_TEXT } from "./keyClaudeFullDocumentDirect.js";
import {
  startSpan,
  countBorrowedProviderCalls,
  sanitizeLatencyErrorType,
  resolveDeployIdentity,
} from "./keyLatencyMarks.js";

function normalizeText(text = "") {
  return String(text ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Closed hard-safety reasons only (Stein pins: fact lock / exit seal / Decision-Goal).
 * Unknown future reasons are diagnostic + audit warning — never auto-hard.
 */
const CLOSED_HARD_REASONS = new Set([
  // A. Fact lock
  "answer_forbidden_certainty",
  "unverified_customer_coverage_claim",
  "number_scope_violation",
  "context_hallucination",
  "unsupported_public_research_claim",
  "unsupported_place_claim",
  "unsourced_public_assertion",
  // B. Exit seal
  "jailbreak_fact",
  "unsupported_recommendation",
  "hard_sales_push",
  "product_push_as_direction",
  "closing_or_signup_push",
  "leadership_cancel_enroll_certainty",
  "empty_answer",
  "empty_voice",
  // C. Direction (insurance pollution vs daily Decision/Goal only)
  "decision_mismatch_insurance_pollution",
]);

function normalizeReasonKey(reason = "") {
  const r = String(reason ?? "").trim();
  if (r.startsWith("answer_facing:")) return r.slice("answer_facing:".length);
  return r;
}

function isClosedHardReason(reason = "") {
  return CLOSED_HARD_REASONS.has(normalizeReasonKey(reason));
}

/**
 * Partition Gate/answer-facing reasons into closed hard veto vs diagnostic-only.
 * Does not invent a new Gate registry file — closed list only.
 */
function partitionCustomerTextSafety({
  gateResult = null,
  voice = "",
  question = "",
  decision = null,
  publicResearchEvidence = null,
} = {}) {
  const diagnostic = [];
  const hard = [];
  const audit_unknown_reasons = [];

  for (const reason of gateResult?.reasons ?? []) {
    if (isClosedHardReason(reason)) hard.push(reason);
    else {
      diagnostic.push(reason);
      // Unregistered / non-closed reasons: never hard-veto
      if (reason && !String(reason).startsWith("optional_fact_gate:")) {
        audit_unknown_reasons.push(reason);
      }
    }
  }

  const answerFacing = collectAnswerFacingSafetyFail({
    gate: { ok: true, ...(gateResult ?? {}) },
    voice,
    question,
    decision,
    publicResearchEvidence,
  });
  if (answerFacing && answerFacing !== "gate_missing") {
    const tagged = `answer_facing:${answerFacing}`;
    if (isClosedHardReason(answerFacing)) hard.push(tagged);
    else {
      diagnostic.push(tagged);
      if (!isClosedHardReason(answerFacing)) {
        // known soft labels stay diagnostic without "unknown" noise for place/claim completeness
        const knownSoft = /place_|claim_prep|general_daily|completeness|candidate|gate_missing/.test(
          answerFacing,
        );
        if (!knownSoft) audit_unknown_reasons.push(tagged);
      }
    }
  }

  return {
    soft: diagnostic,
    hard,
    hardFail: hard.length > 0,
    softOnly: hard.length === 0 && diagnostic.length > 0,
    audit_unknown_reasons,
  };
}

/** Borrowed promote KV — keep facts_to_speak/optional_claims contract (DU1 needs them). */
function stripArabicListMarkersForNumberLock(text = "") {
  // Presentation-only: "1. item" → "- item" so extractNumbers does not treat list ordinals as claims.
  // Does not alter mid-sentence counts like "1건".
  return String(text ?? "").replace(/(^|\n)([ \t]*)\d{1,2}\.\s+/g, "$1$2- ");
}

function gateBorrowedCandidateAnswer(text, directive, s5ReferenceText) {
  return gateKeyVoiceAnswer({
    text,
    directive,
    s5ReferenceText,
  });
}

function onlyOptionalFactGateFail(gateResult) {
  const reasons = gateResult?.reasons ?? [];
  return (
    reasons.length > 0 &&
    reasons.every((r) => String(r).startsWith("optional_fact_gate:"))
  );
}

/** True when Gate fail is soft-only — Claude text may still be customerText. */
function gateAllowsClaudeCustomerText(gateResult, voice, question, decision, research) {
  if (gateResult?.ok) return true;
  if (!voice) return false;
  const part = partitionCustomerTextSafety({
    gateResult,
    voice,
    question,
    decision,
    publicResearchEvidence: research,
  });
  return !part.hardFail;
}

/**
 * @param {object} thinkingFlow
 * @param {object} options
 */
export async function buildKeyVoiceComposeResult(
  thinkingFlow,
  {
    question = "",
    evidenceBundle = null,
    env = process.env,
    previousAnswerSummary = "",
    history = [],
    shadowVisualBlocksOverride = null,
    documentEvidence = null,
    relatedPastOriginals = null,
    directPdfAttachment = null,
    documentDirectMeta = null,
    fetchImpl = fetch,
    ghostLedger = null,
    startedAt = Date.now(),
  } = {},
) {
  let decision = thinkingFlow?.decision ?? null;
  const reflection = thinkingFlow?.reflection ?? null;
  const reality = thinkingFlow?.reality ?? null;
  const directiveQuestion = question || reflection?.customer_said || "";
  // PDF-only upload: do not feed KEY's reflection seed into Claude as a fake customer question.
  const claudeQuestion =
    documentDirectMeta && !String(question ?? "").trim()
      ? ""
      : directiveQuestion;
  const probeOn = isKeyBorrowedSensesProbeEnabled(env);
  const production = isVercelProductionEnv(env);
  const borrowedMode = getKeyBorrowedSensesMode(env);
  const stage2Partial = isKeyBorrowedSensesStage2Partial(env);
  const stage3Active = isKeyBorrowedSensesStage3Active(env);
  // Claude-Full primary on Preview whenever borrowed-senses probe is on (shadow|active),
  // except stage2 partial. KEY_BORROWED_SENSES env value is not changed by this gate.
  // Legacy S6 / shadow-probe branches stay in code; they are skipped when this is true.
  const claudeFullSinglePass = probeOn && !stage2Partial && !production;

  // Turn-owned ghost ledger (never module-global).
  const turnGhostLedger = Array.isArray(ghostLedger) ? ghostLedger : createGhostLedger();

  const overrideBlocks = Array.isArray(shadowVisualBlocksOverride)
    ? shadowVisualBlocksOverride
    : null;

  let shadow = null;
  let borrowedUnderstanding = null;
  let s6SpeakCalls = 0;
  let borrowedSensesCalls = 0;
  let focusedCorrectionCount = 0;
  let borrowedShadowProbeMark = null;
  let claudeFullEmitMark = null;
  let shadowProbeOmitted = null;
  let s6SpeakEnterMs = null;
  let s6SpeakExitMs = null;
  let s6SpeakDurationSum = 0;
  let gateEnterMs = null;
  let gateExitMs = null;
  let gateDurationSum = 0;
  const providerErrorTypes = [];
  let s6ProviderCallCount = 0;
  let claudeCallCount = 0;

  const markGate = (fn) => {
    const span = startSpan(startedAt);
    try {
      return fn();
    } finally {
      const done = span.end();
      if (gateEnterMs == null && done.enter_ms != null) gateEnterMs = done.enter_ms;
      if (done.exit_ms != null) gateExitMs = done.exit_ms;
      if (typeof done.duration_ms === "number") gateDurationSum += done.duration_ms;
    }
  };

  const runS6Speak = async (args) => {
    const span = startSpan(startedAt);
    const result = await speakKeyVoice(args);
    const done = span.end();
    s6SpeakCalls += 1;
    s6ProviderCallCount += 1;
    if (s6SpeakEnterMs == null && done.enter_ms != null) s6SpeakEnterMs = done.enter_ms;
    if (done.exit_ms != null) s6SpeakExitMs = done.exit_ms;
    if (typeof done.duration_ms === "number") s6SpeakDurationSum += done.duration_ms;
    const errType = sanitizeLatencyErrorType(result?.error);
    if (errType) providerErrorTypes.push(errType);
    return result;
  };

  // --- Claude-Full primary emit OR legacy shadow probe (at most 1 Claude call) ---
  // No safe post-response observer exists → claude_full skips shadow_sketch wait;
  // the same Claude-full emit is the customer-answer path (latency: claude_full_emit).
  if (claudeFullSinglePass) {
    const factBoundary = buildEarlyBorrowedFactBoundary({
      reality,
      question: directiveQuestion,
    });
    const emitSpan = startSpan(startedAt);
    try {
      shadow = await runBorrowedSensesShadowProbe({
        question: claudeQuestion,
        directive: null,
        decision: null,
        factBoundary,
        reflection,
        reality,
        history,
        previousAnswerSummary,
        s6FinalAnswer: "",
        visualBlocks: overrideBlocks?.length ? overrideBlocks : [],
        documentEvidence,
        relatedPastOriginals,
        directPdfAttachment,
        documentDirectMeta,
        answerMode: "claude_full",
        startedAt,
        env,
        fetchImpl,
      });
    } finally {
      claudeFullEmitMark = emitSpan.end();
    }
    borrowedShadowProbeMark = null;
    shadowProbeOmitted = {
      omitted: true,
      reason: "claude_full_primary_path_no_post_response_observer",
    };
    borrowedSensesCalls = 1;
    claudeCallCount = 1;
    borrowedUnderstanding = shadow?.borrowed ?? null;
    const borrowedErr = sanitizeLatencyErrorType(shadow?.error);
    if (borrowedErr) providerErrorTypes.push(borrowedErr);
    if (shadow?.error === "REQUEST_PAYLOAD_TOO_LARGE") {
      claudeCallCount = 0;
      borrowedSensesCalls = 0;
    }
  } else if (probeOn) {
    const factBoundary = buildEarlyBorrowedFactBoundary({
      reality,
      question: directiveQuestion,
    });
    const probeSpan = startSpan(startedAt);
    try {
      shadow = await runBorrowedSensesShadowProbe({
        question: claudeQuestion,
        directive: null,
        decision: null,
        factBoundary,
        reflection,
        reality,
        history,
        previousAnswerSummary,
        s6FinalAnswer: "",
        visualBlocks: overrideBlocks?.length ? overrideBlocks : [],
        documentEvidence,
        relatedPastOriginals,
        directPdfAttachment,
        documentDirectMeta,
        answerMode: "shadow_sketch",
        startedAt,
        env,
        fetchImpl,
      });
    } finally {
      borrowedShadowProbeMark = probeSpan.end();
    }
    borrowedSensesCalls = 1;
    claudeCallCount = 1;
    borrowedUnderstanding = shadow?.borrowed ?? null;
    const borrowedErr = sanitizeLatencyErrorType(shadow?.error);
    if (borrowedErr) providerErrorTypes.push(borrowedErr);
    if (shadow?.error === "REQUEST_PAYLOAD_TOO_LARGE") {
      claudeCallCount = 0;
      borrowedSensesCalls = 0;
    }
  }

  // --- KEY Decision: Claude may propose; KEY validates/records (D2) ---
  if (reflection && reality) {
    decision = claudeFullSinglePass
      ? validateAndRecordClaudeDecision({
          reflection,
          reality,
          question: directiveQuestion,
          evidenceBundle,
          borrowedUnderstanding,
        })
      : buildDecision({
          reflection,
          reality,
          question: directiveQuestion,
          evidenceBundle,
          borrowedUnderstanding,
        });
  }

  if (!decision?.decision_complete) {
    return null;
  }

  const factSelection = decision.fact_selection ?? { facts_spoken: [], facts_withheld: [] };
  const speakFactGate = assertDecisionFactGate({ factSelection });
  if (!speakFactGate.ok) return null;

  // Stein Cleanup A: do NOT call composeSpeakFromDecision on the normal customer path.
  // Legacy S5 reference stays empty for Gate; physical delete is Commit B.
  const s5Reference = "";

  const directive = buildKeyVoiceDirective({
    question: directiveQuestion,
    decision,
    previousAnswerSummary,
    history,
    reality,
  });
  directive.verified_customer_chart = buildVerifiedCustomerChart(reality);
  directive.current_user_message = directiveQuestion;
  if (decision) {
    directive.decision_snapshot = {
      situation_key: decision.situation_key ?? null,
      response_priority: decision.response_priority ?? null,
      key_judgment: decision.key_judgment ?? null,
      key_situation_judgment: decision.key_situation_judgment ?? null,
      key_next_move: decision.key_next_move ?? decision.direction?.move ?? null,
      direction: decision.direction ?? null,
    };
  }

  // Evidence-first: attach research to directive BEFORE first Gate/approval (not regen-only).
  if (shadow?.public_research_evidence && typeof shadow.public_research_evidence === "object") {
    const ev = shadow.public_research_evidence;
    directive.public_research_evidence = {
      status: ev.status,
      status_detail: ev.status_detail,
      research_unavailable: ev.research_unavailable === true,
      customer_facing_summary: ev.customer_facing_summary ?? null,
      results: (ev.results ?? []).map((r) => ({
        title: r.title,
        url: r.url,
        domain: r.domain,
        page_age: r.page_age,
        query: r.query,
        // encrypted_* intentionally omitted from directive/trace surfaces
      })),
      citations: (ev.citations ?? []).map((c) => ({
        title: c.title,
        url: c.url,
        cited_text: c.cited_text,
        domain: c.domain,
      })),
    };
  }

  const trace = {
    key_voice_enabled: isKeyVoiceActive(env),
    directive,
    directive_summary: summarizeKeyVoiceDirective(directive),
    voice_raw: null,
    gate_result: null,
    fallback_used: false,
    fallback_reason: null,
    provider: null,
    retry_count: 0,
    s5_reference_preview: "",
    legacy_speak_blocked: true,
    ghost_path_reached: turnGhostLedger,
    rewrite_detected: false,
    borrowed_senses_calls: borrowedSensesCalls,
    s6_speak_calls: 0,
    borrowed_mode: borrowedMode,
    fast_path: null,
    call_order: claudeFullSinglePass
      ? "reality_reflection_claude_full_decision_align_gate"
      : probeOn
        ? "reality_reflection_borrowed_decision_align_gate"
        : "decision_directive_s6",
    shadow_probe_omitted: shadowProbeOmitted,
    d2_output_incomplete:
      claudeFullSinglePass &&
      (decision?.hypothesis_used?.d2_output_incomplete === true ||
        !(borrowedUnderstanding?.decision && typeof borrowedUnderstanding.decision === "object") ||
        !String(borrowedUnderstanding?.session_goal ?? "").trim()),
  };

  // Re-gate borrowed output with real Directive (early call had factBoundary only)
  if (shadow?.borrowed) {
    shadow.gate = gateBorrowedSensesOutput({
      borrowed: shadow.borrowed,
      directive,
      history,
      question: directiveQuestion,
      visualBlocks: overrideBlocks?.length ? overrideBlocks : [],
    });
    shadow.call_phase = "pre_decision";
  }

  // Decision alignment — observation for all probe modes; customer use only with Stage3+active
  let alignment = null;
  if ((probeOn || claudeFullSinglePass) && shadow) {
    alignment = evaluateBorrowedFastPathCandidate({
      question: directiveQuestion,
      decision,
      directive,
      shadow,
      env,
    });
    trace.fast_path = {
      ok: false,
      reason: null,
      aligned_with_decision: alignment.aligned_with_decision === true,
      gate_ok: alignment.gate_ok === true,
      alignment_reason: alignment.reason ?? null,
      observation_only: borrowedMode !== "active",
      mid_field_warnings: alignment.mid_field_warnings ?? [],
    };
  }

  let voiceRaw = null;
  let provider = null;
  let speakResult = { ok: false, error: null };
  let gateResult = { ok: false, reasons: ["pending"] };
  let usedActiveFastPath = false;
  let usedClaudeFullSinglePass = false;
  let usedConstrainedRegen = false;
  let usedFailureMode = false;

  // --- Claude-Full v1.1 (Preview active): adopt Claude after existing safety pins; S6 never ---
  if (claudeFullSinglePass && shadow) {
    const candidateRaw = String(
      shadow?.borrowed?.customer_answer ?? shadow?.borrowed?.voice_raw_candidate ?? "",
    ).trim();
    const candidate = stripArabicListMarkersForNumberLock(candidateRaw);
    const researchEv = shadow?.public_research_evidence ?? null;
    if (shadow?.tool_permission_check) {
      trace.tool_permission_check = shadow.tool_permission_check;
    } else if (shadow?.borrowed?.tool_permission_check) {
      trace.tool_permission_check = shadow.borrowed.tool_permission_check;
    }
    if (!candidate || shadow?.error) {
      usedFailureMode = true;
      voiceRaw = null;
      gateResult = {
        ok: false,
        reasons: [shadow?.error ?? "claude_full_empty_candidate"],
      };
      trace.fast_path = {
        ok: false,
        reason: shadow?.error ?? "claude_full_empty_candidate",
        observation_only: false,
        claude_full_single_pass: true,
      };
      trace.initial_candidate_source = "claude_full_failed";
    } else {
      const kvGate = markGate(() =>
        gateBorrowedCandidateAnswer(candidate, directive, s5Reference),
      );
      const partition = markGate(() =>
        partitionCustomerTextSafety({
          gateResult: kvGate,
          voice: candidate,
          question: directiveQuestion,
          decision,
          publicResearchEvidence: researchEv,
        }),
      );
      if (!partition.hardFail) {
        voiceRaw = candidate;
        provider = "claude_full_single_pass";
        gateResult = kvGate.ok
          ? kvGate
          : {
              ok: true,
              reasons: partition.soft.length ? partition.soft : (kvGate.reasons ?? []),
              soft_pass: true,
            };
        usedClaudeFullSinglePass = true;
        usedActiveFastPath = true;
        trace.fast_path = {
          ok: true,
          reason: null,
          aligned_with_decision: alignment?.aligned_with_decision === true,
          gate_ok: true,
          alignment_reason: null,
          observation_only: false,
          claude_full_single_pass: true,
          mid_field_warnings: alignment?.mid_field_warnings ?? [],
        };
        trace.initial_candidate_source = "claude_full";
        trace.answer_regeneration = { used: false };
      } else {
        // Concrete CLOSED_HARD violation only — focused Claude correction max 1 (no S6).
        voiceRaw = candidate;
        provider = "claude_full_candidate";
        gateResult = {
          ok: false,
          reasons: [...partition.hard, ...partition.soft],
        };
        trace.initial_candidate_source = "claude_full";
        trace.fast_path = {
          ok: false,
          reason: partition.hard.join(";") || "claude_full_hard_safety",
          observation_only: false,
          claude_full_single_pass: true,
          initial_claude_hard: true,
        };
      }
    }
  } else if (stage3Active && !stage2Partial && !production && shadow && alignment?.ok === true) {
    // Legacy Stage3 promote path retained (unreachable when claudeFullSinglePass mirrors stage3Active).
    const stage3Pre = applyStage3PromotionToCompose({
      question: directiveQuestion,
      s6FinalAnswer: "",
      shadow,
      env,
      history,
      previousAnswerSummary,
      decision,
    });
    trace.stage3_active_pre_s6 = stage3Pre.stage3_active;
    if (
      stage3Pre.customer_text_changed === true &&
      stage3Pre.final_answer_source === "s7" &&
      String(stage3Pre.finalText ?? "").trim()
    ) {
      const candidate = String(stage3Pre.finalText).trim();
      const kvGate = markGate(() => gateBorrowedCandidateAnswer(candidate, directive, s5Reference));
      const researchEv = shadow?.public_research_evidence ?? null;
      if (
        kvGate.ok ||
        onlyOptionalFactGateFail(kvGate) ||
        gateAllowsClaudeCustomerText(
          kvGate,
          candidate,
          directiveQuestion,
          decision,
          researchEv,
        )
      ) {
        voiceRaw = candidate;
        provider = "borrowed_senses_fast_path";
        gateResult = kvGate.ok
          ? kvGate
          : { ok: true, reasons: kvGate.reasons ?? [], soft_pass: true };
        usedActiveFastPath = true;
        trace.fast_path = {
          ok: true,
          reason: null,
          aligned_with_decision: true,
          gate_ok: true,
          alignment_reason: null,
          observation_only: false,
          stage3_promotion_pass: true,
          mid_field_warnings: alignment?.mid_field_warnings ?? stage3Pre.stage3_active?.mid_field_warnings ?? [],
        };
      } else {
        trace.fast_path = {
          ...(trace.fast_path ?? {}),
          ok: false,
          reason: `key_voice_gate:${kvGate.reasons?.join(";") ?? "fail"}`,
          observation_only: false,
          stage3_promotion_pass: true,
        };
      }
    } else {
      trace.fast_path = {
        ...(trace.fast_path ?? {}),
        ok: false,
        reason: stage3Pre.stage3_active?.fallback_reason ?? "stage3_promotion_blocked",
        observation_only: false,
        stage3_promotion_pass: false,
        mid_field_warnings: alignment?.mid_field_warnings ?? [],
      };
    }
  } else if (probeOn && shadow && borrowedMode === "shadow") {
    trace.fast_path = {
      ...(trace.fast_path ?? {}),
      ok: false,
      reason: "shadow_observation_only",
      observation_only: true,
    };
  } else if (probeOn && shadow && stage2Partial) {
    trace.fast_path = {
      ...(trace.fast_path ?? {}),
      ok: false,
      reason: "active_partial_requires_s6_then_stage2",
      observation_only: true,
    };
  }

  // --- Stein single correction budget (Compose lifetime max 1) ---
  // Claude-Full: focused Claude correction only (no S6). Legacy: hard_safety_repair via S6.
  let correctionAttempts = 0;
  const researchEvForSafety = () =>
    shadow?.public_research_evidence ?? directive.public_research_evidence ?? null;

  if (!claudeFullSinglePass && !voiceRaw) {
    const fallbackReason = String(
      trace.fast_path?.reason ??
        trace.stage3_active_pre_s6?.fallback_reason ??
        alignment?.reason ??
        "",
    ).trim();
    const midFieldWarnings = [
      ...(Array.isArray(alignment?.mid_field_warnings) ? alignment.mid_field_warnings : []),
      ...(Array.isArray(trace.stage3_active_pre_s6?.mid_field_warnings)
        ? trace.stage3_active_pre_s6.mid_field_warnings
        : []),
    ];
    const rejectedAnswer = String(shadow?.borrowed?.voice_raw_candidate ?? "").trim();
    const canUseBorrowedInitial =
      Boolean(rejectedAnswer) &&
      stage3Active &&
      !stage2Partial &&
      !production &&
      probeOn &&
      Boolean(shadow);

    if (canUseBorrowedInitial) {
      const kvGate = markGate(() => gateBorrowedCandidateAnswer(rejectedAnswer, directive, s5Reference));
      const researchEv = researchEvForSafety();
      const borrowedPartition = markGate(() =>
        partitionCustomerTextSafety({
          gateResult: kvGate,
          voice: rejectedAnswer,
          question: directiveQuestion,
          decision,
          publicResearchEvidence: researchEv,
        }),
      );

      if (borrowedPartition.hardFail) {
        voiceRaw = rejectedAnswer;
        provider = "borrowed_senses_candidate";
        gateResult = {
          ok: false,
          reasons: [...borrowedPartition.hard, ...borrowedPartition.soft],
        };
        usedActiveFastPath = false;
        usedConstrainedRegen = false;
        trace.initial_candidate_source = "borrowed";
        trace.answer_regeneration = { used: false };
        trace.fast_path = {
          ...(trace.fast_path ?? {}),
          ok: false,
          reason: borrowedPartition.hard.join(";") || fallbackReason || "borrowed_hard_safety",
          observation_only: false,
          initial_borrowed_hard: true,
          mid_field_warnings: midFieldWarnings,
        };
      } else {
        const softApprove = canSoftApproveBorrowedVoice({
          voice: rejectedAnswer,
          question: directiveQuestion,
          decision,
          gate: shadow?.gate,
          failReason: fallbackReason,
          midFieldWarnings,
          publicResearchEvidence: researchEv,
        });
        const softKeep =
          !borrowedPartition.hardFail &&
          (softApprove ||
            isSoftPromotionFailReason(fallbackReason) ||
            /place_request_unanswered|place_candidates_missing|place_candidates_insufficient|place_promote_/.test(
              fallbackReason,
            ) ||
            (borrowedPartition.softOnly &&
              !/risky_cancel|q10_portfolio|decision_mismatch_/i.test(fallbackReason)));
        if (softKeep) {
          voiceRaw = rejectedAnswer;
          provider = "borrowed_senses_fast_path";
          gateResult = kvGate.ok
            ? kvGate
            : {
                ok: true,
                reasons: borrowedPartition.soft.length
                  ? borrowedPartition.soft
                  : (kvGate.reasons ?? []),
                soft_pass: true,
              };
          usedActiveFastPath = true;
          usedConstrainedRegen = false;
          trace.initial_candidate_source = "borrowed";
          trace.answer_regeneration = { used: false };
          trace.fast_path = {
            ok: true,
            reason: null,
            aligned_with_decision: alignment?.aligned_with_decision === true,
            gate_ok: true,
            alignment_reason: null,
            observation_only: false,
            stage3_promotion_pass: true,
            soft_approve: softApprove || borrowedPartition.softOnly,
            mid_field_warnings: midFieldWarnings,
          };
        }
      }
    }
  }

  // Initial S6 speak only when Claude-Full is OFF and no candidate exists yet.
  if (!claudeFullSinglePass && !voiceRaw) {
    speakResult = await runS6Speak({ directive, env, fetchImpl });
    usedConstrainedRegen = false;
    trace.answer_regeneration = { used: false };
    trace.initial_candidate_source = "s6_speak";
    if (speakResult.ok) {
      voiceRaw = speakResult.voice_raw;
      provider = speakResult.provider;
    }
    gateResult = voiceRaw
      ? markGate(() => gateKeyVoiceAnswer({ text: voiceRaw, directive, s5ReferenceText: s5Reference }))
      : { ok: false, reasons: [speakResult.error ?? "speak_failed"] };
  }

  trace.voice_raw = voiceRaw;
  trace.provider = provider;
  trace.s6_speak_calls = s6SpeakCalls;
  trace.claude_call_count = claudeCallCount;
  trace.focused_correction_count = focusedCorrectionCount;

  let finalText = voiceRaw;
  let outputGate = gateResult;
  let hardSafetyRepairAttempt = 0;

  const safetyPartition = markGate(() =>
    partitionCustomerTextSafety({
      gateResult,
      voice: voiceRaw,
      question: directiveQuestion,
      decision,
      publicResearchEvidence: researchEvForSafety(),
    }),
  );
  trace.safety_partition = {
    hard: safetyPartition.hard,
    soft: safetyPartition.soft,
    hard_fail: safetyPartition.hardFail,
    audit_unknown_reasons: safetyPartition.audit_unknown_reasons ?? [],
  };

  if (safetyPartition.softOnly || (gateResult?.ok === false && !safetyPartition.hardFail && voiceRaw)) {
    trace.soft_gate_diagnostics = safetyPartition.soft;
    trace.fallback_used = false;
    trace.fallback_reason = null;
    finalText = voiceRaw;
    usedFailureMode = false;
    outputGate = {
      ...(gateResult ?? {}),
      ok: true,
      reasons: safetyPartition.soft,
      soft_pass: true,
    };
  } else if (safetyPartition.hardFail && voiceRaw && correctionAttempts < 1) {
    correctionAttempts = 1;
    hardSafetyRepairAttempt = 1;
    const failedClaimsPreview = String(voiceRaw).slice(0, 400);
    trace.hard_safety_repair = {
      attempt: 1,
      violations: safetyPartition.hard,
      failed_claims_preview: failedClaimsPreview,
    };

    if (claudeFullSinglePass) {
      // Focused Claude correction once — never S6 / S3–S5 / legacy speak.
      focusedCorrectionCount = 1;
      const factBoundary = buildEarlyBorrowedFactBoundary({
        reality,
        question: directiveQuestion,
      });
      const repairProbe = await runBorrowedSensesShadowProbe({
        question: claudeQuestion,
        directive: null,
        decision: null,
        factBoundary,
        reflection,
        reality,
        history,
        previousAnswerSummary,
        s6FinalAnswer: "",
        visualBlocks: overrideBlocks?.length ? overrideBlocks : [],
        publicResearchEvidence: researchEvForSafety(),
        answerMode: "claude_full",
        focusedCorrection: {
          violations: safetyPartition.hard,
          failed_claims_preview: failedClaimsPreview,
          previous_customer_answer: voiceRaw,
          previous_voice_raw_candidate: voiceRaw,
        },
        documentEvidence,
        relatedPastOriginals,
        directPdfAttachment,
        documentDirectMeta,
        startedAt,
        env,
        fetchImpl,
      });
      borrowedSensesCalls += 1;
      claudeCallCount += 1;
      trace.focused_correction_count = focusedCorrectionCount;
      trace.claude_call_count = claudeCallCount;
      const repaired = stripArabicListMarkersForNumberLock(
        String(
          repairProbe?.borrowed?.customer_answer ??
            repairProbe?.borrowed?.voice_raw_candidate ??
            "",
        ).trim(),
      );
      if (repairProbe?.error || !repaired) {
        finalText = KEY_MONOPOLY_FAILURE_CUSTOMER_TEXT;
        usedFailureMode = true;
        usedClaudeFullSinglePass = false;
        trace.fallback_used = true;
        trace.fallback_reason = repairProbe?.error ?? "focused_correction_failed";
        trace.failure_mode_used = true;
        outputGate = {
          ok: false,
          reasons: [trace.fallback_reason],
          hard_safety_failure_mode: true,
        };
      } else {
        voiceRaw = repaired;
        provider = "claude_full_focused_correction";
        finalText = voiceRaw;
        const repairGate = markGate(() =>
          gateBorrowedCandidateAnswer(voiceRaw, directive, s5Reference),
        );
        const repairPartition = markGate(() =>
          partitionCustomerTextSafety({
            gateResult: repairGate,
            voice: voiceRaw,
            question: directiveQuestion,
            decision,
            publicResearchEvidence: researchEvForSafety(),
          }),
        );
        trace.hard_safety_repair.second_check = {
          hard: repairPartition.hard,
          soft: repairPartition.soft,
          hard_fail: repairPartition.hardFail,
        };
        if (repairPartition.hardFail) {
          finalText = KEY_MONOPOLY_FAILURE_CUSTOMER_TEXT;
          usedFailureMode = true;
          usedClaudeFullSinglePass = false;
          trace.fallback_used = true;
          trace.fallback_reason = repairPartition.hard.join("; ");
          trace.failure_mode_used = true;
          outputGate = {
            ok: false,
            reasons: repairPartition.hard,
            hard_safety_failure_mode: true,
          };
        } else {
          usedFailureMode = false;
          usedClaudeFullSinglePass = true;
          usedActiveFastPath = true;
          trace.fallback_used = false;
          outputGate = {
            ...repairGate,
            ok: true,
            reasons: repairPartition.soft,
            soft_pass: repairPartition.soft.length > 0,
          };
        }
      }
    } else {
      const repairDirective = {
        ...directive,
        hard_safety_repair: {
          attempt: 1,
          violations: safetyPartition.hard,
          failed_claims_preview: failedClaimsPreview,
          instruction:
            "HARD SAFETY REPAIR (once — sole correction): Rewrite the full natural Korean customer answer. Fix only the listed CLOSED_HARD violations and the failed claims. Keep the same conversation_history, verified_customer_chart, Decision, Session Goal, related_past_judgments, public_research_evidence, allowed_numbers, and allowed_entities. Do not invent facts. Do not re-search. Do not shrink the chart. Do not use legacy/safe-utterance templates.",
        },
        repetition_avoidance_instruction: `${directive.repetition_avoidance_instruction ?? ""} Hard safety fail (${safetyPartition.hard.join("; ")}). Failed claims: ${failedClaimsPreview}. Repair once without legacy templates.`,
      };
      const repairSpeak = await runS6Speak({
        directive: repairDirective,
        env,
        fetchImpl,
        temperature: 0.3,
      });
      trace.s6_speak_calls = s6SpeakCalls;
      if (repairSpeak.ok && repairSpeak.voice_raw) {
        voiceRaw = repairSpeak.voice_raw;
        provider = repairSpeak.provider;
        finalText = voiceRaw;
        const repairGate = markGate(() =>
          gateKeyVoiceAnswer({
            text: voiceRaw,
            directive,
            s5ReferenceText: s5Reference,
          }),
        );
        const repairPartition = markGate(() =>
          partitionCustomerTextSafety({
            gateResult: repairGate,
            voice: voiceRaw,
            question: directiveQuestion,
            decision,
            publicResearchEvidence: researchEvForSafety(),
          }),
        );
        trace.hard_safety_repair.second_check = {
          hard: repairPartition.hard,
          soft: repairPartition.soft,
          hard_fail: repairPartition.hardFail,
        };
        if (repairPartition.hardFail) {
          finalText = KEY_MONOPOLY_FAILURE_CUSTOMER_TEXT;
          usedFailureMode = true;
          trace.fallback_used = true;
          trace.fallback_reason = repairPartition.hard.join("; ");
          trace.failure_mode_used = true;
          outputGate = { ok: false, reasons: repairPartition.hard, hard_safety_failure_mode: true };
        } else {
          usedFailureMode = false;
          trace.fallback_used = false;
          outputGate = {
            ...repairGate,
            ok: true,
            reasons: repairPartition.soft,
            soft_pass: repairPartition.soft.length > 0,
          };
        }
      } else {
        finalText = KEY_MONOPOLY_FAILURE_CUSTOMER_TEXT;
        usedFailureMode = true;
        trace.fallback_used = true;
        trace.fallback_reason = repairSpeak.error ?? "hard_safety_repair_speak_failed";
        trace.failure_mode_used = true;
        outputGate = { ok: false, reasons: [trace.fallback_reason], hard_safety_failure_mode: true };
      }
    }
  } else if (!gateResult?.ok && !voiceRaw) {
    // Claude-Full / Speak failed with no candidate — honest failure, never S3/S4/S5 / safe utterance.
    if (shadow?.error === "REQUEST_PAYLOAD_TOO_LARGE") {
      finalText = DOCUMENT_DIRECT_REQUEST_TOO_LARGE_CUSTOMER_TEXT;
      usedFailureMode = true;
      trace.fallback_used = true;
      trace.fallback_reason = "request_payload_too_large";
      trace.failure_mode_used = true;
      if (shadow?.document_direct) {
        trace.document_direct = {
          document_id: shadow.document_direct.document_id ?? documentDirectMeta?.document_id ?? null,
          mime_type: shadow.document_direct.mime_type ?? documentDirectMeta?.mime_type ?? null,
          file_size_bytes:
            shadow.document_direct.file_size_bytes ?? documentDirectMeta?.file_size_bytes ?? null,
          direct_document_attached: false,
          estimated_request_bytes: shadow.document_direct.estimated_request_bytes ?? null,
          document_fallback_used: true,
          document_fallback_reason: "request_payload_too_large",
        };
      } else if (documentDirectMeta) {
        trace.document_direct = {
          document_id: documentDirectMeta.document_id ?? null,
          mime_type: documentDirectMeta.mime_type ?? null,
          file_size_bytes: documentDirectMeta.file_size_bytes ?? null,
          direct_document_attached: false,
          estimated_request_bytes: shadow?.estimated_request_bytes ?? null,
          document_fallback_used: true,
          document_fallback_reason: "request_payload_too_large",
        };
      }
      outputGate = {
        ok: false,
        reasons: ["request_payload_too_large"],
        hard_safety_failure_mode: true,
      };
    } else {
      finalText = KEY_MONOPOLY_FAILURE_CUSTOMER_TEXT;
      usedFailureMode = true;
      trace.fallback_used = true;
      trace.fallback_reason = speakResult?.error ?? gateResult?.reasons?.join("; ") ?? "speak_failed";
      trace.failure_mode_used = true;
      outputGate = { ok: false, reasons: [trace.fallback_reason], hard_safety_failure_mode: true };
    }
  }

  trace.correction_attempts = correctionAttempts;
  trace.s6_speak_calls = s6SpeakCalls;
  trace.borrowed_senses_calls = borrowedSensesCalls;
  trace.claude_call_count = claudeCallCount;
  trace.focused_correction_count = focusedCorrectionCount;

  // Absolute ban: legacy safe utterance / S5 compose must never become customerText.
  trace.ghost_path_reached = peekGhostPathsReached(turnGhostLedger);
  trace.hard_safety_repair_attempt = hardSafetyRepairAttempt;
  trace.rewrite_detected = false;

  trace.gate_result = outputGate;
  trace.used_constrained_regen = usedConstrainedRegen;
  trace.used_failure_mode = usedFailureMode;

  finalText = normalizeText(finalText);
  if (!finalText) return null;

  let visualBlocks = [];
  if (outputGate.ok && !trace.fallback_used) {
    if (usedClaudeFullSinglePass) {
      // Claude-Full: Claude emits visual_blocks; KEY only gates format/facts/safety — no KEY rebuild.
      const fromClaude = Array.isArray(shadow?.borrowed?.visual_blocks)
        ? shadow.borrowed.visual_blocks
        : [];
      const blockGate = gateKeyVoiceVisualBlocks({
        blocks: fromClaude,
        text: finalText,
        directive,
      });
      visualBlocks = blockGate.accepted;
      trace.visual_blocks_candidates = fromClaude.map((b) => b?.type ?? null);
      trace.visual_blocks_gate = blockGate;
      trace.visual_blocks_source = "claude_emit";
    } else {
      const candidates = buildKeyVoiceVisualBlocks({ directive });
      const blockGate = gateKeyVoiceVisualBlocks({
        blocks: candidates,
        text: finalText,
        directive,
      });
      visualBlocks = blockGate.accepted;
      trace.visual_blocks_candidates = candidates.map((b) => b.type);
      trace.visual_blocks_gate = blockGate;
      trace.visual_blocks_source = "key_rebuild";
    }
  } else {
    trace.visual_blocks_gate = {
      ok: true,
      accepted: [],
      omitted: [],
      accepted_count: 0,
      omitted_count: 0,
      skipped: trace.fallback_used ? "fallback_used" : "text_gate_fail",
    };
  }

  // --- Post-S6 Stage2 / Stage3: DIAGNOSTIC ONLY — never replace Claude finalText ---
  if (shadow && typeof shadow === "object") {
    trace.shadow_visual_blocks_override_used = Boolean(overrideBlocks?.length);
    trace.shadow_visual_blocks_override_count = overrideBlocks?.length ?? 0;
    const frozenCustomerText = finalText;

    if (usedClaudeFullSinglePass || usedActiveFastPath) {
      // Claude-Full / fast path already selected Claude candidate as voiceRaw before freeze.
      shadow.customer_text_changed = false;
      shadow.final_answer_source = "claude_candidate";
      shadow.s6_final_answer = frozenCustomerText;
      shadow.fast_path = trace.fast_path;
      trace.promotion_diagnostic = {
        stage: usedClaudeFullSinglePass ? "claude_full_single_pass" : "pre_s6_fast_path",
        customer_text_replaced: false,
        note: usedClaudeFullSinglePass
          ? "Claude-Full candidate sealed after KEY safety pins; no rewrite."
          : "Claude borrowed candidate was the initial voiceRaw; promotion does not rewrite after safety.",
      };
    } else if (stage2Partial && !stage3Active) {
      const s6FinalAnswer = frozenCustomerText;
      const stage2 = applyStage2PromotionToCompose({
        question: directiveQuestion,
        s6FinalAnswer,
        shadow,
        env,
      });
      trace.stage2_partial = stage2.stage2_partial;
      trace.promotion_diagnostic = {
        stage: "stage2",
        would_promote:
          stage2.customer_text_changed === true && stage2.final_answer_source === "s7",
        promoted_preview: String(stage2.finalText ?? "").slice(0, 200),
        customer_text_replaced: false,
      };
      shadow.customer_text_changed = false;
      shadow.final_answer_source = "s6";
      shadow.s6_final_answer = s6FinalAnswer;
      shadow.stage2_partial = {
        ...(stage2.stage2_partial ?? {}),
        customer_text_changed: false,
        final_answer_source: "s6",
        diagnostic_only: true,
      };
      finalText = frozenCustomerText;
      shadow.fast_path = trace.fast_path;
    } else if (stage3Active && !stage2Partial) {
      const s6FinalAnswer = frozenCustomerText;
      const stage3 = applyStage3PromotionToCompose({
        question: directiveQuestion,
        s6FinalAnswer,
        shadow,
        env,
        history,
        previousAnswerSummary,
        decision,
      });
      const wouldPromote =
        stage3.customer_text_changed === true &&
        stage3.final_answer_source === "s7" &&
        alignment?.ok === true;
      trace.promotion_diagnostic = {
        stage: "stage3",
        would_promote: wouldPromote,
        promoted_preview: String(stage3.finalText ?? "").slice(0, 200),
        customer_text_replaced: false,
        alignment_ok: alignment?.ok === true,
      };
      shadow.customer_text_changed = false;
      shadow.final_answer_source = "s6";
      shadow.s6_final_answer = s6FinalAnswer;
      shadow.stage3_active = {
        ...(stage3.stage3_active ?? {}),
        customer_text_changed: false,
        final_answer_source: "s6",
        diagnostic_only: true,
        promotion_pass: wouldPromote,
      };
      trace.stage3_active = shadow.stage3_active;
      finalText = frozenCustomerText;
      shadow.fast_path = trace.fast_path;
    } else {
      shadow.customer_text_changed = false;
      shadow.final_answer_source = "s6";
      shadow.s6_final_answer = frozenCustomerText;
      shadow.fast_path = trace.fast_path;
    }

    shadow.borrowed_senses_calls = borrowedSensesCalls;
    shadow.s6_speak_calls = s6SpeakCalls;
    trace.borrowed_senses_shadow = shadow;
  }

  const borrowedProviderCallCount = countBorrowedProviderCalls(shadow);
  const providerSpeed = shadow?.provider_speed ?? null;
  const deployIdentity = resolveDeployIdentity(env);
  trace.latency_marks = {
    borrowed_shadow_probe: borrowedShadowProbeMark,
    claude_full_emit: claudeFullEmitMark,
    s6_speak:
      s6SpeakCalls > 0
        ? {
            enter_ms: s6SpeakEnterMs,
            exit_ms: s6SpeakExitMs,
            duration_ms: s6SpeakDurationSum,
            s6_speak_call_count: s6SpeakCalls,
          }
        : {
            enter_ms: null,
            exit_ms: null,
            duration_ms: null,
            s6_speak_call_count: 0,
          },
    gate:
      gateEnterMs != null || gateExitMs != null || gateDurationSum > 0
        ? {
            enter_ms: gateEnterMs,
            exit_ms: gateExitMs,
            duration_ms: gateDurationSum,
          }
        : null,
    provider: {
      provider_call_count: borrowedProviderCallCount + s6ProviderCallCount,
      borrowed_provider_call_count: borrowedProviderCallCount,
      s6_provider_call_count: s6ProviderCallCount,
      claude_call_count: claudeCallCount,
      s6_call_count: s6SpeakCalls,
      focused_correction_count: focusedCorrectionCount,
      error_types: [...new Set(providerErrorTypes)].slice(0, 8),
    },
    provider_speed: providerSpeed
      ? {
          context_pack_ms: providerSpeed.context_pack_ms ?? null,
          provider_request_start_ms: providerSpeed.provider_request_start_ms ?? null,
          provider_request_complete_ms: providerSpeed.provider_request_complete_ms ?? null,
          provider_duration_ms: providerSpeed.provider_duration_ms ?? null,
          ttft_ms: providerSpeed.ttft_ms ?? null,
          ttft_basis: providerSpeed.ttft_basis ?? null,
          input_bytes: providerSpeed.input_bytes ?? null,
          input_tokens: providerSpeed.input_tokens ?? null,
          output_tokens: providerSpeed.output_tokens ?? null,
          attempt_count: providerSpeed.attempt_count ?? null,
          retry_count: providerSpeed.retry_count ?? null,
          research_tool_round_count: providerSpeed.research_tool_round_count ?? null,
        }
      : null,
    git_commit_sha: deployIdentity.git_commit_sha,
    deployment_id: deployIdentity.deployment_id,
  };

  const usedDocumentDirect =
    usedClaudeFullSinglePass &&
    (trace.document_direct?.direct_document_attached === true ||
      shadow?.document_direct?.direct_document_attached === true ||
      documentDirectMeta?.direct_document_attached === true) &&
    shadow?.error !== "REQUEST_PAYLOAD_TOO_LARGE" &&
    trace.fallback_reason !== "request_payload_too_large";

  if (shadow?.error === "REQUEST_PAYLOAD_TOO_LARGE" && shadow?.document_direct) {
    trace.document_direct = {
      document_id: shadow.document_direct.document_id ?? documentDirectMeta?.document_id ?? null,
      mime_type: shadow.document_direct.mime_type ?? documentDirectMeta?.mime_type ?? null,
      file_size_bytes:
        shadow.document_direct.file_size_bytes ?? documentDirectMeta?.file_size_bytes ?? null,
      direct_document_attached: false,
      estimated_request_bytes: shadow.document_direct.estimated_request_bytes ?? null,
      document_fallback_used: true,
      document_fallback_reason: "request_payload_too_large",
    };
  } else if (trace.document_direct?.document_fallback_reason === "request_payload_too_large") {
    // keep honest blocked meta already written on the failure path
  } else if (documentDirectMeta || shadow?.document_direct) {
    trace.document_direct = documentDirectMeta ?? shadow.document_direct;
  }

  return {
    text: finalText,
    visual_blocks: visualBlocks,
    segments: [],
    compose_mode: usedDocumentDirect
      ? "key_claude_full_document_direct"
      : usedClaudeFullSinglePass
        ? "key_claude_full_single_pass"
        : usedActiveFastPath
          ? "key_s7_borrowed_fast_path"
          : "key_s6_voice_speak",
    thinking_flow_applied: true,
    speak_mode: usedDocumentDirect
      ? "claude_full_document_direct"
      : usedClaudeFullSinglePass
        ? "claude_full_single_pass"
        : usedActiveFastPath
          ? "borrowed_senses_fast_path"
          : "key_voice_speak",
    facts_spoken: directive.facts_to_speak ?? [],
    facts_withheld: factSelection.facts_withheld ?? [],
    facts_used: (directive.facts_to_speak ?? []).map((f) => f.fact_id),
    defer_detected: false,
    fact_text_gate: outputGate.fact_text_gate ?? { ok: true },
    speak_fact_gate: speakFactGate,
    reflection_snapshot: reflection,
    decision_snapshot: decision,
    direction_type: decision.direction?.type ?? null,
    invite_allowed: decision.invite?.allowed ?? false,
    key_voice_trace: trace,
    slice5_enabled: thinkingFlow?.slice5_enabled ?? false,
    inferred_goal: decision.situation_key ?? null,
    rewrite_detected: false,
  };
}

export { isKeyVoiceActive, CLOSED_HARD_REASONS, partitionCustomerTextSafety };
