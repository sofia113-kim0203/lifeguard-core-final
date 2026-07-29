/**
 * Policy Date Foundation — KEY-owned renewal/maturity/effective dates.
 * Storage: profile_health.details_json.key_policy_date_facts (no fake policy rows).
 * Never invent dates from insurance_period prose or “N년 갱신형”.
 */

export const KEY_POLICY_DATE_FACT_PATH = "key_policy_date_facts";

export const POLICY_DATE_FACT_KEYS = Object.freeze([
  "policy.renewal_date",
  "policy.maturity_date",
  "policy.effective_from",
  // Premium / Lapse Slice — explicit calendar dates only (never invent / never alias renewal·maturity).
  "policy.premium_due_date",
  "policy.lapse_scheduled_date",
  "policy.reinstate_by_date",
]);

/** Aliases accepted when reading legacy key_confirmed rows. */
export const POLICY_DATE_FACT_ALIASES = Object.freeze({
  renewal_date: "policy.renewal_date",
  "policy.renewal_date": "policy.renewal_date",
  maturity_date: "policy.maturity_date",
  "policy.maturity_date": "policy.maturity_date",
  effective_from: "policy.effective_from",
  "policy.effective_from": "policy.effective_from",
  premium_due_date: "policy.premium_due_date",
  "policy.premium_due_date": "policy.premium_due_date",
  lapse_scheduled_date: "policy.lapse_scheduled_date",
  "policy.lapse_scheduled_date": "policy.lapse_scheduled_date",
  reinstate_by_date: "policy.reinstate_by_date",
  "policy.reinstate_by_date": "policy.reinstate_by_date",
});

export const POLICY_DATE_SOURCES = Object.freeze([
  "document_evidence",
  "customer_statement",
  "key_confirmed",
]);

export const POLICY_DATE_VERIFICATION = Object.freeze([
  "verified",
  "customer_stated",
  "key_confirmed",
]);

const FACT_KEY_SET = new Set(POLICY_DATE_FACT_KEYS);
const SOURCE_SET = new Set(POLICY_DATE_SOURCES);
const VERIFY_SET = new Set(POLICY_DATE_VERIFICATION);

function trim(v) {
  if (v == null) return null;
  const s = String(v).trim();
  return s ? s : null;
}

function stampNow(now = new Date()) {
  const d = now instanceof Date ? now : new Date(now);
  return Number.isFinite(d.getTime()) ? d.toISOString() : new Date().toISOString();
}

function ymdLocal(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Parse explicit calendar date only — never period prose. */
export function parsePolicyDateLiteral(raw) {
  const s = trim(raw);
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const d = new Date(`${s}T12:00:00`);
    return Number.isFinite(d.getTime()) ? ymdLocal(d) : null;
  }
  const md = s.match(/(\d{4})\s*[./년-]\s*(\d{1,2})\s*[./월-]\s*(\d{1,2})\s*일?/);
  if (md) {
    const dt = new Date(Number(md[1]), Number(md[2]) - 1, Number(md[3]), 12, 0, 0);
    return Number.isFinite(dt.getTime()) ? ymdLocal(dt) : null;
  }
  const md2 = s.match(/(\d{1,2})\s*월\s*(\d{1,2})\s*일/);
  if (md2) {
    // Month-day without year is ambiguous — reject (no invent year).
    return null;
  }
  return null;
}

export function canonicalizePolicyDateFactKey(raw = "") {
  const t = String(raw ?? "").trim().toLowerCase();
  return POLICY_DATE_FACT_ALIASES[t] || null;
}

export function policyDateFactDedupeKey(row = {}) {
  const key = trim(row.fact_key) || "unknown";
  const entity = trim(row.entity_id) || "personal";
  const subject = trim(row.subject_id) || "none";
  return `${key}:${entity}:${subject}`;
}

