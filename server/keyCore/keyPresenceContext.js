/**
 * Triangle T6 — KEY Presence (listen_focus) materials.
 * KEY does not write customer sentences. Claude decides silence / greeting / one LIFE THREAD.
 * No new Family / LLM / DB.
 */

import {
  selectActiveLifeThreads,
  formatLifeThreadsForReadyCard,
} from "./keyLifeThread.js";

export const KEY_PRESENCE_MOVE = "listen_focus";
export const KEY_PRESENCE_SILENCE_TOKEN = "[KEY_PRESENCE_SILENCE]";
/** Internal question marker — never shown as customer utterance. */
export const KEY_PRESENCE_INTERNAL_QUESTION = "__KEY_PRESENCE_LISTEN_FOCUS__";

/** Default: do not re-surface the same thread within 12h. */
export const PRESENCE_SURFACE_COOLDOWN_MS = 12 * 60 * 60 * 1000;

const REQUEST_TIMEZONE = "Asia/Seoul";

export function buildPresenceClock(now = new Date(), timeZone = REQUEST_TIMEZONE) {
  const date = now instanceof Date ? now : new Date(now);
  const safe = Number.isFinite(date.getTime()) ? date : new Date();
  const dateParts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(safe);
  const pick = (type) => dateParts.find((p) => p.type === type)?.value ?? "";
  const current_date = `${pick("year")}-${pick("month")}-${pick("day")}`;
  const current_datetime = new Intl.DateTimeFormat("sv-SE", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  })
    .format(safe)
    .replace(" ", "T");
  const hour = Number(
    new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", hour12: false }).format(
      safe,
    ),
  );
  let day_part = "day";
  if (hour < 11) day_part = "morning";
  else if (hour < 14) day_part = "lunch";
  else if (hour < 18) day_part = "afternoon";
  else day_part = "evening";
  return { current_date, current_datetime, timezone: timeZone, day_part, hour };
}

/**
 * Eligible LIFE THREAD candidates for Presence (max 3).
 * Excludes resolved/closed/do_not_surface and recent repeat surfaces.
 */
export function selectPresenceLifeThreadCandidates(
  threads = [],
  {
    customerId = null,
    now = new Date(),
    max = 3,
    cooldownMs = PRESENCE_SURFACE_COOLDOWN_MS,
  } = {},
) {
  const stamp = now instanceof Date ? now : new Date(now);
  const tNow = Number.isFinite(stamp.getTime()) ? stamp.getTime() : Date.now();
  const active = selectActiveLifeThreads(threads, { customerId });
  const ranked = active
    .filter((t) => {
      if (!t || typeof t !== "object") return false;
      if (t.do_not_surface === true) return false;
      const status = String(t.status ?? "open").trim();
      if (status !== "open" && status !== "pending") return false;
      const last = Date.parse(t.last_surfaced_at ?? "");
      if (Number.isFinite(last) && tNow - last < cooldownMs) return false;
      return true;
    })
    .sort((a, b) => {
      const sa = Number(a.surface_count ?? 0) || 0;
      const sb = Number(b.surface_count ?? 0) || 0;
      if (sa !== sb) return sa - sb;
      const ua = Date.parse(a.updated_at ?? a.created_at ?? "") || 0;
      const ub = Date.parse(b.updated_at ?? b.created_at ?? "") || 0;
      return ub - ua;
    });
  return ranked.slice(0, Math.max(0, Number(max) || 3));
}

export function formatPresenceCandidate(thread = null) {
  if (!thread || typeof thread !== "object") return null;
  const facts = Array.isArray(thread.customer_stated_facts)
    ? thread.customer_stated_facts
        .map((f) => String(f?.text ?? "").trim())
        .filter(Boolean)
        .slice(0, 3)
    : [];
  const emotion =
    thread.customer_expressed_emotion?.text != null
      ? String(thread.customer_expressed_emotion.text)
      : null;
  const window = thread.expected_date_or_window?.label
    ? String(thread.expected_date_or_window.label)
    : thread.expected_date_or_window?.iso_month
      ? String(thread.expected_date_or_window.iso_month)
      : thread.expected_date_or_window?.iso_week_start
        ? String(thread.expected_date_or_window.iso_week_start)
        : null;
  return {
    life_thread_id: thread.thread_id ?? null,
    customer_stated_facts: facts,
    customer_expressed_emotion: emotion,
    expected_or_confirmed_window: window,
    source: thread.source_link?.method ?? "previous_customer_turn",
    last_surfaced_at: thread.last_surfaced_at ?? null,
    surface_count: Number(thread.surface_count ?? 0) || 0,
    sensitivity: thread.sensitivity ?? "family",
    unknowns: [
      "결과·점수·감정은 고객이 말하기 전에는 모름",
      "확인되지 않은 일정·위치·날씨는 모름",
    ],
    event_summary: thread.event_summary ?? null,
    subject_person: thread.subject_person ?? null,
    status: thread.status ?? "open",
  };
}

