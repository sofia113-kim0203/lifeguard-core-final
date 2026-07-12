/**
 * KEY turn latency marks — numbers/status only (no prompts, secrets, PII).
 * Relative to request startedAt (0ms). Must never throw into the customer path.
 */

export function relMs(startedAt, now = Date.now()) {
  try {
    const t0 = Number(startedAt);
    if (!Number.isFinite(t0)) return null;
    return Math.max(0, Math.round(Number(now) - t0));
  } catch {
    return null;
  }
}

/** Open a span; call end() when done. Safe if startedAt invalid. */
export function startSpan(startedAt, now = Date.now()) {
  const enter_ms = relMs(startedAt, now);
  return {
    enter_ms,
    end(endNow = Date.now()) {
      try {
        const exit_ms = relMs(startedAt, endNow);
        const duration_ms =
          enter_ms == null || exit_ms == null ? null : Math.max(0, exit_ms - enter_ms);
        return { enter_ms, exit_ms, duration_ms };
      } catch {
        return { enter_ms, exit_ms: null, duration_ms: null };
      }
    },
  };
}

/** Allowlisted short error codes only — strip anything that looks like a secret/body. */
export function sanitizeLatencyErrorType(error = null) {
  try {
    const raw = String(error ?? "").trim();
    if (!raw) return null;
    const compact = raw.slice(0, 64);
    if (/^(ANTHROPIC_NOT_CONFIGURED|CLAUDE_TIMEOUT|CLAUDE_FETCH_ERROR|CLAUDE_EMPTY|CLAUDE_JSON_PARSE_FAIL|rate_limit|timeout|web_search_disabled_400)$/i.test(compact)) {
      return compact;
    }
    if (/^CLAUDE_API_\d{3}$/i.test(compact)) return compact.toUpperCase();
    if (/^provider_error/i.test(compact)) return "provider_error";
    if (/timeout|abort/i.test(compact)) return "CLAUDE_TIMEOUT";
    return "provider_error_other";
  } catch {
    return null;
  }
}

export function countBorrowedProviderCalls(shadow = null) {
  try {
    if (!shadow || typeof shadow !== "object") return 0;
    const trace = shadow.provider_request_trace;
    if (Array.isArray(trace) && trace.length > 0) return trace.length;
    const attempts = Number(shadow.attempts);
    if (Number.isFinite(attempts) && attempts > 0) return Math.round(attempts);
    return shadow.borrowed || shadow.error || shadow.provider ? 1 : 0;
  } catch {
    return 0;
  }
}

import { KEY_DEPLOY_IDENTITY } from "./keyDeployIdentity.js";

/**
 * Persistable subset for SSE summary + metadata_json.
 * Always includes deploy identity when env / deploy stamp provides it (no secrets).
 */
export function resolveDeployIdentity(env = process.env) {
  try {
    const fromEnv =
      String(env.VERCEL_GIT_COMMIT_SHA ?? env.GIT_COMMIT_SHA ?? "")
        .trim()
        .slice(0, 40) || null;
    const fromStamp =
      String(KEY_DEPLOY_IDENTITY?.git_commit_sha ?? "")
        .trim()
        .slice(0, 40) || null;
    const git_commit_sha = fromEnv || fromStamp || null;
    const deployment_id =
      String(env.VERCEL_DEPLOYMENT_ID ?? env.DEPLOYMENT_ID ?? "")
        .trim()
        .slice(0, 80) || null;
    return { git_commit_sha, deployment_id };
  } catch {
    return { git_commit_sha: null, deployment_id: null };
  }
}

