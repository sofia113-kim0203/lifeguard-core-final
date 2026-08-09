/**
 * KEY relevant durable-memory packet for Claude delivery.
 * Pure selection/packaging — no Claude calls, no keyword classifier, no factory speech.
 */

import { buildKeyLatestDocumentContext } from "./keyDocumentMemoryCommit.js";

export const KEY_RELEVANT_MEMORY_PACKET_SCHEMA = "key_relevant_memory_packet_v1";

const EXCLUDED_BLOCK_NAMES = Object.freeze([
  "full_policy_ledger",
  "full_review_candidates",
  "full_verified_document_coverages",
  "full_customer_chart",
  "full_ready_card_body",
  "full_login_handoff_body",
  "full_conversation_history",
  "prior_assistant_answers_full",
  "prior_original_images_pdfs",
  "unrelated_factory_dumps",
]);

function asTrimmed(v) {
  return v == null ? "" : String(v).trim();
}

function maskPolicyNumber(pn) {
  const s = asTrimmed(pn);
  if (!s) return null;
  if (s.length <= 4) return "*".repeat(s.length);
  return `${s.slice(0, 2)}${"*".repeat(Math.min(8, s.length - 4))}${s.slice(-2)}`;
}

function contractBrief(c = {}) {
  return {
    insurer_name: c.insurer_name ?? c.normalized_insurer_name ?? null,
    product_name: c.product_name ?? null,
    policy_number_masked: maskPolicyNumber(c.policy_number),
    policy_number_quality: c.policy_number_quality ?? null,
    contract_identity_key: c.contract_identity_key ?? null,
    source_document_id: c.source_document_id ?? null,
  };
}

function normalizeToken(raw = "") {
  return asTrimmed(raw)
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/주식회사|㈜|\(주\)/g, "");
}

function contractIdentityLoose(c = {}) {
  const key = asTrimmed(c.contract_identity_key);
  if (key) return key;
  const insurer = normalizeToken(c.insurer_name ?? c.normalized_insurer_name ?? "");
  const pn = asTrimmed(c.policy_number).replace(/[\s-]/g, "").toLowerCase();
  if (insurer && pn && !/[x*]{2,}/i.test(pn)) return `ins:${insurer}|pn:${pn}`;
  const product = normalizeToken(c.product_name ?? "");
  const doc = asTrimmed(c.source_document_id);
  if (insurer && product) return `ins:${insurer}|prod:${product}|doc:${doc || "?"}`;
  if (doc) return `doc:${doc}`;
  return null;
}

function contractsFromMemoryRow(row) {
  if (!row || typeof row !== "object") return [];
  return Array.isArray(row.contracts) ? row.contracts.filter((c) => c && typeof c === "object") : [];
}

function contractsFromChart(chart) {
  if (!chart || typeof chart !== "object") return [];
  const pools = [
    chart.confirmed_contracts,
    chart.contracts,
    chart.personal_confirmed_contracts,
    chart.review_candidates,
    chart.personal_review_candidates,
  ];
  const out = [];
  const seen = new Set();
  for (const pool of pools) {
    if (!Array.isArray(pool)) continue;
    for (const c of pool) {
      if (!c || typeof c !== "object") continue;
      const id = contractIdentityLoose(c) || `row:${out.length}`;
      if (seen.has(id)) continue;
      seen.add(id);
      out.push(c);
    }
  }
  return out;
}

function coveragesForContract(chart, contract) {
  const rows = Array.isArray(chart?.verified_document_coverages)
    ? chart.verified_document_coverages
    : [];
  if (!rows.length || !contract) return [];
  const docId = asTrimmed(contract.source_document_id);
  const key = contractIdentityLoose(contract);
  const insurer = normalizeToken(contract.insurer_name ?? contract.normalized_insurer_name ?? "");
  const pn = asTrimmed(contract.policy_number).replace(/[\s-]/g, "").toLowerCase();
  return rows.filter((row) => {
    if (!row || typeof row !== "object") return false;
    const rDoc = asTrimmed(row.source_document_id ?? row.document_id);
    if (docId && rDoc && rDoc === docId) return true;
    const rKey = asTrimmed(row.contract_identity_key);
    if (key && rKey && rKey === key) return true;
    const rIns = normalizeToken(row.insurer_name ?? "");
    const rPn = asTrimmed(row.policy_number).replace(/[\s-]/g, "").toLowerCase();
    if (insurer && pn && rIns === insurer && rPn && rPn === pn) return true;
    return false;
  });
}