export function normalizePolicyDateFacts(raw = [], { now = new Date() } = {}) {
  const rows = Array.isArray(raw) ? raw : [];
  const out = [];
  const seen = new Set();
  const nowIso = stampNow(now);
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const fact_key =
      canonicalizePolicyDateFactKey(row.fact_key) ||
      canonicalizePolicyDateFactKey(row.fact_type);
    if (!fact_key || !FACT_KEY_SET.has(fact_key)) continue;
    const date_value =
      parsePolicyDateLiteral(row.date_value) ||
      parsePolicyDateLiteral(row.fact_value) ||
      parsePolicyDateLiteral(row.literal_value);
    if (!date_value) continue;
    const source = trim(row.source);
    if (!source || !SOURCE_SET.has(source)) continue;
    const subject_id = trim(row.subject_id) || trim(row.document_id) || trim(row.evidence_id);
    if (!subject_id) continue;
    const subject_type = trim(row.subject_type) || (trim(row.document_id) ? "document" : "policy");
    let verification_status = trim(row.verification_status)?.toLowerCase();
    if (!verification_status || !VERIFY_SET.has(verification_status)) {
      verification_status =
        source === "customer_statement"
          ? "customer_stated"
          : source === "key_confirmed"
            ? "key_confirmed"
            : "verified";
    }
    const entity_id = trim(row.entity_id);
    const document_id = trim(row.document_id) || trim(row.evidence_id);
    const evidence_id = trim(row.evidence_id) || document_id;
    const id =
      trim(row.id) ||
      `pdfact_${fact_key.replace(/\./g, "_")}_${entity_id || "personal"}_${subject_id}`.slice(
        0,
        120,
      );
    const dedupe = policyDateFactDedupeKey({ fact_key, entity_id, subject_id });
    if (seen.has(dedupe)) continue;
    seen.add(dedupe);
    out.push({
      id,
      customer_id: trim(row.customer_id),
      entity_id,
      subject_type,
      subject_id,
      fact_key,
      fact_type: fact_key,
      fact_value: date_value,
      date_value,
      literal_value: date_value,
      source,
      source_message_id: trim(row.source_message_id),
      evidence_id,
      document_id,
      verification_status,
      observed_at: trim(row.observed_at) || nowIso,
      updated_at: trim(row.updated_at) || nowIso,
      qa_fixture: row.qa_fixture === true,
      not_real_customer: row.not_real_customer === true,
    });
  }
  return out;
}

export function mergePolicyDateFacts(existing = [], incoming = [], { now = new Date() } = {}) {
  const map = new Map();
  for (const row of [
    ...normalizePolicyDateFacts(existing, { now }),
    ...normalizePolicyDateFacts(incoming, { now }),
  ]) {
    const key = policyDateFactDedupeKey(row);
    const prior = map.get(key);
    if (!prior) {
      map.set(key, row);
      continue;
    }
    map.set(key, {
      ...prior,
      ...row,
      observed_at: prior.observed_at || row.observed_at,
      updated_at: stampNow(now),
    });
  }
  return [...map.values()];
}

export async function loadPolicyDateFacts({ supabase = null, customerId = null } = {}) {
  if (!supabase || !customerId) return [];
  const { data, error } = await supabase
    .from("profile_health")
    .select("details_json")
    .eq("customer_id", customerId)
    .maybeSingle();
  if (error || !data) return [];
  const details =
    data.details_json && typeof data.details_json === "object" ? data.details_json : {};
  return normalizePolicyDateFacts(details[KEY_POLICY_DATE_FACT_PATH]);
}

export async function persistPolicyDateFacts({
  supabase = null,
  customerId = null,
  factUpdates = [],
} = {}) {
  const incoming = normalizePolicyDateFacts(factUpdates);
  if (!supabase || !customerId || incoming.length === 0) {
    return {
      ok: false,
      attempted: Boolean(supabase && customerId && Array.isArray(factUpdates) && factUpdates.length),
      stored: 0,
      reason: !supabase ? "no_supabase" : !customerId ? "no_customer_id" : "no_updates",
    };
  }
  const { data: row, error: selectError } = await supabase
    .from("profile_health")
    .select("customer_id, details_json")
    .eq("customer_id", customerId)
    .maybeSingle();
  if (selectError) {
    return { ok: false, attempted: true, stored: 0, error: selectError.message };
  }
  const existingDetails =
    row?.details_json && typeof row.details_json === "object" ? row.details_json : {};
  const stamped = incoming.map((r) => ({ ...r, customer_id: customerId }));
  const merged = mergePolicyDateFacts(
    existingDetails[KEY_POLICY_DATE_FACT_PATH],
    stamped,
  );
  const nextDetails = {
    ...existingDetails,
    [KEY_POLICY_DATE_FACT_PATH]: merged,
  };
  if (!row?.customer_id) {
    const { error: insertError } = await supabase.from("profile_health").insert({
      customer_id: customerId,
      details_json: nextDetails,
      updated_at: new Date().toISOString(),
    });
    if (insertError) {
      return { ok: false, attempted: true, stored: 0, error: insertError.message };
    }
    return { ok: true, attempted: true, stored: stamped.length, fact_count: merged.length };
  }
  const { error: updateError } = await supabase
    .from("profile_health")
    .update({
      details_json: nextDetails,
      updated_at: new Date().toISOString(),
    })
    .eq("customer_id", customerId);
  if (updateError) {
    return { ok: false, attempted: true, stored: 0, error: updateError.message };
  }
  return { ok: true, attempted: true, stored: stamped.length, fact_count: merged.length };
}

