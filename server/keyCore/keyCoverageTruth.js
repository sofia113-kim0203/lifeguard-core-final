/**
 * KEY coverage truth — one coverage identity, one current amount.
 * Distinct names stay distinct. Same name + different amounts = CONFLICT.
 * Unpaired amount lists are not assigned to every name.
 * No Q05 patch. No extra model call. No alias dictionary of product names.
 */

export const KEY_COVERAGE_LAYER = Object.freeze({
  CURRENT: "current",
  CONFLICT: "conflict",
  NAME_ONLY: "name_only",
});

function trim(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

export function amountKey(value) {
  if (value == null || value === "") return null;
  const raw = String(value).replace(/[\s,]/g, "").trim();
  if (!raw) return null;
  const man = raw.match(/^(\d+(?:\.\d+)?)만(?:원)?$/);
  if (man) return String(Math.round(Number(man[1]) * 10000));
  const won = raw.replace(/원$/g, "");
  if (/^\d+$/.test(won)) return won;
  return raw.toLowerCase();
}

function coverageName(row = {}) {
  return trim(
    row.coverage_name ??
      row.original_coverage_name ??
      row.rider_name ??
      row.name ??
      row.label ??
      "",
  );
}

function coverageKindToken(row = {}) {
  const direct = trim(row.coverage_kind ?? row.kind ?? row.surgery_class ?? "");
  if (direct) return direct.toLowerCase().replace(/\s+/g, "");
  const name = coverageName(row);
  const paren =
    name.match(/[（(]\s*(\d)\s*종\s*[）)]\s*$/) || name.match(/(\d)\s*종\s*$/);
  return paren ? `${paren[1]}종` : "";
}

function factType(row = {}) {
  return String(row.fact_type ?? "").trim();
}

function factLiteral(row = {}) {
  return trim(row.literal ?? row.literal_value);
}

function factDocumentId(row = {}) {
  return trim(row.source_document_id ?? row.document_id);
}

function nameFromFact(row = {}) {
  const named = coverageName(row);
  if (named) return named;
  const type = factType(row);
  if (type === "coverage_name" || type === "coverage") return factLiteral(row);
  return "";
}

function amountFromFact(row = {}) {
  const direct = row.coverage_amount ?? row.amount ?? null;
  if (direct != null && direct !== "") return direct;
  if (factType(row) === "coverage_amount") return row.literal ?? row.literal_value ?? null;
  return null;
}

function sameDocumentRelation(a, b) {
  const docA = factDocumentId(a);
  const docB = factDocumentId(b);
  if (docA && docB) return docA === docB;
  return !docA && !docB;
}

function coverageIdentity(row = {}) {
  const name = (coverageName(row) || nameFromFact(row)).toLowerCase();
  const unit = trim(row.coverage_unit ?? row.unit).toLowerCase();
  const subject = trim(
    row.insured ?? row.subject ?? row.coverage_subject ?? "",
  ).toLowerCase();
  const kind = coverageKindToken({ ...row, coverage_name: name || coverageName(row) });
  return `${name}|${unit}|${subject}|${kind}`;
}

/**
 * Slot for freshness/conflict: one coverage identity, not "all amounts on this contract".
 * Unbound amounts stay unique so 30만원 and 100만원 are not a false conflict.
 */
export function coverageFactSlotKey(row = {}, subject = "personal") {
  const name = nameFromFact(row);
  if (name) {
    const kind = coverageKindToken({ ...row, coverage_name: name });
    return `coverage|${subject}|${name.toLowerCase()}|${kind}`;
  }
  const amount = amountKey(amountFromFact(row));
  if (amount) return `coverage_amount_unbound|${subject}|${amount}`;
  return null;
}

function bindPair(nameRow, amountRow) {
  const coverage_name = nameFromFact(nameRow);
  const coverage_amount = amountFromFact(amountRow);
  return {
    ...nameRow,
    fact_type: "coverage",
    coverage_name,
    coverage_amount,
    coverage_unit: nameRow.coverage_unit ?? amountRow.coverage_unit ?? nameRow.unit ?? null,
    literal: `${coverage_name} = ${coverage_amount}`,
    source_document_id:
      factDocumentId(nameRow) || factDocumentId(amountRow) || nameRow.source_document_id || null,
    verification_status:
      nameRow.verification_status ?? amountRow.verification_status ?? "key_confirmed",
  };
}

/**
 * Preserve verified name↔amount as one meaning unit.
 * Source stores them as adjacent same-document facts, not two independent lists.
 * A following amount binds only to the immediately preceding name. Do not spray.
 */
export function bindAdjacentCoverageRelations(facts = []) {
  const out = [];
  let pending = null;
  const flush = () => {
    if (pending) out.push(pending);
    pending = null;
  };
  for (const fact of Array.isArray(facts) ? facts : []) {
    if (!fact || typeof fact !== "object") continue;
    const name = nameFromFact(fact);
    const amount = amountFromFact(fact);
    const hasName = Boolean(name);
    const hasAmount = amount != null && amount !== "";
    if (hasName && hasAmount) {
      flush();
      out.push(bindPair(fact, fact));
      continue;
    }
    if (hasName) {
      flush();
      pending = { ...fact, coverage_name: name };
      continue;
    }
    if (hasAmount) {
      if (pending && sameDocumentRelation(pending, fact)) {
        out.push(bindPair(pending, fact));
        pending = null;
      } else {
        out.push(fact);
      }
      continue;
    }
    flush();
    out.push(fact);
  }
  flush();
  return out;
}

function token(value) {
  return trim(value).replace(/\s+/g, "").toLowerCase();
}

export function coverageBelongsToContract(row, contract) {
  if (!row || !contract) return false;
  const docA = trim(row.source_document_id ?? row.document_id);
  const docB = trim(contract.source_document_id);
  if (docA && docB && docA === docB) return true;
  const keyA = trim(row.contract_identity_key);
  const keyB = trim(contract.contract_identity_key);
  if (keyA && keyB && keyA === keyB) return true;
  const insA = token(row.insurer_name ?? row.insurer);
  const insB = token(contract.insurer_name ?? contract.insurer);
  const pnA = token(row.policy_number).replace(/-/g, "");
  const pnB = token(contract.policy_number).replace(/-/g, "");
  if (insA && pnA && insA === insB && pnA === pnB) return true;
  const prodA = token(row.product_name);
  const prodB = token(contract.product_name);
  if (insA && prodA && insA === insB && prodA === prodB) return true;
  return false;
}

function pushRow(out, row, source_path) {
  if (row == null) return;
  if (typeof row === "string") {
    const name = trim(row);
    if (name) out.push({ coverage_name: name, source_path });
    return;
  }
  if (typeof row !== "object") return;
  out.push({ ...row, source_path: row.source_path || source_path });
}

export function collectCoverageRows({
  contract = null,
  evidenceCoverages = [],
  facts = [],
} = {}) {
  const out = [];
  if (Array.isArray(contract?.coverages)) {
    for (const row of contract.coverages) pushRow(out, row, "contract.coverages");
  }
  const summary =
    contract?.coverage_summary && typeof contract.coverage_summary === "object"
      ? contract.coverage_summary
      : null;
  if (summary) {
    for (const key of [
      "key_coverage_baseline_facts",
      "rider_details",
      "riders",
      "detected_coverages",
    ]) {
      if (!Array.isArray(summary[key])) continue;
      for (const row of summary[key]) pushRow(out, row, `coverage_summary.${key}`);
    }
  }
  const evidence = Array.isArray(evidenceCoverages) ? evidenceCoverages : [];
  const matched = evidence.filter((row) => coverageBelongsToContract(row, contract));
  const use = matched.length
    ? matched
    : evidence.filter((row) => !looksLikeForeignCoverage(row, contract));
  for (const row of use) pushRow(out, row, "verified_document_coverages");
  for (const fact of bindAdjacentCoverageRelations(facts)) {
    if (!fact || typeof fact !== "object") continue;
    const name = nameFromFact(fact);
    const amount = amountFromFact(fact);
    if (!name) continue;
    pushRow(
      out,
      { ...fact, coverage_name: name, coverage_amount: amount },
      "confirmed_facts",
    );
  }
  return out;
}

function slimTruthRow(row, layer) {
  return {
    coverage_name: coverageName(row) || null,
    coverage_amount: row.coverage_amount ?? row.amount ?? null,
    coverage_unit: row.coverage_unit ?? row.unit ?? null,
    subject: row.insured ?? row.subject ?? row.coverage_subject ?? null,
    fact_layer: layer,
    verification_status: row.verification_status ?? row.status ?? row.evidence_state ?? null,
    source_path: row.source_path ?? null,
    source_document_id: row.source_document_id ?? row.document_id ?? null,
  };
}

/**
 * Bind name + amount + unit + subject.
 * Do not spray an unpaired amount list onto every name.
 */
export function canonicalizeCoverageTruth(rows = []) {
  const byId = new Map();
  const orphanAmounts = [];
  for (const row of Array.isArray(rows) ? rows : []) {
    const name = coverageName(row);
    const amount = amountKey(row.coverage_amount ?? row.amount ?? row.literal);
    if (!name && amount) {
      orphanAmounts.push(amount);
      continue;
    }
    if (!name) continue;
    const id = coverageIdentity({ ...row, coverage_name: name });
    if (!byId.has(id)) byId.set(id, []);
    byId.get(id).push({
      ...row,
      coverage_name: name,
      coverage_amount: row.coverage_amount ?? row.amount ?? amount,
    });
  }

  const current = [];
  const conflict = [];
  for (const group of byId.values()) {
    const amounts = [
      ...new Set(group.map((row) => amountKey(row.coverage_amount)).filter(Boolean)),
    ];
    if (amounts.length === 0) {
      current.push(slimTruthRow(group[0], KEY_COVERAGE_LAYER.NAME_ONLY));
      continue;
    }
    if (amounts.length === 1) {
      const hit = group.find((row) => amountKey(row.coverage_amount) === amounts[0]) || group[0];
      current.push(slimTruthRow(hit, KEY_COVERAGE_LAYER.CURRENT));
      continue;
    }
    for (const amount of amounts) {
      const hit = group.find((row) => amountKey(row.coverage_amount) === amount);
      if (hit) conflict.push(slimTruthRow(hit, KEY_COVERAGE_LAYER.CONFLICT));
    }
  }

  return {
    current,
    conflict,
    orphan_amounts: orphanAmounts,
    coverages: [...current, ...conflict],
  };
}

function looksLikeForeignCoverage(row, contract) {
  if (!row || !contract) return false;
  const insA = token(row.insurer_name ?? row.insurer);
  const insB = token(contract.insurer_name ?? contract.insurer);
  if (insA && insB && insA !== insB) return true;
  return false;
}

export function attachEvidenceCoveragesToContracts(contracts = [], evidenceCoverages = []) {
  const list = Array.isArray(contracts) ? contracts : [];
  const evidence = Array.isArray(evidenceCoverages) ? evidenceCoverages : [];
  if (!list.length || !evidence.length) return list;
  return list.map((contract) => {
    const existing = Array.isArray(contract.coverages) ? contract.coverages : [];
    const mine = evidence.filter((row) => coverageBelongsToContract(row, contract));
    const extra = mine.length
      ? mine
      : list.length === 1
        ? evidence.filter((row) => !looksLikeForeignCoverage(row, contract))
        : [];
    if (!extra.length) return contract;
    return { ...contract, coverages: [...existing, ...extra] };
  });
}
