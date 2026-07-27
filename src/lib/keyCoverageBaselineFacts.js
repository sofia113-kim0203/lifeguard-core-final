/**
 * KEY coverage baseline facts — Claude proposes; KEY validates & stores.
 * Stored at coverage_summary.key_coverage_baseline_facts (not rider_details).
 * Does not mutate key_confirmed_source_facts.
 */

export const KEY_BASELINE_FACT_STATUSES = Object.freeze({
  VERIFIED: "verified",
  PENDING: "pending",
  CONFLICT: "conflict",
  UNRESOLVED: "unresolved",
});

export const KEY_BASELINE_ITEM_IDS = Object.freeze([
  "cancer_diagnosis",
  "cerebrovascular_diagnosis",
  "ischemic_heart_diagnosis",
  "caregiving",
  "hospital_daily",
  "surgery",
  "major_treatment",
]);

/** Amount-mode diagnosis cards — only these may use name-regex fallback. */
export const KEY_BASELINE_DIAGNOSIS_ITEM_IDS = Object.freeze([
  "cancer_diagnosis",
  "cerebrovascular_diagnosis",
  "ischemic_heart_diagnosis",
]);

export const KEY_BASELINE_STRUCTURED_ITEM_IDS = Object.freeze([
  "caregiving",
  "hospital_daily",
  "surgery",
  "major_treatment",
]);

/** major_treatment_region — cancer | brain_heart | null (never both). */
export const KEY_BASELINE_MAJOR_REGIONS = Object.freeze(["cancer", "brain_heart"]);

const STATUS_SET = new Set(Object.values(KEY_BASELINE_FACT_STATUSES));
const ITEM_SET = new Set(KEY_BASELINE_ITEM_IDS);
const REGION_SET = new Set(KEY_BASELINE_MAJOR_REGIONS);

function cleanText(value) {
  if (value == null) return null;
  const s = String(value).trim();
  return s ? s : null;
}

function normalizeNameKey(name = "") {
  return String(name ?? "")
    .replace(/\s+/g, "")
    .replace(/[()[\]【】]/g, "")
    .toLowerCase();
}

