/**
 * Life Ledger — Slice 1 + Continuity Slice.
 * Storage: profile_health.details_json.key_life_ledger_items
 * Soft reference only — never answer template / forced recommend / second Claude.
 * Customer-stated items only. No Claude inference as ledger fact.
 */

export const KEY_LIFE_LEDGER_FACT_PATH = "key_life_ledger_items";

export const LEDGER_TYPES = Object.freeze([
  "goal",
  "preference",
  "decision",
  "open_question",
  "outcome",
  "life_thread",
]);

export const LEDGER_STATUSES = Object.freeze([
  "active",
  "resolved",
  "cancelled",
  "completed",
]);

export const LEDGER_SOURCES = Object.freeze([
  "customer_statement",
  "claim_guardian",
  "confirmed_system_record",
]);

const TYPE_SET = new Set(LEDGER_TYPES);
const STATUS_SET = new Set(LEDGER_STATUSES);
const SOURCE_SET = new Set(LEDGER_SOURCES);
const CUSTOMER_ONLY_TYPES = new Set([
  "goal",
  "preference",
  "decision",
  "open_question",
  "life_thread",
]);
const TERMINAL = new Set(["resolved", "completed", "cancelled"]);

function trim(v, max = 400) {
  if (v == null) return null;
  const s = String(v).trim();
  if (!s) return null;
  return s.slice(0, max);
}

function stampNow(now = new Date()) {
  const d = now instanceof Date ? now : new Date(now);
  return Number.isFinite(d.getTime()) ? d.toISOString() : new Date().toISOString();
}

function sameEntity(a, b) {
  return (trim(a) || null) === (trim(b) || null);
}

/** Claude / KEY inference voice — never promote to customer ledger. */
export function looksLikeInferenceNotCustomerStatement(text = "") {
  const t = String(text ?? "").trim();
  if (!t) return true;
  if (
    /(것\s*같다|생각된다|보여진다|추정|추론|추천드|권해|필요할\s*것|중요하게\s*생각하는\s*것\s*같다|고객은.{0,24}중요)/.test(
      t,
    )
  ) {
    return true;
  }
  if (/^(고객은|사용자가|이\s*고객)/.test(t) && !/나는|저는|우리가/.test(t)) {
    return true;
  }
  return false;
}

export function normalizeLifeLedgerItems(raw = [], { now = new Date() } = {}) {
  const out = [];
  const nowIso = stampNow(now);
  for (const row of Array.isArray(raw) ? raw : []) {
    if (!row || typeof row !== "object") continue;
    const type = trim(row.type) || trim(row.ledger_type);
    if (!TYPE_SET.has(type)) continue;
    let source = trim(row.source) || "customer_statement";
    if (!SOURCE_SET.has(source)) source = "customer_statement";
    if (CUSTOMER_ONLY_TYPES.has(type) && source !== "customer_statement") continue;
    // Customer-confirmed life outcomes must stay customer_statement (claim sync uses claim_guardian).
    if (
      type === "outcome" &&
      source === "customer_statement" &&
      trim(row.metadata_json?.kind) === "advice_or_expectation"
    ) {
      continue;
    }
    let status = trim(row.status) || (type === "outcome" ? "completed" : "active");
    if (!STATUS_SET.has(status)) status = "active";
    const content =
      trim(row.content) ||
      trim(row.decision) ||
      trim(row.question) ||
      trim(row.outcome_type) ||
      null;
    if (!content) continue;
    const id =
      trim(row.id) ||
      `ll_${type}_${trim(row.source_message_id) || content.slice(0, 24)}`.slice(0, 120);
    const metadata_json =
      row.metadata_json && typeof row.metadata_json === "object" ? { ...row.metadata_json } : {};
    out.push({
      id,
      customer_id: trim(row.customer_id),
      entity_id: trim(row.entity_id),
      type,
      content,
      decision: type === "decision" ? content : trim(row.decision),
      reason: trim(row.reason, 240),
      question: type === "open_question" ? content : trim(row.question),
      outcome_type: type === "outcome" ? trim(row.outcome_type) || content : null,
      status,
      source,
      source_message_id: trim(row.source_message_id),
      related_claim_id: trim(row.related_claim_id),
      related_evidence_id: trim(row.related_evidence_id),
      related_id: trim(row.related_id) || trim(row.related_claim_id),
      related_decision_id: trim(row.related_decision_id),
      supersedes_id: trim(row.supersedes_id),
      created_at: trim(row.created_at) || nowIso,
      updated_at: trim(row.updated_at) || nowIso,
      resolved_at: trim(row.resolved_at),
      completed_at: trim(row.completed_at),
      metadata_json,
    });
  }
  return out;
}

