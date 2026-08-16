/**
 * This-thread KEY verified-fact addresses only.
 * Persist the lookup address, never the amount string.
 * UNKNOWN / AMBIGUOUS are this-lookup results — not durable refs.
 * Next-turn value comes from a live ledger re-read of the same address.
 */

import { retrieveExactCustomerFact } from "./keyExactFactRetrieval.js";
import { attachLiveFactProvenance } from "./keyLiveVerifiedExactFactStore.js";

const MAX_ROWS = 8;

function asId(v) {
  return v == null ? "" : String(v).trim();
}

function lookupStatusOf(row = {}) {
  return asId(row.status ?? row.result_status).toLowerCase();
}

/**
 * Address only. Drops unknown/ambiguous. Strips any value/amount field.
 */
export function compactThreadVerifiedFactRefs(rows = []) {
  const out = [];
  const seen = new Set();
  for (const row of Array.isArray(rows) ? rows : []) {
    if (!row || typeof row !== "object") continue;
    const status = lookupStatusOf(row);
    if (status && status !== "hit") continue;
    const coverage_name = asId(row.coverage_name ?? row.coverage_ref);
    if (!coverage_name) continue;
    const field = asId(row.field) || "amount";
    const contract_id = asId(row.contract_id ?? row.contract_ref);
    const key = `${contract_id}|${coverage_name}|${field}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      contract_id: contract_id || null,
      coverage_name,
      field,
    });
    if (out.length >= MAX_ROWS) break;
  }
  return out;
}

export function mergeThreadVerifiedFactRefs(prior = [], incoming = []) {
  return compactThreadVerifiedFactRefs([
    ...(Array.isArray(prior) ? prior : []),
    ...(Array.isArray(incoming) ? incoming : []),
  ]);
}

/** Read addresses from the raw first argument — never a free identifier. */
export function readThreadVerifiedFactRefsFromArgs(args) {
  if (!args || typeof args !== "object") return [];
  return compactThreadVerifiedFactRefs(args.threadVerifiedFactRefs);
}

export function compactThreadVerifiedFactRefFromLookup(result, input = {}) {
  if (!result || lookupStatusOf(result) !== "hit") return null;
  const fact0 =
    result?.facts?.[0] && typeof result.facts[0] === "object" ? result.facts[0] : null;
  const meta =
    result?.metadata && typeof result.metadata === "object" ? result.metadata : null;
  const compact = compactThreadVerifiedFactRefs([
    {
      status: "hit",
      contract_id:
        fact0?.contract_id ?? meta?.contract_ref ?? input.contract_id ?? input.contractId,
      coverage_name:
        fact0?.coverage_name ??
        meta?.coverage_ref ??
        input.coverage_name ??
        input.coverageName,
      field: fact0?.field ?? meta?.field ?? input.field ?? "amount",
    },
  ]);
  return compact[0] ?? null;
}

/**
 * Re-read current ledger cells for stored addresses.
 * Returns this-turn HIT rows with current values. Drops stale unknown.
 */
export function resolveThreadVerifiedFacts({
  refs = [],
  rows = [],
  customerId,
  liveProvenance = null,
} = {}) {
  const hits = [];
  for (const ref of compactThreadVerifiedFactRefs(refs)) {
    const raw = retrieveExactCustomerFact({
      rows,
      customerId,
      contractId: ref.contract_id,
      coverageName: ref.coverage_name,
      field: ref.field,
    });
    const result = attachLiveFactProvenance(raw, liveProvenance, {
      contractId: ref.contract_id,
      coverageName: ref.coverage_name,
      field: ref.field,
    });
    if (lookupStatusOf(result) !== "hit" || result.value == null) continue;
    const addr = compactThreadVerifiedFactRefFromLookup(result, ref);
    if (!addr) continue;
    hits.push({
      ...addr,
      status: "hit",
      value: result.value,
      source_kind: result.metadata?.source_kind ?? null,
      store: result.metadata?.store ?? null,
    });
  }
  return hits;
}

export function addressesFromResolvedVerifiedFacts(resolvedHits = []) {
  return compactThreadVerifiedFactRefs(
    (Array.isArray(resolvedHits) ? resolvedHits : []).filter(
      (row) => lookupStatusOf(row) === "hit",
    ),
  );
}

/** This-turn KEY-verified data for Claude. Not a prompt command. */
export function buildThreadVerifiedFactsUserText(resolvedHits = []) {
  const facts = [];
  for (const row of Array.isArray(resolvedHits) ? resolvedHits : []) {
    if (!row || lookupStatusOf(row) !== "hit" || row.value == null) continue;
    const coverage_name = asId(row.coverage_name);
    if (!coverage_name) continue;
    facts.push({
      coverage_name,
      field: asId(row.field) || "amount",
      contract_id: asId(row.contract_id) || null,
      status: "hit",
      value: row.value,
    });
    if (facts.length >= MAX_ROWS) break;
  }
  if (!facts.length) return "";
  return [
    "[KEY_THREAD_VERIFIED_FACTS]",
    JSON.stringify({
      kind: "this_thread_key_verified_hits",
      facts,
    }),
  ].join("\n");
}