function extractStrongIdentityHints(question = "") {
  const q = String(question ?? "");
  const hints = [];
  // Exact-looking policy numbers (digits/hyphen groups) — identity match, not topic classifier.
  for (const m of q.matchAll(/(?<![0-9])(\d{6,}[\d-]{0,20})(?![0-9])/g)) {
    const pn = asTrimmed(m[1]).replace(/[\s-]/g, "");
    if (pn.length >= 6) hints.push({ kind: "policy_number", value: pn.toLowerCase() });
  }
  return hints;
}

function historyFocusContract(history = [], candidates = []) {
  if (!candidates.length) return null;
  const turns = Array.isArray(history) ? history.slice(-8) : [];
  const text = turns
    .map((t) => `${t?.role ?? ""}:${t?.content ?? t?.text ?? ""}`)
    .join("\n")
    .toLowerCase();
  if (!text) return null;
  const scored = [];
  for (const c of candidates) {
    const insurer = asTrimmed(c.insurer_name ?? c.normalized_insurer_name).toLowerCase();
    const product = asTrimmed(c.product_name).toLowerCase();
    let score = 0;
    if (insurer && text.includes(insurer)) score += 2;
    if (product && product.length >= 2 && text.includes(product)) score += 2;
    const pn = asTrimmed(c.policy_number).replace(/[\s-]/g, "").toLowerCase();
    if (pn.length >= 4 && text.includes(pn.slice(-4))) score += 3;
    if (score > 0) scored.push({ c, score });
  }
  if (!scored.length) return null;
  scored.sort((a, b) => b.score - a.score);
  if (scored.length >= 2 && scored[0].score === scored[1].score) return null;
  return scored[0].c;
}

/**
 * Resolve current contract focus from structural evidence (no AI / no keyword classifier).
 */
