/**
 * Triangle T5 — LIFE THREAD (customer-stated life continuity).
 * Extract from customer utterance only. Never Claude answer / inferred emotion.
 * Stored inside key_consultation_record_v1 (no new DB / Family / LLM).
 * Presence / proactive surfacing is T6 — this module only remembers + packs for READY CARD.
 */

import { createHash } from "node:crypto";

export const LIFE_THREAD_SCHEMA = "key_life_thread_v1";

function trimText(value, max = 240) {
  const t = String(value ?? "").trim();
  if (!t) return null;
  return t.slice(0, max);
}

function shaShort(parts = []) {
  return createHash("sha256")
    .update(parts.map((p) => String(p ?? "")).join("|"), "utf8")
    .digest("hex")
    .slice(0, 16);
}

/** One-off small talk — never promote to permanent LIFE THREAD. */
export function isTrivialChatNotLifeThread(question = "") {
  const q = String(question ?? "").trim();
  if (!q) return true;
  // Explicit life-event markers win over trivial meal/weather chat.
  if (
    /(군대|입대|중간고사|기말고사|시험\s*기간|이직|여행\s*준비|검사\s*결과|건강검진)/.test(
      q,
    )
  ) {
    return false;
  }
  if (
    /^(오늘\s*)?(점심|아침|저녁|날씨|김밥|커피|비\s*오|더워|추워)/.test(q) ||
    /(점심|아침|저녁).{0,24}(먹었|먹었고|먹었어요|김밥)/.test(q)
  ) {
    return true;
  }
  return false;
}

function resolveSubjectPerson(q = "") {
  if (/아들/.test(q)) return "아들";
  if (/딸/.test(q)) return "딸";
  if (/자녀|아이|애/.test(q)) return "자녀";
  if (/부모|엄마|아빠|아버지|어머니/.test(q)) return "부모님";
  return "고객";
}

function nextMonthWindow(now = new Date()) {
  const d = now instanceof Date ? now : new Date(now);
  if (!Number.isFinite(d.getTime())) return { label: "다음 달", iso_month: null };
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth() + 1; // 0-based → next month index
  const next = m === 12 ? { y: y + 1, m: 1 } : { y, m: m + 1 };
  const iso = `${next.y}-${String(next.m).padStart(2, "0")}`;
  return { label: "다음 달", iso_month: iso };
}

function thisWeekWindow(now = new Date()) {
  const d = now instanceof Date ? now : new Date(now);
  if (!Number.isFinite(d.getTime())) return { label: "이번 주", iso_week_start: null };
  const day = d.getUTCDay();
  const diffToMon = (day + 6) % 7;
  const monday = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - diffToMon));
  const iso = monday.toISOString().slice(0, 10);
  return { label: "이번 주", iso_week_start: iso };
}

function buildThreadId({ customerId = null, kind = "", subject_person = "" } = {}) {
  return shaShort([customerId || "anon", kind, subject_person]);
}

/**
 * Explicit customer-stated life facts / emotions / outcomes only.
 * Ambiguous → []. Never invent sadness/anxiety; never mark events complete without customer saying so.
 */
