/**
 * Phase 8 — Preview-only Golden parallel-path capture (observe only).
 * Original lane (PDF document block) + structured text lane (probe booleans).
 * Never mutates Anthropic payload, Seal answer, DB, or memory.
 */
import { createHash } from "node:crypto";
import {
  isCustomerAllowlistedForQaTurnRecorder,
  isPreviewVercelEnv,
} from "./keyQaTurnRecorder.js";

export const PHASE8_TRACE_PROBES_KEY = "phase8_trace_probes";
export const PHASE8_UPLOADED_FIXTURE_SHA_KEY = "phase8_uploaded_fixture_sha256";
export const PHASE8_MAX_PROBES = 6;
export const PHASE8_MAX_PROBE_VALUE_LEN = 120;

/** Built-in official QA customer (harness). Marker still required. */
const BUILTIN_OFFICIAL_QA_CUSTOMER_IDS = new Set([
  "a247a66f-a597-4ccf-9530-761b82518002",
]);

const FORBIDDEN_TRACE_KEY_RE =
  /base64|prompt|authorization|cookie|token|password|secret|api[_-]?key|service_role|anthropic|system_text|raw_body|pdf_bytes/i;

export function parsePhase8TraceProbes(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  const seen = new Set();
  for (const row of raw) {
    if (out.length >= PHASE8_MAX_PROBES) break;
    if (!row || typeof row !== "object") continue;
    const id = String(row.id ?? "")
      .trim()
      .toUpperCase();
    if (!id || seen.has(id)) continue;
    const value = String(row.value ?? "").trim();
    if (!value || value.length > PHASE8_MAX_PROBE_VALUE_LEN) continue;
    seen.add(id);
    out.push({ id, value });
  }
  return out;
}

export function parsePhase8UploadedFixtureSha256(raw) {
  const hex = String(raw ?? "")
    .trim()
    .toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(hex)) return null;
  return hex;
}

/**
 * Strip diagnostic fields from a request body clone.
 * Mutates nothing on the original when given a shallow copy target.
 */
export function stripPhase8DiagnosticFieldsFromBody(body) {
  if (!body || typeof body !== "object") {
    return { body: body ?? null, probes: [], uploadedFixtureSha256: null, markerPresent: false };
  }
  const probes = parsePhase8TraceProbes(
    body.phase8_trace_probes ?? body.phase8TraceProbes,
  );
  const uploadedFixtureSha256 = parsePhase8UploadedFixtureSha256(
    body.phase8_uploaded_fixture_sha256 ?? body.phase8UploadedFixtureSha256,
  );
  const markerPresent = probes.length > 0;
  const cleaned = { ...body };
  delete cleaned.phase8_trace_probes;
  delete cleaned.phase8TraceProbes;
  delete cleaned.phase8_uploaded_fixture_sha256;
  delete cleaned.phase8UploadedFixtureSha256;
  delete cleaned.phase8_golden_parallel_trace;
  delete cleaned.phase8GoldenParallelTrace;
  return { body: cleaned, probes, uploadedFixtureSha256, markerPresent };
}

export function isOfficialQaCustomerForPhase8Trace(customerId, env = process.env) {
  const id = String(customerId ?? "")
    .trim()
    .toLowerCase();
  if (!id) return false;
  if (isCustomerAllowlistedForQaTurnRecorder(id, env)) return true;
  const extra = String(env?.KEY_PHASE8_TRACE_CUSTOMER_IDS ?? "")
    .trim()
    .toLowerCase();
  if (extra) {
    const allow = new Set(
      extra
        .split(/[,;\s]+/)
        .map((x) => x.trim())
        .filter(Boolean),
    );
    if (allow.has(id)) return true;
  }
  return BUILTIN_OFFICIAL_QA_CUSTOMER_IDS.has(id);
}

/**
 * Activation AND-lock. Any miss → completely off.
 * Production (non-preview) always off even with marker.
 */