/**
 * Lift date facts from key_confirmed_source_facts on policy coverage_summary (read-only lift).
 * Does not invent; only canonical policy.* keys / aliases with parseable dates.
 */
export function extractPolicyDateFactsFromConfirmed({
  policies = [],
  customerId = null,
  now = new Date(),
} = {}) {
  const out = [];
  for (const p of Array.isArray(policies) ? policies : []) {
    const pid = trim(p?.id) || trim(p?.policy_id);
    const facts = Array.isArray(p?.coverage_summary?.key_confirmed_source_facts)
      ? p.coverage_summary.key_confirmed_source_facts
      : Array.isArray(p?.key_confirmed_source_facts)
        ? p.key_confirmed_source_facts
        : [];
    for (const f of facts) {
      const fact_key = canonicalizePolicyDateFactKey(f?.fact_type || f?.fact_key);
      if (!fact_key) continue;
      const date_value = parsePolicyDateLiteral(f?.literal_value || f?.date_value || f?.fact_value);
      if (!date_value) continue;
      const document_id = trim(f?.source_document_id) || trim(f?.document_id);
      out.push({
        customer_id: trim(customerId),
        entity_id: trim(p?.entity_id),
        subject_type: document_id ? "document" : "policy",
        subject_id: document_id || pid || "confirmed",
        fact_key,
        date_value,
        fact_value: date_value,
        source: "key_confirmed",
        evidence_id: document_id,
        document_id,
        verification_status: "key_confirmed",
        observed_at: trim(f?.confirmed_at) || stampNow(now),
      });
    }
  }
  return normalizePolicyDateFacts(out, { now });
}

/**
 * Customer explicit date statements for renewal/maturity/effective — never period prose.
 */
export function buildPolicyDateFactsFromUtterance({
  question = "",
  customerId = null,
  entityId = null,
  messageId = null,
  now = new Date(),
} = {}) {
  const text = String(question ?? "").trim();
  if (!text) return { ok: false, reason: "empty", updates: [] };

  // Reject period-only / 갱신형 prose (no calendar date invent).
  if (/갱신형|보험기간|납입기간|보장기간/.test(text) && !/\d{4}/.test(text) && !/\d{1,2}\s*월\s*\d{1,2}\s*일/.test(text)) {
    return { ok: false, reason: "period_prose_no_calendar_date", updates: [] };
  }

  let fact_key = null;
  // Order: specific premium/lapse/reinstate before broad 갱신/만기 (no alias across types).
  if (/납입\s*기한|보험료\s*납입\s*일|보험료\s*납입\s*기한|납입\s*마감/.test(text)) {
    fact_key = "policy.premium_due_date";
  } else if (/실효\s*예정|실효\s*일|실효\s*예정일/.test(text)) {
    fact_key = "policy.lapse_scheduled_date";
  } else if (/부활\s*가능|부활\s*기한|부활\s*마감|부활할\s*수\s*있는/.test(text)) {
    fact_key = "policy.reinstate_by_date";
  } else if (/갱신\s*일|갱신\s*기준|계약\s*갱신/.test(text)) {
    fact_key = "policy.renewal_date";
  } else if (/만기\s*일|계약\s*만기|만기\s*는/.test(text)) {
    fact_key = "policy.maturity_date";
  } else if (/가입\s*일|보장\s*개시|계약\s*시작|개시\s*일/.test(text)) {
    fact_key = "policy.effective_from";
  }
  if (!fact_key) return { ok: false, reason: "not_policy_date_utterance", updates: [] };

  const date_value =
    parsePolicyDateLiteral(text) ||
    (() => {
      const m = text.match(/(\d{4})\s*년\s*(\d{1,2})\s*월\s*(\d{1,2})\s*일/);
      if (!m) return null;
      return parsePolicyDateLiteral(`${m[1]}-${m[2]}-${m[3]}`);
    })();
  if (!date_value) {
    return { ok: false, reason: "no_explicit_calendar_date", updates: [] };
  }

  const subject_id = `utterance:${trim(messageId) || date_value}:${fact_key}`;
  return {
    ok: true,
    reason: "customer_stated_policy_date",
    updates: [
      {
        customer_id: trim(customerId),
        entity_id: trim(entityId),
        subject_type: "customer_statement",
        subject_id,
        fact_key,
        date_value,
        fact_value: date_value,
        source: "customer_statement",
        source_message_id: trim(messageId),
        evidence_id: null,
        document_id: null,
        verification_status: "customer_stated",
        observed_at: stampNow(now),
        updated_at: stampNow(now),
      },
    ],
  };
}

