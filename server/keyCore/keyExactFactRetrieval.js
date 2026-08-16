/**
 * KEY OS exact fact retrieval — structured request only.
 * No question parsing, synonym table, keyword router, or Claude.
 * Product truth source at tool time is the live verified store
 * (see keyLiveVerifiedExactFactStore.js). In-memory card/chart rows
 * remain for unit tests and candidate search only.
 */
import { attachLiveFactProvenance } from "./keyLiveVerifiedExactFactStore.js";

export {
  LIVE_VERIFIED_FACT_HELPER,
  LIVE_VERIFIED_FACT_SOURCE_KIND,
  LIVE_VERIFIED_FACT_STORE,
  collectExactFactRowsFromLiveVerifiedPolicies,
  loadLiveVerifiedExactFactRows,
} from "./keyLiveVerifiedExactFactStore.js";

function asId(v) {
  return v == null ? "" : String(v).trim();
}

function coverageNameOf(row = {}) {
  return asId(row.coverage_name ?? row.coverage ?? row.literal_name);
}

function contractIdOf(row = {}) {
  return asId(
    row.contract_id ??
      row.contract_identity_key ??
      row.source_document_id ??
      row.document_id,
  );
}

function customerIdOf(row = {}) {
  return asId(row.customer_id ?? row.customerId);
}

function fieldValue(row = {}, field = "amount") {
  const key = asId(field) || "amount";
  if (key === "amount") {
    const v = row.coverage_amount ?? row.amount ?? row.value ?? row.literal_amount;
    return v == null || String(v).trim() === "" ? null : v;
  }
  const v = row[key] ?? row[`coverage_${key}`] ?? null;
  return v == null || String(v).trim() === "" ? null : v;
}

/**
 * Deterministic lookup. Caller must already know customer / contract / coverage / field.
 * Does not read raw customer speech.
 */
export function retrieveExactCustomerFact({
  rows = [],
  customerId,
  contractId = null,
  coverageName,
  field = "amount",
} = {}) {
  const customer = asId(customerId);
  const coverage = asId(coverageName);
  const contract = asId(contractId);
  const wantField = asId(field) || "amount";

  if (!customer || !coverage) {
    return {
      status: "unknown",
      value: null,
      facts: [],
      other_coverage_count: 0,
      other_customer_count: 0,
      metadata: null,
    };
  }

  const pool = Array.isArray(rows) ? rows.filter((r) => r && typeof r === "object") : [];
  const otherCustomer = pool.filter((r) => customerIdOf(r) && customerIdOf(r) !== customer);
  const mine = pool.filter((r) => customerIdOf(r) === customer);
  const nameHits = mine.filter((r) => coverageNameOf(r) === coverage);
  const scoped = contract ? nameHits.filter((r) => contractIdOf(r) === contract) : nameHits;

  if (otherCustomer.length && !mine.length) {
    return {
      status: "unknown",
      value: null,
      facts: [],
      other_coverage_count: 0,
      other_customer_count: 0,
      metadata: null,
    };
  }

  if (!contract && new Set(nameHits.map(contractIdOf).filter(Boolean)).size > 1) {
    return {
      status: "ambiguous",
      value: null,
      facts: [],
      matching_contracts: nameHits.map((r) => ({
        contract_id: contractIdOf(r),
        coverage_name: coverageNameOf(r),
        field: wantField,
        value: fieldValue(r, wantField),
      })),
      other_coverage_count: 0,
      other_customer_count: 0,
      metadata: null,
    };
  }

  if (!scoped.length) {
    return {
      status: "unknown",
      value: null,
      facts: [],
      other_coverage_count: 0,
      other_customer_count: 0,
      metadata: null,
    };
  }

  const value = fieldValue(scoped[0], wantField);
  if (value == null) {
    return {
      status: "unknown",
      value: null,
      facts: [],
      other_coverage_count: 0,
      other_customer_count: 0,
      metadata: null,
    };
  }

  return {
    status: "hit",
    value,
    facts: scoped.map((r) => ({
      customer_id: customer,
      contract_id: contractIdOf(r),
      coverage_name: coverageNameOf(r),
      field: wantField,
      value: fieldValue(r, wantField),
    })),
    other_coverage_count: 0,
    other_customer_count: 0,
    metadata: null,
  };
}

export const KEY_EXACT_FACT_TOOL_NAME = "request_key_fact";