function ledgerDedupeKey(row) {
  // Prefer stable id so reason-link / status updates merge onto the same row.
  if (trim(row.id)) return `id:${trim(row.id)}`;
  return [
    trim(row.type),
    trim(row.entity_id) || "personal",
    trim(row.content),
    trim(row.source_message_id) || trim(row.related_id) || "x",
  ].join("|");
}

export function mergeLifeLedgerItems(existing = [], incoming = [], { now = new Date() } = {}) {
  const map = new Map();
  for (const row of [
    ...normalizeLifeLedgerItems(existing, { now }),
    ...normalizeLifeLedgerItems(incoming, { now }),
  ]) {
    const key = ledgerDedupeKey(row);
    const prior = map.get(key);
    if (!prior) {
      map.set(key, row);
      continue;
    }
    // Terminal statuses do not regress to active unless explicit resume update carries resume flag.
    let status = row.status;
    const explicitResume = row.metadata_json?.explicit_resume === true;
    if (TERMINAL.has(prior.status) && status === "active" && !explicitResume) {
      status = prior.status;
    }
    map.set(key, {
      ...prior,
      ...row,
      status,
      // Preserve original wording / capture; reason may fill later.
      content: prior.content || row.content,
      created_at: prior.created_at || row.created_at,
      supersedes_id: row.supersedes_id || prior.supersedes_id,
      reason: row.reason || prior.reason,
      resolved_at: row.resolved_at || prior.resolved_at,
      completed_at: row.completed_at || prior.completed_at,
      updated_at: stampNow(now),
      metadata_json: { ...(prior.metadata_json || {}), ...(row.metadata_json || {}) },
    });
  }
  return [...map.values()];
}

export function filterLifeLedgerByScope(items = [], { entityId = null, mode = "personal" } = {}) {
  const rows = normalizeLifeLedgerItems(items);
  const eid = trim(entityId);
  if (mode === "corporate") {
    if (!eid) return [];
    return rows.filter((r) => trim(r.entity_id) === eid);
  }
  if (mode === "both") {
    return rows.filter((r) => !r.entity_id || (eid && trim(r.entity_id) === eid));
  }
  return rows.filter((r) => !r.entity_id);
}

export async function loadLifeLedgerItems({ supabase = null, customerId = null } = {}) {
  if (!supabase || !customerId) return [];
  const { data, error } = await supabase
    .from("profile_health")
    .select("details_json")
    .eq("customer_id", customerId)
    .maybeSingle();
  if (error || !data) return [];
  const details =
    data.details_json && typeof data.details_json === "object" ? data.details_json : {};
  return normalizeLifeLedgerItems(details[KEY_LIFE_LEDGER_FACT_PATH]);
}

