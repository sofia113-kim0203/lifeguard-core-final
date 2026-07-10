/**
 * Slice 6 — KEY Voice Compose.
 * Probe modes may run Borrowed Senses before Decision (hypotheses material).
 * Customer replacement:
 *   - off / shadow: never (S6 only; shadow may observe candidate)
 *   - active_partial: S6 first, then existing Stage2 promote helper
 *   - active: Stage3+alignment+Gate may use candidate without S6 (honest empty s6 input);
 *             else S6 once, then existing Stage3 promote helper (still requires alignment)
 */
import { buildDecision } from "./keyDecision.js";
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
import { speakKeyVoice, buildKeyVoiceSafeUtterance } from "./keyVoiceSpeak.js";
import { gateKeyVoiceAnswer } from "./keyVoiceGate.js";
import { composeSpeakFromDecision } from "../keyBrain/keySpeakFromDecision.js";
import { buildKeyVoiceVisualBlocks } from "./keyVoiceVisualBlocks.js";
import { gateKeyVoiceVisualBlocks } from "./keyVoiceBlockGate.js";
import {
  runBorrowedSensesShadowProbe,
  buildEarlyBorrowedFactBoundary,
} from "./keyBorrowedSensesSpeak.js";
import { gateBorrowedSensesOutput } from "./keyBorrowedSensesGate.js";
import {
  evaluateBorrowedFastPathCandidate,
  applyStage2PromotionToCompose,
} from "./keyBorrowedSensesStage2.js";
import { applyStage3PromotionToCompose } from "./keyBorrowedSensesStage3.js";