export function extractLifeThreadsFromCustomerUtterance(
  question = "",
  { customerId = null, sourceLink = null, now = new Date() } = {},
) {
  const q = String(question ?? "").trim();
  if (!q || isTrivialChatNotLifeThread(q)) return [];

  const out = [];
  const subject = resolveSubjectPerson(q);
  const stamp = now instanceof Date ? now : new Date(now);
  const created_at = Number.isFinite(stamp.getTime())
    ? stamp.toISOString()
    : new Date().toISOString();
  const base = {
    schema: LIFE_THREAD_SCHEMA,
    customer_id: String(customerId ?? "").trim() || null,
    sensitivity: "family",
    source_link: sourceLink && typeof sourceLink === "object" ? sourceLink : null,
    created_at,
    updated_at: created_at,
    last_surfaced_at: null,
    surface_count: 0,
    do_not_surface: false,
    resolved_outcome: null,
    customer_expressed_emotion: null,
  };

  // Planned enlistment (fact only).
  const enlistPlanned =
    /(군대|입대).{0,24}(가요|갑니다|갈\s*예정이|간대|간다고|간다)/.test(q) ||
    /(다음\s*달|곧).{0,16}(군대|입대)/.test(q);
  const enlistResolved =
    /(잘\s*)?입대했|입대\s*했고|입대\s*완료|첫\s*전화/.test(q) &&
    /(아들|딸|자녀|아이|군대|입대)/.test(q);

  if (enlistPlanned && !enlistResolved) {
    const window = /다음\s*달/.test(q) ? nextMonthWindow(stamp) : { label: null, iso_month: null };
    const kind = "family_enlistment_planned";
    const emotion =
      /걱정/.test(q)
        ? {
            text: "걱정",
            evidence: { kind: "customer_utterance", text: q.slice(0, 240) },
          }
        : null;
    out.push({
      ...base,
      thread_id: buildThreadId({ customerId, kind, subject_person: subject }),
      subject_person: subject,
      event_kind: kind,
      event_summary: `${subject} 입대 예정`,
      expected_date_or_window: window.label
        ? { label: window.label, iso_month: window.iso_month ?? null }
        : null,
      customer_stated_facts: [
        {
          text: trimText(q, 240),
          evidence: { kind: "customer_utterance", text: q.slice(0, 240) },
        },
      ],
      customer_expressed_emotion: emotion,
      status: "open",
    });
  }

  // Emotion-only follow-up on enlistment (no new completion inference).
  if (!enlistPlanned && !enlistResolved && /걱정/.test(q) && /(군대|입대)/.test(q)) {
    const kind = "family_enlistment_planned";
    out.push({
      ...base,
      thread_id: buildThreadId({ customerId, kind, subject_person: subject }),
      subject_person: subject,
      event_kind: kind,
      event_summary: `${subject} 입대 관련`,
      expected_date_or_window: null,
      customer_stated_facts: [],
      customer_expressed_emotion: {
        text: "걱정",
        evidence: { kind: "customer_utterance", text: q.slice(0, 240) },
      },
      status: "open",
      update_kind: "emotion_only",
    });
  }

  if (enlistResolved) {
    const kind = "family_enlistment_planned";
    out.push({
      ...base,
      thread_id: buildThreadId({ customerId, kind, subject_person: subject }),
      subject_person: subject,
      event_kind: kind,
      event_summary: `${subject} 입대`,
      expected_date_or_window: null,
      customer_stated_facts: [
        {
          text: trimText(q, 240),
          evidence: { kind: "customer_utterance", text: q.slice(0, 240) },
        },
      ],
      status: "resolved",
      resolved_outcome: {
        detail: trimText(q, 240),
        evidence: { kind: "customer_utterance", text: q.slice(0, 240) },
        source_link: sourceLink && typeof sourceLink === "object" ? sourceLink : null,
      },
      update_kind: "outcome_link",
    });
  }

  // Exam period — store window only; never invent scores/emotions.
  if (/(중간고사|기말고사|시험\s*기간)/.test(q)) {
    const kind = "family_exam_period";
    const window = /이번\s*주/.test(q)
      ? thisWeekWindow(stamp)
      : { label: null, iso_week_start: null };
    out.push({
      ...base,
      thread_id: buildThreadId({ customerId, kind, subject_person: subject }),
      subject_person: subject,
      event_kind: kind,
      event_summary: `${subject} 시험 기간`,
      expected_date_or_window: window.label
        ? { label: window.label, iso_week_start: window.iso_week_start ?? null }
        : null,
      customer_stated_facts: [
        {
          text: trimText(q, 240),
          evidence: { kind: "customer_utterance", text: q.slice(0, 240) },
        },
      ],
      status: "open",
    });
  }

  // Deduplicate by thread_id + update_kind within one utterance.
  const seen = new Set();
  const deduped = [];
  for (const row of out) {
    const key = `${row.thread_id}|${row.status}|${row.update_kind ?? "new"}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(row);
  }
  return deduped;
}

/**
 * Fold assistant metadata life_threads across turns (customer_id scoped by caller).
 * Never deletes prior facts — later resolved_outcome / emotion overlays same thread_id.
 */
export function mergeLifeThreadHistory(records = []) {
  const byId = new Map();
  const chronologic = Array.isArray(records) ? [...records] : [];
  // Caller should pass oldest→newest; if not, sort by updated_at when present.
  chronologic.sort((a, b) => {
    const ta = Date.parse(a?.updated_at ?? a?.created_at ?? "") || 0;
    const tb = Date.parse(b?.updated_at ?? b?.created_at ?? "") || 0;
    return ta - tb;
  });
  for (const row of chronologic) {
    if (!row || typeof row !== "object") continue;
    if (row.do_not_surface === true) {
      const id = String(row.thread_id ?? "");
      if (id && byId.has(id)) {
        byId.set(id, { ...byId.get(id), do_not_surface: true, status: "closed" });
      }
      continue;
    }
    const id = String(row.thread_id ?? "").trim();
    if (!id) continue;
    const prev = byId.get(id);
    if (!prev) {
      byId.set(id, {
        ...row,
        customer_stated_facts: Array.isArray(row.customer_stated_facts)
          ? [...row.customer_stated_facts]
          : [],
      });
      continue;
    }
    const facts = [
      ...(Array.isArray(prev.customer_stated_facts) ? prev.customer_stated_facts : []),
      ...(Array.isArray(row.customer_stated_facts) ? row.customer_stated_facts : []),
    ].slice(0, 12);
    byId.set(id, {
      ...prev,
      ...row,
      customer_stated_facts: facts,
      customer_expressed_emotion:
        row.customer_expressed_emotion ?? prev.customer_expressed_emotion ?? null,
      resolved_outcome: row.resolved_outcome ?? prev.resolved_outcome ?? null,
      status: row.status === "resolved" || row.status === "closed" ? row.status : prev.status,
      expected_date_or_window:
        row.expected_date_or_window ?? prev.expected_date_or_window ?? null,
      updated_at: row.updated_at ?? prev.updated_at,
    });
  }
  return [...byId.values()].filter((t) => t.do_not_surface !== true);
}

/** Claude / READY CARD brief — reference only; never verified fact; no Presence ask. */
export function formatLifeThreadsForReadyCard(threads = [], { limit = 6 } = {}) {
  const rows = Array.isArray(threads) ? threads : [];
  return rows.slice(0, limit).map((t) => {
    const emotion =
      t?.customer_expressed_emotion?.text != null
        ? String(t.customer_expressed_emotion.text)
        : null;
    const outcome =
      t?.resolved_outcome?.detail != null ? String(t.resolved_outcome.detail) : null;
    const window = t?.expected_date_or_window?.label
      ? String(t.expected_date_or_window.label)
      : t?.expected_date_or_window?.iso_month
        ? String(t.expected_date_or_window.iso_month)
        : null;
    return {
      thread_id: t.thread_id ?? null,
      subject_person: t.subject_person ?? null,
      event_summary: t.event_summary ?? null,
      expected_date_or_window: window,
      status: t.status ?? "open",
      customer_expressed_emotion: emotion,
      resolved_outcome: outcome,
      completion_confirmed: t.status === "resolved",
      emotion_customer_stated_only: emotion != null,
      source: "previous_customer_turn",
      surfaced_to_customer: false,
      note: "reference_only_not_verified_fact_do_not_ask_first",
    };
  });
}