/**
 * Verified document evidence → policy date fact (explicit date already known to KEY).
 * Caller must supply date from document original — never compute.
 */
export function buildPolicyDateFactFromDocumentEvidence({
  customerId = null,
  entityId = null,
  documentId = null,
  factKey = null,
  dateValue = null,
  qaFixture = false,
  now = new Date(),
} = {}) {
  const fact_key = canonicalizePolicyDateFactKey(factKey);
  const date_value = parsePolicyDateLiteral(dateValue);
  const document_id = trim(documentId);
  if (!fact_key || !date_value || !document_id) {
    return { ok: false, reason: "missing_verified_inputs", updates: [] };
  }
  return {
    ok: true,
    reason: "document_evidence_policy_date",
    updates: [
      {
        customer_id: trim(customerId),
        entity_id: trim(entityId),
        subject_type: "document",
        subject_id: document_id,
        fact_key,
        date_value,
        fact_value: date_value,
        source: "document_evidence",
        evidence_id: document_id,
        document_id,
        verification_status: "verified",
        qa_fixture: qaFixture === true,
        not_real_customer: qaFixture === true,
        observed_at: stampNow(now),
        updated_at: stampNow(now),
      },
    ],
  };
}

/**
 * Clock rows from policy date facts only — 1:1 fact_key↔clock_type.
 * Never uses effective_from / end_date / renewal / maturity as substitutes for
 * premium_due · lapse_scheduled · reinstate_by (or each other).
 */
export function buildInsuranceClocksFromPolicyDateFacts({
  facts = [],
  customerId = null,
  now = new Date(),
} = {}) {
  const rows = normalizePolicyDateFacts(facts, { now });
  const out = [];
  const map = [
    {
      fact_key: "policy.renewal_date",
      clock_type: "policy_renewal",
      idPrefix: "clk_renewal",
      label: (d) => `계약 갱신 확인일 (${d})`,
      note: "from_policy_date_fact_renewal",
    },
    {
      fact_key: "policy.maturity_date",
      clock_type: "policy_maturity",
      idPrefix: "clk_maturity",
      label: (d) => `계약 만기 확인일 (${d})`,
      note: "from_policy_date_fact_maturity",
    },
    {
      fact_key: "policy.premium_due_date",
      clock_type: "premium_due",
      idPrefix: "clk_premium_due",
      label: (d) => `보험료 납입기한 (${d})`,
      note: "from_policy_date_fact_premium_due",
    },
    {
      fact_key: "policy.lapse_scheduled_date",
      clock_type: "lapse_scheduled",
      idPrefix: "clk_lapse",
      label: (d) => `실효 예정일 (${d})`,
      note: "from_policy_date_fact_lapse_scheduled",
    },
    {
      fact_key: "policy.reinstate_by_date",
      clock_type: "reinstate_by",
      idPrefix: "clk_reinstate",
      label: (d) => `부활 가능 기한 (${d})`,
      note: "from_policy_date_fact_reinstate_by",
    },
  ];
  for (const f of rows) {
    const rule = map.find((m) => m.fact_key === f.fact_key);
    if (!rule) continue; // effective_from and unknown keys → no clock
    out.push({
      id: `${rule.idPrefix}_${f.subject_id}`.slice(0, 120),
      customer_id: trim(customerId) || f.customer_id,
      entity_id: f.entity_id,
      clock_type: rule.clock_type,
      subject_type: f.subject_type,
      subject_id: f.subject_id,
      due_at: f.date_value,
      next_check_at: f.date_value,
      status: "active",
      source: f.source === "customer_statement" ? "customer_statement" : "document_evidence",
      source_message_id: f.source_message_id,
      evidence_id: f.evidence_id || f.document_id,
      label: rule.label(f.date_value),
      note: rule.note,
      created_at: stampNow(now),
      updated_at: stampNow(now),
    });
  }
  return out;
}