function parseAmount(value) {
  if (value == null || value === "") return null;
  if (typeof value === "number" && Number.isFinite(value) && value > 0) return value;
  const raw = String(value).replace(/,/g, "").trim();
  if (!raw) return null;
  const man = raw.match(/^(\d+(?:\.\d+)?)\s*만\s*원?$/);
  if (man) return Math.round(Number(man[1]) * 10000);
  const digits = raw.replace(/[^\d.]/g, "");
  const n = Number(digits);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

function normalizeLocator(raw) {
  if (!raw || typeof raw !== "object") return null;
  const out = {};
  if (raw.page != null && String(raw.page).trim() !== "") out.page = raw.page;
  if (raw.section != null && String(raw.section).trim()) out.section = String(raw.section).trim();
  if (raw.line != null && String(raw.line).trim()) out.line = String(raw.line).trim();
  if (raw.table_row != null && String(raw.table_row).trim()) {
    out.table_row = String(raw.table_row).trim();
  }
  if (raw.source_text != null && String(raw.source_text).trim()) {
    out.source_text = String(raw.source_text).trim();
  }
  if (raw.x != null) out.x = raw.x;
  if (raw.y != null) out.y = raw.y;
  return Object.keys(out).length ? out : null;
}

function locatorKey(locator) {
  if (!locator || typeof locator !== "object") return "";
  return [
    locator.page ?? "",
    locator.section ?? "",
    locator.line ?? "",
    locator.table_row ?? "",
    locator.source_text ?? "",
    locator.x ?? "",
    locator.y ?? "",
  ].join("|");
}

/**
 * Identity for merge/dedupe.
 * Prefer content sha256 (same file re-upload) or strong contract fingerprint
 * so duplicate UUID uploads do not double-count diagnosis amounts.
 */
export function baselineFactIdentityKey(fact = {}) {
  const coverage = normalizeNameKey(fact.original_coverage_name);
  const amount =
    fact.coverage_amount != null && Number.isFinite(Number(fact.coverage_amount))
      ? String(Number(fact.coverage_amount))
      : "";
  const item = String(fact.baseline_item_id ?? "").trim();
  const sha = String(fact.source_content_sha256 ?? "").trim().toLowerCase();
  if (sha && coverage) {
    return `sha:${sha}::${coverage}::${item}::${amount}`;
  }
  const policyNo = cleanText(fact.policy_number ?? fact.contract_number ?? fact.contract_fingerprint);
  const insurer = normalizeNameKey(fact.insurer_name);
  const product = normalizeNameKey(fact.product_name);
  const contractDate = cleanText(fact.contract_date ?? fact.effective_from);
  if (policyNo && coverage) {
    return `contract:${insurer}::${product}::${policyNo}::${contractDate ?? ""}::${coverage}::${item}::${amount}`;
  }
  return [
    String(fact.source_document_id ?? "").trim(),
    locatorKey(fact.source_locator),
    coverage,
  ].join("::");
}

function normalizeBaselineItemId(raw) {
  if (raw == null || raw === "") return null;
  const id = String(raw).trim();
  if (id === "null" || id === "none") return null;
  return ITEM_SET.has(id) ? id : null;
}

function normalizeMajorRegion(raw) {
  if (raw == null || raw === "") return null;
  const r = String(raw).trim();
  if (r === "cardio" || r === "brain-heart" || r === "brain_and_heart") return "brain_heart";
  if (REGION_SET.has(r)) return r;
  return null;
}

/**
 * Normalize Claude-proposed rows. Does NOT mark verified — KEY assigns status later.
 */
export function normalizeKeyCoverageBaselineFacts(rawFacts = [], defaults = {}) {
  const rows = Array.isArray(rawFacts) ? rawFacts : [];
  const defaultDocId = cleanText(defaults.source_document_id);
  const out = [];
  const seen = new Set();

  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const original_coverage_name = cleanText(
      row.original_coverage_name ?? row.coverage_name ?? row.rider_name,
    );
    if (!original_coverage_name) continue;

    const source_document_id =
      cleanText(row.source_document_id) || defaultDocId;
    const source_locator = normalizeLocator(row.source_locator);
    let baseline_item_id = normalizeBaselineItemId(row.baseline_item_id);
    let major_treatment_region = normalizeMajorRegion(row.major_treatment_region);

    // Never keep dual region; treat as null for KEY to mark conflict/unresolved.
    if (baseline_item_id !== "major_treatment") {
      major_treatment_region = null;
    }

    const structured_axis_id = cleanText(row.structured_axis_id);
    const coverage_amount = parseAmount(row.coverage_amount ?? row.amount);
    const payment_unit = cleanText(row.payment_unit);
    const payment_frequency = cleanText(row.payment_frequency);
    const maximum_payment_days =
      row.maximum_payment_days == null || row.maximum_payment_days === ""
        ? null
        : Number.isFinite(Number(row.maximum_payment_days))
          ? Number(row.maximum_payment_days)
          : cleanText(row.maximum_payment_days);
    const coverage_period = cleanText(row.coverage_period);
    const renewal =
      row.renewal == null || row.renewal === ""
        ? null
        : typeof row.renewal === "boolean"
          ? row.renewal
          : cleanText(row.renewal);
    const reduction_condition = cleanText(row.reduction_condition);
    const confidence =
      row.confidence == null || row.confidence === ""
        ? null
        : Number.isFinite(Number(row.confidence))
          ? Number(row.confidence)
          : cleanText(row.confidence);
    const unresolved_reason = cleanText(row.unresolved_reason);
    const source_content_sha256 =
      cleanText(row.source_content_sha256) ||
      cleanText(defaults.source_content_sha256);
    const policy_number = cleanText(
      row.policy_number ?? row.contract_number ?? row.contract_fingerprint,
    );
    const insurer_name = cleanText(row.insurer_name ?? row.insurer);
    const product_name = cleanText(row.product_name);
    const contract_date = cleanText(row.contract_date ?? row.effective_from);

    // Claude must not self-verify; strip any incoming status.
    const fact = {
      original_coverage_name,
      source_document_id,
      source_content_sha256,
      source_locator,
      baseline_item_id,
      major_treatment_region,
      structured_axis_id,
      coverage_amount,
      payment_unit,
      payment_frequency,
      maximum_payment_days,
      coverage_period,
      renewal,
      reduction_condition,
      confidence,
      unresolved_reason,
      policy_number,
      insurer_name,
      product_name,
      contract_date,
      status: KEY_BASELINE_FACT_STATUSES.PENDING,
      confirmation_source: "key_claude_baseline_analysis",
      confirmed_at: cleanText(defaults.confirmed_at) || new Date().toISOString(),
    };

    const key = baselineFactIdentityKey(fact);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(fact);
  }
  return out;
}

