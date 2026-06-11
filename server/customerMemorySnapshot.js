export const DEFAULT_MEMORY_FACT_LIMIT = 20;
export const DEFAULT_MEMORY_SNAPSHOT_MAX_CHARS = 2800;

const IMPORTANCE_PRIORITY = { critical: 0, high: 1, medium: 2, low: 3 };
const FACT_TYPE_PRIORITY = { health: 0, insurance: 1, preference: 2, risk: 3, family: 4, identity: 5 };

const MEMORY_RELEVANCE_KEYWORDS = {
  health: ["건강", "병력", "복용", "약", "입원", "수술", "흡연", "고지", "치료", "질병", "가족력"],
  insurance: ["보험", "실손", "보장", "담보", "특약", "계약", "증권", "청구", "보험금", "가입", "암"],
  preference: ["예산", "목표", "선호", "가입", "변경", "해지"],
  family: ["가족", "배우자", "자녀", "부모"],
  identity: ["나이", "연령", "성별", "직업", "프로필", "고객", "이름"],
};

function priorityValue(map, key, fallback) {
  const normalized = String(key ?? "").toLowerCase();
  return Object.hasOwn(map, normalized) ? map[normalized] : fallback;
}

function compareMemoryFacts(left, right) {
  const importance =
    priorityValue(IMPORTANCE_PRIORITY, left.importance, 99) -
    priorityValue(IMPORTANCE_PRIORITY, right.importance, 99);
  if (importance !== 0) return importance;

  const type =
    priorityValue(FACT_TYPE_PRIORITY, left.fact_type, 99) -
    priorityValue(FACT_TYPE_PRIORITY, right.fact_type, 99);
  if (type !== 0) return type;

  return String(right.updated_at ?? "").localeCompare(String(left.updated_at ?? ""));
}

function normalizeFactType(factType) {
  const value = String(factType ?? "").trim();
  return value || "unknown";
}

function normalizeImportance(importance) {
  const value = String(importance ?? "").trim();
  return value || "low";
}

function sanitizeFactValue(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, 240);
}

function questionTokens(question) {
  return String(question ?? "").toLowerCase().match(/[\uAC00-\uD7A3]{2,}|[a-z0-9]{2,}/g) ?? [];
}

export function memoryFactIsRelevant(question, fact) {
  const haystack = [fact.fact_key, fact.fact_type, fact.fact_value]
    .map((value) => String(value ?? "").toLowerCase())
    .join(" ");
  const tokens = questionTokens(question);
  if (tokens.some((token) => haystack.includes(token))) return true;

  const type = normalizeFactType(fact.fact_type);
  const keywords = MEMORY_RELEVANCE_KEYWORDS[type] ?? [];
  const normalizedQuestion = String(question ?? "");
  return keywords.some((keyword) => normalizedQuestion.includes(keyword));
}

export function selectRelevantMemoryFacts(question, facts) {
  const relevant = (facts ?? []).filter((fact) => memoryFactIsRelevant(question, fact));
  if (relevant.length > 0) return relevant;
  return (facts ?? []).slice(0, 8);
}

export function formatCustomerMemorySnapshotForPrompt(
  facts,
  { maxChars = DEFAULT_MEMORY_SNAPSHOT_MAX_CHARS } = {},
) {
  if (!facts?.length) {
    return "(no active customer memory facts retrieved)";
  }

  const lines = [];
  let usedChars = 0;
  for (const [index, fact] of facts.entries()) {
    const line = `[M${index + 1}] type=${normalizeFactType(fact.fact_type)} key=${fact.fact_key} importance=${normalizeImportance(fact.importance)} value=${sanitizeFactValue(fact.fact_value)}`;
    if (usedChars + line.length > maxChars) break;
    lines.push(line);
    usedChars += line.length + 1;
  }

  return lines.length ? lines.join("\n") : "(customer memory facts omitted due to prompt size limit)";
}

export function mapMemoryFactsForResponse(facts) {
  return (facts ?? []).map((fact) => ({
    fact_key: fact.fact_key,
    fact_type: normalizeFactType(fact.fact_type),
    importance: normalizeImportance(fact.importance),
    fact_value: sanitizeFactValue(fact.fact_value),
  }));
}

export async function loadCustomerMemorySnapshot(
  supabase,
  customerId,
  { limit = DEFAULT_MEMORY_FACT_LIMIT, maxChars = DEFAULT_MEMORY_SNAPSHOT_MAX_CHARS } = {},
) {
  if (!customerId) throw new Error("customer_id_required");

  const { data: profile, error: profileError } = await supabase
    .from("customer_profiles")
    .select("id, display_name, birth_date, gender, job_category, marital_status, family_composition, insurance_goal, monthly_insurance_budget, memory_version")
    .eq("id", customerId)
    .is("deleted_at", null)
    .maybeSingle();
  if (profileError) throw new Error(`profile_lookup_failed: ${profileError.message}`);

  const [countResult, factsResult] = await Promise.all([
    supabase
      .from("customer_memory_facts")
      .select("id", { count: "exact", head: true })
      .eq("customer_id", customerId),
    supabase
      .from("customer_memory_facts")
      .select("id, fact_key, fact_value, fact_type, importance, updated_at, metadata_json, source_table")
      .eq("customer_id", customerId)
      .is("superseded_at", null),
  ]);

  if (countResult.error) throw new Error(`memory_count_failed: ${countResult.error.message}`);
  if (factsResult.error) throw new Error(`memory_snapshot_failed: ${factsResult.error.message}`);

  const facts = (Array.isArray(factsResult.data) ? factsResult.data : [])
    .filter((fact) => !fact?.metadata_json?.revoked_at)
    .filter((fact) => fact.fact_type !== "system")
    .sort(compareMemoryFacts)
    .slice(0, limit);

  return {
    customer_id: customerId,
    memory_version: profile?.memory_version ?? 0,
    profile: profile ?? null,
    facts,
    fact_count: countResult.count ?? 0,
    snapshot_facts_count: facts.length,
    prompt_block: formatCustomerMemorySnapshotForPrompt(facts, { maxChars }),
  };
}

export function buildStructuredMemoryProfile(snapshot) {
  const profile = snapshot?.profile ?? {};
  const facts = snapshot?.facts ?? [];
  const byType = facts.reduce((acc, fact) => {
    const type = normalizeFactType(fact.fact_type);
    acc[type] = acc[type] ?? [];
    acc[type].push(fact);
    return acc;
  }, {});

  return {
    customer_id: snapshot?.customer_id ?? null,
    memory_version: snapshot?.memory_version ?? 0,
    profile: {
      name: profile.display_name ?? null,
      birth_date: profile.birth_date ?? null,
      gender: profile.gender ?? null,
      occupation: profile.job_category ?? null,
      marital_status: profile.marital_status ?? null,
      family_composition: profile.family_composition ?? null,
      insurance_goal: profile.insurance_goal ?? null,
      monthly_budget: profile.monthly_insurance_budget ?? null,
    },
    insurance_memory: (byType.insurance ?? []).map((fact) => ({
      fact_key: fact.fact_key,
      value: fact.fact_value,
    })),
    health_memory: (byType.health ?? []).map((fact) => ({
      fact_key: fact.fact_key,
      value: fact.fact_value,
    })),
    conversation_memory: [...(byType.preference ?? []), ...(byType.risk ?? [])].map((fact) => ({
      fact_key: fact.fact_key,
      value: fact.fact_value,
    })),
    fact_count: snapshot?.snapshot_facts_count ?? facts.length,
    total_fact_count: snapshot?.fact_count ?? facts.length,
  };
}
