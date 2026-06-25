/**
 * P10-4 READ ONLY — KEY path runtime trace (no answer logic change).
 */
import { classifyConsultationIntent } from "./intentGateLayer.js";
import { matchConversationBrainTopic } from "./salesDirectorConversationBrain.js";
import {
  isKeyBlockedIntent,
  isKeyOrchestratorEnabled,
  parseKeyCustomerAllowlist,
  shouldUseSalesDirectorKeyOrchestrator,
} from "./salesDirectorKeyToolRegistry.js";

function preview(text = "", max = 300) {
  return String(text ?? "").slice(0, max);
}

export function diagnoseKeyEligibility({
  question = "",
  customerId = null,
  consultationIntent = null,
  env = process.env,
} = {}) {
  const classification = consultationIntent ?? classifyConsultationIntent(question);
  const skipReasons = [];

  if (!isKeyOrchestratorEnabled(env)) {
    skipReasons.push("SALES_DIRECTOR_KEY_ORCHESTRATOR !== 1");
  }
  if (isKeyBlockedIntent(classification.intent ?? "", env)) {
    skipReasons.push(`blocked_intent:${classification.intent ?? ""}`);
  }

  const allowlist = parseKeyCustomerAllowlist(env);
  const allowlistActive = Boolean(allowlist);
  const customerInAllowlist = allowlist ? allowlist.has(customerId) : null;
  if (allowlist && (!customerId || !allowlist.has(customerId))) {
    skipReasons.push("customer_not_in_key_allowlist");
  }

  const eligible = shouldUseSalesDirectorKeyOrchestrator({
    question,
    customerId,
    consultationIntent: classification,
    env,
  });

  return {
    eligible,
    skip_reasons: skipReasons,
    key_env_enabled: isKeyOrchestratorEnabled(env),
    allowlist_active: allowlistActive,
    customer_in_allowlist: customerInAllowlist,
    classificationIntent: classification.intent ?? null,
    lookup_sub_intent: classification.lookup_sub_intent ?? null,
    lookup_category: classification.lookup_category ?? null,
  };
}

