/**
 * Insurance Clock Slice 1 — KEY owns deadlines; Claude explains only.
 * Storage: profile_health.details_json.key_insurance_clock_items (Claim Guardian pattern).
 * No separate Clock Claude / Persona. No invented statutory deadlines.
 */

import {
  KEY_ACTIVE_CLAIM_CASES_FACT_PATH,
  normalizeKeyClaimCaseUpdates,
} from "../documentPolicyUploadPersist.js";
import {
  buildInsuranceClocksFromPolicyDateFacts,
  extractPolicyDateFactsFromConfirmed,
  normalizePolicyDateFacts,
} from "./keyPolicyDateFacts.js";

export const KEY_INSURANCE_CLOCK_FACT_PATH = "key_insurance_clock_items";

export const CLOCK_TYPES = Object.freeze([
  "claim_followup",
  "consent_expiry",
  "policy_renewal",
  "policy_maturity",
  // Premium / Lapse Slice — 1:1 with policy date facts (never substitute renewal/maturity).
  "premium_due",
  "lapse_scheduled",
  "reinstate_by",
]);

export const CLOCK_STATUSES = Object.freeze([
  "active",
  "completed",
  "cancelled",
  "expired",
  "unknown_date",
]);

export const CLOCK_SOURCES = Object.freeze([
  "customer_statement",
  "verified_document",
  "document_evidence",
  "authority_consent",
  "claim_guardian",
]);

const CLOCK_TYPE_SET = new Set(CLOCK_TYPES);
const CLOCK_STATUS_SET = new Set(CLOCK_STATUSES);
const CLOCK_SOURCE_SET = new Set(CLOCK_SOURCES);
const TERMINAL_CLOCK = new Set(["completed", "cancelled", "expired"]);

const WEEKDAY_KO = Object.freeze({
  일: 0,
  월: 1,
  화: 2,
  수: 3,
  목: 4,
  금: 5,
  토: 6,
});

function trim(v) {
  if (v == null) return null;
  const s = String(v).trim();
  return s ? s : null;
}

function stampNow(now = new Date()) {
  const d = now instanceof Date ? now : new Date(now);
  return Number.isFinite(d.getTime()) ? d.toISOString() : new Date().toISOString();
}

const DEFAULT_CLOCK_TZ = "Asia/Seoul";

function ymdLocal(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Calendar YMD + weekday (0=Sun) in customer timezone — never invent dates. */
export function getCalendarPartsInTimeZone(now = new Date(), timeZone = DEFAULT_CLOCK_TZ) {
  const d = now instanceof Date ? now : new Date(now);
  if (!Number.isFinite(d.getTime())) {
    return { ymd: null, weekday: null, year: null, month: null, day: null, timeZone };
  }
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
  });
  const parts = Object.fromEntries(
    fmt.formatToParts(d).filter((p) => p.type !== "literal").map((p) => [p.type, p.value]),
  );
  const weekdayMap = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  const year = Number(parts.year);
  const month = Number(parts.month);
  const day = Number(parts.day);
  const ymd = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  return {
    ymd,
    weekday: weekdayMap[parts.weekday] ?? null,
    year,
    month,
    day,
    timeZone,
  };
}