/**
 * Build PRESENCE_CONTEXT for Claude. KEY does not draft the customer line.
 */
export function buildPresenceContext({
  now = new Date(),
  visitKind = "revisit",
  lastVisitAt = null,
  lifeThreads = [],
  customerId = null,
  readyCardVersion = null,
  maxCandidates = 3,
} = {}) {
  const clock = buildPresenceClock(now);
  const candidates = selectPresenceLifeThreadCandidates(lifeThreads, {
    customerId,
    now,
    max: maxCandidates,
  }).map(formatPresenceCandidate);
  return {
    schema: "key_presence_context_v1",
    move: KEY_PRESENCE_MOVE,
    current_datetime: clock.current_datetime,
    current_date: clock.current_date,
    timezone: clock.timezone,
    day_part: clock.day_part,
    visit_kind: visitKind === "first_visit" ? "first_visit" : "revisit",
    last_visit_at: lastVisitAt ? String(lastVisitAt) : null,
    ready_card_version: readyCardVersion ?? null,
    active_life_thread_candidates: candidates,
    max_life_threads_to_surface: 1,
    instructions: {
      decide: ["silence", "general_greeting", "one_life_thread"],
      silence_token: KEY_PRESENCE_SILENCE_TOKEN,
      forbid: [
        "invented_family_or_schedule",
        "inferred_emotion_as_fact",
        "forced_insurance_pitch",
        "weather_without_location",
        "calendar_without_permission",
        "list_multiple_life_threads",
        "resolved_thread_as_current",
      ],
    },
  };
}

/** Invoke Claude for a short opening. Life threads are optional material, not a gate. */
export function shouldInvokePresenceClaude({
  presenceContext = null,
  sessionAlreadyRan = false,
  customerQuestionPending = false,
  answerStreamActive = false,
} = {}) {
  void presenceContext;
  if (sessionAlreadyRan === true) return { ok: false, reason: "session_already_ran" };
  if (customerQuestionPending === true) return { ok: false, reason: "customer_question_pending" };
  if (answerStreamActive === true) return { ok: false, reason: "answer_stream_active" };
  return { ok: true, reason: "eligible" };
}

export function isPresenceSilenceAnswer(text = "") {
  const t = String(text ?? "").trim();
  if (!t) return true;
  if (t === KEY_PRESENCE_SILENCE_TOKEN) return true;
  if (t.replace(/\s+/g, "") === KEY_PRESENCE_SILENCE_TOKEN) return true;
  return false;
}

/**
 * Infer which candidate Claude surfaced (at most one) from answer overlap.
 * Never treats Claude text as a customer fact.
 */
export function resolvePresenceSurfaceFromAnswer(answer = "", candidates = []) {
  const text = String(answer ?? "").trim();
  if (!text || isPresenceSilenceAnswer(text)) {
    return { source_type: null, life_thread_id: null, surfaced: false };
  }
  const rows = Array.isArray(candidates) ? candidates : [];
  let best = null;
  let bestScore = 0;
  for (const c of rows) {
    if (!c || typeof c !== "object") continue;
    let score = 0;
    const subject = String(c.subject_person ?? "").trim();
    const summary = String(c.event_summary ?? "").trim();
    if (subject && text.includes(subject)) score += 2;
    if (/시험|중간고사|기말고사/.test(text) && /시험|중간고사|기말고사/.test(summary)) {
      score += 3;
    }
    if (/입대|군대/.test(text) && /입대|군대/.test(summary)) score += 3;
    for (const fact of c.customer_stated_facts ?? []) {
      const f = String(fact ?? "").trim();
      if (f.length >= 6 && text.includes(f.slice(0, Math.min(12, f.length)))) score += 2;
    }
    if (score > bestScore) {
      bestScore = score;
      best = c;
    }
  }
  if (best && bestScore >= 2) {
    return {
      source_type: "life_thread",
      life_thread_id: best.life_thread_id ?? null,
      surfaced: true,
    };
  }
  // Light greeting / time context without a life thread hook.
  if (/오랜만|식사|점심|오늘|별일|이야기할까요/.test(text)) {
    return { source_type: "time_context", life_thread_id: null, surfaced: false };
  }
  return { source_type: "general_revisit", life_thread_id: null, surfaced: false };
}

export function markLifeThreadSurfaced(thread, { at = new Date() } = {}) {
  if (!thread || typeof thread !== "object") return null;
  const stamp = at instanceof Date ? at : new Date(at);
  const iso = Number.isFinite(stamp.getTime()) ? stamp.toISOString() : new Date().toISOString();
  return {
    ...thread,
    last_surfaced_at: iso,
    surface_count: (Number(thread.surface_count ?? 0) || 0) + 1,
    updated_at: iso,
  };
}