export function resolveFocusedContracts({
  question = "",
  history = [],
  memoryRow = null,
  chart = null,
  selectedContractId = null,
  selectedDocumentId = null,
  screenOpenContractId = null,
  allowMulti = false,
} = {}) {
  const memoryContracts = contractsFromMemoryRow(memoryRow);
  const chartContracts = contractsFromChart(chart);
  const pool = [];
  const seen = new Set();
  for (const c of [...memoryContracts, ...chartContracts]) {
    const id = contractIdentityLoose(c) || JSON.stringify(contractBrief(c));
    if (seen.has(id)) continue;
    seen.add(id);
    pool.push(c);
  }

  const selectedId = asTrimmed(selectedContractId);
  const screenId = asTrimmed(screenOpenContractId);
  const selectedDoc = asTrimmed(selectedDocumentId);
  const hints = extractStrongIdentityHints(question);

  let source = null;
  let focused = [];

  if (selectedId) {
    const hit = pool.find(
      (c) =>
        asTrimmed(c.id) === selectedId ||
        asTrimmed(c.contract_id) === selectedId ||
        contractIdentityLoose(c) === selectedId,
    );
    if (hit) {
      focused = [hit];
      source = "explicit_selected_contract";
    }
  }

  if (!focused.length && screenId) {
    const hit = pool.find(
      (c) =>
        asTrimmed(c.id) === screenId ||
        asTrimmed(c.contract_id) === screenId ||
        contractIdentityLoose(c) === screenId,
    );
    if (hit) {
      focused = [hit];
      source = "screen_open_contract";
    }
  }

  if (!focused.length && selectedDoc) {
    const hits = pool.filter((c) => asTrimmed(c.source_document_id) === selectedDoc);
    if (hits.length === 1) {
      focused = hits;
      source = "explicit_selected_document";
    } else if (hits.length > 1 && memoryContracts.length) {
      const memHits = hits.filter((c) =>
        memoryContracts.some((m) => contractIdentityLoose(m) === contractIdentityLoose(c)),
      );
      if (memHits.length === 1) {
        focused = memHits;
        source = "explicit_selected_document";
      }
    }
  }

  if (!focused.length && hints.length) {
    const hits = pool.filter((c) => {
      const pn = asTrimmed(c.policy_number).replace(/[\s-]/g, "").toLowerCase();
      return hints.some((h) => h.kind === "policy_number" && pn && pn.includes(h.value));
    });
    if (hits.length === 1) {
      focused = hits;
      source = "strong_contract_identity";
    } else if (hits.length > 1) {
      return {
        status: "ambiguous",
        source: "strong_contract_identity_conflict",
        focused: [],
        candidates: hits.map(contractBrief),
      };
    }
  }

  if (!focused.length) {
    const hist = historyFocusContract(history, pool);
    if (hist) {
      focused = [hist];
      source = "recent_dialogue_focus";
    }
  }

  if (!focused.length && memoryContracts.length === 1) {
    focused = [memoryContracts[0]];
    source = "latest_document_focus";
  }

  if (!focused.length && memoryContracts.length > 1) {
    // Same focus lineage: if all memory contracts share one insurer+doc primary, pick primary doc contract.
    const primaryDoc = asTrimmed(memoryRow?.primary_document_id);
    const primaryHits = primaryDoc
      ? memoryContracts.filter((c) => asTrimmed(c.source_document_id) === primaryDoc)
      : [];
    if (primaryHits.length === 1) {
      focused = primaryHits;
      source = "document_focus_lineage";
    } else if (allowMulti && memoryContracts.length <= 4) {
      focused = memoryContracts.slice();
      source = "multi_related_from_memory";
    } else {
      return {
        status: "ambiguous",
        source: "memory_contracts_conflict",
        focused: [],
        candidates: memoryContracts.map(contractBrief),
      };
    }
  }

  if (!focused.length && chartContracts.length === 1) {
    focused = [chartContracts[0]];
    source = "single_chart_contract";
  }

  if (!focused.length) {
    return {
      status: pool.length ? "ambiguous" : "none",
      source: pool.length ? "insufficient_focus_evidence" : "no_contracts",
      focused: [],
      candidates: pool.slice(0, 8).map(contractBrief),
    };
  }

  if (allowMulti && focused.length > 1) {
    return { status: "resolved", source, focused, candidates: [] };
  }

  return {
    status: "resolved",
    source,
    focused: focused.slice(0, 1),
    candidates: [],
  };
}

export function buildRecentDialoguePair(history = []) {
  const turns = Array.isArray(history) ? history : [];
  let lastUser = null;
  let lastAssistant = null;
  for (let i = turns.length - 1; i >= 0; i -= 1) {
    const role = asTrimmed(turns[i]?.role).toLowerCase();
    const content = asTrimmed(turns[i]?.content ?? turns[i]?.text);
    if (!content) continue;
    if (!lastAssistant && (role === "assistant" || role === "key")) {
      lastAssistant = { role: "assistant", content: content.slice(0, 1200) };
    } else if (!lastUser && (role === "user" || role === "customer")) {
      lastUser = { role: "user", content: content.slice(0, 800) };
    }
    if (lastUser && lastAssistant) break;
  }
  return [lastUser, lastAssistant].filter(Boolean);
}

function confirmedFactsFromContracts(contracts = []) {
  const facts = [];
  const seen = new Set();
  for (const c of contracts) {
    for (const ref of Array.isArray(c?.fact_refs) ? c.fact_refs : []) {
      if (!ref || typeof ref !== "object") continue;
      const key = [
        ref.fact_type,
        ref.literal,
        ref.source_document_id,
        ref.source_page,
      ].join("|");
      if (seen.has(key)) continue;
      seen.add(key);
      facts.push({
        fact_type: ref.fact_type ?? null,
        literal: ref.literal ?? null,
        source_document_id: ref.source_document_id ?? null,
        source_page: ref.source_page ?? null,
        verification_status: ref.verification_status ?? "key_confirmed_from_original",
        contract_identity_key: contractIdentityLoose(c),
      });
    }
  }
  return facts;
}