function addDaysToYmd(ymd, addDays) {
  const [y, m, d] = String(ymd).split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + addDays, 12, 0, 0));
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(2, "0")}`;
}

function parseIsoDateOnly(raw) {
  const s = trim(raw);
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const d = new Date(`${s}T12:00:00`);
    return Number.isFinite(d.getTime()) ? ymdLocal(d) : null;
  }
  const d = new Date(s);
  return Number.isFinite(d.getTime()) ? ymdLocal(d) : null;
}

/**
 * Parse customer-stated deadline from utterance. Never invents "보통 3년".
 * Relative weekdays use customer timezone (default Asia/Seoul) and return anchor evidence.
 */
export function parseCustomerStatedDeadline(
  question = "",
  { now = new Date(), timeZone = DEFAULT_CLOCK_TZ } = {},
) {
  const text = String(question ?? "").trim();
  const parts = getCalendarPartsInTimeZone(now, timeZone);
  if (!text || !parts.ymd) {
    return {
      due_at: null,
      next_check_at: null,
      status: "unknown_date",
      reason: "empty",
      relative_anchor_date: null,
      timezone: timeZone,
    };
  }
  const anchor = {
    relative_anchor_date: parts.ymd,
    timezone: parts.timeZone,
  };

  // Absolute: 2026-07-25 / 2026.7.25 / 2026/7/25
  const abs = text.match(/(\d{4})[./-](\d{1,2})[./-](\d{1,2})/);
  if (abs) {
    const y = Number(abs[1]);
    const m = Number(abs[2]);
    const d = Number(abs[3]);
    const due = `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    return { due_at: due, next_check_at: due, status: "active", reason: "absolute_date", ...anchor };
  }

  // Month-day: 7월 25일 / 7월25일
  const md = text.match(/(\d{1,2})\s*월\s*(\d{1,2})\s*일/);
  if (md) {
    const m = Number(md[1]);
    const d = Number(md[2]);
    let year = parts.year;
    let due = `${year}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    if (due < parts.ymd) {
      year += 1;
      due = `${year}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    }
    return { due_at: due, next_check_at: due, status: "active", reason: "month_day", ...anchor };
  }

  // Relative weekday: 다음 주 금요일 / 이번 주 금요일 / 금요일까지
  const wd = text.match(/(다음\s*주|이번\s*주)?\s*([월화수목금토일])요일/);
  if (wd) {
    const which = String(wd[1] || "").replace(/\s+/g, "");
    const target = WEEKDAY_KO[wd[2]];
    if (typeof target === "number" && typeof parts.weekday === "number") {
      let add = (target - parts.weekday + 7) % 7;
      if (which === "다음주") {
        add = add === 0 ? 7 : add + 7;
      } else if (which === "이번주") {
        // keep add
      } else if (add === 0 && !/까지/.test(text)) {
        add = 7;
      }
      const due = addDaysToYmd(parts.ymd, add);
      return {
        due_at: due,
        next_check_at: due,
        status: "active",
        reason: which ? `relative_${which}_${wd[2]}` : `relative_${wd[2]}`,
        ...anchor,
      };
    }
  }

  // Vague — no due_at invention
  if (/곧|빨리|조만간|이번\s*주\s*안|며칠\s*안|서둘러|제출해야|내야\s*해/.test(text)) {
    return {
      due_at: null,
      next_check_at: addDaysToYmd(parts.ymd, 3),
      status: "unknown_date",
      reason: "vague_deadline_needs_date",
      ...anchor,
    };
  }

  return {
    due_at: null,
    next_check_at: null,
    status: "unknown_date",
    reason: "no_date_signal",
    ...anchor,
  };
}

export function isClaimFollowupClockUtterance(question = "") {
  const text = String(question ?? "").trim();
  if (!text) return false;
  return /(제출|서류|진단서|입퇴원|영수증|서류\s*내|기한|까지).{0,24}(해야|할|해|야)|기한|마감|다음\s*주|이번\s*주/.test(
    text,
  );
}

export function isClockCompletionUtterance(question = "") {
  const text = String(question ?? "").trim();
  return /(제출했|제출\s*완료|냈(?:어|어요)|보냈(?:어|어요)|접수까지\s*했)/.test(text);
}

export function clockDedupeKey(row = {}) {
  const type = trim(row.clock_type) || "unknown";
  const entity = trim(row.entity_id) || "personal";
  const subject = trim(row.subject_id) || "none";
  return `${type}:${entity}:${subject}`;
}