/**
 * KEY validation — assigns verified | pending | conflict | unresolved.
 * Never auto-verifies Claude output without checks.
 *
 * @param {object[]} proposed normalized Claude rows
 * @param {{
 *   ownedDocumentIds?: Set<string>|string[],
 *   existingFacts?: object[],
 *   retiredPolicyDocumentIds?: Set<string>|string[],
 * }} ctx
 */
export function keyValidateCoverageBaselineFacts(proposed = [], ctx = {}) {
  const owned = new Set(
    [...(ctx.ownedDocumentIds ?? [])].map((id) => String(id).trim()).filter(Boolean),
  );
  const retiredDocs = new Set(
    [...(ctx.retiredPolicyDocumentIds ?? [])]
      .map((id) => String(id).trim())
      .filter(Boolean),
  );
  const existing = Array.isArray(ctx.existingFacts) ? ctx.existingFacts : [];
  const existingByIdentity = new Map(
    existing.map((f) => [baselineFactIdentityKey(f), f]),
  );

  const byName = new Map();
  const out = [];

  for (const raw of proposed) {
    const fact = { ...raw };
    const identity = baselineFactIdentityKey(fact);
    const nameKey = normalizeNameKey(fact.original_coverage_name);

    if (!fact.source_document_id || !fact.source_locator) {
      fact.status = KEY_BASELINE_FACT_STATUSES.UNRESOLVED;
      fact.unresolved_reason =
        fact.unresolved_reason || "missing_source_document_or_locator";
      out.push(fact);
      continue;
    }

    if (owned.size && !owned.has(String(fact.source_document_id))) {
      fact.status = KEY_BASELINE_FACT_STATUSES.UNRESOLVED;
      fact.unresolved_reason = fact.unresolved_reason || "document_not_owned";
      out.push(fact);
      continue;
    }

    if (retiredDocs.has(String(fact.source_document_id))) {
      fact.status = KEY_BASELINE_FACT_STATUSES.UNRESOLVED;
      fact.unresolved_reason = fact.unresolved_reason || "retired_or_deleted_contract";
      out.push(fact);
      continue;
    }

    if (!fact.baseline_item_id) {
      fact.status = KEY_BASELINE_FACT_STATUSES.UNRESOLVED;
      fact.unresolved_reason =
        fact.unresolved_reason || "baseline_item_unclear";
      out.push(fact);
      continue;
    }

    // Similar/micro cancer must not enter general cancer diagnosis totals.
    if (
      fact.baseline_item_id === "cancer_diagnosis" &&
      /유사암|소액암|경계성|제자리암|상피내/.test(nameKey) &&
      !/일반암/.test(nameKey)
    ) {
      fact.status = KEY_BASELINE_FACT_STATUSES.UNRESOLVED;
      fact.baseline_item_id = null;
      fact.unresolved_reason =
        fact.unresolved_reason || "similar_cancer_excluded";
      out.push(fact);
      continue;
    }

    if (fact.baseline_item_id === "major_treatment" && !fact.major_treatment_region) {
      fact.status = KEY_BASELINE_FACT_STATUSES.UNRESOLVED;
      fact.unresolved_reason =
        fact.unresolved_reason || "major_treatment_region_unclear";
      out.push(fact);
      continue;
    }

    if (
      fact.baseline_item_id === "major_treatment" &&
      fact.major_treatment_region &&
      !REGION_SET.has(fact.major_treatment_region)
    ) {
      fact.status = KEY_BASELINE_FACT_STATUSES.UNRESOLVED;
      fact.unresolved_reason =
        fact.unresolved_reason || "invalid_major_treatment_region";
      out.push(fact);
      continue;
    }

    // Same coverage name cannot be both surgery and major_treatment.
    const priorSameName = byName.get(nameKey);
    if (priorSameName) {
      const a = priorSameName.baseline_item_id;
      const b = fact.baseline_item_id;
      const surgeryMajorClash =
        (a === "surgery" && b === "major_treatment") ||
        (a === "major_treatment" && b === "surgery");
      const dualMajor =
        a === "major_treatment" &&
        b === "major_treatment" &&
        priorSameName.major_treatment_region &&
        fact.major_treatment_region &&
        priorSameName.major_treatment_region !== fact.major_treatment_region;
      const dualItem = a && b && a !== b;
      if (surgeryMajorClash || dualMajor || dualItem) {
        fact.status = KEY_BASELINE_FACT_STATUSES.CONFLICT;
        fact.unresolved_reason =
          fact.unresolved_reason || "duplicate_primary_attribution";
        priorSameName.status = KEY_BASELINE_FACT_STATUSES.CONFLICT;
        priorSameName.unresolved_reason =
          priorSameName.unresolved_reason || "duplicate_primary_attribution";
        out.push(fact);
        continue;
      }
    }

    const prev = existingByIdentity.get(identity);
    if (
      prev &&
      prev.status === KEY_BASELINE_FACT_STATUSES.VERIFIED &&
      prev.baseline_item_id &&
      fact.baseline_item_id &&
      (prev.baseline_item_id !== fact.baseline_item_id ||
        prev.major_treatment_region !== fact.major_treatment_region)
    ) {
      fact.status = KEY_BASELINE_FACT_STATUSES.CONFLICT;
      fact.unresolved_reason =
        fact.unresolved_reason || "conflicts_existing_verified";
      out.push(fact);
      continue;
    }

    // Sufficient evidence → verified; incomplete optional fields → still verified if attribution clear.
    const hasAmountOrAxis =
      fact.coverage_amount != null ||
      fact.structured_axis_id ||
      fact.payment_unit ||
      fact.maximum_payment_days != null ||
      fact.renewal != null ||
      fact.reduction_condition ||
      KEY_BASELINE_DIAGNOSIS_ITEM_IDS.includes(fact.baseline_item_id);

    if (!hasAmountOrAxis && KEY_BASELINE_STRUCTURED_ITEM_IDS.includes(fact.baseline_item_id)) {
      fact.status = KEY_BASELINE_FACT_STATUSES.PENDING;
      fact.unresolved_reason =
        fact.unresolved_reason || "structured_details_incomplete";
      out.push(fact);
      byName.set(nameKey, fact);
      continue;
    }

    fact.status = KEY_BASELINE_FACT_STATUSES.VERIFIED;
    fact.unresolved_reason = null;
    out.push(fact);
    byName.set(nameKey, fact);
  }

  return out;
}

