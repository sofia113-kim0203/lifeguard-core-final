/**
 * Corporate Gap Factory — Snapshot-only judgment (CORP-D1).
 * Reads CorporateSnapshot v1 only — never entity_memory_facts or Memory loaders.
 * Recommendation · Workspace · KEY not here.
 */
import { CORPORATE_SNAPSHOT_V1, loadCorporateSnapshot } from "./corporateSnapshot.js";

export const CORPORATE_GAP_V1 = "corp-gap-v1";

const ABSENT_VALUES = new Set(["없음", "no", "absent", "n", "false", "0", "none"]);
const PRESENT_VALUES = new Set(["있음", "yes", "present", "y", "true", "1"]);

/** v1 corporate coverage taxonomy — meaning redefined vs personal COVERAGE_ITEMS (Principle 7). */
const CORPORATE_COVERAGE_ITEMS_V1 = [
  {
    item: "group_insurance",
    snapshot_field: "derived.group_insurance_status",
    unknown_label: "group_insurance_status",
    kind: "status_enum",
  },
  {
    item: "liability",
    snapshot_field: "derived.liability",
    unknown_label: "liability",
    kind: "coverage_signal",
  },
  {
    item: "fire_insurance",
    snapshot_field: "derived.fire_insurance",
    unknown_label: "fire_insurance",
    kind: "coverage_signal",
  },
  {
    item: "executive_protection",
    snapshot_field: "derived.executive_protection",
    unknown_label: "executive_protection",
    kind: "coverage_signal",
  },
  {
    item: "employee_benefit",
    snapshot_field: "derived.employee_count",
    unknown_label: "employee_count",
    kind: "employee_count",
  },
];

function assertSnapshotContract(corporateSnapshot) {
  if (!corporateSnapshot) throw new Error("corporate_snapshot_required");
  if (corporateSnapshot.contract_version !== CORPORATE_SNAPSHOT_V1) {
    throw new Error("corporate_snapshot_version_mismatch");
  }
  if (!corporateSnapshot.identity?.entity_id) throw new Error("corporate_snapshot_identity_required");
  if (!corporateSnapshot.derived || !Array.isArray(corporateSnapshot.derived.unknowns)) {
    throw new Error("corporate_snapshot_derived_unknowns_required");
  }
}

function snapshotProvenance(corporateSnapshot) {
  return corporateSnapshot.memory_summary?.source ?? "entity_memory_facts";
}

function isUnknownLabel(unknowns, label) {
  return unknowns.includes(label);
}

function normalizeSignal(raw) {
  const trimmed = String(raw ?? "").trim();
  if (!trimmed) return { known: false, present: false, absent: false };
  const lower = trimmed.toLowerCase();
  if (PRESENT_VALUES.has(lower) || PRESENT_VALUES.has(trimmed)) {
    return { known: true, present: true, absent: false };
  }
  if (ABSENT_VALUES.has(lower) || ABSENT_VALUES.has(trimmed)) {
    return { known: true, present: false, absent: true };
  }
  if (lower === "unknown" || lower === "미확인") {
    return { known: false, present: false, absent: false };
  }
  return { known: true, present: true, absent: false, value: trimmed };
}

function evaluateGroupInsuranceStatus(status, unknowns, provenance) {
  if (isUnknownLabel(unknowns, "group_insurance_status") || status === "unknown" || !status) {
    return {
      item: "group_insurance",
      status: "unknown",
      known_gap: false,
      unknown_gap: true,
      sufficient: false,
      reason: "Snapshot.derived.unknowns",
      provenance,
      snapshot_field: "derived.group_insurance_status",
    };
  }
  if (status === "present") {
    return {
      item: "group_insurance",
      status: "sufficient",
      known_gap: true,
      unknown_gap: false,
      sufficient: true,
      reason: "derived.group_insurance_status=present",
      provenance,
      snapshot_field: "derived.group_insurance_status",
    };
  }
  if (status === "absent") {
    return {
      item: "group_insurance",
      status: "known_gap",
      known_gap: true,
      unknown_gap: false,
      sufficient: false,
      reason: "derived.group_insurance_status=absent",
      provenance,
      snapshot_field: "derived.group_insurance_status",
    };
  }
  return {
    item: "group_insurance",
    status: "unknown",
    known_gap: false,
    unknown_gap: true,
    sufficient: false,
    reason: "Snapshot.derived.unknowns",
    provenance,
    snapshot_field: "derived.group_insurance_status",
  };
}

function evaluateCoverageSignal(itemDef, rawValue, unknowns, provenance) {
  if (isUnknownLabel(unknowns, itemDef.unknown_label)) {
    return {
      item: itemDef.item,
      status: "unknown",
      known_gap: false,
      unknown_gap: true,
      sufficient: false,
      reason: "Snapshot.derived.unknowns",
      provenance,
      snapshot_field: itemDef.snapshot_field,
    };
  }

  const signal = normalizeSignal(rawValue);
  if (!signal.known) {
    return {
      item: itemDef.item,
      status: "unknown",
      known_gap: false,
      unknown_gap: true,
      sufficient: false,
      reason: "Snapshot.derived.unknowns",
      provenance,
      snapshot_field: itemDef.snapshot_field,
    };
  }

  if (signal.absent) {
    return {
      item: itemDef.item,
      status: "known_gap",
      known_gap: true,
      unknown_gap: false,
      sufficient: false,
      reason: `${itemDef.snapshot_field}=absent`,
      provenance,
      snapshot_field: itemDef.snapshot_field,
    };
  }

  return {
    item: itemDef.item,
    status: "sufficient",
    known_gap: true,
    unknown_gap: false,
    sufficient: true,
    reason: `${itemDef.snapshot_field}=present`,
    provenance,
    snapshot_field: itemDef.snapshot_field,
  };
}