function dedupeFactoryFacts(keyConfirmed = [], officialFacts = []) {
  const out = [];
  const seen = new Set();
  for (const f of [...officialFacts, ...(Array.isArray(keyConfirmed) ? keyConfirmed : [])]) {
    if (!f || typeof f !== "object") continue;
    const key = [
      asTrimmed(f.fact_type).toLowerCase(),
      asTrimmed(f.literal ?? f.literal_value),
      asTrimmed(f.source_document_id),
    ].join("|");
    if (!key.replace(/\|/g, "") || seen.has(key)) continue;
    seen.add(key);
    out.push({
      fact_type: f.fact_type ?? null,
      literal: f.literal ?? f.literal_value ?? null,
      source_document_id: f.source_document_id ?? null,
      verification_status: f.verification_status ?? "key_confirmed",
    });
  }
  return { facts: out, factory_facts_deduplicated: true };
}

export function buildFocusedChartProjection({
  chart = null,
  focusedContracts = [],
  ambiguousCandidates = [],
} = {}) {
  if (!focusedContracts.length) {
    return {
      schema: "focused_verified_chart_v1",
      subject: "personal",
      subject_type: "individual",
      focus_status: "ambiguous_or_none",
      confirmed_contracts: [],
      review_candidates: [],
      verified_document_coverages: [],
      contract_candidates_brief: (ambiguousCandidates || []).slice(0, 8),
      note:
        "No full ledger/chart. Short candidate list only — ask which contract if needed in one answer.",
    };
  }
  const coverages = [];
  for (const c of focusedContracts) {
    coverages.push(...coveragesForContract(chart, c));
  }
  return {
    schema: "focused_verified_chart_v1",
    subject: "personal",
    subject_type: "individual",
    focus_status: "resolved",
    confirmed_contracts: focusedContracts.map((c) => ({
      insurer_name: c.insurer_name ?? null,
      product_name: c.product_name ?? null,
      policy_number: c.policy_number ?? null,
      policy_number_quality: c.policy_number_quality ?? null,
      monthly_premium: c.monthly_premium ?? c.premium ?? null,
      policyholder: c.policyholder ?? null,
      insured: c.insured ?? null,
      contract_identity_key: contractIdentityLoose(c),
      source_document_id: c.source_document_id ?? null,
      status: c.status ?? "active",
    })),
    review_candidates: [],
    verified_document_coverages: coverages.slice(0, 80),
    note: "Focused KEY chart slice only — full ledger/review dumps excluded.",
  };
}

export function estimateCharsAndTokens(value) {
  let chars = 0;
  try {
    chars = JSON.stringify(value ?? null).length;
  } catch {
    chars = String(value ?? "").length;
  }
  return {
    chars,
    estimated_input_tokens: Math.ceil(chars / 4),
  };
}

/**
 * Build KEY→Claude relevant memory packet (PII bodies stay in structured fields for Claude;
 * trace helpers expose sizes only).
 */