export function mergeKeyCoverageBaselineFacts(existing = [], incoming = []) {
  const map = new Map();
  for (const fact of [
    ...(Array.isArray(existing) ? existing : []),
    ...(Array.isArray(incoming) ? incoming : []),
  ]) {
    if (!fact || typeof fact !== "object") continue;
    map.set(baselineFactIdentityKey(fact), fact);
  }
  return [...map.values()];
}

/** Collect stored baseline facts from policy rows (any status). */
export function collectKeyCoverageBaselineFactsFromPolicies(policies = []) {
  const out = [];
  for (const policy of Array.isArray(policies) ? policies : []) {
    const summary =
      policy?.coverage_summary && typeof policy.coverage_summary === "object"
        ? policy.coverage_summary
        : {};
    if (summary.retired_reason) continue;
    const rows = Array.isArray(summary.key_coverage_baseline_facts)
      ? summary.key_coverage_baseline_facts
      : [];
    for (const row of rows) {
      if (!row || typeof row !== "object") continue;
      out.push({
        ...row,
        policy_id: String(policy.id ?? ""),
        insurer_name: String(policy.insurer_name ?? "").trim() || null,
        product_name: String(policy.product_name ?? "").trim() || null,
      });
    }
  }
  return out;
}

export function isVerifiedBaselineFact(fact) {
  return fact?.status === KEY_BASELINE_FACT_STATUSES.VERIFIED;
}

export function policiesHaveKeyBaselineFacts(policies = []) {
  return collectKeyCoverageBaselineFactsFromPolicies(policies).length > 0;
}