export const KEY_EXACT_FACT_TOOL = Object.freeze({
  name: KEY_EXACT_FACT_TOOL_NAME,
  description:
    "Ask KEY for this customer's stored private insurance facts. " +
    "Private contract facts (coverage names, amounts) may exist in KEY even when they are absent from the current input. " +
    "If a private insurance fact is needed and the current input does not contain that value, " +
    "call this tool before asking the customer to re-upload a policy or call an insurer. " +
    "Public products and official rules use web_search. Private customer facts use this tool. " +
    "action=list_names finds stored addresses: coverage name, contract_id, and insurer/product when stored (no amounts). " +
    "If the stored name is unknown, list_names first, then get with that exact name. " +
    "action=get returns one field for one coverage on one contract. " +
    "If the same coverage exists on more than one contract, send contract_id. " +
    "Omitting contract_id then returns status=ambiguous and matching_contracts — KEY will not pick one. " +
    "You may send several request_key_fact calls in one turn. " +
    "Do not invent amounts. The authenticated customer is applied by KEY — do not send another customer.",
  input_schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      action: {
        type: "string",
        enum: ["get", "list_names"],
        description:
          "list_names: FIND stored addresses (coverage name, contract_id, insurer/product). No amounts. get: one field on one coverage.",
      },
      contract_id: {
        type: "string",
        description: "Required for get when the same coverage name exists on more than one contract.",
      },
      coverage_name: {
        type: "string",
        description: "Exact stored coverage name for get. Use a name returned by list_names when unsure.",
      },
      field: {
        type: "string",
        enum: ["amount"],
        description: "Used with get. Currently amount only.",
      },
    },
    required: ["action"],
  },
});

export function collectExactFactRowsFromKeyStore({
  customerId,
  chart = null,
  keyConfirmedSourceFacts = [],
} = {}) {
  const cid = asId(customerId);
  if (!cid) return [];
  const rows = [];
  const pushRow = (row) => {
    if (!row || typeof row !== "object") return;
    const name = coverageNameOf(row);
    if (!name) return;
    rows.push({
      customer_id: cid,
      contract_id: contractIdOf(row),
      coverage_name: name,
      coverage_amount: row.coverage_amount ?? row.amount ?? row.value ?? null,
    });
  };
  const coverages = Array.isArray(chart?.verified_document_coverages)
    ? chart.verified_document_coverages
    : [];
  for (const row of coverages) pushRow(row);
  const internalContracts = [
    ...(Array.isArray(chart?.confirmed_contracts) ? chart.confirmed_contracts : []),
    ...(Array.isArray(chart?.insurance_contracts) ? chart.insurance_contracts : []),
  ];
  for (const c of internalContracts) {
    if (Array.isArray(c?.coverages)) {
      for (const cov of c.coverages) {
        pushRow({
          ...cov,
          contract_id: contractIdOf(c) || contractIdOf(cov),
          source_document_id: c.source_document_id ?? cov.source_document_id,
        });
      }
    }
    for (const ref of Array.isArray(c?.fact_refs) ? c.fact_refs : []) {
      if (!ref || typeof ref !== "object") continue;
      if (!/coverage/i.test(String(ref.fact_type ?? ""))) continue;
      pushRow({
        coverage_name: ref.coverage_name ?? ref.literal ?? null,
        coverage_amount: ref.coverage_amount ?? ref.amount ?? null,
        contract_id: contractIdOf(c),
        source_document_id: ref.source_document_id ?? c.source_document_id,
      });
    }
  }
  for (const f of Array.isArray(keyConfirmedSourceFacts) ? keyConfirmedSourceFacts : []) {
    if (!f || typeof f !== "object") continue;
    if (!/coverage/i.test(String(f.fact_type ?? f.field ?? ""))) continue;
    pushRow({
      coverage_name: f.coverage_name ?? f.literal ?? null,
      coverage_amount: f.coverage_amount ?? f.amount ?? null,
      contract_id: contractIdOf(f),
      source_document_id: f.source_document_id,
    });
  }
  return rows;
}

export function listExactCoverageNames({
  rows = [],
  customerId,
  contractId = null,
} = {}) {
  const customer = asId(customerId);
  const contract = asId(contractId);
  const mine = (Array.isArray(rows) ? rows : []).filter(
    (r) => r && customerIdOf(r) === customer,
  );
  const scoped = contract ? mine.filter((r) => contractIdOf(r) === contract) : mine;
  const seen = new Set();
  const names = [];
  for (const r of scoped) {
    const name = coverageNameOf(r);
    const cid = contractIdOf(r);
    const key = `${cid}|${name}`;
    if (!name || seen.has(key)) continue;
    seen.add(key);
    const addr = { contract_id: cid || null, coverage_name: name };
    const insurer = asId(r.insurer_name);
    const product = asId(r.product_name);
    if (insurer) addr.insurer_name = insurer;
    if (product) addr.product_name = product;
    names.push(addr);
  }
  return {
    status: names.length ? "hit" : "unknown",
    coverage_names: names,
    other_coverage_count: 0,
    other_customer_count: 0,
    metadata: null,
  };
}

