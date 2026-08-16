/**
 * Short KEY handoff memo — relationship / interest / unresolved only.
 * Not a fact ledger. Amounts and web scraps are stripped.
 * Verified numbers stay on KEY fact addresses and are re-read live.
 */

import { compactThreadVerifiedFactRefs } from "./keyThreadVerifiedFactRefs.js";

export const KEY_HANDOFF_START = "<<<KEY_HANDOFF>>>";
export const KEY_HANDOFF_END = "<<<END_KEY_HANDOFF>>>";

const MAX_SPEECH = 240;
const MAX_FIELD = 80;
const AMOUNT_RE = /\d+\s*만|\d+\s*원|월\s*\d|coverage_amount/i;
const URL_RE = /https?:\/\/|www\.|weather\.go\.kr|knia\.or\.kr|kidi\.or\.kr/i;

function asText(v, max) {
  const s = String(v ?? "").replace(/\s+/g, " ").trim();
  if (!s) return "";
  return s.slice(0, max);
}

function isSafeContextField(v) {
  const s = asText(v, MAX_FIELD);
  if (!s) return "";
  if (AMOUNT_RE.test(s) || URL_RE.test(s)) return "";
  return s;
}

export function stripHandoffFromCustomerText(text = "") {
  const raw = String(text ?? "");
  const startIdx = raw.indexOf(KEY_HANDOFF_START);
  if (startIdx < 0) return raw;
  return raw.slice(0, startIdx).trimEnd();
}

export function parseHandoffFromAssistantText(text = "") {
  const raw = String(text ?? "");
  const startIdx = raw.indexOf(KEY_HANDOFF_START);
  if (startIdx < 0) {
    return { present: false, ok: false, candidate: null };
  }
  const after = raw.slice(startIdx + KEY_HANDOFF_START.length);
  const endIdx = after.indexOf(KEY_HANDOFF_END);
  const jsonSlice = (endIdx >= 0 ? after.slice(0, endIdx) : after).trim();
  if (!jsonSlice) return { present: true, ok: false, candidate: null };
  try {
    const parsed = JSON.parse(jsonSlice);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { present: true, ok: false, candidate: null };
    }
    return { present: true, ok: true, candidate: parsed };
  } catch {
    return { present: true, ok: false, candidate: null };
  }
}

function hasOwnHandoffField(cand, keys) {
  if (!cand || typeof cand !== "object") return false;
  return keys.some((key) => Object.hasOwn(cand, key));
}

function safePrevField(memo, key) {
  if (!memo || typeof memo !== "object") return "";
  return isSafeContextField(memo[key]);
}

/**
 * KEY owns the stored memo. Claude may propose interest/unresolved only.
 * customer_speech = this-turn customer words. fact refs = KEY HIT addresses only.
 * Empty unresolved from Claude drops that leftover. Missing block keeps the previous.
 */
export function sanitizeHandoffMemo({
  claudeCandidate = null,
  customerQuestion = "",
  verifiedFactRefs = [],
  previousMemo = null,
  claudeBlockOk = claudeCandidate != null && typeof claudeCandidate === "object",
} = {}) {
  const speech = asText(customerQuestion, MAX_SPEECH);
  const cand =
    claudeCandidate && typeof claudeCandidate === "object" ? claudeCandidate : {};
  const prevInterest = safePrevField(previousMemo, "interest");
  const prevUnresolved = safePrevField(previousMemo, "unresolved");
  let interest = prevInterest;
  let unresolved = prevUnresolved;
  if (claudeBlockOk === true) {
    if (hasOwnHandoffField(cand, ["interest", "concern"])) {
      interest = isSafeContextField(cand.interest ?? cand.concern);
    }
    if (hasOwnHandoffField(cand, ["unresolved", "open"])) {
      unresolved = isSafeContextField(cand.unresolved ?? cand.open);
    }
  }
  const refs = compactThreadVerifiedFactRefs(verifiedFactRefs);
  if (!speech && !interest && !unresolved && !refs.length) return null;
  return {
    schema: "key_handoff_memo_v1",
    interest: interest || null,
    customer_speech: speech || null,
    unresolved: unresolved || null,
    verified_fact_refs: refs,
    not_verified_fact: true,
  };
}

export function compactHandoffMemo(row = null) {
  if (!row || typeof row !== "object") return null;
  return sanitizeHandoffMemo({
    claudeCandidate: {
      interest: row.interest,
      unresolved: row.unresolved,
    },
    customerQuestion: row.customer_speech ?? "",
    verifiedFactRefs: row.verified_fact_refs,
    claudeBlockOk: true,
  });
}

/** Presence may receive leftover context. It does not create refs or a warehouse. */
export function clothesHandoffForPresence(memo = null) {
  const compact = compactHandoffMemo(memo);
  if (!compact) return null;
  if (!compact.interest && !compact.unresolved && !compact.customer_speech) return null;
  return {
    ...compact,
    verified_fact_refs: [],
  };
}

export function readHandoffMemoFromArgs(args) {
  if (!args || typeof args !== "object") return null;
  return compactHandoffMemo(args.threadHandoffMemo ?? args.handoff_memo ?? null);
}

export function handoffMemoHasForbiddenLiteral(memo = null) {
  try {
    return AMOUNT_RE.test(JSON.stringify(memo ?? {})) || URL_RE.test(JSON.stringify(memo ?? {}));
  } catch {
    return true;
  }
}

export function buildHandoffMemoUserText(memo = null) {
  const compact = compactHandoffMemo(memo);
  if (!compact) return "";
  return [
    "[KEY_HANDOFF_MEMO]",
    JSON.stringify({
      kind: "this_customer_handoff_context",
      not_verified_fact: true,
      memo: {
        interest: compact.interest,
        customer_speech: compact.customer_speech,
        unresolved: compact.unresolved,
        verified_fact_refs: compact.verified_fact_refs,
      },
    }),
  ].join("\n");
}

/** User-channel write contract. Not a system/HEART/VOICE rewrite. */
export function buildHandoffWriteContractUserText() {
  return [
    "[KEY_HANDOFF_WRITE]",
    "고객 답을 평문으로 끝낸 뒤에만, 고객에게 보이지 않는 인수인계를 한 번 붙일 수 있다.",
    KEY_HANDOFF_START,
    '{"interest":"짧은 관심","unresolved":"짧은 미해결"}',
    KEY_HANDOFF_END,
    "미해결이 끝났으면 unresolved를 빈 문자열로 둔다. 금액·특약값·URL·웹검색 내용을 쓰지 않는다. 이 블록을 고객에게 말하지 않는다.",
  ].join("\n");
}