export function normalizeInsuranceClockItems(raw = [], { now = new Date() } = {}) {
  const rows = Array.isArray(raw) ? raw : [];
  const out = [];
  const seen = new Set();
  const nowIso = stampNow(now);
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const clock_type = trim(row.clock_type);
    if (!clock_type || !CLOCK_TYPE_SET.has(clock_type)) continue;
    const statusRaw = trim(row.status)?.toLowerCase();
    let status = statusRaw && CLOCK_STATUS_SET.has(statusRaw) ? statusRaw : "active";
    const source = trim(row.source);
    if (!source || !CLOCK_SOURCE_SET.has(source)) continue;
    const subject_id = trim(row.subject_id);
    if (!subject_id) continue;
    const entity_id = trim(row.entity_id);
    const due_at = parseIsoDateOnly(row.due_at);
    let next_check_at = parseIsoDateOnly(row.next_check_at) || due_at;
    if (!due_at && status === "active") status = "unknown_date";
    if (status === "unknown_date" && !next_check_at) {
      const d = now instanceof Date ? now : new Date(now);
      d.setDate(d.getDate() + 3);
      next_check_at = ymdLocal(d);
    }
    // Expire consent/policy clocks past due when still active.
    if (
      (clock_type === "consent_expiry" ||
        clock_type === "policy_renewal" ||
        clock_type === "policy_maturity" ||
        clock_type === "premium_due" ||
        clock_type === "lapse_scheduled" ||
        clock_type === "reinstate_by") &&
      status === "active" &&
      due_at
    ) {
      const dueMs = new Date(`${due_at}T23:59:59`).getTime();
      if (Number.isFinite(dueMs) && dueMs < Date.now()) status = "expired";
    }
    const id =
      trim(row.id) ||
      `clk_${clock_type}_${entity_id || "personal"}_${subject_id}`.slice(0, 120);
    const key = clockDedupeKey({ clock_type, entity_id, subject_id });
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      id,
      customer_id: trim(row.customer_id),
      entity_id,
      clock_type,
      subject_type: trim(row.subject_type) || clock_type,
      subject_id,
      due_at,
      next_check_at,
      status,
      source,
      source_message_id: trim(row.source_message_id),
      evidence_id: trim(row.evidence_id),
      label: trim(row.label),
      note: trim(row.note),
      relative_anchor_date: parseIsoDateOnly(row.relative_anchor_date),
      timezone: trim(row.timezone) || null,
      evidence:
        row.evidence && typeof row.evidence === "object"
          ? {
              ...(row.evidence.relative_anchor_date
                ? { relative_anchor_date: parseIsoDateOnly(row.evidence.relative_anchor_date) }
                : {}),
              ...(row.evidence.timezone ? { timezone: trim(row.evidence.timezone) } : {}),
              ...(row.evidence.utterance_relative
                ? { utterance_relative: trim(row.evidence.utterance_relative) }
                : {}),
            }
          : null,
      created_at: trim(row.created_at) || nowIso,
      updated_at: trim(row.updated_at) || nowIso,
      completed_at: trim(row.completed_at),
    });
  }
  return out;
}

/**
 * Merge clock rows. Terminal statuses do not regress to active/unknown_date.
 * Dedupe by clock_type + entity + subject.
 */
export function mergeInsuranceClockItems(existing = [], incoming = [], { now = new Date() } = {}) {
  const map = new Map();
  for (const row of [
    ...normalizeInsuranceClockItems(existing, { now }),
    ...normalizeInsuranceClockItems(incoming, { now }),
  ]) {
    const key = clockDedupeKey(row);
    const prior = map.get(key);
    if (!prior) {
      map.set(key, row);
      continue;
    }
    let status = row.status;
    if (TERMINAL_CLOCK.has(prior.status) && !TERMINAL_CLOCK.has(status)) {
      // Explicit customer-stated due_at may supersede completed claim_followup.
      // Vague/unknown and non-claim clocks never reopen terminal rows.
      const allowDatedSupersede =
        prior.clock_type === "claim_followup" &&
        status === "active" &&
        Boolean(row.due_at) &&
        row.source === "customer_statement";
      if (!allowDatedSupersede) {
        status = prior.status;
      }
    }
    // Prefer explicit due_at over null; never invent from vague→unknown over a dated clock.
    let due_at = row.due_at || prior.due_at;
    if (!row.due_at && row.status === "unknown_date" && prior.due_at && prior.status === "active") {
      due_at = prior.due_at;
      status = prior.status;
    }
    const next_check_at = row.next_check_at || prior.next_check_at || due_at;
    map.set(key, {
      ...prior,
      ...row,
      due_at,
      next_check_at,
      status,
      completed_at:
        status === "completed" || status === "cancelled" || status === "expired"
          ? row.completed_at || prior.completed_at || stampNow(now)
          : null,
      created_at: prior.created_at || row.created_at,
      updated_at: stampNow(now),
    });
  }
  return [...map.values()];
}