export function executeKeyExactFactRequest({
  action = "get",
  contractId = null,
  coverageName = null,
  field = "amount",
  customerId,
  rows = [],
} = {}) {
  if (String(action ?? "") === "list_names") {
    return listExactCoverageNames({ rows, customerId, contractId });
  }
  return retrieveExactCustomerFact({
    rows,
    customerId,
    contractId,
    coverageName,
    field,
  });
}

export function hasKeyExactFactToolUse(content = []) {
  return (Array.isArray(content) ? content : []).some(
    (b) => b?.type === "tool_use" && b?.name === KEY_EXACT_FACT_TOOL_NAME,
  );
}

export function buildKeyExactFactToolResults(
  assistantContent = [],
  {
    customerId,
    rows = [],
    observeBag = null,
    liveProvenance = null,
    verifiedRefBag = null,
  } = {},
) {
  const blocks = [];
  for (const b of Array.isArray(assistantContent) ? assistantContent : []) {
    if (b?.type !== "tool_use" || b?.name !== KEY_EXACT_FACT_TOOL_NAME) continue;
    const id = b?.id != null ? String(b.id).trim() : "";
    if (!id) continue;
    const input = b.input && typeof b.input === "object" ? b.input : {};
    const raw = executeKeyExactFactRequest({
      action: input.action,
      contractId: input.contract_id,
      coverageName: input.coverage_name,
      field: input.field,
      customerId,
      rows,
    });
    const result = attachLiveFactProvenance(raw, liveProvenance, {
      contractId: input.contract_id,
      coverageName: input.coverage_name,
      field: input.field,
    });
    try {
      observeBag?.record?.(result, input.action, customerId);
    } catch {
      /* observe must never break Claude path */
    }
    try {
      verifiedRefBag?.record?.(result, input);
    } catch {
      /* continuity bag must never break Claude path */
    }
    blocks.push({
      type: "tool_result",
      tool_use_id: id,
      content: JSON.stringify(result),
    });
  }
  return blocks;
}

/** Loop guard only. Not the continue protocol. Not a test-fitted turn budget. */
export const PROVIDER_TURN_SAFETY_ABORT = 12;

/**
 * Server-search is pending only while the Anthropic loop is still open.
 * Official: pause_turn, or server_tool_use whose id has no result block.
 * A completed web_search_tool_result + end_turn is NOT pending.
 * Replaying that finished assistant as the last message is assistant prefill
 * (claude-sonnet-4-6 400: conversation must end with a user message).
 */
export function isServerSearchStillPending({
  stopReason = "",
  assistantContent = [],
} = {}) {
  const stop = String(stopReason ?? "").trim();
  if (stop === "pause_turn") return true;
  const blocks = Array.isArray(assistantContent) ? assistantContent : [];
  const resultIds = new Set();
  for (const b of blocks) {
    const type = String(b?.type ?? "");
    const id = b?.tool_use_id != null ? String(b.tool_use_id) : "";
    if (
      id &&
      (type === "web_search_tool_result" || type.endsWith("_tool_result"))
    ) {
      resultIds.add(id);
    }
  }
  return blocks.some(
    (b) =>
      b?.type === "server_tool_use" &&
      b?.id &&
      !resultIds.has(String(b.id)),
  );
}

/**
 * Continue while KEY fact or an open server-search loop must return to Claude.
 * Stop when there is no further tool request (end_turn / no pending tools).
 * safety abort is a runaway guard, not the design cap.
 */
export function resolveProviderTurnDecision({
  stopReason = "",
  keyFactPending = false,
  serverSearchPending = false,
  usedServerSearch = false,
  customerVisible = false,
  turn = 0,
  safetyAbortTurns = PROVIDER_TURN_SAFETY_ABORT,
} = {}) {
  const stop = String(stopReason ?? "").trim();
  const searchPending =
    serverSearchPending === true ||
    (usedServerSearch === true && stop === "pause_turn");
  const pending = keyFactPending === true || searchPending === true;
  const safetyAbort = turn + 1 >= Number(safetyAbortTurns);
  if (pending && safetyAbort) {
    return { action: "abort", reason: "safety_abort", pending: true };
  }
  if (pending) {
    return { action: "continue", reason: "tool_result_pending", pending: true };
  }
  if (customerVisible) {
    return {
      action: "accept_answer",
      reason: stop || "end_turn",
      pending: false,
    };
  }
  return {
    action: "empty",
    reason: stop || "no_pending_tools",
    pending: false,
  };
}

export function shouldContinueForToolResultPath(opts = {}) {
  return resolveProviderTurnDecision(opts).action === "continue";
}