export function buildKeyRelevantMemoryPacket({
  question = "",
  history = [],
  memoryRow = null,
  memoryLoad = null,
  chart = null,
  keyConfirmedSourceFacts = null,
  selectedContractId = null,
  selectedDocumentId = null,
  screenOpenContractId = null,
  originalAttachmentCount = 0,
  crossSessionRecall = false,
  customerConfirmedFacts = null,
  allowMultiContracts = false,
} = {}) {
  const included = [];
  const excluded = [...EXCLUDED_BLOCK_NAMES];
  const block_chars = {};

  const focus = resolveFocusedContracts({
    question,
    history,
    memoryRow,
    chart,
    selectedContractId,
    selectedDocumentId,
    screenOpenContractId,
    allowMulti: allowMultiContracts === true,
  });

  const officialContext = memoryRow ? buildKeyLatestDocumentContext(memoryRow) : null;
  const focusedContracts = focus.status === "resolved" ? focus.focused : [];
  const recent = buildRecentDialoguePair(history);
  const officialFacts = confirmedFactsFromContracts(
    focusedContracts.length ? focusedContracts : contractsFromMemoryRow(memoryRow),
  );
  const { facts: adoptedFacts, factory_facts_deduplicated } = dedupeFactoryFacts(
    keyConfirmedSourceFacts,
    officialFacts,
  );
  // Keep only facts tied to focused contracts when resolved.
  const focusedKeys = new Set(focusedContracts.map((c) => contractIdentityLoose(c)).filter(Boolean));
  const focusedDocIds = new Set(
    focusedContracts.map((c) => asTrimmed(c.source_document_id)).filter(Boolean),
  );
  const factsForPacket =
    focusedContracts.length === 0
      ? adoptedFacts.slice(0, 40)
      : adoptedFacts
          .filter((f) => {
            if (!focusedKeys.size && !focusedDocIds.size) return true;
            if (
              f.contract_identity_key &&
              focusedKeys.has(f.contract_identity_key)
            ) {
              return true;
            }
            if (
              f.source_document_id &&
              focusedDocIds.has(asTrimmed(f.source_document_id))
            ) {
              return true;
            }
            return officialFacts.some(
              (o) =>
                asTrimmed(o.fact_type) === asTrimmed(f.fact_type) &&
                asTrimmed(o.literal) === asTrimmed(f.literal),
            );
          })
          .slice(0, 60);

  const focusedChart = buildFocusedChartProjection({
    chart,
    focusedContracts,
    ambiguousCandidates: focus.candidates,
  });

  const unconfirmed = {
    read_status: officialContext?.read_status ?? null,
    rejected_fact_count: Number(memoryRow?.rejected_fact_count) || 0,
    partial:
      officialContext &&
      !["confirmed_facts"].includes(String(officialContext.read_status ?? "")),
    note: officialContext?.read_status
      ? `Official document memory read_status=${officialContext.read_status}`
      : "No official document memory on this turn",
  };

  const customerFacts = Array.isArray(customerConfirmedFacts)
    ? customerConfirmedFacts.slice(0, 12)
    : [];

  const packetBody = {
    schema_version: KEY_RELEVANT_MEMORY_PACKET_SCHEMA,
    current_question: String(question ?? ""),
    focus_resolution: {
      status: focus.status,
      source: focus.source,
      focused_contract_count: focusedContracts.length,
      candidates: focus.status === "ambiguous" ? focus.candidates : [],
    },
    focused_contracts: focusedContracts.map((c) => ({
      ...contractBrief(c),
      policy_number: c.policy_number ?? null,
      monthly_premium: c.monthly_premium ?? c.premium ?? null,
      policyholder: c.policyholder ?? null,
      insured: c.insured ?? null,
      fact_refs: Array.isArray(c.fact_refs) ? c.fact_refs.slice(0, 40) : [],
    })),
    official_document_memory: officialContext
      ? {
          memory_commit_id: officialContext.memory_commit_id,
          memory_version: officialContext.memory_version,
          read_status: officialContext.read_status,
          focus_status: officialContext.focus_status,
          document_ids: officialContext.document_ids,
          primary_document_id: officialContext.primary_document_id,
          confirmation_source: officialContext.confirmation_source,
          rejected_fact_count: officialContext.rejected_fact_count,
          originals_reattached: false,
        }
      : null,
    confirmed_facts: factsForPacket,
    unconfirmed,
    customer_confirmed_facts: customerFacts,
    recent_dialogue: recent,
    focused_chart: focusedChart,
  };

  included.push("current_question");
  block_chars.current_question = estimateCharsAndTokens(packetBody.current_question).chars;
  included.push("focused_contracts");
  block_chars.focused_contracts = estimateCharsAndTokens(packetBody.focused_contracts).chars;
  if (officialContext) {
    included.push("official_document_memory");
    block_chars.official_document_memory = estimateCharsAndTokens(
      packetBody.official_document_memory,
    ).chars;
  }
  included.push("confirmed_facts");
  block_chars.confirmed_facts = estimateCharsAndTokens(packetBody.confirmed_facts).chars;
  included.push("unconfirmed");
  block_chars.unconfirmed = estimateCharsAndTokens(packetBody.unconfirmed).chars;
  if (customerFacts.length) {
    included.push("customer_confirmed_facts");
    block_chars.customer_confirmed_facts = estimateCharsAndTokens(customerFacts).chars;
  }
  included.push("recent_dialogue");
  block_chars.recent_dialogue = estimateCharsAndTokens(recent).chars;
  included.push("focused_chart");
  block_chars.focused_chart = estimateCharsAndTokens(focusedChart).chars;

  const total = estimateCharsAndTokens(packetBody);
  const memoryStatus =
    memoryLoad?.status === "query_failed"
      ? "memory_query_failed"
      : officialContext
        ? "memory_hit"
        : "memory_miss";

  const trace = {
    active: true,
    source: officialContext
      ? crossSessionRecall
        ? "customer_active_memory"
        : "session_active_memory"
      : memoryStatus === "memory_miss"
        ? "chart_focus_only"
        : memoryStatus,
    memory_commit_id: officialContext?.memory_commit_id ?? null,
    memory_version: officialContext?.memory_version ?? null,
    cross_session_recall: crossSessionRecall === true,
    focus_resolution_source: focus.source,
    focused_contract_count: focusedContracts.length,
    included_blocks: included,
    excluded_blocks: excluded,
    block_chars,
    total_context_chars: total.chars,
    estimated_input_tokens: total.estimated_input_tokens,
    original_attachment_count: Number(originalAttachmentCount) || 0,
    focus_resolved: focus.status === "resolved",
    focus_ambiguous: focus.status === "ambiguous",
    memory_hit: memoryStatus === "memory_hit",
    memory_miss: memoryStatus === "memory_miss",
    memory_query_failed: memoryStatus === "memory_query_failed",
    factory_facts_deduplicated,
  };

  return {
    ok: true,
    packet: packetBody,
    trace,
    focused_chart: focusedChart,
    use_focused_delivery: true,
  };
}

