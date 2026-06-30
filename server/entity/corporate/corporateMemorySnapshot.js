/**
 * Corporate Memory namespace — parallel to loadCustomerMemorySnapshot (Core untouched).
 * Entity Memory → Corporate Memory facts on entity_memory_facts.
 */
import { assertCorporateEntity } from "../entityGuard.js";
import { ENTITY_TYPES } from "../entityTypes.js";

const DEFAULT_MEMORY_FACT_LIMIT = 20;
const DEFAULT_MEMORY_SNAPSHOT_MAX_CHARS = 2800;

const IMPORTANCE_PRIORITY = { critical: 0, high: 1, medium: 2, low: 3 };

function compareMemoryFacts(left, right) {
  const leftRank = IMPORTANCE_PRIORITY[String(left.importance ?? "low").toLowerCase()] ?? 99;
  const rightRank = IMPORTANCE_PRIORITY[String(right.importance ?? "low").toLowerCase()] ?? 99;
  if (leftRank !== rightRank) return leftRank - rightRank;
  return String(right.updated_at ?? "").localeCompare(String(left.updated_at ?? ""));
}

function sanitizeFactValue(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, 240);
}

function formatCorporateMemorySnapshotForPrompt(facts, { maxChars = DEFAULT_MEMORY_SNAPSHOT_MAX_CHARS } = {}) {
  if (!facts?.length) {
    return "(no active corporate entity memory facts retrieved)";
  }
  const lines = [];
  let usedChars = 0;
  for (const [index, fact] of facts.entries()) {
    const line = `[C${index + 1}] type=${fact.fact_type ?? "corporate"} key=${fact.fact_key} importance=${fact.importance ?? "low"} value=${sanitizeFactValue(fact.fact_value)}`;
    if (usedChars + line.length > maxChars) break;
    lines.push(line);
    usedChars += line.length + 1;
  }
  return lines.length ? lines.join("\n") : "(corporate memory facts omitted due to prompt size limit)";
}

export async function loadCorporateEntityRecord(supabase, entityId) {
  if (!entityId) throw new Error("entity_id_required");
  const { data, error } = await supabase
    .from("entities")
    .select("id, entity_type, entity_status, entity_scope, display_name, metadata_json, memory_version")
    .eq("id", entityId)
    .maybeSingle();
  if (error) throw new Error(`entity_lookup_failed: ${error.message}`);
  if (!data) return null;
  const guard = assertCorporateEntity({
    entity_id: data.id,
    entity_type: data.entity_type,
    entity_status: data.entity_status,
    entity_scope: data.entity_scope,
    display_name: data.display_name,
    memory_version: data.memory_version,
    metadata_json: data.metadata_json,
  });
  if (!guard.ok) {
    throw new Error(guard.reason ?? "corporate_entity_invalid");
  }
  return data;
}

export async function loadCorporateMemorySnapshot(
  supabase,
  entityId,
  { limit = DEFAULT_MEMORY_FACT_LIMIT, maxChars = DEFAULT_MEMORY_SNAPSHOT_MAX_CHARS, entityRecord = null } = {},
) {
  if (!entityId) throw new Error("entity_id_required");

  const entity = entityRecord ?? (await loadCorporateEntityRecord(supabase, entityId));
  if (!entity) throw new Error("corporate_entity_not_found");

  const [countResult, factsResult] = await Promise.all([
    supabase
      .from("entity_memory_facts")
      .select("id", { count: "exact", head: true })
      .eq("entity_id", entityId)
      .eq("entity_type", ENTITY_TYPES.CORPORATE),
    supabase
      .from("entity_memory_facts")
      .select(
        "id, fact_key, fact_value, fact_type, importance, updated_at, metadata_json, source_table, entity_type",
      )
      .eq("entity_id", entityId)
      .eq("entity_type", ENTITY_TYPES.CORPORATE)
      .is("superseded_at", null),
  ]);

  if (countResult.error) throw new Error(`corporate_memory_count_failed: ${countResult.error.message}`);
  if (factsResult.error) throw new Error(`corporate_memory_snapshot_failed: ${factsResult.error.message}`);

  const facts = (Array.isArray(factsResult.data) ? factsResult.data : [])
    .filter((fact) => !fact?.metadata_json?.revoked_at)
    .filter((fact) => fact.fact_type !== "system")
    .sort(compareMemoryFacts)
    .slice(0, limit);

  return {
    entity_id: entityId,
    entity_type: ENTITY_TYPES.CORPORATE,
    entity_status: entity.entity_status,
    entity_scope: entity.entity_scope,
    display_name: entity.display_name ?? null,
    metadata_json: entity.metadata_json ?? {},
    memory_version: entity.memory_version ?? 0,
    facts,
    fact_count: countResult.count ?? 0,
    snapshot_facts_count: facts.length,
    memory_namespace: "entity_memory_facts",
    prompt_block: formatCorporateMemorySnapshotForPrompt(facts, { maxChars }),
  };
}
