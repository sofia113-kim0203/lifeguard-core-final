/**
 * TOKEN BOMB S4-T — Preview-only sanitized Claude runtime trace.
 * Identical helper on Baseline and Selective branches.
 * Never stores question/answer/system/body/PII. Preview emit only.
 */

export const KEY_CLAUDE_PREVIEW_RUNTIME_TRACE_SCHEMA =
  "key_claude_preview_runtime_trace_v1";

export const PREVIEW_RUNTIME_TRACE_MAX_BYTES = 16 * 1024;
export const PREVIEW_RUNTIME_TRACE_MAX_OBSERVATIONS = 5;

const SAFE_ID_RE = /^[A-Za-z0-9_.:-]{1,80}$/;
const MAX_ID_ARRAY = 64;

/** Fixed packet type stems (dynamic hash suffixes stripped). */
const PACKET_TYPE_STEMS = new Set([
  "policy_count_packet",
  "policy_list_packet",
  "coverage_packet",
  "premium_packet",
  "claim_packet",
  "clock_packet",
  "attachment_packet",
  "conversation_packet",
  "contract_summary_packet",
  "recommendation_context_packet",
  "memory_packet",
]);

const FIXED_FACT_SCOPE_ALLOW = new Set([
  "confirmed_contract_count",
  "confirmed_contract_list",
  "contract_status",
  "contract_premium",
  "payment_status",
  "coverage_name",
  "coverage_amount",
  "coverage_period",
  "renewal_type",
  "linked_contract_id",
  "minimal_thread",
  "current_original",
  "attachment_identity",
  "claim_status",
  "submitted_evidence",
  "deadline",
  "payment_denial_result",
  "recommendation_context",
  "coverage_gap",
  "budget_preference",
  "contract_summary",
  "clock_deadline",
  "renewal",
  "lapse",
]);

const CANARY_PATTERNS = [
  /data:image\//i,
  /base64,[A-Za-z0-9+/]{40,}/i,
  /@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/,
  /signedurl|storage\.googleapis|supabase\.co\/storage/i,
  /주민등록|계약번호|보험료|담보금액/,
];

export function shouldEmitKeyClaudePreviewRuntimeTrace(env = process.env) {
  return String(env?.VERCEL_ENV ?? "").trim() === "preview";
}

export function sanitizePreviewTraceId(raw) {
  const s = String(raw ?? "").trim();
  if (!s || s.length > 80) return null;
  if (!SAFE_ID_RE.test(s)) return null;
  return s;
}

export function toPacketTypeId(packetId) {
  const raw = String(packetId ?? "").trim().toLowerCase();
  if (!raw) return null;
  // Strip customer-specific suffixes: coverage_packet_rh_xxxx → coverage_packet
  const packetIdx = raw.indexOf("_packet");
  if (packetIdx >= 0) {
    const stem = raw.slice(0, packetIdx + "_packet".length);
    if (PACKET_TYPE_STEMS.has(stem)) return sanitizePreviewTraceId(stem);
  }
  if (PACKET_TYPE_STEMS.has(raw)) return sanitizePreviewTraceId(raw);
  return null;
}

function uniqSortIds(ids) {
  const out = [];
  const seen = new Set();
  for (const id of ids) {
    const s = sanitizePreviewTraceId(id);
    if (!s || seen.has(s)) continue;
    seen.add(s);
    out.push(s);
    if (out.length >= MAX_ID_ARRAY) break;
  }
  out.sort();
  return out;
}