export function buildPersistableLatencyMarks(latencyMarks = null, env = process.env) {
  try {
    if (!latencyMarks || typeof latencyMarks !== "object") return null;
    const pickSpan = (span) => {
      if (!span || typeof span !== "object") return null;
      const enter_ms = typeof span.enter_ms === "number" ? span.enter_ms : null;
      const exit_ms = typeof span.exit_ms === "number" ? span.exit_ms : null;
      const duration_ms = typeof span.duration_ms === "number" ? span.duration_ms : null;
      if (enter_ms == null && exit_ms == null && duration_ms == null) return null;
      return { enter_ms, exit_ms, duration_ms };
    };
    const provider = latencyMarks.provider && typeof latencyMarks.provider === "object"
      ? {
          provider_call_count: Number(latencyMarks.provider.provider_call_count) || 0,
          borrowed_provider_call_count:
            Number(latencyMarks.provider.borrowed_provider_call_count) || 0,
          s6_provider_call_count: Number(latencyMarks.provider.s6_provider_call_count) || 0,
          claude_call_count: Number(latencyMarks.provider.claude_call_count) || 0,
          s6_call_count: Number(latencyMarks.provider.s6_call_count) || 0,
          focused_correction_count:
            Number(latencyMarks.provider.focused_correction_count) || 0,
          error_types: Array.isArray(latencyMarks.provider.error_types)
            ? latencyMarks.provider.error_types
                .map((e) => sanitizeLatencyErrorType(e))
                .filter(Boolean)
                .slice(0, 8)
            : [],
        }
      : null;
    const providerSpeed =
      latencyMarks.provider_speed && typeof latencyMarks.provider_speed === "object"
        ? {
            context_pack_ms:
              typeof latencyMarks.provider_speed.context_pack_ms === "number"
                ? latencyMarks.provider_speed.context_pack_ms
                : null,
            provider_request_start_ms:
              typeof latencyMarks.provider_speed.provider_request_start_ms === "number"
                ? latencyMarks.provider_speed.provider_request_start_ms
                : null,
            provider_request_complete_ms:
              typeof latencyMarks.provider_speed.provider_request_complete_ms === "number"
                ? latencyMarks.provider_speed.provider_request_complete_ms
                : null,
            provider_duration_ms:
              typeof latencyMarks.provider_speed.provider_duration_ms === "number"
                ? latencyMarks.provider_speed.provider_duration_ms
                : null,
            ttft_ms:
              typeof latencyMarks.provider_speed.ttft_ms === "number"
                ? latencyMarks.provider_speed.ttft_ms
                : null,
            ttft_basis:
              typeof latencyMarks.provider_speed.ttft_basis === "string"
                ? latencyMarks.provider_speed.ttft_basis.slice(0, 48)
                : null,
            input_bytes:
              typeof latencyMarks.provider_speed.input_bytes === "number"
                ? latencyMarks.provider_speed.input_bytes
                : null,
            input_tokens:
              typeof latencyMarks.provider_speed.input_tokens === "number"
                ? latencyMarks.provider_speed.input_tokens
                : null,
            output_tokens:
              typeof latencyMarks.provider_speed.output_tokens === "number"
                ? latencyMarks.provider_speed.output_tokens
                : null,
            attempt_count:
              typeof latencyMarks.provider_speed.attempt_count === "number"
                ? latencyMarks.provider_speed.attempt_count
                : null,
            retry_count:
              typeof latencyMarks.provider_speed.retry_count === "number"
                ? latencyMarks.provider_speed.retry_count
                : null,
            research_tool_round_count:
              typeof latencyMarks.provider_speed.research_tool_round_count === "number"
                ? latencyMarks.provider_speed.research_tool_round_count
                : null,
          }
        : null;
    const s6 = latencyMarks.s6_speak && typeof latencyMarks.s6_speak === "object"
      ? {
          ...pickSpan(latencyMarks.s6_speak),
          s6_speak_call_count: Number(latencyMarks.s6_speak.s6_speak_call_count) || 0,
        }
      : null;
    const identity = resolveDeployIdentity(env);
    const out = {
      borrowed_shadow_probe: pickSpan(latencyMarks.borrowed_shadow_probe),
      claude_full_emit: pickSpan(latencyMarks.claude_full_emit),
      s6_speak: s6,
      gate: pickSpan(latencyMarks.gate),
      finalize: pickSpan(latencyMarks.finalize),
      seal: pickSpan(latencyMarks.seal),
      provider,
      provider_speed: providerSpeed,
      git_commit_sha:
        typeof latencyMarks.git_commit_sha === "string"
          ? latencyMarks.git_commit_sha.slice(0, 40)
          : identity.git_commit_sha,
      deployment_id:
        typeof latencyMarks.deployment_id === "string"
          ? latencyMarks.deployment_id.slice(0, 80)
          : identity.deployment_id,
    };
    return out;
  } catch {
    return null;
  }
}
