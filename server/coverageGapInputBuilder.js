/**
 * Phase 26 Step 1B — Build Coverage Gap Engine input from Customer Memory.
 */

function normalizeText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function computeAgeBand(birthDate) {
  if (!birthDate) return null;
  const birth = new Date(birthDate);
  if (Number.isNaN(birth.getTime())) return null;
  const age = Math.floor((Date.now() - birth.getTime()) / (365.25 * 24 * 60 * 60 * 1000));
  if (age < 30) return "20s";
  if (age < 40) return "30s";
  if (age < 50) return "40s";
  if (age < 60) return "50s";
  return "60plus";
}

function parseMonthlyBudget(profile, facts) {
  if (profile?.monthly_insurance_budget != null) {
    return Number(profile.monthly_insurance_budget);
  }
  for (const fact of facts ?? []) {
    const text = `${fact.fact_key ?? ""} ${fact.fact_value ?? ""}`;
    if (!/budget|예산|보험료|월/.test(text)) continue;
    const match = text.match(/(\d{1,3})\s*만?\s*원?/);
    if (match) return Number(match[1]) * 10000;
  }
  return null;
}

function policyStatusLabel(policy) {
  if (policy?.is_active === false) return "해지";
  if (policy?.policy_status) return normalizeText(policy.policy_status);
  return "유지";
}

function buildPolicyFact(policy) {
  const insurer = normalizeText(policy.insurer_name);
  const product = normalizeText(policy.product_name);
  const type = normalizeText(policy.policy_type);
  const premium = policy.monthly_premium ?? policy.premium_amount;
  const riders = Array.isArray(policy.coverage_summary?.riders)
    ? policy.coverage_summary.riders.join(",")
    : normalizeText(policy.coverage_summary?.riders ?? "");
  const status = policyStatusLabel(policy);

  return {
    fact_key: `insurance.policy.${policy.id}.coverage_input`,
    fact_value: `${insurer}/${product}(${type || "general"}) 보험료:${premium ?? "미기록"} 특약:${riders || "미기록"} 상태:${status}`,
    fact_type: "insurance",
    importance: "high",
    source_table: "profile_insurance_policies",
    provenance_ref: policy.id,
  };
}

function buildHealthFacts(health) {
  if (!health) return [];
  const details = health.details_json ?? {};
  const facts = [];

  const push = (key, value, importance = "high") => {
    const text = normalizeText(value);
    if (!text) return;
    facts.push({
      fact_key: key,
      fact_value: text,
      fact_type: "health",
      importance,
      source_table: "profile_health",
    });
  };

  push("health.condition.summary", details.conditions ?? details.medical_history);
  push("health.medication.summary", details.medications ?? details.medication);
  push("health.surgery_5y.flag", details.surgery_history ?? details.surgery_5y);
  push("health.hospital_5y.flag", details.hospitalization_history ?? details.hospital_5y);
  push("health.disclosure.summary", details.insurance_disclosure ?? details.disclosure);

  return facts;
}

function buildProfileFacts(profile) {
  if (!profile) return [];
  const facts = [];
  const push = (key, value, factType = "identity", importance = "medium") => {
    const text = normalizeText(value);
    if (!text) return;
    facts.push({ fact_key: key, fact_value: text, fact_type: factType, importance });
  };

  push("profile.name", profile.display_name);
  push("profile.age_band", computeAgeBand(profile.birth_date) ?? profile.birth_date);
  push("profile.gender", profile.gender);
  push("profile.occupation", profile.job_category);
  push("profile.marital_status", profile.marital_status);
  push("profile.family_composition", profile.family_composition, "family", "high");
  push("preference.insurance_goal", profile.insurance_goal, "preference", "high");
  if (profile.monthly_insurance_budget != null) {
    push(
      "preference.monthly_budget",
      `${profile.monthly_insurance_budget}원`,
      "preference",
      "high",
    );
  }

  return facts;
}

function dedupeFacts(facts) {
  const seen = new Set();
  return facts.filter((fact) => {
    const key = `${fact.fact_key}::${fact.fact_value}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function buildCoverageGapInputFromMemory({
  snapshot,
  policies = [],
  health = null,
} = {}) {
  const profile = snapshot?.profile ?? {};
  const memoryFacts = Array.isArray(snapshot?.facts) ? snapshot.facts : [];

  const profileFacts = buildProfileFacts(profile);
  const healthFacts = buildHealthFacts(health);
  const policyFacts = (policies ?? []).map(buildPolicyFact);
  const enrichedFacts = dedupeFacts([...memoryFacts, ...profileFacts, ...healthFacts, ...policyFacts]);

  const insuranceHoldings = (policies ?? []).map((policy) => ({
    policy_id: policy.id,
    insurer_name: policy.insurer_name ?? null,
    product_name: policy.product_name ?? null,
    policy_type: policy.policy_type ?? null,
    monthly_premium: policy.monthly_premium ?? policy.premium_amount ?? null,
    riders: policy.coverage_summary?.riders ?? null,
    status: policyStatusLabel(policy),
    effective_from: policy.effective_from ?? policy.contract_date ?? null,
    is_active: policy.is_active !== false,
  }));

  return {
    customer_id: snapshot?.customer_id ?? null,
    memory_version: snapshot?.memory_version ?? 0,
    customer_profile: {
      age_band: computeAgeBand(profile.birth_date),
      birth_date: profile.birth_date ?? null,
      gender: profile.gender ?? null,
      family_composition: profile.family_composition ?? null,
      occupation: profile.job_category ?? null,
      insurance_goal: profile.insurance_goal ?? null,
      monthly_budget: parseMonthlyBudget(profile, memoryFacts),
      marital_status: profile.marital_status ?? null,
    },
    insurance_holdings: insuranceHoldings,
    health_profile: {
      conditions: health?.details_json?.conditions ?? health?.details_json?.medical_history ?? null,
      medications: health?.details_json?.medications ?? health?.details_json?.medication ?? null,
      surgery_history: health?.details_json?.surgery_history ?? null,
      hospitalization_history: health?.details_json?.hospitalization_history ?? null,
      disclosures: health?.details_json?.insurance_disclosure ?? null,
      source: health?.source ?? null,
    },
    memory_facts: enrichedFacts,
    memory_sources_used: [
      { source: "customer_memory_facts", count: memoryFacts.length },
      { source: "customer_profiles", count: profileFacts.length },
      { source: "profile_insurance_policies", count: policyFacts.length },
      { source: "profile_health", count: healthFacts.length },
    ].filter((entry) => entry.count > 0),
  };
}