export function filterInsuranceClocksByScope(
  items = [],
  { entityId = null, mode = "personal" } = {},
) {
  const rows = normalizeInsuranceClockItems(items);
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

export async function loadInsuranceClockItems({ supabase = null, customerId = null } = {}) {
  if (!supabase || !customerId) return [];
  const { data, error } = await supabase
    .from("profile_health")
    .select("details_json")
    .eq("customer_id", customerId)
    .maybeSingle();
  if (error || !data) return [];
  const details =
    data.details_json && typeof data.details_json === "object" ? data.details_json : {};
  return normalizeInsuranceClockItems(details[KEY_INSURANCE_CLOCK_FACT_PATH]);
}

export async function persistInsuranceClockItems({
  supabase = null,
  customerId = null,
  clockUpdates = [],
} = {}) {
  const incoming = normalizeInsuranceClockItems(clockUpdates);
  if (!supabase || !customerId || incoming.length === 0) {
    return {
      ok: false,
      attempted: Boolean(supabase && customerId && Array.isArray(clockUpdates) && clockUpdates.length),
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
  const merged = mergeInsuranceClockItems(
    existingDetails[KEY_INSURANCE_CLOCK_FACT_PATH],
    stamped,
  );
  const nextDetails = {
    ...existingDetails,
    [KEY_INSURANCE_CLOCK_FACT_PATH]: merged,
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
    return { ok: true, attempted: true, stored: stamped.length, case_count: merged.length };
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
  return { ok: true, attempted: true, stored: stamped.length, case_count: merged.length };
}

function pickOpenClaimSubject(existingCases = [], { entityId = null } = {}) {
  const eid = trim(entityId);
  const openStatuses = new Set([
    "identified",
    "preparing",
    "ready_for_customer_submission",
    "submitted_by_customer",
    "under_review",
  ]);
  const rows = normalizeKeyClaimCaseUpdates(existingCases).filter((c) => {
    if (!openStatuses.has(String(c.status))) return false;
    if (eid) {
      return String(c.claim_scope) === "corporate" && trim(c.entity_id) === eid;
    }
    return String(c.claim_scope ?? "personal") !== "corporate" && !trim(c.entity_id);
  });
  if (!rows.length) return null;
  const surgery = rows.find((c) => String(c.claim_case_key || "").includes("surgery"));
  return surgery || rows[0];
}

/**
 * Pure builder — claim follow-up / completion from customer utterance.
 */
export function buildInsuranceClockUpdatesFromUtterance({
  question = "",
  existingCases = [],
  existingClocks = [],
  customerId = null,
  entityId = null,
  messageId = null,
  now = new Date(),
} = {}) {
  const text = String(question ?? "").trim();
  const updates = [];
  const eid = trim(entityId);
  const cid = trim(customerId);

  // Completion path — mark matching claim_followup completed (no regress later via merge).
  // Only claim_case subjects (not utterance:unknown honesty rows).
  if (isClockCompletionUtterance(text)) {
    const clocks = normalizeInsuranceClockItems(existingClocks, { now });
    const openFollowups = clocks.filter(
      (c) =>
        c.clock_type === "claim_followup" &&
        c.subject_type === "claim_case" &&
        !TERMINAL_CLOCK.has(c.status) &&
        (eid ? trim(c.entity_id) === eid : !c.entity_id),
    );
    for (const c of openFollowups) {
      updates.push({
        ...c,
        status: "completed",
        completed_at: stampNow(now),
        updated_at: stampNow(now),
        note: "completed_by_customer_statement",
      });
    }
    if (updates.length) {
      return {
        ok: true,
        reason: "completed_claim_followup",
        action: "complete",
        updates,
      };
    }
  }

  if (!isClaimFollowupClockUtterance(text)) {
    return { ok: false, reason: "not_clock_utterance", action: "skip", updates: [] };
  }

  const parsed = parseCustomerStatedDeadline(text, { now, timeZone: DEFAULT_CLOCK_TZ });
  const claim = pickOpenClaimSubject(existingCases, { entityId: eid });
  // Vague with no explicit date: do not attach to a dated claim subject as a fake due_at.
  // Prefer utterance-scoped unknown_date so honesty survives alongside an existing dated clock.
  const subject_id =
    !parsed.due_at && parsed.status === "unknown_date"
      ? `utterance:unknown:${trim(messageId) || stampNow(now)}`
      : claim?.claim_case_key || `utterance:${trim(messageId) || "anon"}`;
  // Do not reopen terminal followup for same subject.
  const prior = normalizeInsuranceClockItems(existingClocks, { now }).find(
    (c) =>
      c.clock_type === "claim_followup" &&
      c.subject_id === subject_id &&
      (eid ? trim(c.entity_id) === eid : !c.entity_id),
  );
  // Vague / unknown-date must not reopen a completed followup (Seat E).
  // Explicit customer-stated due_at may supersede the same claim subject (Seat A).
  if (prior && TERMINAL_CLOCK.has(prior.status)) {
    if (!parsed.due_at || parsed.status === "unknown_date") {
      return { ok: false, reason: "terminal_clock_no_reopen", action: "skip", updates: [] };
    }
  }

  const evidence =
    parsed.relative_anchor_date || parsed.timezone
      ? {
          relative_anchor_date: parsed.relative_anchor_date,
          timezone: parsed.timezone || DEFAULT_CLOCK_TZ,
          ...(parsed.reason?.startsWith("relative_")
            ? { utterance_relative: text.slice(0, 80) }
            : {}),
        }
      : null;

  const row = {
    id: prior?.id || `clk_claim_followup_${subject_id}`.slice(0, 120),
    customer_id: cid,
    entity_id: eid,
    clock_type: "claim_followup",
    subject_type: parsed.due_at ? "claim_case" : "utterance",
    subject_id,
    due_at: parsed.due_at,
    next_check_at: parsed.next_check_at,
    status: parsed.status === "unknown_date" ? "unknown_date" : "active",
    source: "customer_statement",
    source_message_id: trim(messageId),
    evidence_id: null,
    label: parsed.due_at
      ? `청구 서류 제출 기한 (${parsed.due_at})`
      : "청구 서류 제출 — 정확한 날짜 확인 필요",
    note: parsed.reason,
    relative_anchor_date: parsed.relative_anchor_date,
    timezone: parsed.timezone || DEFAULT_CLOCK_TZ,
    evidence,
    created_at: prior?.created_at || stampNow(now),
    updated_at: stampNow(now),
    completed_at: null,
  };
  return {
    ok: true,
    reason: parsed.due_at ? "created_claim_followup_with_date" : "created_claim_followup_unknown_date",
    action: prior ? "update" : "create",
    updates: [row],
  };
}

/**
 * Project consent expiry clocks from authority grant rows (no invented dates).
 */
export function buildConsentExpiryClocksFromGrants({
  grants = [],
  customerId = null,
  entityId = null,
  now = new Date(),
} = {}) {
  const eid = trim(entityId);
  const cid = trim(customerId);
  const out = [];
  for (const g of Array.isArray(grants) ? grants : []) {
    const due = parseIsoDateOnly(g?.expires_at);
    if (!due) continue;
    const statusHint = trim(g?.status);
    if (statusHint && statusHint !== "active") continue;
    const grantId = trim(g?.id) || `${trim(g?.consent_scope)}:${due}`;
    const scope = trim(g?.consent_scope) || "authority";
    out.push({
      id: `clk_consent_${grantId}`.slice(0, 120),
      customer_id: cid,
      entity_id: eid || trim(g?.entity_id),
      clock_type: "consent_expiry",
      subject_type: "authority_consent",
      subject_id: grantId,
      due_at: due,
      next_check_at: due,
      status: "active",
      source: "authority_consent",
      source_message_id: null,
      evidence_id: trim(g?.evidence_id),
      label: `법인 권한·동의 만료 (${scope})`,
      note: "from_entity_authority_consents.expires_at",
      created_at: stampNow(now),
      updated_at: stampNow(now),
      completed_at: null,
    });
  }
  return normalizeInsuranceClockItems(out, { now });
}

/**
 * Project consent clocks from corporate_contexts[].authority_brief.consent_deadlines.
 */
export function buildConsentExpiryClocksFromCorporateContexts({
  corporateContexts = [],
  customerId = null,
  now = new Date(),
} = {}) {
  const out = [];
  for (const ctx of Array.isArray(corporateContexts) ? corporateContexts : []) {
    const eid = trim(ctx?.entity_id);
    if (!eid) continue;
    const deadlines = Array.isArray(ctx?.authority_brief?.consent_deadlines)
      ? ctx.authority_brief.consent_deadlines
      : [];
    out.push(
      ...buildConsentExpiryClocksFromGrants({
        grants: deadlines,
        customerId,
        entityId: eid,
        now,
      }),
    );
  }
  return out;
}

/**
 * Assemble Hand-scoped clock items: stored ledger + consent + policy date facts.
 * policy_renewal/maturity/premium_due/lapse_scheduled/reinstate_by come only from
 * matching policy date facts (or explicit same-named fields — never substitutes).
 */
export function assembleInsuranceClockItemsForHand({
  storedClocks = [],
  corporateContexts = [],
  policies = [],
  policyDateFacts = [],
  customerId = null,
  entityId = null,
  mode = "personal",
  now = new Date(),
} = {}) {
  const projectedConsent = buildConsentExpiryClocksFromCorporateContexts({
    corporateContexts,
    customerId,
    now,
  });
  const fromPolicies = buildPolicyDateClocksFromPolicies({
    policies,
    customerId,
    entityId: mode === "corporate" ? trim(entityId) : null,
    now,
  });
  const liftedConfirmed = extractPolicyDateFactsFromConfirmed({
    policies,
    customerId,
    now,
  });
  const dateFacts = normalizePolicyDateFacts(
    [...(Array.isArray(policyDateFacts) ? policyDateFacts : []), ...liftedConfirmed],
    { now },
  );
  const fromDateFacts = buildInsuranceClocksFromPolicyDateFacts({
    facts: dateFacts,
    customerId,
    now,
  });
  const merged = mergeInsuranceClockItems(
    storedClocks,
    [...projectedConsent, ...fromPolicies, ...fromDateFacts],
    { now },
  );
  return filterInsuranceClocksByScope(merged, { entityId, mode });
}

/**
 * Policy date clocks only from explicit same-named fields.
 * Never uses end_date, insurance_period, renewal↔maturity, or cross-type substitutes.
 */
export function buildPolicyDateClocksFromPolicies({
  policies = [],
  customerId = null,
  entityId = null,
  now = new Date(),
} = {}) {
  const cid = trim(customerId);
  const eid = trim(entityId);
  const out = [];
  const fieldRules = [
    {
      pick: (p) =>
        parseIsoDateOnly(p?.renewal_date) ||
        parseIsoDateOnly(p?.coverage_summary?.renewal_date),
      clock_type: "policy_renewal",
      idPrefix: "clk_renewal",
      label: (d) => `계약 갱신 확인일 (${d})`,
      note: "explicit_policy_renewal_date_only",
    },
    {
      pick: (p) =>
        parseIsoDateOnly(p?.maturity_date) ||
        parseIsoDateOnly(p?.coverage_summary?.maturity_date),
      clock_type: "policy_maturity",
      idPrefix: "clk_maturity",
      label: (d) => `계약 만기 확인일 (${d})`,
      note: "explicit_policy_maturity_date_only",
    },
    {
      pick: (p) =>
        parseIsoDateOnly(p?.premium_due_date) ||
        parseIsoDateOnly(p?.coverage_summary?.premium_due_date),
      clock_type: "premium_due",
      idPrefix: "clk_premium_due",
      label: (d) => `보험료 납입기한 (${d})`,
      note: "explicit_policy_premium_due_date_only",
    },
    {
      pick: (p) =>
        parseIsoDateOnly(p?.lapse_scheduled_date) ||
        parseIsoDateOnly(p?.coverage_summary?.lapse_scheduled_date),
      clock_type: "lapse_scheduled",
      idPrefix: "clk_lapse",
      label: (d) => `실효 예정일 (${d})`,
      note: "explicit_policy_lapse_scheduled_date_only",
    },
    {
      pick: (p) =>
        parseIsoDateOnly(p?.reinstate_by_date) ||
        parseIsoDateOnly(p?.coverage_summary?.reinstate_by_date),
      clock_type: "reinstate_by",
      idPrefix: "clk_reinstate",
      label: (d) => `부활 가능 기한 (${d})`,
      note: "explicit_policy_reinstate_by_date_only",
    },
  ];
  for (const p of Array.isArray(policies) ? policies : []) {
    const pid = trim(p?.id) || trim(p?.policy_id);
    if (!pid) continue;
    const rowEntity = eid || trim(p?.entity_id) || null;
    for (const rule of fieldRules) {
      const due = rule.pick(p);
      if (!due) continue;
      out.push({
        id: `${rule.idPrefix}_${pid}`.slice(0, 120),
        customer_id: cid,
        entity_id: rowEntity,
        clock_type: rule.clock_type,
        subject_type: "policy",
        subject_id: pid,
        due_at: due,
        next_check_at: due,
        status: "active",
        source: "document_evidence",
        label: rule.label(due),
        note: rule.note,
        created_at: stampNow(now),
        updated_at: stampNow(now),
      });
    }
  }
  return normalizeInsuranceClockItems(out, { now });
}

export function buildInsuranceClockHandBrief(items = [], { now = new Date() } = {}) {
  const rows = normalizeInsuranceClockItems(items, { now });
  const today = ymdLocal(now instanceof Date ? now : new Date(now));
  const upcoming = [];
  const overdue = [];
  const unknown_date = [];
  const completed_recent = [];
  for (const row of rows) {
    if (row.status === "completed" || row.status === "cancelled") {
      completed_recent.push(row);
      continue;
    }
    if (row.status === "unknown_date" || !row.due_at) {
      unknown_date.push(row);
      continue;
    }
    if (row.status === "expired" || (row.due_at && row.due_at < today)) {
      overdue.push(row);
      continue;
    }
    if (row.status === "active") upcoming.push(row);
  }
  const sortByDue = (a, b) => String(a.due_at || a.next_check_at || "").localeCompare(String(b.due_at || b.next_check_at || ""));
  upcoming.sort(sortByDue);
  overdue.sort(sortByDue);
  const briefRow = (r) => ({
    id: r.id,
    clock_type: r.clock_type,
    entity_id: r.entity_id,
    subject_id: r.subject_id,
    due_at: r.due_at,
    next_check_at: r.next_check_at,
    status: r.status,
    source: r.source,
    label: r.label,
  });
  return {
    hand: "key_insurance_clock",
    upcoming: upcoming.slice(0, 6).map(briefRow),
    overdue: overdue.slice(0, 6).map(briefRow),
    unknown_date: unknown_date.slice(0, 6).map(briefRow),
    completed_recent: completed_recent.slice(0, 4).map(briefRow),
    packs_separated: true,
    note: "key_owns_dates_claude_explains_only_no_invented_deadlines",
  };
}

export function softInsuranceClockContext(brief = null) {
  if (!brief || typeof brief !== "object") return null;
  return {
    insurance_clock: {
      upcoming: brief.upcoming || [],
      overdue: brief.overdue || [],
      unknown_date: brief.unknown_date || [],
      completed_recent: brief.completed_recent || [],
      note: "soft_context_reference_only_dates_must_match_clock_rows",
    },
  };
}

// Re-export path constant for claim case join helpers.
export { KEY_ACTIVE_CLAIM_CASES_FACT_PATH };
