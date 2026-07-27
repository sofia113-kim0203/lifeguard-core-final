/**
 * Preview-only QA turn recorder (Surgery 0).
 * Default OFF. Never blocks customer stream/seal. No second Claude call.
 */
import { createHash, createHmac, randomBytes } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import {
  resolveServiceRoleKey,
  resolveSupabaseUrl,
} from "../customerMemoryFoundation.js";
import { resolveDeployIdentity } from "./keyLatencyMarks.js";

export const QA_TURN_TRACE_SCHEMA_VERSION = "key-qa-turn-trace-v0";
export const QA_TURN_TRACE_TABLE = "key_qa_turn_traces";
export const QA_TURN_DEFAULT_TTL_HOURS = 72;
export const QA_TURN_WRITE_TIMEOUT_MS = 800;

const SECRET_SCRUB_PATTERNS = [
  /Authorization\s*[:=]\s*Bearer\s+[A-Za-z0-9\-._~+/]+=*/gi,
  /Bearer\s+[A-Za-z0-9\-._~+/]{20,}=*/gi,
  /Cookie\s*[:=]\s*[^\s;,]+/gi,
  /(?:access_token|refresh_token|api[_-]?key|service_role|SUPABASE_[A-Z0-9_]+|ANTHROPIC_API_KEY|QA_PASSWORD|bypass[_-]?secret)\s*[:=]\s*["']?[^"'\s]+/gi,
  /https?:\/\/[^\s"'<>]+(?:token|sig|signature|X-Amz-)[^\s"'<>]*/gi,
  /data:[a-zA-Z0-9/+.-]+;base64,[A-Za-z0-9+/=\s]+/gi,
  /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g,
];

const FORBIDDEN_PAYLOAD_KEYS = new Set([
  "base64",
  "pdfbase64",
  "bytes",
  "file_bytes",
  "image_bytes",
  "authorization",
  "cookie",
  "access_token",
  "refresh_token",
  "api_key",
  "apikey",
  "service_role_key",
  "supabase_key",
  "qa_password",
  "bypass_secret",
  "signed_url",
  "signedurl",
]);

function flagOn(value) {
  const v = String(value ?? "")
    .trim()
    .toLowerCase();
  return v === "1" || v === "true" || v === "on";
}

export function isQaTurnRecorderFlagOn(env = process.env) {
  return flagOn(env?.KEY_QA_TURN_RECORDER);
}

/** Strict Preview only — development/production never activate. */
export function isPreviewVercelEnv(env = process.env) {
  return String(env?.VERCEL_ENV ?? "").trim() === "preview";
}

export function parseQaTurnRecorderAllowlist(env = process.env) {
  const raw = String(env?.KEY_QA_TURN_RECORDER_CUSTOMER_IDS ?? "").trim();
  if (!raw) return [];
  return raw
    .split(/[,;\s]+/)
    .map((id) => id.trim().toLowerCase())
    .filter(Boolean);
}

export function isCustomerAllowlistedForQaTurnRecorder(customerId, env = process.env) {
  const id = String(customerId ?? "")
    .trim()
    .toLowerCase();
  if (!id) return false;
  const allow = parseQaTurnRecorderAllowlist(env);
  if (!allow.length) return false;
  return allow.includes(id);
}

export function isHistoryFullEnabled(env = process.env) {
  return flagOn(env?.KEY_QA_TURN_RECORDER_HISTORY_FULL);
}

/**
 * Activation AND-lock. Any miss → record 0.
 * GO lock: VERCEL_ENV === "preview" (not loose !== production).
 */
export function shouldActivateQaTurnRecorder({
  env = process.env,
  customerId = null,
  presenceTurn = false,
  audience = null,
  keyRoleContract = null,
} = {}) {
  if (!isPreviewVercelEnv(env)) return false;
  if (!isQaTurnRecorderFlagOn(env)) return false;
  if (!isCustomerAllowlistedForQaTurnRecorder(customerId, env)) return false;
  if (presenceTurn === true) return false;
  const aud = String(audience ?? "")
    .trim()
    .toLowerCase();
  if (aud === "agent") return false;
  if (keyRoleContract && typeof keyRoleContract === "object") {
    const roleAud = String(keyRoleContract.audience ?? "")
      .trim()
      .toLowerCase();
    if (roleAud === "agent") return false;
  }
  return true;
}

export function createTurnTraceId(now = Date.now()) {
  const rand = randomBytes(8).toString("hex");
  return `qatr_${now.toString(36)}_${rand}`;
}

function resolvePepper(env = process.env) {
  return String(
    env?.KEY_QA_TURN_RECORDER_PEPPER ??
      env?.KEY_QA_TURN_HASH_PEPPER ??
      "key-qa-turn-trace-default-pepper",
  );
}

export function hashSensitiveId(value, env = process.env) {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  const pepper = resolvePepper(env);
  try {
    return createHmac("sha256", pepper).update(raw, "utf8").digest("hex").slice(0, 32);
  } catch {
    return createHash("sha256")
      .update(`${pepper}:${raw}`, "utf8")
      .digest("hex")
      .slice(0, 32);
  }
}

export function scrubSecretsInText(input) {
  let text = String(input ?? "");
  for (const re of SECRET_SCRUB_PATTERNS) {
    text = text.replace(re, "[REDACTED]");
  }
  return text;
}

function isForbiddenKey(key) {
  const k = String(key ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, "");
  if (!k) return false;
  if (FORBIDDEN_PAYLOAD_KEYS.has(k)) return true;
  if (k.endsWith("_base64") || k.endsWith("base64")) return true;
  if (k.includes("password") || k.includes("secret")) return true;
  return false;
}

export function scrubDeepForQaTrace(value, depth = 0) {
  if (depth > 12) return "[MAX_DEPTH]";
  if (value == null) return value;
  if (typeof value === "string") return scrubSecretsInText(value);
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) {
    return value.map((item) => scrubDeepForQaTrace(item, depth + 1));
  }
  if (typeof value === "object") {
    const out = {};
    for (const [key, child] of Object.entries(value)) {
      if (isForbiddenKey(key)) {
        out[key] = "[REDACTED_FORBIDDEN_KEY]";
        continue;
      }
      out[key] = scrubDeepForQaTrace(child, depth + 1);
    }
    return out;
  }
  return String(value);
}

export function sha256Text(text) {
  return createHash("sha256").update(String(text ?? ""), "utf8").digest("hex");
}

export function parsePolicyCountAuthorityN(addendum) {
  const text = String(addendum ?? "");
  if (!text.trim()) return null;
  const m =
    text.match(/active_distinct_count\s*[:=]\s*(\d+)/i) ||
    text.match(/(\d+)\s*건/);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

export function buildSystemCapture({
  systemText = "",
  policyCountAuthorityAddendum = null,
  hasDomainContext = false,
  hasSidecarHint = false,
  hasPlaceAddendum = false,
  hasProductAddendum = false,
  hasAgentPriority = false,
} = {}) {
  const text = scrubSecretsInText(String(systemText ?? ""));
  const hasPolicyCount =
    typeof policyCountAuthorityAddendum === "string" &&
    policyCountAuthorityAddendum.trim().length > 0;
  const system_block_order = ["LIFEGUARD_KEY_SYSTEM_PROMPT"];
  if (hasDomainContext) system_block_order.push("DOMAIN_CONTEXT");
  if (hasSidecarHint) system_block_order.push("KEY_RECORD_SIDECAR_HINT");
  if (hasPolicyCount) system_block_order.push("POLICY_COUNT_AUTHORITY");
  if (hasAgentPriority) system_block_order.push("KEY_ROLE_BADGE");
  return {
    system_block_order,
    system_text_final: text,
    system_text_sha256: sha256Text(text),
    system_text_chars: text.length,
    flags: {
      has_lifeguard_key_system: true,
      has_domain_context: hasDomainContext === true,
      has_policy_count_authority: hasPolicyCount,
      policy_count_authority_n: hasPolicyCount
        ? parsePolicyCountAuthorityN(policyCountAuthorityAddendum)
        : null,
      has_sidecar_hint: hasSidecarHint === true,
      has_place_addendum: hasPlaceAddendum === true,
      has_product_addendum: hasProductAddendum === true,
      has_agent_priority: hasAgentPriority === true,
    },
  };
}

function summarizeChart(chart) {
  if (!chart || typeof chart !== "object") return null;
  const contracts = Array.isArray(chart.contracts) ? chart.contracts : [];
  return {
    policy_count:
      chart.policy_count != null
        ? Number(chart.policy_count)
        : contracts.length || null,
    contracts_length: contracts.length,
    evidence_state: chart.evidence_state ?? chart.status ?? null,
  };
}

function collectHistoryPollution(history = []) {
  const rows = Array.isArray(history) ? history : [];
  const hits = [];
  const re = /(\d+)\s*건|(보험|계약).{0,12}(목록|리스트)|실손|운전자/;
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    const role = String(row?.role ?? "");
    const content = String(row?.content ?? row?.text ?? "");
    if (!content || !re.test(content)) continue;
    hits.push({
      role,
      index,
      excerpt_redacted: scrubSecretsInText(content).slice(0, 180),
    });
    if (hits.length >= 24) break;
  }
  return hits;
}

export function buildUserPayloadCapture({
  userPayload = null,
  history = [],
  question = "",
  historyFull = false,
} = {}) {
  const payload =
    userPayload && typeof userPayload === "object" ? userPayload : {};
  const actual_keys_present = Object.keys(payload).sort();
  const historyRows = Array.isArray(history) ? history : [];
  const role_counts = { user: 0, assistant: 0, other: 0 };
  for (const row of historyRows) {
    const role = String(row?.role ?? "").toLowerCase();
    if (role === "user") role_counts.user += 1;
    else if (role === "assistant") role_counts.assistant += 1;
    else role_counts.other += 1;
  }
  const out = {
    current_question: scrubSecretsInText(String(question ?? "")).slice(0, 2000),
    policy_truth: scrubDeepForQaTrace(payload.policy_truth ?? null),
    available_verified_evidence_personal_chart: summarizeChart(
      payload?.available_verified_evidence?.personal?.chart ??
        payload?.chart ??
        null,
    ),
    history_meta: {
      message_count: historyRows.length,
      role_counts,
      assistant_count: role_counts.assistant,
      user_count: role_counts.user,
    },
    history_contract_pollution_hits: collectHistoryPollution(historyRows),
    history_full: historyFull === true,
    prompt_vocab_expected: [
      "EVIDENCE_SCOPE",
      "CURRENT_ORIGINALS",
      "VERIFIED_POLICY_LEDGER",
      "POLICY_COUNT_AUTHORITY",
    ],
    actual_keys_present,
  };
  if (historyFull === true) {
    out.history_messages_redacted = historyRows.slice(-40).map((row) => ({
      role: row?.role ?? null,
      content: scrubSecretsInText(String(row?.content ?? row?.text ?? "")).slice(
        0,
        1200,
      ),
    }));
  }
  return out;
}

export function buildOriginalsManifest({
  vaultRecall = null,
  attachments = null,
  pdfMeta = null,
} = {}) {
  const attachRows = Array.isArray(attachments) ? attachments : [];
  const listing = Array.isArray(vaultRecall?.listing) ? vaultRecall.listing : [];
  const failed = Array.isArray(vaultRecall?.failed) ? vaultRecall.failed : [];
  const excluded = Array.isArray(vaultRecall?.excluded)
    ? vaultRecall.excluded
    : [];
  const blocks = [];
  const pushBlock = (row, order) => {
    if (!row || typeof row !== "object") return;
    const document_id =
      String(row.document_id ?? row.id ?? "").trim() || null;
    const sha256 =
      String(row.content_sha256 ?? row.sha256 ?? "")
        .trim()
        .toLowerCase() || null;
    const media_type =
      String(row.mediaType ?? row.media_type ?? row.mime_type ?? "").trim() ||
      null;
    blocks.push({
      order,
      document_id,
      sha256,
      media_type,
      download_ok:
        row.download_ok === true ||
        Boolean(row.base64) ||
        row.attached === true ||
        Boolean(sha256),
      // filename intentionally omitted by default
    });
  };
  if (attachRows.length) {
    attachRows.forEach((row, i) => pushBlock(row, i + 1));
  } else if (pdfMeta?.document_id) {
    pushBlock(
      {
        document_id: pdfMeta.document_id,
        content_sha256: pdfMeta.content_sha256,
        media_type: pdfMeta.mime_type ?? pdfMeta.media_type,
        attached: pdfMeta.attached === true,
      },
      1,
    );
  }
  const manifest = {
    candidate_document_count: listing.length || attachRows.length || 0,
    attached_document_count: blocks.length,
    blocks,
    failed_document_ids: failed
      .map((f) => String(f?.document_id ?? f?.id ?? f ?? "").trim())
      .filter(Boolean),
    excluded: excluded.map((e) => ({
      document_id: String(e?.document_id ?? e?.id ?? "").trim() || null,
      reason: String(e?.reason ?? "").slice(0, 120) || null,
    })),
    partial_originals:
      vaultRecall?.partial_originals === true ||
      String(vaultRecall?.reason ?? "").includes("partial") ||
      false,
    vault_mode: vaultRecall?.mode ?? null,
    vault_reason: vaultRecall?.reason ?? null,
  };
  // Hard guarantee: no bytes/base64 leak even if caller passed them.
  return scrubDeepForQaTrace(manifest);
}

export function buildClaudeCapture({
  providerRawCustomerText = "",
  stopReason = null,
  toolUsePresent = false,
  toolNames = [],
  sidecarRaw = null,
  sidecarParseOk = false,
  policyInventoryFactsCount = 0,
  textBeforeFinalize = "",
  textAfterSeal = "",
  sealedMatchesClaude = null,
  streamedEqualsSealed = null,
  providerMessagesRequestCount = 1,
} = {}) {
  return {
    provider_raw_customer_text: scrubSecretsInText(
      String(providerRawCustomerText ?? ""),
    ).slice(0, 20000),
    stop_reason: stopReason ?? null,
    tool_use_present: toolUsePresent === true,
    tool_names: Array.isArray(toolNames) ? toolNames.slice(0, 24) : [],
    sidecar_raw:
      sidecarRaw == null
        ? null
        : scrubSecretsInText(String(sidecarRaw)).slice(0, 12000),
    sidecar_parse_ok: sidecarParseOk === true,
    policy_inventory_facts_count: Number(policyInventoryFactsCount) || 0,
    text_before_finalize: scrubSecretsInText(
      String(textBeforeFinalize ?? ""),
    ).slice(0, 20000),
    text_after_seal: scrubSecretsInText(String(textAfterSeal ?? "")).slice(
      0,
      20000,
    ),
    sealed_matches_claude: sealedMatchesClaude,
    streamed_equals_sealed: streamedEqualsSealed,
    provider_messages_request_count: Number(providerMessagesRequestCount) || 0,
    second_claude_call: false,
  };
}

export function summarizeLedgerBrief(ledgerBrief, env = process.env) {
  if (!ledgerBrief || typeof ledgerBrief !== "object") {
    return { active_distinct_count: null, rows: [] };
  }
  const rows = Array.isArray(ledgerBrief.contracts)
    ? ledgerBrief.contracts
    : Array.isArray(ledgerBrief.rows)
      ? ledgerBrief.rows
      : [];
  return {
    active_distinct_count:
      ledgerBrief.active_distinct_count != null
        ? Number(ledgerBrief.active_distinct_count)
        : null,
    rows: rows.slice(0, 40).map((row) => ({
      id_hash: hashSensitiveId(row?.id ?? row?.policy_id ?? null, env),
      insurer: row?.insurer ?? row?.insurer_name ?? null,
      product_name: row?.product_name ?? null,
      monthly_premium:
        row?.monthly_premium != null && Number.isFinite(Number(row.monthly_premium))
          ? Number(row.monthly_premium)
          : null,
      source_document_id: row?.source_document_id ?? null,
      policy_number: row?.policy_number ?? null,
    })),
  };
}

export function buildLedgerCapture({
  beforeBrief = null,
  afterBrief = null,
  sidecarCandidates = null,
  upsert = null,
  refreshSessionSignal = false,
  env = process.env,
} = {}) {
  const before = summarizeLedgerBrief(beforeBrief, env);
  const after = summarizeLedgerBrief(afterBrief, env);
  const candidates = Array.isArray(sidecarCandidates)
    ? sidecarCandidates
    : Array.isArray(sidecarCandidates?.items)
      ? sidecarCandidates.items
      : [];
  const upsertObj =
    upsert && typeof upsert === "object"
      ? {
          attempted: upsert.attempted === true,
          success_count:
            Number(upsert.stored ?? upsert.success_count ?? 0) || 0,
          fail_count: Number(upsert.fail_count ?? 0) || 0,
          skipped_weak_merge: Number(upsert.skipped_weak_merge ?? 0) || 0,
          error_codes: Array.isArray(upsert.error_codes)
            ? upsert.error_codes
            : upsert.error
              ? [String(upsert.error).slice(0, 120)]
              : [],
          ok: upsert.ok === true,
        }
      : {
          attempted: false,
          success_count: 0,
          fail_count: 0,
          skipped_weak_merge: 0,
          error_codes: [],
          ok: false,
        };
  return {
    before,
    sidecar_candidates: {
      proposed_count: candidates.length,
      items: candidates.slice(0, 40).map((item) => ({
        insurer: item?.insurer ?? item?.insurer_name ?? null,
        product_name: item?.product_name ?? null,
        source_document_id: item?.source_document_id ?? null,
        source_sha256:
          item?.source_content_sha256 ?? item?.source_sha256 ?? null,
        verification_status: item?.verification_status ?? null,
      })),
    },
    upsert: upsertObj,
    after: {
      active_distinct_count: after.active_distinct_count,
      row_count_delta:
        before.active_distinct_count != null && after.active_distinct_count != null
          ? after.active_distinct_count - before.active_distinct_count
          : upsertObj.success_count || null,
      rows: after.rows,
    },
    refresh_session_signal: refreshSessionSignal === true,
  };
}

export function resolveQaTurnTtlHours(env = process.env) {
  const n = Number(env?.KEY_QA_TURN_RECORDER_TTL_HOURS);
  if (!Number.isFinite(n)) return QA_TURN_DEFAULT_TTL_HOURS;
  return Math.min(168, Math.max(24, Math.floor(n)));
}

export function assembleQaTurnTracePayload({
  turnTraceId,
  env = process.env,
  customerId = null,
  sessionId = null,
  model = null,
  route = "api/customer-home-brain-fact",
  systemCapture = null,
  userPayloadCapture = null,
  originalsManifest = null,
  claudeCapture = null,
  ledgerCapture = null,
  recordMeta = null,
  requestTimestamp = null,
} = {}) {
  const identity = resolveDeployIdentity(env) || {};
  const expiresAt = new Date(
    Date.now() + resolveQaTurnTtlHours(env) * 3600 * 1000,
  ).toISOString();
  const payload = {
    schema_version: QA_TURN_TRACE_SCHEMA_VERSION,
    turn_trace_id: turnTraceId,
    request_timestamp: requestTimestamp || new Date().toISOString(),
    preview: {
      vercel_env: String(env?.VERCEL_ENV ?? ""),
      git_commit_sha: identity.git_commit_sha ?? null,
      preview_url_host: (() => {
        const url = String(env?.VERCEL_URL ?? "").trim();
        if (!url) return null;
        try {
          return new URL(url.startsWith("http") ? url : `https://${url}`).hostname;
        } catch {
          return url.slice(0, 120);
        }
      })(),
    },
    route,
    model: model ?? null,
    customer_id_hash: hashSensitiveId(customerId, env),
    session_id_hash: hashSensitiveId(sessionId, env),
    activation: {
      flags: ["KEY_QA_TURN_RECORDER"],
      allowlisted: true,
    },
    system: systemCapture,
    user_payload: userPayloadCapture,
    originals_manifest: originalsManifest,
    claude: claudeCapture,
    ledger: ledgerCapture,
    voice_trace_link: {
      turn_trace_id: turnTraceId,
      compose_mode: "key_claude_first_direct",
    },
    record_meta: {
      write_ok: null,
      write_ms: null,
      error_code: null,
      expires_at: expiresAt,
      ...(recordMeta && typeof recordMeta === "object" ? recordMeta : {}),
    },
  };
  return scrubDeepForQaTrace(payload);
}

export function createServiceRoleAdmin(env = process.env) {
  const url = resolveSupabaseUrl(env);
  const key = resolveServiceRoleKey(env);
  if (!url || !key) return null;
  // Never write to production Supabase project.
  try {
    const host = new URL(url).host.toLowerCase();
    if (host === "fhvlxcguvjvtftttfrix.supabase.co") return null;
  } catch {
    return null;
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export async function insertQaTurnTraceRow({
  admin = null,
  turnTraceId,
  payload,
  env = process.env,
} = {}) {
  if (!admin) {
    return { ok: false, error_code: "storage_fail", error: "service_role_unavailable" };
  }
  const expiresAt =
    payload?.record_meta?.expires_at ||
    new Date(Date.now() + resolveQaTurnTtlHours(env) * 3600 * 1000).toISOString();
  const row = {
    turn_trace_id: turnTraceId,
    schema_version: QA_TURN_TRACE_SCHEMA_VERSION,
    customer_id_hash: payload?.customer_id_hash ?? null,
    session_id_hash: payload?.session_id_hash ?? null,
    vercel_env: String(env?.VERCEL_ENV ?? ""),
    git_commit_sha: payload?.preview?.git_commit_sha ?? null,
    expires_at: expiresAt,
    payload,
  };
  const { error } = await admin.from(QA_TURN_TRACE_TABLE).insert(row);
  if (error) {
    return {
      ok: false,
      error_code: "storage_fail",
      error: String(error.message ?? error).slice(0, 240),
    };
  }
  return { ok: true, error_code: null };
}

/**
 * Bounded completion after seal. Never throws to customer path.
 * Prefer waitUntil when available; always race ≤ timeoutMs.
 */
export async function completeQaTurnTraceWrite({
  writePromise,
  timeoutMs = QA_TURN_WRITE_TIMEOUT_MS,
  waitUntilImpl = null,
} = {}) {
  const safePromise = Promise.resolve(writePromise)
    .then((result) => result ?? { ok: true, error_code: null })
    .catch((err) => ({
      ok: false,
      error_code: "storage_fail",
      error: String(err?.message ?? err).slice(0, 240),
    }));

  if (typeof waitUntilImpl === "function") {
    try {
      waitUntilImpl(safePromise);
    } catch {
      /* local / non-Vercel */
    }
  }

  let timeoutId = null;
  const timeoutPromise = new Promise((resolve) => {
    timeoutId = setTimeout(() => {
      resolve({ ok: false, error_code: "timeout" });
    }, Math.max(1, Number(timeoutMs) || QA_TURN_WRITE_TIMEOUT_MS));
  });

  try {
    const raced = await Promise.race([safePromise, timeoutPromise]);
    return raced;
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

export async function recordQaTurnTrace({
  env = process.env,
  customerId = null,
  sessionId = null,
  presenceTurn = false,
  audience = null,
  keyRoleContract = null,
  model = null,
  systemCapture = null,
  userPayloadCapture = null,
  originalsManifest = null,
  claudeCapture = null,
  ledgerCapture = null,
  turnTraceId = null,
  insertImpl = null,
  waitUntilImpl = null,
  timeoutMs = QA_TURN_WRITE_TIMEOUT_MS,
  admin = null,
} = {}) {
  const started = Date.now();
  const emptyMeta = {
    attempted: false,
    ok: false,
    error_code: "inactive",
    write_ms: 0,
    turn_trace_id: null,
  };

  try {
    if (
      !shouldActivateQaTurnRecorder({
        env,
        customerId,
        presenceTurn,
        audience,
        keyRoleContract,
      })
    ) {
      return emptyMeta;
    }

    const id = turnTraceId || createTurnTraceId();
    const payload = assembleQaTurnTracePayload({
      turnTraceId: id,
      env,
      customerId,
      sessionId,
      model,
      systemCapture,
      userPayloadCapture,
      originalsManifest,
      claudeCapture,
      ledgerCapture,
    });

    const writePromise = (async () => {
      if (typeof insertImpl === "function") {
        return insertImpl({ turnTraceId: id, payload, env });
      }
      const client = admin || createServiceRoleAdmin(env);
      return insertQaTurnTraceRow({
        admin: client,
        turnTraceId: id,
        payload,
        env,
      });
    })();

    const result = await completeQaTurnTraceWrite({
      writePromise,
      timeoutMs,
      waitUntilImpl,
    });

    const write_ms = Math.max(0, Date.now() - started);
    return {
      attempted: true,
      ok: result?.ok === true,
      error_code: result?.ok === true ? null : result?.error_code || "storage_fail",
      write_ms,
      turn_trace_id: id,
      error: result?.error ?? null,
    };
  } catch (err) {
    return {
      attempted: true,
      ok: false,
      error_code: "storage_fail",
      write_ms: Math.max(0, Date.now() - started),
      turn_trace_id: turnTraceId || null,
      error: String(err?.message ?? err).slice(0, 240),
    };
  }
}

export async function purgeQaTurnTraces({
  env = process.env,
  admin = null,
  mode = null,
  traceId = null,
  customerHash = null,
  dryRun = false,
  now = new Date(),
} = {}) {
  if (!flagOn(env?.KEY_QA_TURN_RECORDER_PURGE) && dryRun !== true) {
    return {
      ok: false,
      error: "KEY_QA_TURN_RECORDER_PURGE required (or --dry-run)",
      deleted: 0,
    };
  }
  const client = admin || createServiceRoleAdmin(env);
  if (!client) {
    return { ok: false, error: "service_role_unavailable", deleted: 0 };
  }

  let query = client.from(QA_TURN_TRACE_TABLE).select("turn_trace_id, expires_at, customer_id_hash");
  if (mode === "trace-id") {
    if (!traceId) return { ok: false, error: "trace_id_required", deleted: 0 };
    query = query.eq("turn_trace_id", String(traceId));
  } else if (mode === "customer-hash") {
    if (!customerHash) return { ok: false, error: "customer_hash_required", deleted: 0 };
    query = query.eq("customer_id_hash", String(customerHash));
  } else if (mode === "all-expired") {
    query = query.lt("expires_at", new Date(now).toISOString());
  } else {
    return { ok: false, error: "mode_required", deleted: 0 };
  }

  const { data, error } = await query.limit(5000);
  if (error) {
    return {
      ok: false,
      error: String(error.message ?? error).slice(0, 240),
      deleted: 0,
    };
  }
  const ids = (Array.isArray(data) ? data : [])
    .map((row) => row?.turn_trace_id)
    .filter(Boolean);
  if (dryRun) {
    return {
      ok: true,
      dry_run: true,
      would_delete: ids.length,
      turn_trace_ids: ids.slice(0, 50),
      deleted: 0,
    };
  }
  if (!ids.length) {
    return { ok: true, deleted: 0, dry_run: false };
  }
  const { error: delErr } = await client
    .from(QA_TURN_TRACE_TABLE)
    .delete()
    .in("turn_trace_id", ids);
  if (delErr) {
    return {
      ok: false,
      error: String(delErr.message ?? delErr).slice(0, 240),
      deleted: 0,
    };
  }
  return { ok: true, deleted: ids.length, dry_run: false };
}

/** Mutable capture bag filled by Claude-first hooks. */
export function createQaTurnCaptureBag({ turnTraceId, env = process.env } = {}) {
  return {
    active: true,
    turn_trace_id: turnTraceId || createTurnTraceId(),
    env,
    system: null,
    user_payload: null,
    originals_manifest: null,
    claude: null,
    ledger_before: null,
    ledger_after: null,
    sidecar_candidates: null,
    upsert: null,
    refresh_session_signal: false,
    model: null,
    record: null,
  };
}
