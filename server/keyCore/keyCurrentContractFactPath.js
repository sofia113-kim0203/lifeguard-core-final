/**
 * Current-contract fact path for request_key_fact.
 * Production already owns exact coverage get/list_names.
 * This module only keeps stored current contracts visible with trust_state
 * and refuses to turn an incomplete coverage search into none.
 */
import {
  buildContractIdentityKey,
  isRetiredPolicyRow,
} from "../../src/lib/keyInsuranceScreenFacts.js";
import {
  hasPendingPolicyVerification,
  isEligibleConfirmedContractCard,
} from "../../src/lib/policyIdentityPollution.js";

export const KEY_CURRENT_CONTRACT_SLOTS = Object.freeze([
  "current_contracts",
  "coverages",
  "premiums",
  "renewal",
  "stated_goal",
]);

const UNKNOWN_NOTE =
  "unknown means not confirmed in KEY store - not proof the customer has none";
const NONE_NOTE =
  "none means KEY fully checked this requested range in store and found no matching stored fact";
const AMBIGUOUS_NOTE = "ambiguous - KEY will not pick one";
const CONFLICT_NOTE = "conflict - KEY will not hide or pick one side";
const ENDED_STATUS_RE =
  /cancelled|canceled|terminated|ended|expired|lapsed|surrendered|inactive|closed|해지|종료|만기|실효/i;
const CURRENT_STATUS_RE =
  /^(active|current|in[_-]?force|inforce|유지|정상|유효)$/i;

function asText(value) {
  return String(value ?? "").trim();
}

function asId(value) {
  return asText(value);
}

function storedOrNull(value) {
  if (value == null) return null;
  if (typeof value === "string" && !value.trim()) return null;
  return value;
}

function nestedLedger(truth = {}) {
  const ledger = truth?.VERIFIED_POLICY_LEDGER;
  return ledger && typeof ledger === "object" ? ledger : {};
}

function asContractArray(value) {
  return Array.isArray(value) ? value : null;
}

function contractRowId(row = {}) {
  return asId(row.contract_id ?? row.id ?? "");
}

function idSet(rows) {
  return new Set(
    (Array.isArray(rows) ? rows : []).map((row) => contractRowId(row)).filter(Boolean),
  );
}

function classifyTrustState(row, { confirmedIds, reviewIds, fallback = "review" } = {}) {
  if (hasPendingPolicyVerification(row)) return "pending_unverified";
  const id = contractRowId(row);
  if (id && confirmedIds?.has(id)) return "confirmed";
  if (id && reviewIds?.has(id)) return "review";
  if (isEligibleConfirmedContractCard(row) && buildContractIdentityKey(row)) {
    return "confirmed";
  }
  if (isEligibleConfirmedContractCard(row)) return "review";
  return fallback;
}

function resolveLiveCurrentContractLists({ truth = {}, chartObj = {}, ssot = {} } = {}) {
  const ledger = nestedLedger(truth);
  const confirmedFromTruth = asContractArray(truth.confirmed_contracts);
  const confirmedFromLedger = asContractArray(ledger.confirmed_contracts);
  const confirmedFromChart = asContractArray(chartObj.confirmed_contracts);
  const reviewFromChart = asContractArray(
    chartObj.personal_review_candidates ?? chartObj.review_candidates,
  );
  const livePolicies = asContractArray(ssot.policies);
  const confirmedIds = idSet([
    ...(confirmedFromChart || []),
    ...(confirmedFromTruth || []),
    ...(confirmedFromLedger || []),
  ]);
  const reviewIds = idSet(reviewFromChart);

  if (livePolicies != null) {
    return {
      rows: livePolicies.filter((row) => row && !isRetiredPolicyRow(row)),
      listPresent: true,
      confirmedIds,
      reviewIds,
      defaultTrust: "review",
    };
  }
  if (confirmedFromChart != null || reviewFromChart != null) {
    return {
      rows: [...(confirmedFromChart || []), ...(reviewFromChart || [])],
      listPresent: true,
      confirmedIds,
      reviewIds,
      defaultTrust: "review",
    };
  }
  if (confirmedFromTruth != null) {
    return {
      rows: confirmedFromTruth,
      listPresent: true,
      confirmedIds,
      reviewIds,
      defaultTrust: "confirmed",
    };
  }
  if (confirmedFromLedger != null) {
    return {
      rows: confirmedFromLedger,
      listPresent: true,
      confirmedIds,
      reviewIds,
      defaultTrust: "confirmed",
    };
  }
  return {
    rows: [],
    listPresent: false,
    confirmedIds,
    reviewIds,
    defaultTrust: "review",
  };
}