/**
 * ONE_PATH Claude delivery shape — verified/current FACT+CONTEXT only.
 * Never promotes pending/unverified/OCR/inventory. No judgment prose.
 */
function isPendingLikeVerificationStatus(status) {
  return /pending|unverified|candidate|ocr|inventory|review/.test(
    String(status ?? "").toLowerCase(),
  );
}

export function buildKeyRelevantEvidenceForOnePath(packetResult = null) {
  const packet =
    packetResult && typeof packetResult === "object"
      ? packetResult.packet && typeof packetResult.packet === "object"
        ? packetResult.packet
        : packetResult.schema_version
          ? packetResult
          : null
      : null;
  if (!packet || typeof packet !== "object") return null;

  const confirmed_facts = (Array.isArray(packet.confirmed_facts)
    ? packet.confirmed_facts
    : []
  ).filter(
    (f) =>
      f && typeof f === "object" && !isPendingLikeVerificationStatus(f.verification_status),
  );

  const focused_contracts = (
    Array.isArray(packet.focused_contracts) ? packet.focused_contracts : []
  ).filter((c) => c && typeof c === "object");

  const chart =
    packet.focused_chart && typeof packet.focused_chart === "object"
      ? packet.focused_chart
      : null;

  return {
    schema_version: "key_relevant_evidence_v1",
    authority: "verified_current_over_customer_card",
    note: "FACT/CONTEXT only. Ready Card / customer card cache must not override this block.",
    focus_resolution: packet.focus_resolution ?? null,
    focused_contracts,
    confirmed_facts,
    unconfirmed: packet.unconfirmed ?? null,
    official_document_memory: packet.official_document_memory ?? null,
    customer_confirmed_facts: Array.isArray(packet.customer_confirmed_facts)
      ? packet.customer_confirmed_facts.filter(
          (f) =>
            f &&
            typeof f === "object" &&
            !isPendingLikeVerificationStatus(f.verification_status),
        )
      : [],
    verified_chart_slice: chart
      ? {
          focus_status: chart.focus_status ?? null,
          confirmed_contracts: Array.isArray(chart.confirmed_contracts)
            ? chart.confirmed_contracts
            : [],
          verified_document_coverages: Array.isArray(chart.verified_document_coverages)
            ? chart.verified_document_coverages
            : [],
        }
      : null,
  };
}