function evaluateEmployeeBenefit(rawCount, unknowns, provenance) {
  if (isUnknownLabel(unknowns, "employee_count")) {
    return {
      item: "employee_benefit",
      status: "unknown",
      known_gap: false,
      unknown_gap: true,
      sufficient: false,
      reason: "Snapshot.derived.unknowns",
      provenance,
      snapshot_field: "derived.employee_count",
    };
  }

  const count = Number(rawCount);
  if (Number.isFinite(count) && count > 0) {
    return {
      item: "employee_benefit",
      status: "sufficient",
      known_gap: true,
      unknown_gap: false,
      sufficient: true,
      reason: "derived.employee_count>0",
      provenance,
      snapshot_field: "derived.employee_count",
    };
  }

  return {
    item: "employee_benefit",
    status: "known_gap",
    known_gap: true,
    unknown_gap: false,
    sufficient: false,
    reason: "derived.employee_count=0",
    provenance,
    snapshot_field: "derived.employee_count",
  };
}

/**
 * Pure builder — CorporateSnapshot v1 → Gap engine input (Snapshot fields only).
 */
export function buildCorporateGapInputFromSnapshot({ corporateSnapshot } = {}) {
  assertSnapshotContract(corporateSnapshot);

  const derived = corporateSnapshot.derived;
  const unknowns = [...derived.unknowns];

  return {
    contract_version: CORPORATE_GAP_V1,
    snapshot_version: corporateSnapshot.contract_version,
    entity_id: corporateSnapshot.identity.entity_id,
    entity_type: corporateSnapshot.identity.entity_type ?? "corporate",
    provenance: snapshotProvenance(corporateSnapshot),
    snapshot_built_at: corporateSnapshot.built_at ?? null,
    derived: {
      group_insurance_status: derived.group_insurance_status ?? "unknown",
      liability: derived.liability ?? null,
      fire_insurance: derived.fire_insurance ?? null,
      executive_protection: derived.executive_protection ?? null,
      employee_count: derived.employee_count ?? null,
      unknowns,
    },
  };
}

/**
 * Pure engine — corporate coverage judgment from Snapshot-derived gap input only.
 * Judges coverage gaps — does not recommend products.
 */
export function analyzeCorporateCoverageGaps({ gapInput, generatedAt = new Date().toISOString() } = {}) {
  if (!gapInput?.entity_id) throw new Error("gap_input_required");
  if (gapInput.contract_version !== CORPORATE_GAP_V1) throw new Error("gap_input_version_mismatch");

  const { derived } = gapInput;
  const unknowns = derived.unknowns ?? [];
  const provenance = gapInput.provenance ?? "entity_memory_facts";

  const gaps = [
    evaluateGroupInsuranceStatus(derived.group_insurance_status, unknowns, provenance),
    evaluateCoverageSignal(
      CORPORATE_COVERAGE_ITEMS_V1.find((i) => i.item === "liability"),
      derived.liability,
      unknowns,
      provenance,
    ),
    evaluateCoverageSignal(
      CORPORATE_COVERAGE_ITEMS_V1.find((i) => i.item === "fire_insurance"),
      derived.fire_insurance,
      unknowns,
      provenance,
    ),
    evaluateCoverageSignal(
      CORPORATE_COVERAGE_ITEMS_V1.find((i) => i.item === "executive_protection"),
      derived.executive_protection,
      unknowns,
      provenance,
    ),
    evaluateEmployeeBenefit(derived.employee_count, unknowns, provenance),
  ];

  return {
    contract_version: CORPORATE_GAP_V1,
    snapshot_version: gapInput.snapshot_version ?? CORPORATE_SNAPSHOT_V1,
    entity_id: gapInput.entity_id,
    entity_type: gapInput.entity_type ?? "corporate",
    generated_at: generatedAt,
    gaps,
    summary: {
      item_count: gaps.length,
      unknown_gap_count: gaps.filter((g) => g.unknown_gap === true).length,
      known_gap_count: gaps.filter((g) => g.known_gap === true && g.sufficient === false).length,
      sufficient_count: gaps.filter((g) => g.sufficient === true).length,
      invented_coverage: false,
    },
  };
}

/** Loader orchestrator — Snapshot loader only at Gap boundary. */
export async function loadCorporateGapContext(supabase, entityId, options = {}) {
  if (!entityId) throw new Error("entity_id_required");

  const corporateSnapshot =
    options.corporateSnapshot ?? (await loadCorporateSnapshot(supabase, entityId, options));

  const gapInput = buildCorporateGapInputFromSnapshot({ corporateSnapshot });
  const analysis = analyzeCorporateCoverageGaps({ gapInput });

  return {
    contract_version: CORPORATE_GAP_V1,
    entity_id: corporateSnapshot.identity.entity_id,
    snapshot_version: corporateSnapshot.contract_version,
    snapshot_built_at: corporateSnapshot.built_at ?? null,
    gap_input: gapInput,
    analysis,
    available: true,
    source: "compute-on-read",
  };
}