/**
 * Customer asked not to bring up a topic — mark recent / matching threads do_not_surface.
 * Does not delete prior facts.
 */
export function extractDoNotSurfaceOverlays(customerText = "", { candidateThreadIds = [] } = {}) {
  const q = String(customerText ?? "").trim();
  if (!q) return [];
  const askOff =
    /(그\s*이야기|그\s*얘기|그\s*말).{0,12}(묻지|꺼내지|하지\s*마)|묻지\s*말아|이야기\s*하지\s*마|그만\s*물어/.test(
      q,
    );
  if (!askOff) return [];
  const ids = (Array.isArray(candidateThreadIds) ? candidateThreadIds : [])
    .map((id) => String(id ?? "").trim())
    .filter(Boolean);
  if (!ids.length) {
    return [
      {
        schema: "key_life_thread_v1",
        thread_id: "presence_topic_off",
        do_not_surface: true,
        status: "closed",
        update_kind: "do_not_surface",
        customer_stated_facts: [
          {
            text: q.slice(0, 240),
            evidence: { kind: "customer_utterance", text: q.slice(0, 240) },
          },
        ],
      },
    ];
  }
  return ids.map((thread_id) => ({
    schema: "key_life_thread_v1",
    thread_id,
    do_not_surface: true,
    status: "closed",
    update_kind: "do_not_surface",
    customer_stated_facts: [
      {
        text: q.slice(0, 240),
        evidence: { kind: "customer_utterance", text: q.slice(0, 240) },
      },
    ],
  }));
}

export function buildPresenceSystemAddendum() {
  return [
    "이번 입력은 PRESENCE_TURN(listen_focus)이다. 고객 질문이 아직 없다.",
    "PRESENCE_CONTEXT만 보고 다음 중 하나만 선택한다: (1) 아무 말도 하지 않음 (2) 부담 없는 일반 인사 (3) active LIFE THREAD 후보 중 최대 1개만 자연스럽게 꺼냄.",
    "침묵을 고르면 답변 본문에 정확히 " + KEY_PRESENCE_SILENCE_TOKEN + " 만 출력한다.",
    "고객이 직접 말한 사실만 짚고, 결과·감정·일정을 아는 척하지 않는다. 감정을 확정하지 말고 고객이 말하게 한다.",
    "보험 상담으로 바로 전환하지 않는다. 여러 가족 이야기를 나열하지 않는다. 해결된(resolved) 이야기를 현재 사건처럼 말하지 않는다.",
    "위치 없이 날씨를 단정하지 말고, 캘린더 권한 없이 일정을 아는 척하지 않는다.",
    "한두 문장으로 대화를 연다. 길게 캐묻지 않는다.",
  ].join("\n");
}

export function buildPresenceUserQuestionLine() {
  return [
    "PRESENCE_TURN listen_focus.",
    "고객 질문 없음. current_context.presence_context만 보고 침묵·일반 인사·LIFE THREAD 하나 중 선택해 한마디로 대화를 열어라.",
  ].join(" ");
}

/**
 * Live one-path user clothes only. Fact + purpose. No sample greeting. No HEART edit.
 * visit_kind must be the computed value — do not claim first_visit on a revisit.
 */
export function buildPresenceOpeningUserText(presenceOpening = null) {
  const visitKind =
    presenceOpening && typeof presenceOpening === "object"
      ? String(presenceOpening.visitKind ?? presenceOpening.visit_kind ?? "").trim()
      : "";
  if (visitKind !== "first_visit" && visitKind !== "revisit") return "";
  const first = visitKind === "first_visit";
  return [
    "[KEY_PRESENCE_OPENING]",
    `visit_kind: ${visitKind}`,
    first
      ? "fact: 이 고객은 KEY를 처음 방문했다."
      : "fact: 이 고객은 KEY를 다시 방문했다.",
    first
      ? "purpose: 먼저 친근하게 반기고, 첫 만남답게 자연스럽게 관계를 시작해라. 고정문구 없이 네가 직접 말해라."
      : "purpose: 먼저 친근하게 반기고, 관계를 자연스럽게 이어가라. 고정문구 없이 네가 직접 말해라.",
  ].join("\n");
}

/** Brief for READY CARD / evidence — Presence may mark surfaced_to_customer. */
export function formatPresenceLifeThreadsBrief(threads = [], { customerId = null, surfacedId = null } = {}) {
  return formatLifeThreadsForReadyCard(threads, {
    limit: 6,
    activeOnly: true,
    customerId,
  }).map((row) => ({
    ...row,
    surfaced_to_customer:
      surfacedId != null && String(row.thread_id) === String(surfacedId),
    note:
      surfacedId != null && String(row.thread_id) === String(surfacedId)
        ? "surfaced_this_presence_turn"
        : "reference_only_not_verified_fact",
  }));
}