/**
 * Document ids referenced by verified/confirmed KEY_RELEVANT_EVIDENCE only.
 * Never includes pending/unverified/OCR/candidate/inventory/review sources.
 */
export function collectVerifiedDocumentIdsFromKeyRelevantEvidence(
  keyRelevantEvidence = null,
) {
  const evidence =
    keyRelevantEvidence && typeof keyRelevantEvidence === "object"
      ? keyRelevantEvidence
      : null;
  if (!evidence) return [];

  const out = [];
  const seen = new Set();
  const push = (raw) => {
    const id = String(raw ?? "").trim();
    if (!id || seen.has(id)) return;
    seen.add(id);
    out.push(id);
  };

  const pushFactDoc = (fact) => {
    if (!fact || typeof fact !== "object") return;
    if (isPendingLikeVerificationStatus(fact.verification_status)) return;
    push(fact.source_document_id ?? fact.document_id);
  };

  for (const f of Array.isArray(evidence.confirmed_facts) ? evidence.confirmed_facts : []) {
    pushFactDoc(f);
  }
  for (const f of Array.isArray(evidence.customer_confirmed_facts)
    ? evidence.customer_confirmed_facts
    : []) {
    pushFactDoc(f);
  }

  for (const c of Array.isArray(evidence.focused_contracts)
    ? evidence.focused_contracts
    : []) {
    if (!c || typeof c !== "object") continue;
    if (isPendingLikeVerificationStatus(c.verification_status)) continue;
    push(c.source_document_id ?? c.document_id);
    for (const ref of Array.isArray(c.fact_refs) ? c.fact_refs : []) {
      pushFactDoc(ref);
    }
  }

  const slice =
    evidence.verified_chart_slice && typeof evidence.verified_chart_slice === "object"
      ? evidence.verified_chart_slice
      : null;
  for (const c of Array.isArray(slice?.confirmed_contracts)
    ? slice.confirmed_contracts
    : []) {
    if (!c || typeof c !== "object") continue;
    if (isPendingLikeVerificationStatus(c.verification_status)) continue;
    push(c.source_document_id ?? c.document_id);
  }
  for (const cov of Array.isArray(slice?.verified_document_coverages)
    ? slice.verified_document_coverages
    : []) {
    if (!cov || typeof cov !== "object") continue;
    if (isPendingLikeVerificationStatus(cov.verification_status)) continue;
    push(cov.source_document_id ?? cov.document_id);
  }

  const official =
    evidence.official_document_memory &&
    typeof evidence.official_document_memory === "object"
      ? evidence.official_document_memory
      : null;
  if (official) {
    push(official.primary_document_id);
    for (const id of Array.isArray(official.document_ids) ? official.document_ids : []) {
      push(id);
    }
  }

  return out;
}

/**
 * Structural signal: this no-original turn depends on official document memory.
 * No keyword classifier — Ready/chart/memory attempt evidence only.
 */
export function isOfficialDocumentMemoryDependentTurn({
  originalAttachmentCount = 0,
  readyCardMeta = null,
  chart = null,
  memoryLoadAttempted = false,
} = {}) {
  if (Number(originalAttachmentCount) > 0) return false;
  if (memoryLoadAttempted !== true) return false;
  const readyCount = Number(readyCardMeta?.document_status?.active_count) || 0;
  if (readyCount > 0) return true;
  if (readyCardMeta?.materials_connected === true) return true;
  const contracts = contractsFromChart(chart);
  if (contracts.length > 0) return true;
  const coverages = Array.isArray(chart?.verified_document_coverages)
    ? chart.verified_document_coverages.length
    : 0;
  return coverages > 0;
}

export function shouldHardStopOnMemoryQueryFailed({
  originalAttachmentCount = 0,
  memoryLoad = null,
  readyCardMeta = null,
  chart = null,
} = {}) {
  if (!memoryLoad || memoryLoad.status !== "query_failed") return false;
  return isOfficialDocumentMemoryDependentTurn({
    originalAttachmentCount,
    readyCardMeta,
    chart,
    memoryLoadAttempted: true,
  });
}