export async function persistLifeLedgerItems({
  supabase = null,
  customerId = null,
  ledgerUpdates = [],
} = {}) {
  const incoming = normalizeLifeLedgerItems(ledgerUpdates);
  if (!supabase || !customerId || incoming.length === 0) {
    return {
      ok: false,
      attempted: Boolean(supabase && customerId && Array.isArray(ledgerUpdates) && ledgerUpdates.length),
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
  const merged = mergeLifeLedgerItems(existingDetails[KEY_LIFE_LEDGER_FACT_PATH], stamped);
  const nextDetails = {
    ...existingDetails,
    [KEY_LIFE_LEDGER_FACT_PATH]: merged,
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
    return { ok: true, attempted: true, stored: stamped.length, item_count: merged.length };
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
  return { ok: true, attempted: true, stored: stamped.length, item_count: merged.length };
}

export function isCustomerGoalUtterance(question = "") {
  const t = String(question ?? "").trim();
  if (!t || looksLikeInferenceNotCustomerStatement(t)) return false;
  if (isCustomerPreferenceUtterance(t) && !/(목표|하고\s*싶어|유지하고\s*싶어)/.test(t)) {
    return false;
  }
  if (!/(나는|저는|우리|난\s)/.test(t) && !/(원해|싶어|중요해|우선|유지하고)/.test(t)) {
    return false;
  }
  return (
    /(보험료|보장|유지|줄이|부담).{0,40}(원해|싶어|중요해|우선|유지하고\s*싶어)/.test(t) ||
    /(줄이는\s*것보다|보다).{0,40}(유지|보장)/.test(t) ||
    /(고액|보험료).{0,40}(보다|보다도).{0,40}(유지|보장)/.test(t) ||
    /(목표는|목표야|목표가)/.test(t)
  );
}

/** Explicit preference — stored separately from goal. */
export function isCustomerPreferenceUtterance(question = "") {
  const t = String(question ?? "").trim();
  if (!t || looksLikeInferenceNotCustomerStatement(t)) return false;
  if (!/(나는|저는|우리|난\s|내\s*선호)/.test(t) && !/(선호|더\s*좋아|싫어)/.test(t)) {
    return false;
  }
  return /(선호|취향|더\s*좋아|싫어|원하지\s*않|편한\s*쪽|쪽을\s*원해|대면보다|전화가\s*편)/.test(
    t,
  );
}

export function isCustomerDecisionUtterance(question = "") {
  const t = String(question ?? "").trim();
  if (!t || looksLikeInferenceNotCustomerStatement(t)) return false;
  return /(하기로\s*(했|결정)|유지하기로|해지하기로|가입하기로|결정했어|결정했어요|결정했습니다)/.test(
    t,
  );
}

export function isOpenQuestionUtterance(question = "") {
  const t = String(question ?? "").trim();
  if (!t || looksLikeInferenceNotCustomerStatement(t)) return false;
  return (
    /(충분한지|모자란지|부족한지|되는지).{0,12}(모르|궁금)/.test(t) ||
    /(모르겠어|잘\s*모르|확인\s*필요|궁금한데).{0,40}(보장|담보|보험)/.test(t) ||
    /(보장|담보).{0,40}(모르겠어|충분한지\s*모르)/.test(t)
  );
}

/** Important life context the customer stated — never inferred. */
export function isLifeThreadUtterance(question = "") {
  const t = String(question ?? "").trim();
  if (!t || looksLikeInferenceNotCustomerStatement(t)) return false;
  if (!/(나는|저는|우리|우리\s*가족|난\s)/.test(t)) return false;
  return /(요즘|생활|가족|이사|직장|육아|간병|이혼|결혼|출산|실직|이직|부모님|아이들).{0,40}/.test(
    t,
  );
}

export function isDecisionReasonOnlyUtterance(question = "") {
  const t = String(question ?? "").trim();
  if (!t || looksLikeInferenceNotCustomerStatement(t)) return false;
  if (isCustomerDecisionUtterance(t)) return false;
  return /^(?:왜냐하면|이유는|때문에)\s*.+/.test(t) || /(?:왜냐하면|이유는)\s*.+/.test(t);
}

export function isLedgerCorrectionUtterance(question = "") {
  const t = String(question ?? "").trim();
  return /(정정하|수정하|아니라)/.test(t);
}

export function isLedgerCloseUtterance(question = "") {
  const t = String(question ?? "").trim();
  return /(종료하|끝냈|해결됐|더\s*이상\s*.{0,12}아니|닫아|종료할게)/.test(t);
}

export function isLedgerCancelUtterance(question = "") {
  const t = String(question ?? "").trim();
  return /(취소하|철회하|안\s*할래|취소할게|없던\s*일로)/.test(t);
}

export function isLedgerResumeUtterance(question = "") {
  const t = String(question ?? "").trim();
  return /(다시\s*진행|재개하|다시\s*열어|다시\s*살려)/.test(t);
}

/** Customer-confirmed life result — not advice / expectation. */
export function isCustomerConfirmedOutcomeUtterance(question = "") {
  const t = String(question ?? "").trim();
  if (!t || looksLikeInferenceNotCustomerStatement(t)) return false;
  if (/(하면\s*좋|추천|예상|것\s*같|권해|하면\s*될)/.test(t)) return false;
  return (
    /(실제로|확정됐|결과가|결과야|결과로).{0,40}(끝|확정|받았|됐|나왔)/.test(t) ||
    /(보험금\s*외|청구\s*말고|생활에서).{0,40}(결과|확정)/.test(t) ||
    /(결과가\s*나왔|결과가\s*확정|실제로\s*.{0,20}(받았|끝냈|확정))/.test(t)
  );
}

function extractDecisionReason(text = "") {
  const m = String(text).match(/(?:왜냐하면|이유는|때문에)\s*(.+)$/);
  return m ? trim(m[1], 200) : null;
}

function latestSameEntity(existing, { type, entityId, statusIn = null } = {}) {
  const rows = existing
    .filter(
      (e) =>
        e.type === type &&
        sameEntity(e.entity_id, entityId) &&
        (!statusIn || statusIn.includes(e.status)),
    )
    .sort((a, b) => String(a.updated_at || a.created_at || "").localeCompare(String(b.updated_at || b.created_at || "")));
  return rows.length ? rows[rows.length - 1] : null;
}

/**
 * Build ledger rows from customer utterance only (never Claude answer text).
 */
export function buildLifeLedgerUpdatesFromUtterance({
  question = "",
  existingLedger = [],
  customerId = null,
  entityId = null,
  messageId = null,
  now = new Date(),
} = {}) {
  const text = String(question ?? "").trim();
  if (!text) return { ok: false, reason: "empty", action: "skip", updates: [] };
  if (looksLikeInferenceNotCustomerStatement(text)) {
    return { ok: false, reason: "inference_blocked", action: "skip", updates: [] };
  }

  const eid = trim(entityId);
  const msg = trim(messageId) || `llmsg_${Date.now().toString(36)}`;
  const existing = normalizeLifeLedgerItems(existingLedger, { now });
  const updates = [];
  const base = {
    customer_id: trim(customerId),
    entity_id: eid,
    source: "customer_statement",
    source_message_id: msg,
    created_at: stampNow(now),
    updated_at: stampNow(now),
  };

  // --- Lifecycle: close / cancel / resume (explicit only; preserve original row) ---
  if (isLedgerResumeUtterance(text)) {
    const target =
      latestSameEntity(existing, {
        type: "goal",
        entityId: eid,
        statusIn: ["resolved", "cancelled"],
      }) ||
      latestSameEntity(existing, {
        type: "open_question",
        entityId: eid,
        statusIn: ["resolved", "cancelled"],
      }) ||
      latestSameEntity(existing, {
        type: "preference",
        entityId: eid,
        statusIn: ["resolved", "cancelled"],
      }) ||
      latestSameEntity(existing, {
        type: "life_thread",
        entityId: eid,
        statusIn: ["resolved", "cancelled"],
      });
    if (target) {
      updates.push({
        ...target,
        ...base,
        id: target.id,
        status: "active",
        resolved_at: null,
        metadata_json: {
          ...(target.metadata_json || {}),
          explicit_resume: true,
          resume_message_id: msg,
        },
      });
    }
  } else if (isLedgerCancelUtterance(text) || isLedgerCloseUtterance(text)) {
    const cancelled = isLedgerCancelUtterance(text);
    const target =
      latestSameEntity(existing, { type: "goal", entityId: eid, statusIn: ["active"] }) ||
      latestSameEntity(existing, {
        type: "open_question",
        entityId: eid,
        statusIn: ["active"],
      }) ||
      latestSameEntity(existing, {
        type: "preference",
        entityId: eid,
        statusIn: ["active"],
      }) ||
      latestSameEntity(existing, {
        type: "life_thread",
        entityId: eid,
        statusIn: ["active"],
      }) ||
      latestSameEntity(existing, { type: "decision", entityId: eid, statusIn: ["active"] });
    if (target) {
      updates.push({
        ...target,
        ...base,
        id: target.id,
        status: cancelled ? "cancelled" : "resolved",
        resolved_at: stampNow(now),
        metadata_json: {
          ...(target.metadata_json || {}),
          explicit_status_change: cancelled ? "cancelled" : "resolved",
          status_message_id: msg,
        },
      });
    }
  }

  // --- Decision reason link (same customer + entity; latest active decision still missing reason) ---
  if (isDecisionReasonOnlyUtterance(text) || extractDecisionReason(text)) {
    const reason =
      extractDecisionReason(text) ||
      trim(text.replace(/^(?:왜냐하면|이유는|때문에)\s*/, ""), 200);
    const openWithoutReason = existing
      .filter(
        (e) =>
          e.type === "decision" &&
          sameEntity(e.entity_id, eid) &&
          e.status === "active" &&
          !e.reason,
      )
      .sort((a, b) =>
        String(a.updated_at || a.created_at || "").localeCompare(
          String(b.updated_at || b.created_at || ""),
        ),
      );
    const d = openWithoutReason.length
      ? openWithoutReason[openWithoutReason.length - 1]
      : null;
    if (reason && d) {
      updates.push({
        ...d,
        ...base,
        id: d.id,
        reason,
        metadata_json: {
          ...(d.metadata_json || {}),
          reason_linked: true,
          reason_message_id: msg,
        },
      });
    }
  }

  // --- Preference / goal (correction prefers prior goal when insurance-goal wording) ---
  const correctingUtterance = isLedgerCorrectionUtterance(text);
  const priorGoal = latestSameEntity(existing, { type: "goal", entityId: eid });
  const priorPref = latestSameEntity(existing, { type: "preference", entityId: eid });
  const looksInsuranceGoal =
    /(보험료|보장|유지|줄이|부담)/.test(text) && /(원해|싶어|중요해|우선)/.test(text);
  const asGoal =
    isCustomerGoalUtterance(text) ||
    (correctingUtterance && priorGoal && looksInsuranceGoal);
  const asPreference =
    isCustomerPreferenceUtterance(text) && !asGoal;

  if (asPreference) {
    const correcting = correctingUtterance && priorPref;
    updates.push({
      id: `ll_preference_${msg}`.slice(0, 120),
      ...base,
      type: "preference",
      content: text.slice(0, 400),
      status: "active",
      supersedes_id: correcting ? priorPref.id : null,
      metadata_json: {
        preserved_customer_wording: true,
        correction: Boolean(correcting),
      },
    });
  }

  if (asGoal) {
    const correcting = correctingUtterance && priorGoal;
    updates.push({
      id: `ll_goal_${msg}`.slice(0, 120),
      ...base,
      type: "goal",
      content: text.slice(0, 400),
      status: "active",
      supersedes_id: correcting ? priorGoal.id : null,
      metadata_json: {
        preserved_customer_wording: true,
        correction: Boolean(correcting),
      },
    });
  }

  if (isCustomerDecisionUtterance(text)) {
    const prior = latestSameEntity(existing, { type: "decision", entityId: eid });
    const correcting = isLedgerCorrectionUtterance(text) && prior;
    updates.push({
      id: `ll_decision_${msg}`.slice(0, 120),
      ...base,
      type: "decision",
      content: text.slice(0, 400),
      decision: text.slice(0, 400),
      reason: extractDecisionReason(text),
      status: "active",
      supersedes_id: correcting ? prior.id : null,
      metadata_json: {
        preserved_customer_wording: true,
        not_key_recommendation: true,
        correction: Boolean(correcting),
      },
    });
  }

  if (isOpenQuestionUtterance(text)) {
    const prior = latestSameEntity(existing, { type: "open_question", entityId: eid });
    const correcting = isLedgerCorrectionUtterance(text) && prior;
    updates.push({
      id: `ll_openq_${msg}`.slice(0, 120),
      ...base,
      type: "open_question",
      content: text.slice(0, 400),
      question: text.slice(0, 400),
      status: "active",
      resolved_at: null,
      supersedes_id: correcting ? prior.id : null,
      metadata_json: {
        preserved_customer_wording: true,
        correction: Boolean(correcting),
      },
    });
  }

  if (isLifeThreadUtterance(text)) {
    const prior = latestSameEntity(existing, { type: "life_thread", entityId: eid });
    const correcting = isLedgerCorrectionUtterance(text) && prior;
    updates.push({
      id: `ll_thread_${msg}`.slice(0, 120),
      ...base,
      type: "life_thread",
      content: text.slice(0, 400),
      status: "active",
      supersedes_id: correcting ? prior.id : null,
      metadata_json: {
        preserved_customer_wording: true,
        customer_stated_life_context: true,
        not_inferred: true,
        correction: Boolean(correcting),
      },
    });
  }

  if (isCustomerConfirmedOutcomeUtterance(text)) {
    updates.push({
      id: `ll_outcome_life_${msg}`.slice(0, 120),
      ...base,
      type: "outcome",
      content: text.slice(0, 400),
      outcome_type: "customer_confirmed_life",
      status: "completed",
      completed_at: stampNow(now),
      supersedes_id: null,
      metadata_json: {
        preserved_customer_wording: true,
        kind: "customer_confirmed_life",
        not_advice: true,
        not_expectation: true,
      },
    });
  }

  // Correction of goal/preference/thread without new classifier match: "정정하면, …"
  if (isLedgerCorrectionUtterance(text) && !updates.some((u) => u.supersedes_id)) {
    const prior =
      latestSameEntity(existing, { type: "goal", entityId: eid }) ||
      latestSameEntity(existing, { type: "preference", entityId: eid }) ||
      latestSameEntity(existing, { type: "life_thread", entityId: eid }) ||
      latestSameEntity(existing, { type: "decision", entityId: eid });
    if (prior && !updates.some((u) => u.type === prior.type && u.supersedes_id === prior.id)) {
      updates.push({
        id: `ll_${prior.type}_corr_${msg}`.slice(0, 120),
        ...base,
        type: prior.type,
        content: text.slice(0, 400),
        decision: prior.type === "decision" ? text.slice(0, 400) : null,
        status: "active",
        supersedes_id: prior.id,
        metadata_json: {
          preserved_customer_wording: true,
          correction: true,
        },
      });
    }
  }

  if (!updates.length) {
    return { ok: false, reason: "not_ledger_utterance", action: "skip", updates: [] };
  }

  const filtered = updates.filter((u) => {
    // Allow status/reason updates onto existing id.
    if (existing.some((e) => e.id === u.id)) return true;
    return !existing.some(
      (e) =>
        e.id === u.id ||
        (e.type === u.type &&
          e.content === u.content &&
          sameEntity(e.entity_id, u.entity_id) &&
          !u.supersedes_id),
    );
  });
  if (!filtered.length) {
    return { ok: false, reason: "already_recorded", action: "skip", updates: [] };
  }

  return {
    ok: true,
    reason: filtered[0].type,
    action: filtered.some((u) => existing.some((e) => e.id === u.id)) ? "update" : "create",
    updates: normalizeLifeLedgerItems(filtered, { now }),
  };
}

/**
 * Project Claim Guardian terminal outcomes into ledger (not Claude inference).
 */
export function syncLifeLedgerOutcomesFromClaims({
  cases = [],
  existingLedger = [],
  customerId = null,
  now = new Date(),
} = {}) {
  const existing = normalizeLifeLedgerItems(existingLedger, { now });
  const updates = [];
  for (const c of Array.isArray(cases) ? cases : []) {
    if (!c || typeof c !== "object") continue;
    const status = String(c.status ?? "").trim();
    if (!["paid", "denied", "closed", "submitted_by_customer"].includes(status)) continue;
    const claimKey = trim(c.claim_case_key);
    if (!claimKey) continue;
    const scope = String(c.claim_scope ?? "personal").trim().toLowerCase();
    const eid = scope === "corporate" ? trim(c.entity_id) : null;
    if (scope === "corporate" && !eid) continue;

    const outcome_type =
      status === "paid"
        ? "claim_paid"
        : status === "denied"
          ? "claim_denied"
          : status === "submitted_by_customer"
            ? "claim_submitted"
            : "claim_closed";
    const related_id = claimKey;
    if (
      existing.some(
        (e) =>
          e.type === "outcome" &&
          e.related_id === related_id &&
          e.outcome_type === outcome_type,
      )
    ) {
      continue;
    }
    updates.push({
      id: `ll_outcome_${outcome_type}_${claimKey}`.slice(0, 120),
      customer_id: trim(customerId),
      entity_id: eid,
      type: "outcome",
      content: outcome_type,
      outcome_type,
      status: "completed",
      source: "claim_guardian",
      source_message_id: null,
      related_claim_id: claimKey,
      related_id,
      related_evidence_id: null,
      created_at: stampNow(now),
      updated_at: stampNow(now),
      completed_at: stampNow(now),
      metadata_json: {
        claim_status: status,
        insurer_verified: c.insurer_verified === true,
      },
    });
  }
  return normalizeLifeLedgerItems(updates, { now });
}

export function buildLifeLedgerHandBrief(items = [], { now = new Date() } = {}) {
  const rows = normalizeLifeLedgerItems(items, { now });
  const briefRow = (r) => ({
    id: r.id,
    type: r.type,
    content: r.content,
    status: r.status,
    source: r.source,
    entity_id: r.entity_id,
    reason: r.reason,
    related_id: r.related_id,
    supersedes_id: r.supersedes_id,
    created_at: r.created_at,
    resolved_at: r.resolved_at,
    completed_at: r.completed_at,
  });
  return {
    goals: rows.filter((r) => r.type === "goal" && r.status === "active").slice(0, 8).map(briefRow),
    preferences: rows
      .filter((r) => r.type === "preference" && r.status === "active")
      .slice(0, 8)
      .map(briefRow),
    decisions: rows
      .filter((r) => r.type === "decision" && r.status !== "cancelled")
      .slice(0, 8)
      .map(briefRow),
    open_questions: rows
      .filter((r) => r.type === "open_question" && r.status === "active")
      .slice(0, 8)
      .map(briefRow),
    life_threads: rows
      .filter((r) => r.type === "life_thread" && r.status === "active")
      .slice(0, 8)
      .map(briefRow),
    outcomes: rows.filter((r) => r.type === "outcome").slice(0, 8).map(briefRow),
    item_count: rows.length,
    packs_separated: true,
    note: "key_owns_life_ledger; soft_reference_only; claude_judges_freely",
  };
}

export function softLifeLedgerContext(brief = null) {
  if (!brief || typeof brief !== "object") return null;
  return {
    life_ledger: {
      goals: brief.goals || [],
      preferences: brief.preferences || [],
      decisions: brief.decisions || [],
      open_questions: brief.open_questions || [],
      life_threads: brief.life_threads || [],
      outcomes: brief.outcomes || [],
      item_count: Number(brief.item_count) || 0,
      packs_separated: true,
      note: "soft_context_reference_only_not_answer_template_not_forced_recommend",
    },
  };
}