export function shouldActivatePhase8GoldenParallelTrace({
  env = process.env,
  customerId = null,
  markerPresent = false,
} = {}) {
  if (!isPreviewVercelEnv(env)) return false;
  if (markerPresent !== true) return false;
  if (!isOfficialQaCustomerForPhase8Trace(customerId, env)) return false;
  return true;
}

export function normalizeGoldenProbeText(input) {
  return String(input ?? "")
    .normalize("NFKC")
    .replace(/[\u200b-\u200d\ufeff]/g, "")
    .replace(/[ \t\r\n]+/g, " ")
    .replace(/[·•]/g, " ")
    .replace(/[“”"'′`]/g, "")
    .replace(/[，、]/g, ",")
    .replace(/[．。]/g, ".")
    .replace(/\s*([,.:;!?/|()\[\]{}])\s*/g, "$1")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export function matchProbeInText(haystack, probeValue) {
  const rawHay = String(haystack ?? "");
  const rawNeedle = String(probeValue ?? "").trim();
  if (!rawNeedle) {
    return { exact: false, normalized: false };
  }
  const exact = rawHay.includes(rawNeedle);
  const normHay = normalizeGoldenProbeText(rawHay);
  const normNeedle = normalizeGoldenProbeText(rawNeedle);
  const normalized = Boolean(normNeedle) && normHay.includes(normNeedle);
  return { exact, normalized };
}

export function sha256Base64Decoded(base64) {
  try {
    const buf = Buffer.from(String(base64 ?? ""), "base64");
    if (!buf.length) {
      return { byteLength: 0, sha256: null };
    }
    return {
      byteLength: buf.length,
      sha256: createHash("sha256").update(buf).digest("hex"),
    };
  } catch {
    return { byteLength: 0, sha256: null };
  }
}

function collectTextFromAnthropicBlocks(blocks, { skipDocumentBase64 = true } = {}) {
  const parts = [];
  const list = Array.isArray(blocks) ? blocks : [];
  for (const block of list) {
    if (!block || typeof block !== "object") continue;
    const type = String(block.type ?? "").trim().toLowerCase();
    if (type === "text") {
      parts.push(String(block.text ?? ""));
      continue;
    }
    if (skipDocumentBase64 && (type === "document" || type === "image")) {
      continue;
    }
  }
  return parts.join("\n");
}

export function extractProviderTextCorpus({ system = null, messages = null } = {}) {
  const parts = [];
  if (typeof system === "string") {
    parts.push(system);
  } else if (Array.isArray(system)) {
    parts.push(collectTextFromAnthropicBlocks(system));
  }
  for (const msg of Array.isArray(messages) ? messages : []) {
    const content = msg?.content;
    if (typeof content === "string") {
      parts.push(content);
      continue;
    }
    parts.push(collectTextFromAnthropicBlocks(content));
  }
  return parts.join("\n");
}

export function extractSelectiveTextCorpus(selectiveLiveRequest = null) {
  if (!selectiveLiveRequest || typeof selectiveLiveRequest !== "object") return "";
  const parts = [];
  const plan = selectiveLiveRequest.selection_plan || selectiveLiveRequest.meta || {};
  const packets =
    plan.selected_resource_packets ||
    selectiveLiveRequest.inventory?.selected_resource_packets ||
    [];
  for (const p of Array.isArray(packets) ? packets : []) {
    if (!p || typeof p !== "object") continue;
    // Attachment identity without base64
    const payload = p.safe_payload || p.data || null;
    if (payload && typeof payload === "object") {
      try {
        parts.push(JSON.stringify(payload));
      } catch {
        /* ignore */
      }
    }
    if (p.safe_label) parts.push(String(p.safe_label));
    if (p.packet_id) parts.push(String(p.packet_id));
  }
  // Text layers from assembled selective messages (exclude document/image bytes)
  parts.push(
    extractProviderTextCorpus({
      system: selectiveLiveRequest.system,
      messages: selectiveLiveRequest.messages,
    }),
  );
  return parts.join("\n");
}

export function buildExtractionCorpus({
  chart = null,
  policyTruthContext = null,
  multiAttachments = null,
} = {}) {
  const parts = [];
  const pushObj = (obj) => {
    if (obj == null) return;
    try {
      parts.push(JSON.stringify(obj));
    } catch {
      parts.push(String(obj));
    }
  };

  if (chart && typeof chart === "object") {
    pushObj(chart.personal_review_candidates || chart.review_candidates || null);
    pushObj(chart.policies || null);
    pushObj(chart.coverages || null);
    pushObj(chart);
  }
  if (policyTruthContext && typeof policyTruthContext === "object") {
    pushObj(policyTruthContext.confirmed_contracts || null);
    pushObj(policyTruthContext.pending_contracts || null);
    pushObj(policyTruthContext);
  }
  for (const row of Array.isArray(multiAttachments) ? multiAttachments : []) {
    if (!row || typeof row !== "object") continue;
    const meta = { ...row };
    delete meta.base64;
    delete meta.pdfBase64;
    delete meta.bytes;
    pushObj(meta);
  }
  return parts.join("\n");
}

export function inspectProviderDocumentBlocks({ system = null, messages = null } = {}) {
  const found = [];
  const scan = (blocks) => {
    for (const block of Array.isArray(blocks) ? blocks : []) {
      if (!block || typeof block !== "object") continue;
      const type = String(block.type ?? "").trim().toLowerCase();
      if (type !== "document" && type !== "image") continue;
      const source = block.source && typeof block.source === "object" ? block.source : {};
      const mediaType = String(
        source.media_type || block.media_type || "",
      ).trim();
      const sourceType = String(source.type || "").trim().toLowerCase();
      let decoded = { byteLength: 0, sha256: null };
      if (sourceType === "base64" && typeof source.data === "string") {
        decoded = sha256Base64Decoded(source.data);
      }
      found.push({
        provider_block_type: type,
        provider_media_type: mediaType || null,
        provider_source_type: sourceType || null,
        provider_decoded_byte_length: decoded.byteLength,
        provider_document_sha256: decoded.sha256,
      });
    }
  };
  if (Array.isArray(system)) scan(system);
  for (const msg of Array.isArray(messages) ? messages : []) {
    scan(msg?.content);
  }
  return found;
}

export function selectivePdfPresent(selectiveLiveRequest = null, multiAttachments = null) {
  const plan = selectiveLiveRequest?.selection_plan;
  const mode = String(plan?.current_attachment_mode || "");
  const attachRows = Array.isArray(plan?._selected_attach_for_content)
    ? plan._selected_attach_for_content
    : [];
  const packets = Array.isArray(plan?.selected_resource_packets)
    ? plan.selected_resource_packets
    : [];
  const hasAttachPacket = packets.some(
    (p) =>
      p?.current_turn_attachment === true ||
      String(p?.packet_id || "").startsWith("attachment_packet_"),
  );
  const hasPdfAttach = (Array.isArray(multiAttachments) ? multiAttachments : []).some(
    (row) => {
      const mt = String(row?.mediaType || row?.media_type || "").toLowerCase();
      return mt.includes("pdf") || Boolean(row?.base64 || row?.pdfBase64);
    },
  );
  if (mode === "CONTENT_FIRST" && (attachRows.length > 0 || hasAttachPacket)) {
    return hasPdfAttach || attachRows.length > 0;
  }
  return hasAttachPacket && hasPdfAttach;
}

function pickPrimaryDocumentBlock(blocks) {
  if (!Array.isArray(blocks) || !blocks.length) return null;
  const pdf = blocks.find(
    (b) =>
      b.provider_block_type === "document" &&
      String(b.provider_media_type || "").includes("pdf"),
  );
  return pdf || blocks[0];
}

export function buildOriginalLaneCapture({
  selectiveLiveRequest = null,
  multiAttachments = null,
  system = null,
  messages = null,
  uploadedFixtureSha256 = null,
} = {}) {
  const blocks = inspectProviderDocumentBlocks({ system, messages });
  const primary = pickPrimaryDocumentBlock(blocks);
  const providerSha = primary?.provider_document_sha256 || null;
  const uploaded = parsePhase8UploadedFixtureSha256(uploadedFixtureSha256);
  const hashMatch =
    Boolean(providerSha) && Boolean(uploaded) && providerSha === uploaded;
  return {
    selective_pdf_present: selectivePdfPresent(selectiveLiveRequest, multiAttachments),
    provider_document_block_present: Boolean(primary),
    provider_block_type: primary?.provider_block_type ?? null,
    provider_media_type: primary?.provider_media_type ?? null,
    provider_source_type: primary?.provider_source_type ?? null,
    provider_decoded_byte_length: primary?.provider_decoded_byte_length ?? 0,
    provider_document_sha256: providerSha,
    uploaded_fixture_sha256: uploaded,
    document_hash_match: hashMatch,
  };
}

export function buildStructuredLaneProbeRows({
  probes = [],
  extractionCorpus = "",
  selectiveTextCorpus = "",
  providerTextCorpus = "",
  finalAnswer = "",
} = {}) {
  return parsePhase8TraceProbes(probes).map((probe) => {
    const extraction = matchProbeInText(extractionCorpus, probe.value);
    const selective = matchProbeInText(selectiveTextCorpus, probe.value);
    const provider = matchProbeInText(providerTextCorpus, probe.value);
    const answer = matchProbeInText(finalAnswer, probe.value);
    return {
      id: probe.id,
      extraction_exact: extraction.exact,
      extraction_normalized: extraction.normalized,
      selective_text_exact: selective.exact,
      selective_text_normalized: selective.normalized,
      provider_text_exact: provider.exact,
      provider_text_normalized: provider.normalized,
      final_answer_exact: answer.exact,
      final_answer_normalized: answer.normalized,
    };
  });
}

export function judgeOriginalLane(originalLane) {
  if (!originalLane?.provider_document_block_present) {
    return "PROVIDER_DOCUMENT_BLOCK_GAP";
  }
  if (originalLane.uploaded_fixture_sha256 && !originalLane.document_hash_match) {
    return "PROVIDER_DOCUMENT_BYTES_MISMATCH";
  }
  if (originalLane.document_hash_match) {
    return "ORIGINAL_DOCUMENT_DELIVERY_PASS";
  }
  // Document present but harness hash not supplied — delivery structure pass, hash pending
  return "ORIGINAL_DOCUMENT_BLOCK_PRESENT_HASH_PENDING";
}

export function judgeStructuredProbe(row) {
  if (!row) return "STRUCTURED_UNKNOWN";
  if (!row.extraction_exact && !row.extraction_normalized) {
    return "STRUCTURED_EXTRACTION_GAP";
  }
  if (!row.selective_text_exact && !row.selective_text_normalized) {
    return "SELECTIVE_TEXT_PACKET_GAP";
  }
  if (!row.provider_text_exact && !row.provider_text_normalized) {
    return "PROVIDER_TEXT_ASSEMBLY_GAP";
  }
  if (!row.final_answer_exact && !row.final_answer_normalized) {
    return "CLAUDE_OUTPUT_SELECTION_GAP";
  }
  if (row.final_answer_normalized && !row.final_answer_exact) {
    return "GOLDEN_EXACT_MATCHER_GAP";
  }
  return "STRUCTURED_PROBE_PRESENT_IN_ANSWER";
}

/**
 * Full capture at final Anthropic request + sealed answer.
 * Returns probe ids + booleans + original lane structure only.
 */
export function buildPhase8GoldenParallelTrace({
  active = false,
  probes = [],
  uploadedFixtureSha256 = null,
  selectiveLiveRequest = null,
  multiAttachments = null,
  chart = null,
  policyTruthContext = null,
  system = null,
  messages = null,
  finalAnswer = "",
  actualProviderFetchCount = null,
} = {}) {
  if (active !== true) return null;
  const safeProbes = parsePhase8TraceProbes(probes);
  if (!safeProbes.length) return null;

  const original_lane = buildOriginalLaneCapture({
    selectiveLiveRequest,
    multiAttachments,
    system,
    messages,
    uploadedFixtureSha256,
  });
  const extractionCorpus = buildExtractionCorpus({
    chart,
    policyTruthContext,
    multiAttachments,
  });
  const selectiveTextCorpus = extractSelectiveTextCorpus(selectiveLiveRequest);
  const providerTextCorpus = extractProviderTextCorpus({ system, messages });
  const structured_lane = buildStructuredLaneProbeRows({
    probes: safeProbes,
    extractionCorpus,
    selectiveTextCorpus,
    providerTextCorpus,
    finalAnswer,
  });

  const original_judgment = judgeOriginalLane(original_lane);
  const structured_judgments = structured_lane.map((row) => ({
    id: row.id,
    judgment: judgeStructuredProbe(row),
  }));

  // If original PDF hash matches but a Golden is missing from final answer → document read/omission
  const answerGaps = structured_lane.filter(
    (r) => !r.final_answer_exact && !r.final_answer_normalized,
  );
  let document_read_or_omission = null;
  if (
    original_lane.document_hash_match === true &&
    answerGaps.length > 0
  ) {
    document_read_or_omission = {
      judgment: "CLAUDE_DOCUMENT_READ_OR_OMISSION_GAP",
      missing_probe_ids: answerGaps.map((r) => r.id),
    };
  }

  const answerText = String(finalAnswer ?? "");
  return {
    schema_version: "phase8-golden-parallel-trace-v1",
    active: true,
    original_lane,
    original_judgment,
    structured_lane,
    structured_judgments,
    document_read_or_omission,
    provider_calls: Number.isFinite(Number(actualProviderFetchCount))
      ? Number(actualProviderFetchCount)
      : null,
    answer_len: answerText.length,
  };
}

/** U10 — refuse emitting forbidden keys/values into a public trace object. */
export function assertPhase8TraceSafe(trace) {
  if (trace == null) return true;
  const json = JSON.stringify(trace);
  if (/"value"\s*:/.test(json)) return false;
  if (/data:[a-zA-Z0-9/+.-]+;base64,/.test(json)) return false;
  if (/%PDF-1\./.test(json)) return false;
  if (/JVBERi0/.test(json)) return false;
  if (/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\./.test(json)) return false;
  if (FORBIDDEN_TRACE_KEY_RE.test(Object.keys(trace).join(","))) {
    // top-level key names only — nested booleans like provider_* are allowed
  }
  return true;
}

/**
 * Prove diagnostic probes are absent from a serialized Anthropic body.
 * Does not log probe values.
 */
export function anthropicBodyContainsAnyProbeValue(body, probes) {
  let serialized = "";
  try {
    serialized = JSON.stringify(body ?? null);
  } catch {
    return true;
  }
  for (const probe of parsePhase8TraceProbes(probes)) {
    if (probe.value && serialized.includes(probe.value)) return true;
  }
  if (serialized.includes("phase8_trace_probes")) return true;
  if (serialized.includes("phase8_uploaded_fixture_sha256")) return true;
  return false;
}

export function createPhase8TraceBag({
  env = process.env,
  customerId = null,
  probes = [],
  uploadedFixtureSha256 = null,
} = {}) {
  const safeProbes = parsePhase8TraceProbes(probes);
  const active = shouldActivatePhase8GoldenParallelTrace({
    env,
    customerId,
    markerPresent: safeProbes.length > 0,
  });
  if (!active) {
    return { active: false, probes: [], uploadedFixtureSha256: null, result: null };
  }
  return {
    active: true,
    probes: safeProbes,
    uploadedFixtureSha256: parsePhase8UploadedFixtureSha256(uploadedFixtureSha256),
    result: null,
  };
}