export function buildKeyPathRuntimeTrace({
  question = "",
  customerId = null,
  consultationIntent = null,
  env = process.env,
  modeDecision = null,
  agentTurn = null,
  salesDirectorTrace = null,
  keyLoop = null,
  finalizeTrace = null,
  observability = null,
  answerText = "",
  sseTrace = null,
} = {}) {
  const classification = consultationIntent ?? classifyConsultationIntent(question);
  const keyEligibility = diagnoseKeyEligibility({
    question,
    customerId,
    consultationIntent: classification,
    env,
  });

  const conversationBrain = salesDirectorTrace?.conversation_brain ?? null;
  const freeThinking = conversationBrain?.free_thinking ?? null;
  const keyOrchestratorTrace = salesDirectorTrace?.key_orchestrator ?? null;

  const preserveGate = finalizeTrace?.preserve_gate_trace ?? null;
  const preserveApplied = finalizeTrace?.generation_mode === "free_thinking_preserved";
  const hulEntered =
    !preserveApplied &&
    Boolean(finalizeTrace?.generation_mode || finalizeTrace?.humanFrame || finalizeTrace?.applied != null);

  const keyCompose = finalizeTrace?.key_compose_trace ?? null;
  const toolBrainAbsorbed =
    salesDirectorTrace?.tool_brain_absorbed ?? salesDirectorTrace?.tool_brain ?? null;

  return {
    audit: "p10_4_key_path_trace",
    read_only: true,
    question,
    classificationIntent: classification.intent ?? null,
    lookup_sub_intent: classification.lookup_sub_intent ?? null,
    lookup_category: classification.lookup_category ?? null,
    conversation_brain_topic: matchConversationBrainTopic(question),
    key_eligibility: keyEligibility,
    key_loop: {
      eligibility_checked: true,
      entered: keyLoop?.entered === true || modeDecision?.key_orchestrator === true,
      handled: keyLoop?.handled === true || modeDecision?.mode === "sales_director_key_mode",
      failed_reason: keyLoop?.failed_reason ?? null,
      legacy_fallback: keyLoop?.legacy_fallback ?? null,
      sales_director_mode: modeDecision?.mode ?? observability?.sales_director_mode ?? null,
      key_tools_called: keyOrchestratorTrace?.tools_called ?? agentTurn?.factBundle?.key_tools_called ?? null,
    },
    build_key_structured_response: {
      called: keyCompose?.called === true,
      skip_reason: keyCompose?.skip_reason ?? (keyCompose?.called ? null : "not_invoked"),
      text_preview: preview(keyCompose?.text_preview ?? ""),
      used_safe_fallback: keyCompose?.used_safe_fallback === true,
      compose_mode: keyCompose?.compose_mode ?? toolBrainAbsorbed?.compose_mode ?? null,
      absorbed_slice: keyCompose?.absorbed_slice ?? toolBrainAbsorbed?.legacy_slice ?? null,
    },
    tool_brain_absorbed: toolBrainAbsorbed
      ? {
          legacy_slice: toolBrainAbsorbed.legacy_slice ?? null,
          compose_mode: toolBrainAbsorbed.compose_mode ?? keyCompose?.compose_mode ?? null,
          tools_called: toolBrainAbsorbed.tools_called ?? null,
          coverage_gap_suppressed: toolBrainAbsorbed.coverage_gap_suppressed === true,
          coverage_gap_suppress_reason: toolBrainAbsorbed.coverage_gap_suppress_reason ?? null,
          premium_stats_used: toolBrainAbsorbed.premium_stats_used === true,
          snapshot_used: toolBrainAbsorbed.snapshot_used === true,
          memory_used: toolBrainAbsorbed.memory_used === true,
        }
      : null,
    free_thinking: {
      created: Boolean(freeThinking?.status || conversationBrain?.free_thinking_applied),
      source: freeThinking?.source ?? null,
      status: freeThinking?.status ?? null,
      applied: conversationBrain?.free_thinking_applied === true,
      agent_turn_text_preview: preview(agentTurn?.text ?? ""),
    },
    preserve_gate: preserveGate
      ? {
          applied: preserveApplied,
          shouldPreserve: preserveGate.shouldPreserveFactualLookupFreeThinkingAnswer ?? null,
          preserve_path: preserveGate.preserve_path ?? null,
          hul_overwrite_entered: preserveGate.hul_overwrite_entered ?? null,
        }
      : null,
    hul: {
      entered: hulEntered,
      generation_mode: finalizeTrace?.generation_mode ?? null,
      text_preview: preview(
        preserveApplied ? agentTurn?.text : finalizeTrace?.text ?? answerText,
      ),
      applied: finalizeTrace?.applied ?? null,
    },
    final_selection: {
      response_source: observability?.response_source ?? agentTurn?.responseSource ?? null,
      sales_director_mode: observability?.sales_director_mode ?? null,
      selected_route: observability?.selected_route ?? null,
      answer_text_preview: preview(answerText),
      agent_turn_text_preview: preview(agentTurn?.text ?? ""),
    },
    sse: {
      delta_count: sseTrace?.delta_count ?? 0,
      replace_count: sseTrace?.replace_count ?? 0,
      first_delta_preview: preview(sseTrace?.first_delta_preview ?? ""),
      replace_preview: preview(sseTrace?.replace_preview ?? ""),
    },
    core_questions: {
      ab_blocks_key:
        preserveApplied === true ||
        (freeThinking?.source === "claude" && Boolean(agentTurn?.text)),
      key_eligibility_drop: keyEligibility.eligible === false,
      key_generated_but_not_selected:
        keyEligibility.eligible === true &&
        keyCompose?.called === true &&
        observability?.response_source !== "sales_director_key" &&
        finalizeTrace?.generation_mode !== "key_orchestrator",
    },
  };
}
