/**
 * Corporate Snapshot Factory — Memory → judgment-ready current state (CORP-C1).
 * Personal snapshot builders untouched. Gap/Recommendation/Workspace not here.
 */
import { loadCorporateEntityRecord, loadCorporateMemorySnapshot } from "./corporateMemorySnapshot.js";
import { ENTITY_TYPES } from "../entityTypes.js";

export const CORPORATE_SNAPSHOT_V1 = "corp-snapshot-v1";

/** Derived dimensions v1 tracks — missing facts become derived.unknowns (honest gap input later). */
const V1_DERIVED_TRACKING = [
  { field: "industry", fact_key: "corporate.basic.industry", unknown_label: "industry" },
  {
    field: "group_insurance_status",
    fact_key: "corporate.group_insurance.presence",
    unknown_label: "group_insurance_status",
  },
  { field: "employee_count", fact_key: "corporate.basic.employee_count", unknown_label: "employee_count" },
  { field: "executive_protection", fact_key: "corporate.executive_protection", unknown_label: "executive_protection" },
  { field: "fire_insurance", fact_key: "corporate.fire_insurance", unknown_label: "fire_insurance" },
  { field: "liability", fact_key: "corporate.liability", unknown_label: "liability" },
];

const PRESENT_VALUES = new Set(["있음", "yes", "present", "y", "true", "1"]);
const ABSENT_VALUES = new Set(["없음", "no", "absent", "n", "false", "0"]);

function normalizeGroupInsuranceStatus(rawValue) {
  const normalized = String(rawValue ?? "")
    .trim()
    .toLowerCase();
  if (!normalized) return "unknown";
  if (PRESENT_VALUES.has(normalized) || PRESENT_VALUES.has(String(rawValue ?? "").trim())) return "present";
  if (ABSENT_VALUES.has(normalized) || ABSENT_VALUES.has(String(rawValue ?? "").trim())) return "absent";
  if (normalized === "미확인" || normalized === "unknown") return "unknown";
  return "unknown";
}

function factMapFromMemory(memorySnapshot) {
  const map = new Map();
  for (const fact of memorySnapshot?.facts ?? []) {
    const key = String(fact?.fact_key ?? "").trim();
    if (key && !map.has(key)) map.set(key, fact);
  }
  return map;
}

function resolveDerivedField(field, fact) {
  if (!fact) return { value: null, known: false };

  const raw = String(fact.fact_value ?? "").trim();
  if (!raw) return { value: null, known: false };

  if (field === "group_insurance_status") {
    const status = normalizeGroupInsuranceStatus(raw);
    return { value: status, known: status !== "unknown" };
  }

  if (field === "employee_count") {
    const n = Number(raw.replace(/,/g, ""));
    if (Number.isFinite(n) && n >= 0) return { value: n, known: true };
    return { value: null, known: false };
  }

  return { value: raw, known: true };
}

/**
 * Pure builder — Corporate Memory + Entity identity → CorporateSnapshot v1.
 * @param {{ entityRecord: object, memorySnapshot: object }} input
 */
export function buildCorporateSnapshot({ entityRecord, memorySnapshot } = {}) {
  if (!entityRecord?.id) throw new Error("entity_record_required");
  if (!memorySnapshot) throw new Error("memory_snapshot_required");

  const factsByKey = factMapFromMemory(memorySnapshot);
  const factKeys = [...factsByKey.keys()].sort();
  const factCount = memorySnapshot.fact_count ?? memorySnapshot.facts?.length ?? factKeys.length;

  const derivedValues = {};
  const unknowns = [];

  for (const track of V1_DERIVED_TRACKING) {
    const fact = factsByKey.get(track.fact_key) ?? null;
    const { value, known } = resolveDerivedField(track.field, fact);
    derivedValues[track.field] = value;

    if (!known) {
      unknowns.push(track.unknown_label);
    } else if (track.field === "group_insurance_status" && value === "unknown") {
      unknowns.push(track.unknown_label);
    }
  }

  return {
    contract_version: CORPORATE_SNAPSHOT_V1,
    built_at: new Date().toISOString(),
    identity: {
      entity_id: entityRecord.id,
      entity_type: entityRecord.entity_type ?? ENTITY_TYPES.CORPORATE,
      status: entityRecord.entity_status ?? null,
      scope: entityRecord.entity_scope ?? null,
      display_name: entityRecord.display_name ?? null,
      memory_version: entityRecord.memory_version ?? memorySnapshot.memory_version ?? 0,
    },
    memory_summary: {
      fact_count: factCount,
      fact_keys: factKeys,
      source: memorySnapshot.memory_namespace ?? "entity_memory_facts",
    },
    derived: {
      industry: derivedValues.industry ?? null,
      group_insurance_status: derivedValues.group_insurance_status ?? "unknown",
      employee_count: derivedValues.employee_count ?? null,
      executive_protection: derivedValues.executive_protection ?? null,
      fire_insurance: derivedValues.fire_insurance ?? null,
      liability: derivedValues.liability ?? null,
      unknowns,
    },
  };
}

/** Loader orchestrator — existing memory loaders + pure builder. */
export async function loadCorporateSnapshot(supabase, entityId, options = {}) {
  if (!entityId) throw new Error("entity_id_required");

  const entityRecord = options.entityRecord ?? (await loadCorporateEntityRecord(supabase, entityId));
  if (!entityRecord) throw new Error("corporate_entity_not_found");

  const memorySnapshot = await loadCorporateMemorySnapshot(supabase, entityId, {
    ...options,
    entityRecord,
  });

  return buildCorporateSnapshot({ entityRecord, memorySnapshot });
}