function normalizeText(text = "") {
  return String(text ?? "")
    .replace(/\s+/g, " ")
    .trim();
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
    fetchImpl = fetch,
  } = {},
) {
  let decision = thinkingFlow?.decision ?? null;
  const reflection = thinkingFlow?.reflection ?? null;
  const reality = thinkingFlow?.reality ?? null;
  const directiveQuestion = question || reflection?.customer_said || "";
  const probeOn = isKeyBorrowedSensesProbeEnabled(env);
  const production = isVercelProductionEnv(env);
  const borrowedMode = getKeyBorrowedSensesMode(env);
  const stage2Partial = isKeyBorrowedSensesStage2Partial(env);
  const stage3Active = isKeyBorrowedSensesStage3Active(env);

  const overrideBlocks = Array.isArray(shadowVisualBlocksOverride)
    ? shadowVisualBlocksOverride
    : null;

  let shadow = null;
  let borrowedUnderstanding = null;
  let s6SpeakCalls = 0;
  let borrowedSensesCalls = 0;

  // --- Early Borrowed Senses (before Decision) when probe enabled — at most 1 call ---
  if (probeOn) {
    const factBoundary = buildEarlyBorrowedFactBoundary({
      reality,
      question: directiveQuestion,
    });
    shadow = await runBorrowedSensesShadowProbe({
      question: directiveQuestion,
      directive: null,
      decision: null,
      factBoundary,
      reflection,
      history,
      previousAnswerSummary,
      s6FinalAnswer: "",
      visualBlocks: overrideBlocks?.length ? overrideBlocks : [],
      env,
      fetchImpl,
    });
    borrowedSensesCalls = 1;
    borrowedUnderstanding = shadow?.borrowed ?? null;
  }

  // --- KEY Decision (owns judgment; Claude understanding = material only) ---
  if (reflection && reality) {
    decision = buildDecision({
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

  const s5Reference = composeSpeakFromDecision({
    decision,
    policies: thinkingFlow?.policies ?? thinkingFlow?.reality?.policies ?? [],
  });

  const directive = buildKeyVoiceDirective({
    question: directiveQuestion,
    decision,
    previousAnswerSummary,
    history,
  });

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
    s5_reference_preview: String(s5Reference ?? "").slice(0, 200),
    borrowed_senses_calls: borrowedSensesCalls,
    s6_speak_calls: 0,
    borrowed_mode: borrowedMode,
    fast_path: null,
    call_order: probeOn
      ? "reality_reflection_borrowed_decision_align_gate"
      : "decision_directive_s6",
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
  if (probeOn && shadow) {
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
    };
  }

  let voiceRaw = null;
  let provider = null;
  let speakResult = { ok: false, error: null };
  let gateResult = { ok: false, reasons: ["pending"] };
  let usedActiveFastPath = false;

  // --- active only: one-call candidate if Stage3 promote + Decision alignment + KEY Voice Gate ---
  // s6FinalAnswer "" is honest absence (not a fabricated S6). Stage3 F3 still uses history/summary.
  if (stage3Active && !stage2Partial && !production && shadow && alignment?.ok === true) {
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
      const kvGate = gateKeyVoiceAnswer({
        text: candidate,
        directive,
        s5ReferenceText: s5Reference,
      });
      if (kvGate.ok) {
        voiceRaw = candidate;
        provider = "borrowed_senses_fast_path";
        gateResult = kvGate;
        usedActiveFastPath = true;
        trace.fast_path = {
          ok: true,
          reason: null,
          aligned_with_decision: true,
          gate_ok: true,
          alignment_reason: null,
          observation_only: false,
          stage3_promotion_pass: true,
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

  // --- S6 Speak when not on active fast path ---
  if (!voiceRaw) {
    speakResult = await speakKeyVoice({ directive, env, fetchImpl });
    s6SpeakCalls = 1;
    if (speakResult.ok) {
      voiceRaw = speakResult.voice_raw;
      provider = speakResult.provider;
    }

    gateResult = voiceRaw
      ? gateKeyVoiceAnswer({ text: voiceRaw, directive, s5ReferenceText: s5Reference })
      : { ok: false, reasons: [speakResult.error ?? "speak_failed"] };

    // Probe-off keeps one Gate-fail rewrite retry; probe-on stays at S6=1
    if (!gateResult.ok && voiceRaw && !probeOn) {
      trace.retry_count = 1;
      const retryDirective = {
        ...directive,
        repetition_avoidance_instruction: `${directive.repetition_avoidance_instruction} Gate fail: ${gateResult.reasons.join("; ")}. Rewrite without violating facts/focus.`,
      };
      const retrySpeak = await speakKeyVoice({
        directive: retryDirective,
        env,
        fetchImpl,
        temperature: 0.3,
      });
      s6SpeakCalls += 1;
      if (retrySpeak.ok) {
        voiceRaw = retrySpeak.voice_raw;
        provider = retrySpeak.provider;
        gateResult = gateKeyVoiceAnswer({
          text: voiceRaw,
          directive,
          s5ReferenceText: s5Reference,
        });
      }
    }
  }

  trace.voice_raw = voiceRaw;
  trace.provider = provider;
  trace.s6_speak_calls = s6SpeakCalls;

  let finalText = voiceRaw;
  let outputGate = gateResult;

  if (!gateResult.ok) {
    trace.fallback_used = true;
    trace.fallback_reason = voiceRaw
      ? gateResult.reasons?.join("; ")
      : speakResult.error ?? "speak_failed";
    finalText = buildKeyVoiceSafeUtterance(directive);
    outputGate = gateKeyVoiceAnswer({ text: finalText, directive, s5ReferenceText: s5Reference });
    trace.safe_gate_result = outputGate;
  }

  trace.gate_result = outputGate;

  finalText = normalizeText(finalText);
  if (!finalText) return null;

  let visualBlocks = [];
  if (outputGate.ok && !trace.fallback_used) {
    const candidates = buildKeyVoiceVisualBlocks({ directive });
    const blockGate = gateKeyVoiceVisualBlocks({
      blocks: candidates,
      text: finalText,
      directive,
    });
    visualBlocks = blockGate.accepted;
    trace.visual_blocks_candidates = candidates.map((b) => b.type);
    trace.visual_blocks_gate = blockGate;
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

  // --- Post-S6 Stage2 / Stage3 (base HEAD contracts). Never for shadow. Skip if active fast path already used. ---
  if (shadow && typeof shadow === "object") {
    trace.shadow_visual_blocks_override_used = Boolean(overrideBlocks?.length);
    trace.shadow_visual_blocks_override_count = overrideBlocks?.length ?? 0;

    if (usedActiveFastPath) {
      shadow.customer_text_changed = true;
      shadow.final_answer_source = "s7";
      shadow.s6_final_answer = "";
      shadow.fast_path = trace.fast_path;
    } else if (stage2Partial && !stage3Active) {
      const s6FinalAnswer = finalText;
      const stage2 = applyStage2PromotionToCompose({
        question: directiveQuestion,
        s6FinalAnswer,
        shadow,
        env,
      });
      trace.stage2_partial = stage2.stage2_partial;
      shadow.customer_text_changed = stage2.customer_text_changed;
      shadow.final_answer_source = stage2.final_answer_source;
      shadow.s6_final_answer = s6FinalAnswer;
      shadow.stage2_partial = stage2.stage2_partial;
      if (stage2.customer_text_changed === true && stage2.final_answer_source === "s7") {
        finalText = String(stage2.finalText ?? "").trim() || s6FinalAnswer;
      }
      shadow.fast_path = trace.fast_path;
    } else if (stage3Active && !stage2Partial) {
      const s6FinalAnswer = finalText;
      const stage3 = applyStage3PromotionToCompose({
        question: directiveQuestion,
        s6FinalAnswer,
        shadow,
        env,
        history,
        previousAnswerSummary,
        decision,
      });
      trace.stage3_active = stage3.stage3_active;
      // Decision alignment required for customer swap (GO corrective)
      const mayPromote =
        stage3.customer_text_changed === true &&
        stage3.final_answer_source === "s7" &&
        alignment?.ok === true;
      if (mayPromote) {
        const promoted = String(stage3.finalText ?? "").trim() || s6FinalAnswer;
        const kvGate = gateKeyVoiceAnswer({
          text: promoted,
          directive,
          s5ReferenceText: s5Reference,
        });
        if (kvGate.ok) {
          finalText = promoted;
          shadow.customer_text_changed = true;
          shadow.final_answer_source = "s7";
          outputGate = kvGate;
          trace.gate_result = kvGate;
        } else {
          shadow.customer_text_changed = false;
          shadow.final_answer_source = "s6";
          stage3.stage3_active = {
            ...stage3.stage3_active,
            promotion_pass: false,
            customer_text_changed: false,
            final_answer_source: "s6",
            fallback_reason: `key_voice_gate:${kvGate.reasons?.join(";") ?? "fail"}`,
          };
        }
      } else {
        shadow.customer_text_changed = false;
        shadow.final_answer_source = "s6";
        if (stage3.customer_text_changed && alignment?.ok !== true) {
          stage3.stage3_active = {
            ...stage3.stage3_active,
            promotion_pass: false,
            customer_text_changed: false,
            final_answer_source: "s6",
            fallback_reason: alignment?.reason ?? "decision_alignment_blocked",
          };
        }
      }
      shadow.s6_final_answer = s6FinalAnswer;
      shadow.stage3_active = stage3.stage3_active;
      trace.stage3_active = stage3.stage3_active;
      shadow.fast_path = trace.fast_path;
    } else {
      // shadow or off-with-probe edge: never replace customer text
      shadow.customer_text_changed = false;
      shadow.final_answer_source = "s6";
      shadow.s6_final_answer = finalText;
      shadow.fast_path = trace.fast_path;
    }

    shadow.borrowed_senses_calls = borrowedSensesCalls;
    shadow.s6_speak_calls = s6SpeakCalls;
    trace.borrowed_senses_shadow = shadow;
  }

  return {
    text: finalText,
    visual_blocks: visualBlocks,
    segments: [],
    compose_mode: usedActiveFastPath ? "key_s7_borrowed_fast_path" : "key_s6_voice_speak",
    thinking_flow_applied: true,
    speak_mode: usedActiveFastPath ? "borrowed_senses_fast_path" : "key_voice_speak",
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
  };
}

export { isKeyVoiceActive };