function storedContractStatus(row = {}) {
  return (
    storedOrNull(row.status) ||
    storedOrNull(row.contract_status) ||
    storedOrNull(row.policy_status) ||
    (row.is_active === false ? "inactive" : row.is_active === true ? "active" : null)
  );
}

function normalizeCoverageItem(item) {
  if (typeof item === "string") {
    const name = asText(item);
    return name ? { coverage_name: name } : null;
  }
  if (!item || typeof item !== "object") return null;
  return {
    ...item,
    coverage_name:
      item.coverage_name ??
      item.rider_name ??
      item.name ??
      item.label ??
      item.category,
  };
}

function storedCoveragesFromRow(row = {}) {
  const summary =
    row.coverage_summary && typeof row.coverage_summary === "object"
      ? row.coverage_summary
      : {};
  const bags = [
    row.coverages,
    summary.coverages,
    summary.rider_details,
    summary.riders,
    summary.detected_coverages,
  ];
  const present = bags.filter((bag) => Array.isArray(bag));
  if (!present.length) return null;
  const out = [];
  const seen = new Set();
  for (const bag of present) {
    for (const item of bag) {
      const normalized = normalizeCoverageItem(item);
      if (!normalized) continue;
      const key = `${asText(normalized.coverage_name).toLowerCase()}::${normalized.coverage_amount ?? normalized.amount ?? ""}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(normalized);
    }
  }
  return out;
}

function rowCustomerId(row) {
  return asId(row?.customer_id ?? row?.owner_customer_id ?? "");
}

function belongsToCustomer(row, customerId) {
  const cid = asId(customerId);
  if (!cid) return false;
  const rid = rowCustomerId(row);
  if (!rid) return true;
  return rid === cid;
}

function isolateOwnerRows(rows, customerId) {
  return (Array.isArray(rows) ? rows : []).filter(
    (row) => row && typeof row === "object" && belongsToCustomer(row, customerId),
  );
}

function classifyLifeStatus(statusText) {
  const s = asText(statusText);
  if (!s) return null;
  if (ENDED_STATUS_RE.test(s)) return "ended";
  if (CURRENT_STATUS_RE.test(s)) return "current";
  return null;
}

function storedBoolean(value) {
  if (value === true) return true;
  if (value === false) return false;
  if (value === "true") return true;
  if (value === "false") return false;
  return null;
}

function storedSource(row) {
  return (
    storedOrNull(row?.source_document_id) ||
    storedOrNull(row?.source_id) ||
    storedOrNull(row?.document_id) ||
    (typeof row?.source === "string" &&
    row.source !== "customer_stated_stored" &&
    row.source !== "customer_stated"
      ? storedOrNull(row.source)
      : null)
  );
}

function storedAsOf(row) {
  return (
    storedOrNull(row?.as_of) ||
    storedOrNull(row?.effective_date) ||
    storedOrNull(row?.observed_at) ||
    storedOrNull(row?.updated_at) ||
    storedOrNull(row?.as_of_date) ||
    null
  );
}

function isEndedRow(row) {
  return row?.life_status === "ended";
}

function isCurrentContract(row) {
  if (!row || isEndedRow(row)) return false;
  if (row.life_status === "current") return true;
  if (
    row.trust_state === "confirmed" ||
    row.trust_state === "review" ||
    row.trust_state === "pending_unverified"
  ) {
    return true;
  }
  return row.list_source === "confirmed_contracts";
}

function topicHay(row, slot) {
  const fields =
    slot === "coverages"
      ? [row?.coverage_name]
      : [
          row?.coverage_name,
          row?.product_name,
          row?.insurer,
          row?.kind,
          row?.value,
          row?.summary,
          row?.goal_text,
          row?.text,
        ];
  return fields.map((v) => asText(v).toLowerCase()).join(" ");
}

function matchesTopic(row, topic, slot) {
  const t = asText(topic).toLowerCase();
  if (!t) return true;
  return topicHay(row, slot).includes(t);
}

export function collectCurrentContractFactStore({
  customerId = null,
  policyTruthContext = null,
  chart = null,
  readyCardSsot = null,
} = {}) {
  const cid = asId(customerId);
  const contracts = [];
  const coverages = [];
  const premiums = [];
  const renewals = [];
  const statedGoals = [];
  const truth =
    policyTruthContext && typeof policyTruthContext === "object" ? policyTruthContext : {};
  const ssot = readyCardSsot && typeof readyCardSsot === "object" ? readyCardSsot : {};
  const chartObj = chart && typeof chart === "object" ? chart : {};
  const liveContracts = resolveLiveCurrentContractLists({ truth, chartObj, ssot });
  const verifiedCoverages = [
    ...(asContractArray(truth.verified_document_coverages) || []),
    ...(asContractArray(nestedLedger(truth).verified_document_coverages) || []),
    ...(asContractArray(chartObj.verified_document_coverages) || []),
  ];
  const goalList = Array.isArray(ssot.lifeLedgerBrief?.goals)
    ? ssot.lifeLedgerBrief.goals
    : null;
  let sawContractCoveragesArray = false;

  const pushCoverage = (row, listSource, trustState = null) => {
    if (!row || typeof row !== "object") return;
    if (!belongsToCustomer(row, cid) && rowCustomerId(row)) return;
    const name = asText(row.coverage_name ?? row.rider_name ?? row.name);
    if (!name) return;
    const amount = storedOrNull(row.coverage_amount ?? row.amount ?? row.value);
    const dedupeKey = `${asId(row.contract_id)}::${name.toLowerCase()}::${amount ?? ""}`;
    if (coverages.some((c) => `${asId(c.contract_id)}::${asText(c.coverage_name).toLowerCase()}::${c.amount ?? ""}` === dedupeKey)) {
      return;
    }
    coverages.push({
      customer_id: cid || null,
      contract_id: asId(row.contract_id) || null,
      coverage_name: name,
      amount,
      product_name: storedOrNull(row.product_name),
      insurer: storedOrNull(row.insurer),
      source: storedSource(row),
      as_of: storedAsOf(row),
      list_source: listSource,
      trust_state: trustState,
    });
  };

  const pushContract = (row, listSource) => {
    if (!row || typeof row !== "object") return;
    if (!belongsToCustomer(row, cid) && rowCustomerId(row)) return;
    const rawStatus = storedContractStatus(row);
    const lifeStatus = classifyLifeStatus(rawStatus);
    const trustState = classifyTrustState(row, {
      confirmedIds: liveContracts.confirmedIds,
      reviewIds: liveContracts.reviewIds,
      fallback: liveContracts.defaultTrust || "review",
    });
    const record = {
      customer_id: cid || null,
      contract_id: asId(row.contract_id ?? row.id) || null,
      insurer: storedOrNull(row.insurer || row.insurer_name || row.company_name),
      product_name: storedOrNull(row.product_name || row.product_label),
      contract_date: storedOrNull(
        row.contract_date ||
          row.effective_from ||
          row.coverage_summary?.contract_date ||
          row.coverage_summary?.effective_from,
      ),
      policy_number: storedOrNull(row.policy_number ?? row.coverage_summary?.policy_number),
      status: rawStatus,
      life_status: lifeStatus,
      trust_state: trustState,
      is_renewal: storedBoolean(row.is_renewal ?? row.renewal),
      monthly_premium: storedOrNull(row.monthly_premium ?? row.premium ?? row.premium_amount),
      source: storedSource(row),
      as_of: storedAsOf(row),
      list_source: listSource,
      coverage_inventory_present: false,
    };
    const rowCoverages = storedCoveragesFromRow(row);
    if (Array.isArray(rowCoverages)) {
      record.coverage_inventory_present = true;
      sawContractCoveragesArray = true;
      for (const cov of rowCoverages) {
        pushCoverage(
          {
            ...cov,
            contract_id: row.contract_id ?? row.id ?? cov?.contract_id,
            product_name: cov?.product_name ?? row.product_name,
            insurer: cov?.insurer ?? row.insurer ?? row.insurer_name,
            customer_id: row.customer_id ?? cid,
            source_document_id: cov?.source_document_id ?? row.source_document_id,
            as_of: cov?.as_of ?? row.as_of,
          },
          listSource,
          trustState,
        );
      }
    }
    contracts.push(record);
  };

  for (const row of liveContracts.rows) pushContract(row, "live_current_contracts");
  for (const row of verifiedCoverages) pushCoverage(row, "verified_document_coverages");
  if (goalList) {
    for (const row of goalList) {
      const text = asText(row?.summary ?? row?.goal_text ?? row?.text ?? row?.value);
      if (!text) continue;
      statedGoals.push({
        customer_id: cid || null,
        text,
        source_kind: "customer_stated",
        source: storedSource(row),
        as_of: storedAsOf(row),
      });
    }
  }

  const ownedContracts = isolateOwnerRows(contracts, cid);
  for (const row of ownedContracts) {
    if (row.monthly_premium != null) {
      premiums.push({
        customer_id: cid || null,
        contract_id: row.contract_id,
        insurer: row.insurer,
        product_name: row.product_name,
        monthly_premium: row.monthly_premium,
        source: row.source,
        as_of: row.as_of,
        life_status: row.life_status,
        trust_state: row.trust_state,
        list_source: row.list_source,
      });
    }
    if (row.is_renewal !== null) {
      renewals.push({
        customer_id: cid || null,
        contract_id: row.contract_id,
        insurer: row.insurer,
        product_name: row.product_name,
        is_renewal: row.is_renewal,
        source: row.source,
        as_of: row.as_of,
        life_status: row.life_status,
        trust_state: row.trust_state,
        list_source: row.list_source,
      });
    }
  }

  const currentForInventory = ownedContracts.filter(isCurrentContract);
  return {
    customerId: cid || null,
    contracts: ownedContracts,
    coverages: isolateOwnerRows(coverages, cid),
    premiums: isolateOwnerRows(premiums, cid),
    renewals: isolateOwnerRows(renewals, cid),
    statedGoals: isolateOwnerRows(statedGoals, cid),
    inventory: {
      contracts_list_present: liveContracts.listPresent,
      coverages_list_present: verifiedCoverages.length > 0 || sawContractCoveragesArray,
      coverages_list_complete:
        currentForInventory.length > 0 &&
        currentForInventory.every((row) => row.coverage_inventory_present === true),
      goals_list_present: goalList != null,
    },
  };
}

function forbiddenInput(input = {}) {
  if (!input || typeof input !== "object") return false;
  const banned = new Set(["customerId", "customer_id", "sql", "query", "write", "insert", "update", "delete"]);
  return Object.keys(input).some((k) => banned.has(k));
}

function baseResult({ status, slot, topic, facts = [], value = null, note = null, extra = {} }) {
  return {
    status,
    slot,
    topic: asText(topic) || null,
    value,
    facts,
    source: facts.length === 1 ? facts[0].source ?? null : null,
    as_of: facts.length === 1 ? facts[0].as_of ?? null : null,
    conflict: null,
    note,
    ...extra,
  };
}

function speakableEvidence(trustState) {
  return trustState === "confirmed" ? "원본으로 확인됨" : "목록에 있으나 원본으로 아직 확정 전";
}

function publicContract(row) {
  return {
    contract_id: row.contract_id,
    insurer: row.insurer,
    product_name: row.product_name,
    policy_number: row.policy_number,
    status: row.status,
    evidence: speakableEvidence(row.trust_state),
    source: row.source,
    as_of: row.as_of,
  };
}

function publicCoverage(row) {
  return {
    contract_id: row.contract_id,
    coverage_name: row.coverage_name,
    amount: row.amount,
    evidence: speakableEvidence(row.trust_state),
    source: row.source,
    as_of: row.as_of,
  };
}

function publicPremium(row) {
  return {
    contract_id: row.contract_id,
    insurer: row.insurer,
    product_name: row.product_name,
    monthly_premium: row.monthly_premium,
    source: row.source,
    as_of: row.as_of,
  };
}

function publicRenewal(row) {
  return {
    contract_id: row.contract_id,
    insurer: row.insurer,
    product_name: row.product_name,
    is_renewal: row.is_renewal,
    source: row.source,
    as_of: row.as_of,
  };
}

function currentOwned(rows, cid) {
  return isolateOwnerRows(rows, cid).filter(isCurrentContract);
}

function slotStatusFromTrust(facts, missingDetail = false) {
  if (!facts.length) return missingDetail ? "partial" : "unknown";
  if (missingDetail) return "partial";
  const states = [
    ...new Set(
      facts
        .map((row) => row.trust_state || row.evidence)
        .filter(Boolean),
    ),
  ];
  if (states.length === 0) return "confirmed";
  if (
    states.length === 1 &&
    (states[0] === "confirmed" || states[0] === "원본으로 확인됨")
  ) {
    return "confirmed";
  }
  return "partial";
}

function findAmountConflicts(rows, keyFn, valueFn) {
  const groups = new Map();
  for (const row of rows) {
    const key = keyFn(row);
    if (!key) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  const conflicts = [];
  for (const [, list] of groups) {
    if (new Set(list.map((r) => String(valueFn(r)))).size > 1) {
      conflicts.push({ rows: list });
    }
  }
  return conflicts;
}

export function executeCurrentContractFactRequest({
  slot,
  topic = "",
  customerId,
  store = null,
  input = null,
} = {}) {
  if (input && forbiddenInput(input)) {
    return baseResult({
      status: "unknown",
      slot: asText(slot) || null,
      topic,
      note: UNKNOWN_NOTE,
      extra: { rejected: "forbidden_argument" },
    });
  }
  const cid = asId(customerId);
  const want = asText(slot);
  if (!cid || !KEY_CURRENT_CONTRACT_SLOTS.includes(want)) {
    return baseResult({ status: "unknown", slot: want || null, topic, note: UNKNOWN_NOTE });
  }
  const bag = store && typeof store === "object" ? store : { customerId: cid };
  if (asId(bag.customerId) && asId(bag.customerId) !== cid) {
    return baseResult({ status: "unknown", slot: want, topic, note: UNKNOWN_NOTE });
  }
  const inventory = bag.inventory && typeof bag.inventory === "object" ? bag.inventory : {};

  if (want === "current_contracts") {
    if (!inventory.contracts_list_present) {
      return baseResult({ status: "unknown", slot: want, topic, note: UNKNOWN_NOTE });
    }
    const filtered = currentOwned(bag.contracts, cid).filter((row) =>
      matchesTopic(row, topic, want),
    );
    if (!filtered.length) {
      return baseResult({
        status: "none",
        slot: want,
        topic,
        note: NONE_NOTE,
        extra: { complete: true },
      });
    }
    const facts = filtered.map(publicContract);
    return baseResult({ status: slotStatusFromTrust(facts), slot: want, topic, facts });
  }

  if (want === "coverages") {
    const all = isolateOwnerRows(bag.coverages, cid);
    if (!inventory.coverages_list_present) {
      return baseResult({ status: "unknown", slot: want, topic, note: UNKNOWN_NOTE });
    }
    const filtered = all.filter((row) => matchesTopic(row, topic, want));
    if (!filtered.length) {
      if (inventory.coverages_list_complete === true) {
        return baseResult({
          status: "none",
          slot: want,
          topic,
          note: NONE_NOTE,
          extra: { complete: true },
        });
      }
      return baseResult({ status: "unknown", slot: want, topic, note: UNKNOWN_NOTE });
    }
    const sameTarget = findAmountConflicts(
      filtered,
      (r) => `${asId(r.contract_id)}::${asText(r.coverage_name).toLowerCase()}`,
      (r) => r.amount,
    );
    if (sameTarget.length) {
      return baseResult({
        status: "conflict",
        slot: want,
        topic,
        note: CONFLICT_NOTE,
        extra: {
          conflict: {
            kind: "same_target_different_values",
            matching: sameTarget.flatMap((g) => g.rows).map(publicCoverage),
          },
        },
      });
    }
    const sameName = new Map();
    for (const row of filtered) {
      const n = asText(row.coverage_name);
      if (!n) continue;
      if (!sameName.has(n)) sameName.set(n, []);
      sameName.get(n).push(row);
    }
    const ambiguousNames = [...sameName.values()].filter((list) => {
      const cids = new Set(list.map((r) => asId(r.contract_id)).filter(Boolean));
      return cids.size > 1;
    });
    if (ambiguousNames.length) {
      return baseResult({
        status: "ambiguous",
        slot: want,
        topic,
        note: AMBIGUOUS_NOTE,
        extra: {
          matching: ambiguousNames.flat().map((r) => ({
            contract_id: r.contract_id,
            coverage_name: r.coverage_name,
            amount: r.amount ?? null,
          })),
        },
      });
    }
    const facts = filtered.map(publicCoverage);
    return baseResult({
      status: slotStatusFromTrust(facts, facts.some((f) => f.amount == null)),
      slot: want,
      topic,
      facts,
    });
  }

  if (want === "premiums") {
    if (!inventory.contracts_list_present) {
      return baseResult({ status: "unknown", slot: want, topic, note: UNKNOWN_NOTE });
    }
    const current = currentOwned(bag.contracts, cid);
    if (!current.length) {
      return baseResult({
        status: "none",
        slot: want,
        topic,
        note: NONE_NOTE,
        extra: { complete: true },
      });
    }
    const rows = currentOwned(bag.premiums, cid).filter((row) => matchesTopic(row, topic, want));
    if (!rows.length) {
      return baseResult({ status: "unknown", slot: want, topic, note: UNKNOWN_NOTE });
    }
    const facts = rows.map(publicPremium);
    return baseResult({
      status: slotStatusFromTrust(facts, current.some((c) => c.monthly_premium == null)),
      slot: want,
      topic,
      facts,
    });
  }

  if (want === "renewal") {
    if (!inventory.contracts_list_present) {
      return baseResult({ status: "unknown", slot: want, topic, note: UNKNOWN_NOTE });
    }
    const current = currentOwned(bag.contracts, cid);
    if (!current.length) {
      return baseResult({
        status: "none",
        slot: want,
        topic,
        note: NONE_NOTE,
        extra: { complete: true },
      });
    }
    const rows = currentOwned(bag.renewals, cid).filter((row) => matchesTopic(row, topic, want));
    if (!rows.length) {
      return baseResult({ status: "unknown", slot: want, topic, note: UNKNOWN_NOTE });
    }
    return baseResult({
      status: slotStatusFromTrust(rows.map(publicRenewal), current.some((c) => c.is_renewal == null)),
      slot: want,
      topic,
      facts: rows.map(publicRenewal),
    });
  }

  if (want === "stated_goal") {
    if (!inventory.goals_list_present) {
      return baseResult({
        status: "unknown",
        slot: want,
        topic,
        note: UNKNOWN_NOTE,
        extra: { authority: "customer_stated", not_contract_fact: true },
      });
    }
    const filtered = isolateOwnerRows(bag.statedGoals, cid).filter((row) =>
      matchesTopic(row, topic, want),
    );
    if (!filtered.length) {
      return baseResult({
        status: "none",
        slot: want,
        topic,
        note: NONE_NOTE,
        extra: { complete: true, authority: "customer_stated", not_contract_fact: true },
      });
    }
    return baseResult({
      status: "confirmed",
      slot: want,
      topic,
      facts: filtered.map((row) => ({
        text: row.text,
        source_kind: "customer_stated",
        source: row.source,
        as_of: row.as_of,
      })),
      extra: { authority: "customer_stated", not_contract_fact: true },
    });
  }

  return baseResult({ status: "unknown", slot: want, topic, note: UNKNOWN_NOTE });
}