function numOrNull(v) {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function boolOrNull(v) {
  if (v === true) return true;
  if (v === false) return false;
  return null;
}

/**
 * Map one internal provider_fetch_observation (+ optional enrich) → public schema.
 */
export function mapProviderFetchObservationForPreview(raw = {}, enrich = {}) {
  const usage = raw?.usage && typeof raw.usage === "object" ? raw.usage : null;
  const enrichUsage =
    enrich?.usage && typeof enrich.usage === "object" ? enrich.usage : null;
  const u = enrichUsage || usage;

  const inputTokens = u ? numOrNull(u.input_tokens) : null;
  const cacheCreate = u ? numOrNull(u.cache_creation_input_tokens) : null;
  const cacheRead = u ? numOrNull(u.cache_read_input_tokens) : null;
  const outputTokens = u ? numOrNull(u.output_tokens) : null;

  // Prefer enrich times; else raw; never invent.
  const providerStart = numOrNull(enrich.provider_start_ms ?? raw.provider_start_ms);
  const firstDelta = numOrNull(
    enrich.first_customer_delta_ms ?? raw.first_customer_delta_ms,
  );
  const providerComplete = numOrNull(
    enrich.provider_complete_ms ?? raw.provider_complete_ms,
  );
  const customerComplete = numOrNull(
    enrich.customer_complete_ms ?? raw.customer_complete_ms,
  );

  let ttft = numOrNull(enrich.ttft_ms ?? raw.ttft_ms);
  if (ttft == null && providerStart != null && firstDelta != null) {
    ttft = firstDelta - providerStart;
  }
  let providerDuration = numOrNull(enrich.provider_duration_ms ?? raw.provider_duration_ms);
  if (providerDuration == null && providerStart != null && providerComplete != null) {
    providerDuration = providerComplete - providerStart;
  }
  let customerTotal = numOrNull(enrich.customer_total_ms ?? raw.customer_total_ms);
  if (customerTotal == null && providerStart != null && customerComplete != null) {
    customerTotal = customerComplete - providerStart;
  }

  const flags = enrich.context_flags && typeof enrich.context_flags === "object"
    ? enrich.context_flags
    : {};

  return {
    fetch_index:
      numOrNull(raw.provider_fetch_index ?? raw.fetch_index) ?? 0,
    request_body_bytes: numOrNull(raw.body_bytes ?? raw.request_body_bytes) ?? 0,
    system_chars: numOrNull(raw.system_chars ?? enrich.system_chars) ?? 0,
    message_count: numOrNull(raw.message_count) ?? 0,
    image_count: numOrNull(raw.image_block_count ?? raw.image_count) ?? 0,
    tool_count: numOrNull(raw.tool_count) ?? 0,
    input_tokens: inputTokens,
    cache_creation_input_tokens: cacheCreate,
    cache_read_input_tokens: cacheRead,
    output_tokens: outputTokens,
    stop_reason:
      enrich.stop_reason != null
        ? String(enrich.stop_reason)
        : raw.stop_reason != null
          ? String(raw.stop_reason)
          : null,
    tool_use_count:
      numOrNull(enrich.tool_use_count ?? raw.server_tool_use_count ?? raw.tool_use_count) ??
      0,
    provider_start_ms: providerStart,
    first_customer_delta_ms: firstDelta,
    provider_complete_ms: providerComplete,
    customer_complete_ms: customerComplete,
    ttft_ms: ttft,
    provider_duration_ms: providerDuration,
    customer_total_ms: customerTotal,
    full_chart_present: boolOrNull(
      flags.full_chart_present ?? raw.full_chart_present,
    ),
    full_ledger_present: boolOrNull(
      flags.full_ledger_present ?? raw.full_ledger_present,
    ),
    full_memory_present: boolOrNull(
      flags.full_memory_present ?? raw.full_memory_present,
    ),
    full_conversation_present: boolOrNull(
      flags.full_conversation_present ?? raw.full_conversation_present,
    ),
    prior_original_present: boolOrNull(
      flags.prior_original_present ?? raw.prior_original_present,
    ),
    heavy_context_replay:
      enrich.heavy_context_replay === true ||
      raw.prior_heavy_context_replayed === true ||
      raw.heavy_context_replay === true
        ? true
        : enrich.heavy_context_replay === false ||
            raw.prior_heavy_context_replayed === false ||
            raw.heavy_context_replay === false
          ? false
          : boolOrNull(flags.heavy_context_replay),
  };
}

export function buildSelectionObservationForPreview({
  liveRequestMode = null,
  selectionPlan = null,
  selectionAvailable = null,
} = {}) {
  const mode = String(liveRequestMode ?? "");
  const available =
    selectionAvailable === true ||
    (selectionAvailable == null && mode === "ONE_SHOT_SELECTIVE" && selectionPlan);

  if (!available) {
    return {
      selection_available: false,
      selected_prompt_block_count: null,
      selected_prompt_block_ids: [],
      selected_resource_packet_count: null,
      selected_resource_packet_type_ids: [],
      selected_fact_scope_count: null,
      selected_fact_scope_ids: [],
    };
  }

  const plan = selectionPlan && typeof selectionPlan === "object" ? selectionPlan : {};
  const blockIds = uniqSortIds(
    Array.isArray(plan.selected_prompt_blocks) ? plan.selected_prompt_blocks : [],
  );

  const packetTypeIds = uniqSortIds(
    (Array.isArray(plan.selected_resource_packets)
      ? plan.selected_resource_packets
      : []
    )
      .map((p) => toPacketTypeId(p?.packet_id ?? p))
      .filter(Boolean),
  );

  const factScopeRaw = [];
  if (Array.isArray(plan.selected_fact_scopes)) {
    factScopeRaw.push(...plan.selected_fact_scopes);
  }
  for (const p of Array.isArray(plan.selected_resource_packets)
    ? plan.selected_resource_packets
    : []) {
    if (Array.isArray(p?.fact_scopes)) factScopeRaw.push(...p.fact_scopes);
  }
  const factScopeIds = uniqSortIds(
    factScopeRaw.filter((id) => FIXED_FACT_SCOPE_ALLOW.has(String(id))),
  );

  return {
    selection_available: true,
    selected_prompt_block_count: blockIds.length,
    selected_prompt_block_ids: blockIds,
    selected_resource_packet_count: packetTypeIds.length,
    selected_resource_packet_type_ids: packetTypeIds,
    selected_fact_scope_count: factScopeIds.length,
    selected_fact_scope_ids: factScopeIds,
  };
}

export function assertNoRawCustomerContentInPreviewTrace(obj) {
  const s = JSON.stringify(obj);
  for (const re of CANARY_PATTERNS) {
    if (re.test(s)) {
      throw new Error("RAW_CUSTOMER_CONTENT_IN_TRACE");
    }
  }
  // Structural denylist keys
  const bannedKey = /question|answer|email|contract_number|file_name|storage_path|signed_url|system_prompt|base64|customer_name/i;
  const walk = (v, path = "") => {
    if (v && typeof v === "object") {
      for (const [k, child] of Object.entries(v)) {
        if (bannedKey.test(k)) {
          throw new Error(`RAW_CUSTOMER_CONTENT_IN_TRACE:key:${k}`);
        }
        walk(child, `${path}.${k}`);
      }
    }
  };
  walk(obj);
  return true;
}

export function sanitizeKeyClaudePreviewRuntimeTrace(trace) {
  if (!trace || typeof trace !== "object") return null;
  const cloned = JSON.parse(JSON.stringify(trace));
  assertNoRawCustomerContentInPreviewTrace(cloned);

  let observations = Array.isArray(cloned.provider_fetch_observations)
    ? cloned.provider_fetch_observations
    : [];
  let truncated = false;
  if (observations.length > PREVIEW_RUNTIME_TRACE_MAX_OBSERVATIONS) {
    observations = observations.slice(0, PREVIEW_RUNTIME_TRACE_MAX_OBSERVATIONS);
    truncated = true;
  }
  cloned.provider_fetch_observations = observations;
  if (truncated) cloned.observations_truncated = true;

  let json = JSON.stringify(cloned);
  if (Buffer.byteLength(json, "utf8") > PREVIEW_RUNTIME_TRACE_MAX_BYTES) {
    // Safe truncate: drop observations from the end until under limit (keep count SSOT).
    while (
      cloned.provider_fetch_observations.length > 0 &&
      Buffer.byteLength(JSON.stringify(cloned), "utf8") > PREVIEW_RUNTIME_TRACE_MAX_BYTES
    ) {
      cloned.provider_fetch_observations.pop();
      cloned.observations_truncated = true;
    }
    json = JSON.stringify(cloned);
    if (Buffer.byteLength(json, "utf8") > PREVIEW_RUNTIME_TRACE_MAX_BYTES) {
      // Last resort: empty observations, keep counts.
      cloned.provider_fetch_observations = [];
      cloned.observations_truncated = true;
    }
  }

  assertNoRawCustomerContentInPreviewTrace(cloned);
  return cloned;
}

/**
 * Build Preview runtime trace from already-computed server fields.
 */
export function buildKeyClaudePreviewRuntimeTrace({
  env = process.env,
  liveRequestMode = null,
  actualProviderFetchCount = 0,
  providerFetchObservations = [],
  selectionPlan = null,
  selectionAvailable = null,
  contextFlags = null,
  /** Apply usage/latency to the last observation when per-fetch enrich missing. */
  turnEnrich = null,
} = {}) {
  if (!shouldEmitKeyClaudePreviewRuntimeTrace(env)) {
    return null;
  }

  const mode =
    liveRequestMode === "ONE_SHOT_SELECTIVE" || liveRequestMode === "FULL_CURRENT"
      ? liveRequestMode
      : liveRequestMode
        ? String(liveRequestMode)
        : "FULL_CURRENT";

  const count = Number(actualProviderFetchCount) || 0;
  const rawObs = Array.isArray(providerFetchObservations)
    ? providerFetchObservations
    : [];

  const observations = rawObs.map((obs, idx) => {
    const isLast = idx === rawObs.length - 1;
    const enrich = isLast && turnEnrich && typeof turnEnrich === "object"
      ? {
          usage: turnEnrich.usage ?? null,
          stop_reason: turnEnrich.stop_reason ?? null,
          tool_use_count: turnEnrich.tool_use_count ?? null,
          provider_start_ms: turnEnrich.provider_start_ms ?? null,
          first_customer_delta_ms: turnEnrich.first_customer_delta_ms ?? null,
          provider_complete_ms: turnEnrich.provider_complete_ms ?? null,
          customer_complete_ms: turnEnrich.customer_complete_ms ?? null,
          ttft_ms: turnEnrich.ttft_ms ?? null,
          context_flags: contextFlags,
          system_chars: turnEnrich.system_chars ?? null,
          heavy_context_replay: obs?.prior_heavy_context_replayed,
        }
      : {
          context_flags: contextFlags,
          heavy_context_replay: obs?.prior_heavy_context_replayed,
        };
    return mapProviderFetchObservationForPreview(obs, enrich);
  });

  const trace = {
    schema: KEY_CLAUDE_PREVIEW_RUNTIME_TRACE_SCHEMA,
    live_request_mode: mode,
    actual_provider_fetch_count: count,
    provider_fetch_observations: observations,
    selection_observation: buildSelectionObservationForPreview({
      liveRequestMode: mode,
      selectionPlan,
      selectionAvailable,
    }),
    privacy_guard: {
      raw_customer_content_present: false,
    },
  };

  return sanitizeKeyClaudePreviewRuntimeTrace(trace);
}
